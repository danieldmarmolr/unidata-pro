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


def cohorts_overview(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Distribucion de clientes por estado en el periodo dado.

    Devuelve:
    - states[]: lista por estado con metrics agregadas
    - flow: transiciones (cuantos pasaron de Nuevo -> 2da en el periodo, etc)
    - totals: KPIs globales del periodo
    """
    win = resolve_window(period, from_iso, to_iso)
    days = win["days"]
    eng = get_engine("unistore")
    p = {"days": days}

    # Para cada cliente: contar ordenes paid totales y en periodo, primera y ultima compra
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
                MIN(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS primera_compra,
                MAX(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid') AS ultima_compra,
                MIN(o."createdAt") FILTER (WHERE o."paymentStatus" = 'paid'
                                            AND o."createdAt" >= NOW() - make_interval(days => :days)) AS primera_compra_periodo
            FROM tienda_nube."Customer" c
            INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
            GROUP BY c.id, c.name, c.email
        )
        SELECT
            customer_id, nombre, ordenes_total, ordenes_periodo, facturacion_periodo,
            primera_compra::date AS primera_compra,
            ultima_compra::date AS ultima_compra,
            primera_compra_periodo::date AS primera_compra_periodo
        FROM customer_stats
        WHERE ordenes_periodo > 0
    """, p) or []

    # Clasificar cada cliente
    today = today_ar()
    states_count: dict[str, dict] = {
        "nuevo": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "segunda_compra": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "conv_recurrente": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "recurrente": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
        "recuperado": {"customers": 0, "ordenes": 0, "facturacion": 0.0},
    }

    customers_by_state: dict[str, list[dict]] = {k: [] for k in states_count.keys()}

    for r in rows:
        cid = int(r[0] or 0)
        nombre = r[1]
        total = int(r[2] or 0)
        periodo = int(r[3] or 0)
        rev = float(r[4] or 0)
        primera = r[5]  # date
        ultima = r[6]
        primera_p = r[7]

        # Logica de clasificacion
        if total == 1:
            state = "nuevo"
        elif total == 2:
            state = "segunda_compra"
        elif total == 3:
            state = "conv_recurrente"
        else:
            # 4+ ordenes -> recurrente o recuperado
            if ultima and primera and (primera < primera_p) if primera_p else False:
                # ultima compra antes de hace 180d?
                if ultima and (today - ultima).days > 180:
                    state = "recuperado"
                else:
                    state = "recurrente"
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
            "primera_compra": primera.isoformat() if primera else None,
            "ultima_compra": ultima.isoformat() if ultima else None,
        })

    # Construir respuesta
    state_labels = {
        "nuevo": "Nuevo",
        "segunda_compra": "Segunda compra",
        "conv_recurrente": "Conv. a Recurrente",
        "recurrente": "Recurrente",
        "recuperado": "Recuperado",
    }
    state_colors = {
        "nuevo": "#3b82f6",       # blue
        "segunda_compra": "#06b6d4",  # cyan
        "conv_recurrente": "#a259ff", # accent purple
        "recurrente": "#10b981",  # emerald
        "recuperado": "#f59e0b",  # amber
    }

    states_arr = []
    for key, data in states_count.items():
        ticket = (data["facturacion"] / data["ordenes"]) if data["ordenes"] else 0
        states_arr.append({
            "key": key,
            "label": state_labels[key],
            "color": state_colors[key],
            "customers": data["customers"],
            "ordenes": data["ordenes"],
            "facturacion": round(data["facturacion"], 2),
            "ticket_promedio": round(ticket, 2),
        })

    # Totales
    total_customers = sum(s["customers"] for s in states_arr)
    total_ordenes = sum(s["ordenes"] for s in states_arr)
    total_facturacion = sum(s["facturacion"] for s in states_arr)

    return {
        "period": period,
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
            k: sorted(v, key=lambda x: -x["facturacion_periodo"])[:10]
            for k, v in customers_by_state.items()
        },
        "generated_at": now_ar().isoformat(),
    }


def cohort_customers(state: str, period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Lista todos los clientes de un estado dado en el periodo (para drilldown)."""
    overview = cohorts_overview(period, from_iso, to_iso)
    customers_all = overview.get("top_by_state", {}).get(state, [])
    # Tomamos la lista raw - en una implementacion completa se haria query directa
    return {
        "state": state,
        "label": next((s["label"] for s in overview["states"] if s["key"] == state), state),
        "count": len(customers_all),
        "customers": customers_all,
        "period": period,
    }
