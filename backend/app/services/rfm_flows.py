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
            }
        transitions[key]["count"] += 1
        if "previous" in periods:
            transitions[key]["revenue_a"] += periods["previous"]["revenue"]
        if "current" in periods:
            transitions[key]["revenue_b"] += periods["current"]["revenue"]

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
