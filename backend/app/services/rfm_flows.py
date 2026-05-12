"""
RFM Flows mes a mes - migracion entre segmentos.

Calcula el segmento RFM de cada cliente en MES_PASADO y MES_ACTUAL,
luego cuenta las transiciones (from -> to).

Util para responder preguntas como:
- Cuantos Champions se volvieron At Risk este mes? (alerta de fuga top)
- Cuantos New Customers ascendieron a Loyal? (efectividad del onboarding)
- Cuantos Lost volvieron a comprar? (efectividad de reactivacion)

Output: lista de transiciones {from, to, count, revenue_a, revenue_b}
listo para Sankey diagram.
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q
from app.services.rfm_analytics import _classify_segment, _quintile_score, SEGMENTS, SEGMENT_ACTIONS

log = logging.getLogger("unidata.rfm_flows")


def rfm_flows_mom() -> dict:
    """Migracion de segmentos RFM entre el ultimo mes y el mes previo.

    Para cada cliente con compras en cualquiera de los 2 meses, calcula
    su segmento RFM en cada mes. Las transiciones agregadas se devuelven
    listas para renderizar un Sankey diagram (from -> to).
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        WITH base AS (
            SELECT o."customerId" AS cid,
                   o.id AS oid,
                   o."createdAt" AS fecha,
                   o.total::float AS total,
                   CASE
                     WHEN o."createdAt" >= NOW() - INTERVAL '30 days' THEN 'current'
                     WHEN o."createdAt" >= NOW() - INTERVAL '60 days' THEN 'previous'
                     ELSE 'older'
                   END AS bucket
            FROM tienda_nube."Order" o
            WHERE o."paymentStatus" = 'paid'
              AND o."customerId" IS NOT NULL
              AND o."createdAt" >= NOW() - INTERVAL '120 days'
        )
        SELECT cid, bucket,
               COUNT(*)::int AS orders,
               MAX(fecha)::date AS last,
               SUM(total)::float AS revenue
        FROM base
        WHERE bucket IN ('current', 'previous')
        GROUP BY cid, bucket
    """) or []

    # Estructura: { customer_id: { current: {orders, last, revenue}, previous: {...} } }
    by_customer: dict[int, dict[str, dict]] = {}
    for r in rows:
        cid = int(r[0] or 0)
        bucket = r[1]
        if cid not in by_customer:
            by_customer[cid] = {}
        by_customer[cid][bucket] = {
            "orders": int(r[2] or 0),
            "last": r[3],
            "revenue": float(r[4] or 0),
        }

    # Para clasificar RFM necesito quintiles. Uso los del mes ACTUAL como
    # baseline (asumiendo el comportamiento "normal" del mes en curso).
    current_orders_dist = sorted([d["current"]["orders"] for d in by_customer.values() if "current" in d])
    current_rev_dist = sorted([d["current"]["revenue"] for d in by_customer.values() if "current" in d])

    # Recency: dias desde ultima compra desde fecha de cohorte
    today = dt.date.today()
    current_recency_dist = sorted([
        (today - d["current"]["last"]).days
        for d in by_customer.values()
        if "current" in d and d["current"]["last"]
    ])

    if not current_orders_dist:
        return {
            "flows": [],
            "segments": SEGMENTS,
            "current_month_start": (today - dt.timedelta(days=30)).isoformat(),
            "previous_month_start": (today - dt.timedelta(days=60)).isoformat(),
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }

    def classify(orders: int, recency_days: int, revenue: float) -> str:
        f = _quintile_score(orders, current_orders_dist, higher_is_better=True)
        r = _quintile_score(recency_days, current_recency_dist, higher_is_better=False)
        m = _quintile_score(revenue, current_rev_dist, higher_is_better=True)
        return _classify_segment(r, f, m)

    # Para cada cliente, calcular segmento en current y previous
    transitions: dict[tuple[str, str], dict] = {}
    for cid, periods in by_customer.items():
        cur_seg = None
        prev_seg = None
        if "current" in periods and periods["current"]["last"]:
            d = periods["current"]
            cur_seg = classify(d["orders"], (today - d["last"]).days, d["revenue"])
        if "previous" in periods and periods["previous"]["last"]:
            d = periods["previous"]
            # Para previous tambien uso current distribution como baseline para
            # comparabilidad (mismos thresholds).
            prev_seg = classify(d["orders"], (today - d["last"]).days, d["revenue"])

        # 4 casos de transicion:
        if prev_seg and cur_seg:
            key = (prev_seg, cur_seg)
        elif prev_seg and not cur_seg:
            key = (prev_seg, "_inactivo")  # estaba activo, no compro este mes
        elif not prev_seg and cur_seg:
            key = ("_nuevo", cur_seg)  # primera vez aparece
        else:
            continue  # ambos None - no clasificable

        if key not in transitions:
            transitions[key] = {
                "from": key[0], "to": key[1],
                "count": 0, "revenue_a": 0.0, "revenue_b": 0.0,
                "customer_ids": [],
            }
        transitions[key]["count"] += 1
        if "previous" in periods:
            transitions[key]["revenue_a"] += periods["previous"]["revenue"]
        if "current" in periods:
            transitions[key]["revenue_b"] += periods["current"]["revenue"]
        # Guardamos los IDs para hacer drill-down despues. Capamos a 500 para
        # mantener el payload manejable en transiciones gigantes.
        if len(transitions[key]["customer_ids"]) < 500:
            transitions[key]["customer_ids"].append(int(cid))

    # Lista ordenada por count desc
    flows = sorted(transitions.values(), key=lambda x: -x["count"])
    for f in flows:
        f["revenue_a"] = round(f["revenue_a"], 0)
        f["revenue_b"] = round(f["revenue_b"], 0)

    # Resumen ejecutivo: alertas mas importantes
    alerts: list[dict] = []
    for f in flows:
        # Champions -> At Risk = alerta critica
        if f["from"] == "champions" and f["to"] == "at_risk":
            alerts.append({
                "severity": "high",
                "icon": "🆘",
                "title": f"{f['count']} Champions cayeron a At Risk",
                "body": "Tus mejores clientes se estan alejando. Intervencion urgente.",
            })
        # New -> Lost = onboarding malo
        if f["from"] == "new" and f["to"] in ("lost", "_inactivo"):
            alerts.append({
                "severity": "medium",
                "icon": "👋",
                "title": f"{f['count']} clientes Nuevos no volvieron",
                "body": "Problema de onboarding o producto. Revisar primera experiencia.",
            })
        # Hibernating -> active = win-back exitoso
        if f["from"] in ("hibernating", "lost") and f["to"] in ("champions", "loyal", "potential_loyalist"):
            alerts.append({
                "severity": "info",
                "icon": "✨",
                "title": f"{f['count']} clientes reactivados",
                "body": "Win-back funcionando. Replicar la estrategia que los trajo de vuelta.",
            })

    return {
        "flows": flows,
        "segments": SEGMENTS,
        "actions": SEGMENT_ACTIONS,
        "alerts": alerts[:10],
        "current_month_start": (today - dt.timedelta(days=30)).isoformat(),
        "previous_month_start": (today - dt.timedelta(days=60)).isoformat(),
        "total_customers": len(by_customer),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def rfm_flows_customers(from_seg: str, to_seg: str, limit: int = 100) -> dict:
    """Devuelve la lista de clientes de una transicion FROM->TO especifica.

    Re-corre rfm_flows_mom (es cacheable a nivel router) y extrae los IDs
    de la transicion pedida. Despues hace una query a tienda_nube.Customer
    para enriquecer con nombre, email, ordenes y revenue del periodo.
    """
    base = rfm_flows_mom()
    flows = base.get("flows", [])
    target = next((f for f in flows if f["from"] == from_seg and f["to"] == to_seg), None)
    if not target:
        return {"from": from_seg, "to": to_seg, "customers": [], "total": 0}

    ids = target.get("customer_ids", [])[:limit]
    if not ids:
        return {"from": from_seg, "to": to_seg, "customers": [], "total": int(target.get("count", 0))}

    eng = get_engine("unistore")
    rows = q(eng, """
        WITH ids AS (SELECT UNNEST(:ids::int[]) AS id),
             ord_curr AS (
               SELECT o."customerId" AS cid,
                      COUNT(*)::int AS orders_cur,
                      MAX(o."createdAt")::date AS last_cur,
                      COALESCE(SUM(o.total),0)::float AS rev_cur
               FROM tienda_nube."Order" o
               WHERE o."paymentStatus"='paid'
                 AND o."createdAt" >= NOW() - INTERVAL '30 days'
                 AND o."customerId" = ANY(:ids::int[])
               GROUP BY o."customerId"
             ),
             ord_prev AS (
               SELECT o."customerId" AS cid,
                      COUNT(*)::int AS orders_prev,
                      MAX(o."createdAt")::date AS last_prev,
                      COALESCE(SUM(o.total),0)::float AS rev_prev
               FROM tienda_nube."Order" o
               WHERE o."paymentStatus"='paid'
                 AND o."createdAt" >= NOW() - INTERVAL '60 days'
                 AND o."createdAt" <  NOW() - INTERVAL '30 days'
                 AND o."customerId" = ANY(:ids::int[])
               GROUP BY o."customerId"
             )
        SELECT ids.id,
               COALESCE(c.name, c.email, 'Customer ' || ids.id::text) AS nombre,
               c.email,
               COALESCE(oc.orders_cur, 0) AS orders_cur,
               COALESCE(op.orders_prev, 0) AS orders_prev,
               COALESCE(oc.rev_cur, 0)::float AS rev_cur,
               COALESCE(op.rev_prev, 0)::float AS rev_prev,
               oc.last_cur::text AS last_cur,
               op.last_prev::text AS last_prev
        FROM ids
        LEFT JOIN tienda_nube."Customer" c ON c.id = ids.id
        LEFT JOIN ord_curr oc ON oc.cid = ids.id
        LEFT JOIN ord_prev op ON op.cid = ids.id
        ORDER BY (COALESCE(oc.rev_cur,0) + COALESCE(op.rev_prev,0)) DESC NULLS LAST
    """, {"ids": ids}) or []

    customers = [{
        "customer_id": int(r[0]),
        "nombre": r[1] or "",
        "email": r[2] or "",
        "orders_cur": int(r[3] or 0),
        "orders_prev": int(r[4] or 0),
        "revenue_cur": round(float(r[5] or 0), 2),
        "revenue_prev": round(float(r[6] or 0), 2),
        "last_cur": r[7],
        "last_prev": r[8],
    } for r in rows]

    return {
        "from": from_seg,
        "to": to_seg,
        "customers": customers,
        "total": int(target.get("count", 0)),
        "showing": len(customers),
    }
