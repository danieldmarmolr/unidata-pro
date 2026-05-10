"""
Cohortes de clientes - replica del PowerBI ERP Analytics (page 3-5).

Clasifica clientes en estados segun su historia de compras:
- nuevo: primera compra en el periodo (1 sola compra total)
- segunda_compra: 2da orden (siempre clasifica asi sin importar periodo)
- conv_recurrente: 3ra orden (transicion de "segunda" a "recurrente")
- recurrente: 4+ ordenes en los ultimos 90 dias
- recuperado: cliente con historial pero su ultima compra >180d antes,
  ahora volvio
- inactivo: cliente con compras pero ninguna en los ultimos 180 dias

Devuelve agregados por estado: cantidad de clientes, ordenes totales,
facturacion, ticket promedio.
"""
from __future__ import annotations

import datetime as dt

from app.utils.tz import today_ar, now_ar
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar, resolve_window

log = logging.getLogger("unidata.cohorts")


def cohorts_overview(
    period: str = "30d",
    from_iso: str | None = None,
    to_iso: str | None = None,
    unit: str = "unistore",
) -> dict:
    """Distribucion de clientes por estado en el periodo dado.

    unit: 'unistore' = clientes finales (compradores TN), 'unidrop' = dropshippers
    operadores de Unidrop (con suscripcion / cuenta MELI).

    Devuelve:
    - states[]: lista por estado con metrics agregadas
    - totals: KPIs globales del periodo

    Estados:
    - nuevo / segunda_compra / conv_recurrente / recurrente / recuperado
    - posible_churn: customer recurrente cuyo gap actual desde su ultima compra
      excede 1.5x el promedio de gaps historicos (o 60d si no hay historial).
    """
    if unit == "unidrop":
        return _cohorts_overview_unidrop(period, from_iso, to_iso)

    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unistore")
    p = {"days": days}

    # Por cada cliente: ordenes totales/periodo, primera/ultima compra,
    # gap promedio entre compras (para detectar Posible churn).
    rows = q(eng, """
        WITH customer_stats AS (
            SELECT
                c.id AS customer_id,
                COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
                COUNT(o.id) FILTER (WHERE o."paymentStatus" = 'paid')::int AS ordenes_total,
                COUNT(o.id) FILTER (WHERE o."paymentStatus" = 'paid'
                                    AND o."createdAt" >= NOW() - make_interval(days => :days))::int AS ordenes_periodo,
                SUM(o.total) FILTER (WHERE o."paymentStatus" = 'paid'
                                     AND o."createdAt" >= NOW() - make_interval(days => :days))::float AS facturacion_periodo,
                SUM(o.total) FILTER (WHERE o."paymentStatus" = 'paid')::float AS facturacion_total,
                MIN(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS primera_compra,
                MAX(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS ultima_compra
            FROM tienda_nube."Customer" c
            INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
            GROUP BY c.id, c.name, c.email
        ),
        gap_stats AS (
            SELECT "customerId" AS cid,
                   AVG(EXTRACT(DAY FROM ("createdAt" - prev_at)))::float AS avg_gap_days
            FROM (
                SELECT "customerId", "createdAt",
                       LAG("createdAt") OVER (PARTITION BY "customerId" ORDER BY "createdAt") AS prev_at
                FROM tienda_nube."Order"
                WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
            ) x WHERE prev_at IS NOT NULL
            GROUP BY 1
        )
        SELECT
            cs.customer_id, cs.nombre, cs.ordenes_total, cs.ordenes_periodo, cs.facturacion_periodo,
            cs.facturacion_total,
            cs.primera_compra::date AS primera_compra,
            cs.ultima_compra::date AS ultima_compra,
            COALESCE(gs.avg_gap_days, 0) AS avg_gap_days,
            EXTRACT(DAY FROM (NOW() - cs.ultima_compra))::int AS dias_desde_ultima
        FROM customer_stats cs
        LEFT JOIN gap_stats gs ON gs.cid = cs.customer_id
        WHERE cs.ordenes_total > 0
    """, p) or []

    # Clasificar cada cliente
    today = today_ar()
    states_count: dict[str, dict] = {
        "nuevo": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "segunda_compra": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "conv_recurrente": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "recurrente": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "recuperado": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "posible_churn": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "perdidos": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
    }

    customers_by_state: dict[str, list[dict]] = {k: [] for k in states_count.keys()}

    for r in rows:
        cid = int(r[0] or 0)
        nombre = r[1]
        total = int(r[2] or 0)
        periodo = int(r[3] or 0)
        rev = float(r[4] or 0)
        rev_total = float(r[5] or 0)
        primera = r[6]  # date
        ultima = r[7]
        avg_gap_days = float(r[8] or 0)
        dias_desde_ultima = int(r[9] or 0) if r[9] is not None else 9999

        # Detectar primero los churn / perdidos (independiente del periodo de compras).
        # Estos NO requieren que haya comprado en el periodo - son riesgo activo.
        is_perdido = total >= 2 and dias_desde_ultima > 365
        # Posible churn: clientes recurrentes (>=2 ordenes) cuyo gap actual desde
        # su ultima compra excede 1.5x su gap promedio. Si no tiene historial de
        # gaps suficiente, usar 60d como umbral por default.
        threshold_days = max(60, avg_gap_days * 1.5) if avg_gap_days > 0 else 60
        is_churn = (
            total >= 2
            and not is_perdido
            and dias_desde_ultima > threshold_days
        )

        if is_perdido:
            state = "perdidos"
        elif is_churn:
            state = "posible_churn"
        elif periodo == 0:
            # No compro en el periodo y no es churn/perdido aun -> no se clasifica.
            continue
        elif total == 1:
            state = "nuevo"
        elif total == 2:
            state = "segunda_compra"
        elif total == 3:
            state = "conv_recurrente"
        else:
            # 4+ ordenes pero la ultima fue > 180d antes de hoy = recuperado
            if ultima and (today - ultima).days > 180:
                state = "recuperado"
            else:
                state = "recurrente"

        states_count[state]["customers"] += 1
        states_count[state]["ordenes"] += periodo
        states_count[state]["facturacion"] += rev
        customers_by_state[state].append({
            "customer_id": cid,
            "nombre": nombre,
            "ordenes_total": total,
            "ordenes_periodo": periodo,
            "facturacion_periodo": round(rev, 2),
            "facturacion_total": round(rev_total, 2),
            "primera_compra": primera.isoformat() if primera else None,
            "ultima_compra": ultima.isoformat() if ultima else None,
            "avg_gap_days": round(avg_gap_days, 1),
            "dias_desde_ultima": dias_desde_ultima,
        })

    # Construir respuesta
    state_labels = {
        "nuevo": "Nuevo",
        "segunda_compra": "Segunda compra",
        "conv_recurrente": "Conv. a Recurrente",
        "recurrente": "Recurrente",
        "recuperado": "Recuperado",
        "posible_churn": "Posible churn",
        "perdidos": "Perdidos",
    }
    state_colors = {
        "nuevo": "#3b82f6",       # blue
        "segunda_compra": "#06b6d4",  # cyan
        "conv_recurrente": "#a259ff", # accent purple
        "recurrente": "#10b981",  # emerald
        "recuperado": "#f59e0b",  # amber
        "posible_churn": "#ef4444", # red - alerta
        "perdidos": "#475569",    # slate - inactivo
    }
    state_descriptions = {
        "nuevo": "Primera compra del cliente",
        "segunda_compra": "2da orden del historial",
        "conv_recurrente": "3ra orden = transicion a recurrente",
        "recurrente": "4+ ordenes activas",
        "recuperado": "Cliente con compra >180d que volvio",
        "posible_churn": "Cliente recurrente que paso de su gap esperado · accion sugerida",
        "perdidos": "Sin compras desde hace mas de 365 dias",
    }

    states_arr = []
    for key, data in states_count.items():
        ticket = (data["facturacion"] / data["ordenes"]) if data["ordenes"] else 0
        states_arr.append({
            "key": key,
            "label": state_labels[key],
            "color": state_colors[key],
            "description": state_descriptions[key],
            "customers": data["customers"],
            "ordenes": data["ordenes"],
            "facturacion": round(data["facturacion"], 2),
            "ticket_promedio": round(ticket, 2),
        })

    # Totales (solo de los que tienen actividad en el periodo - excluye
    # perdidos que no aportan a las ventas del periodo)
    active_states = [s for s in states_arr if s["key"] not in ("perdidos",)]
    total_customers = sum(s["customers"] for s in active_states)
    total_ordenes = sum(s["ordenes"] for s in active_states)
    total_facturacion = sum(s["facturacion"] for s in active_states)

    return {
        "period": period,
        "unit": "unistore",
        "window": {"days": days},
        "totals": {
            "customers": total_customers,
            "ordenes": total_ordenes,
            "facturacion": round(total_facturacion, 2),
            "ticket_promedio": round(total_facturacion / total_ordenes, 2) if total_ordenes else 0,
        },
        "states": states_arr,
        # Top 10 clientes por estado para drilldown
        "top_by_state": {
            k: sorted(v, key=lambda x: -x.get("facturacion_total", 0))[:10]
            for k, v in customers_by_state.items()
        },
        "generated_at": now_ar().isoformat(),
    }


def _cohorts_overview_unidrop(period: str, from_iso: str | None, to_iso: str | None) -> dict:
    """Cohortes Unidrop: clasifica DROPSHIPPERS (operadores) por su patron de
    actividad de ventas MELI + TN, no clientes finales. Usa MercadoLibre
    OrderMercadoLibre + tienda_nube_orders + PaymentIntent.

    Estados: nuevo (1 venta), segunda_compra, conv_recurrente, recurrente,
    recuperado, posible_churn, perdidos. Mismo criterio temporal que Unistore.
    """
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unidrop")

    rows = q(eng, """
        WITH stats AS (
          SELECT u.id AS customer_id,
                 COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'User '||u.id::text) AS nombre,
                 -- Ordenes ML pagadas
                 (SELECT COUNT(*) FROM mercado_libre_dev."OrderMercadoLibre" o
                  INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
                  WHERE mla."userId" = u.id AND o."status" = 'paid')::int AS ordenes_ml,
                 -- Ordenes TN pagadas
                 (SELECT COUNT(*) FROM public.tienda_nube_orders WHERE user_id = u.id AND payment_status::text = 'paid')::int AS ordenes_tn,
                 -- Ultima venta (entre ML y TN)
                 GREATEST(
                   COALESCE((SELECT MAX("dateCreated") FROM mercado_libre_dev."OrderMercadoLibre" o
                             INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
                             WHERE mla."userId" = u.id AND o."status" = 'paid'), 'epoch'::timestamp),
                   COALESCE((SELECT MAX(created_at) FROM public.tienda_nube_orders WHERE user_id = u.id AND payment_status::text = 'paid'), 'epoch'::timestamp)
                 ) AS ultima_venta,
                 -- Primera venta
                 LEAST(
                   COALESCE((SELECT MIN("dateCreated") FROM mercado_libre_dev."OrderMercadoLibre" o
                             INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
                             WHERE mla."userId" = u.id AND o."status" = 'paid'), 'infinity'::timestamp),
                   COALESCE((SELECT MIN(created_at) FROM public.tienda_nube_orders WHERE user_id = u.id AND payment_status::text = 'paid'), 'infinity'::timestamp)
                 ) AS primera_venta
          FROM public."User" u
          WHERE u."subscriptionId" IS NOT NULL OR u."mercadoLibreAccountId" IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.tienda_nube_orders tno WHERE tno.user_id = u.id)
        )
        SELECT customer_id, nombre,
               (ordenes_ml + ordenes_tn) AS ordenes_total,
               ultima_venta::date AS ultima_compra,
               primera_venta::date AS primera_compra,
               EXTRACT(DAY FROM (NOW() - ultima_venta))::int AS dias_desde_ultima,
               ordenes_ml, ordenes_tn
        FROM stats
        WHERE (ordenes_ml + ordenes_tn) > 0
    """) or []

    today = today_ar()
    states_count: dict[str, dict] = {
        "nuevo": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "segunda_compra": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "conv_recurrente": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "recurrente": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "recuperado": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "posible_churn": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "perdidos": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
    }
    customers_by_state: dict[str, list[dict]] = {k: [] for k in states_count.keys()}

    for r in rows:
        cid = int(r[0] or 0)
        nombre = r[1]
        total = int(r[2] or 0)
        ultima = r[3]
        primera = r[4]
        dias_desde_ultima = int(r[5] or 0) if r[5] is not None else 9999
        ml_count = int(r[6] or 0)
        tn_count = int(r[7] or 0)

        is_perdido = total >= 2 and dias_desde_ultima > 365
        is_churn = total >= 2 and not is_perdido and dias_desde_ultima > 60

        if is_perdido:
            state = "perdidos"
        elif is_churn:
            state = "posible_churn"
        elif total == 1:
            state = "nuevo"
        elif total == 2:
            state = "segunda_compra"
        elif total == 3:
            state = "conv_recurrente"
        else:
            if ultima and (today - ultima).days > 180:
                state = "recuperado"
            else:
                state = "recurrente"

        states_count[state]["customers"] += 1
        states_count[state]["ordenes"] += total
        customers_by_state[state].append({
            "customer_id": cid,
            "nombre": nombre,
            "ordenes_total": total,
            "ordenes_ml": ml_count,
            "ordenes_tn": tn_count,
            "primera_compra": primera.isoformat() if primera else None,
            "ultima_compra": ultima.isoformat() if ultima else None,
            "dias_desde_ultima": dias_desde_ultima,
        })

    state_labels = {
        "nuevo": "Nuevo", "segunda_compra": "Segunda venta",
        "conv_recurrente": "Conv. a Recurrente", "recurrente": "Recurrente",
        "recuperado": "Recuperado", "posible_churn": "Posible churn",
        "perdidos": "Perdidos",
    }
    state_colors = {
        "nuevo": "#3b82f6", "segunda_compra": "#06b6d4",
        "conv_recurrente": "#a259ff", "recurrente": "#10b981",
        "recuperado": "#f59e0b", "posible_churn": "#ef4444",
        "perdidos": "#475569",
    }
    state_descriptions = {
        "nuevo": "Primera venta del dropshipper",
        "segunda_compra": "2da venta del historial",
        "conv_recurrente": "3ra venta = paso a recurrente",
        "recurrente": "4+ ventas activas",
        "recuperado": "Volvio a vender despues de 180+ dias inactivo",
        "posible_churn": "Sin ventas hace 60+ dias · accion sugerida",
        "perdidos": "Sin ventas desde hace mas de 365 dias",
    }

    states_arr = []
    for key, dat in states_count.items():
        states_arr.append({
            "key": key, "label": state_labels[key], "color": state_colors[key],
            "description": state_descriptions[key],
            "customers": dat["customers"], "ordenes": dat["ordenes"],
            "facturacion": 0.0, "ticket_promedio": 0.0,
        })

    active = [s for s in states_arr if s["key"] != "perdidos"]
    return {
        "period": period,
        "unit": "unidrop",
        "window": {"days": days},
        "totals": {
            "customers": sum(s["customers"] for s in active),
            "ordenes": sum(s["ordenes"] for s in active),
            "facturacion": 0,
            "ticket_promedio": 0,
        },
        "states": states_arr,
        "top_by_state": {
            k: sorted(v, key=lambda x: -x.get("ordenes_total", 0))[:10]
            for k, v in customers_by_state.items()
        },
        "generated_at": now_ar().isoformat(),
    }


def cohort_customers(state: str, period: str = "30d", from_iso: str | None = None, to_iso: str | None = None, unit: str = "unistore") -> dict:
    """Lista todos los clientes de un estado dado en el periodo (para drilldown).

    Devuelve formato {columns, rows, row_count} compatible con DrillDownModal.
    """
    overview = cohorts_overview(period, from_iso, to_iso, unit=unit)
    customers_all = overview.get("top_by_state", {}).get(state, [])

    if unit == "unidrop":
        cols = ["user_id", "nombre", "ordenes_total", "ordenes_ml", "ordenes_tn", "ultima_compra", "dias_desde_ultima", "_unit"]
        rows = [[
            c.get("customer_id"),
            c.get("nombre"),
            c.get("ordenes_total"),
            c.get("ordenes_ml"),
            c.get("ordenes_tn"),
            c.get("ultima_compra"),
            c.get("dias_desde_ultima"),
            "unidrop",
        ] for c in customers_all]
    else:
        cols = [
            "customer_id", "cliente", "ordenes_total", "ordenes_periodo",
            "facturacion_periodo", "facturacion_total",
            "ultima_compra", "dias_desde_ultima", "avg_gap_days",
        ]
        rows = [[
            c.get("customer_id"),
            c.get("nombre"),
            c.get("ordenes_total"),
            c.get("ordenes_periodo"),
            c.get("facturacion_periodo"),
            c.get("facturacion_total"),
            c.get("ultima_compra"),
            c.get("dias_desde_ultima"),
            c.get("avg_gap_days"),
        ] for c in customers_all]

    return {
        "columns": cols,
        "rows": rows,
        "row_count": len(rows),
        "state": state,
        "label": next((s["label"] for s in overview["states"] if s["key"] == state), state),
        "period": period,
        "unit": unit,
    }
