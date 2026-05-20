"""Facturacion Contabilium emitida por suscripciones MELI (Unidrop).

Identifica como factura de suscripcion MELI a las ContabilliumInvoice cuyo
idVentaIntegracion NO matchea con OrderMercadoLibre.id ni con
tienda_nube_orders.tienda_nube_id. Estas tienen un patron de id artificial
generado por Contabilium ({prefix}{DDMMAAAA} en el momento de la emision).

Enrich con dropshipper (User via ContabiliumClient.contabilium_id -> nro_doc
== User.dni) y plan (SubscriptionMeli.name/price).
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar, resolve_window


SUBS_FILTER_SQL = """
    LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml
      ON oml.id = ci."idVentaIntegracion"
    LEFT JOIN public.tienda_nube_orders tn
      ON tn.tienda_nube_id::text = ci."idVentaIntegracion"::text
"""
SUBS_WHERE_SQL = " oml.id IS NULL AND tn.tienda_nube_id IS NULL "


def finanzas_invoices_meli(
    period: str = "30d",
    plan: str = "all",
    tipo: str = "all",
    search: str | None = None,
    limit: int | None = None,
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """
    period: 7d|30d|90d|12m|custom
    plan: 'all' | str(subscriptionId)
    tipo: 'all' | 'FCA' | 'FCB'
    search: prefix-match en numeroComprobante, razon_social, dni, email, fantasy_name
    limit: tope de filas devueltas en items[]. Default None = todo (hard cap 10000).
    """
    w = resolve_window(period, from_iso, to_iso)
    eng = get_engine("unidrop")

    params: dict = {"from_ts": w["from_ts"], "to_ts": w["to_ts"]}
    extra_where = ""
    if tipo in ("FCA", "FCB"):
        extra_where += f' AND ci."tipoFc" = :tipo '
        params["tipo"] = tipo
    if plan != "all":
        try:
            params["plan_id"] = int(plan)
            extra_where += ' AND u."subscriptionId" = :plan_id '
        except (TypeError, ValueError):
            pass
    if search:
        params["s"] = f"%{search.strip()}%"
        extra_where += """ AND (
            ci."numeroComprobante" ILIKE :s
            OR cc.razon_social ILIKE :s
            OR cc.nro_doc ILIKE :s
            OR cc.email ILIKE :s
            OR u.fantasy_name ILIKE :s
            OR u.email ILIKE :s
        ) """

    base_from = f"""
        FROM contabillium_dev."ContabilliumInvoice" ci
        {SUBS_FILTER_SQL}
        LEFT JOIN contabillium_dev."ContabiliumClient" cc ON cc.contabilium_id = ci."idCliente"
        LEFT JOIN public."User" u ON u.dni = cc.nro_doc
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        WHERE {SUBS_WHERE_SQL}
          AND ci."fechaEmision" >= :from_ts AND ci."fechaEmision" < :to_ts
          {extra_where}
    """

    # KPI cards
    cards: list[dict] = []
    totals = q(eng, f"""
        SELECT COUNT(*)::int AS n,
               COALESCE(SUM(ci.total),0)::float AS total,
               COALESCE(AVG(ci.total),0)::float AS ticket,
               COUNT(*) FILTER (WHERE ci."tipoFc"='FCA')::int AS fca,
               COALESCE(SUM(CASE WHEN ci."tipoFc"='FCA' THEN ci.total ELSE 0 END),0)::float AS total_fca,
               COUNT(*) FILTER (WHERE ci."tipoFc"='FCB')::int AS fcb,
               COALESCE(SUM(CASE WHEN ci."tipoFc"='FCB' THEN ci.total ELSE 0 END),0)::float AS total_fcb,
               COUNT(DISTINCT ci."idCliente")::int AS clientes
        {base_from}
    """, params) or [(0, 0.0, 0.0, 0, 0.0, 0, 0.0, 0)]
    r = totals[0]
    n_inv, total, ticket, fca, total_fca, fcb, total_fcb, clientes = (
        int(r[0] or 0), float(r[1] or 0), float(r[2] or 0),
        int(r[3] or 0), float(r[4] or 0), int(r[5] or 0), float(r[6] or 0),
        int(r[7] or 0),
    )

    # Periodo previo equivalente para delta
    prev_window_days = int((w["to_ts"] - w["from_ts"]).total_seconds() / 86400) or 1
    p_prev = {
        "from_ts_prev": w["from_ts"] - dt.timedelta(days=prev_window_days),
        "to_ts_prev": w["from_ts"],
    }
    prev_total = float(scalar(eng, f"""
        SELECT COALESCE(SUM(ci.total),0)::float
        FROM contabillium_dev."ContabilliumInvoice" ci
        {SUBS_FILTER_SQL}
        WHERE {SUBS_WHERE_SQL}
          AND ci."fechaEmision" >= :from_ts_prev AND ci."fechaEmision" < :to_ts_prev
    """, p_prev) or 0)
    delta_total = ((total - prev_total) / prev_total * 100) if prev_total > 0 else None

    cards.append({
        "label": f"Facturado ({period})", "value": round(total, 0), "prefix": "$ ",
        "delta": round(delta_total, 1) if delta_total is not None else None,
        "hint": "Facturas Contabilium de suscripciones MELI",
    })
    cards.append({
        "label": "Facturas emitidas", "value": n_inv,
        "hint": f"{fca:,} FCA + {fcb:,} FCB",
    })
    cards.append({
        "label": "Ticket promedio", "value": round(ticket, 0), "prefix": "$ ",
        "hint": "total / cantidad",
    })
    cards.append({
        "label": "Dropshippers facturados", "value": clientes,
        "hint": "idCliente unicos",
    })
    cards.append({
        "label": "Total FCA", "value": round(total_fca, 0), "prefix": "$ ",
        "hint": f"{fca:,} comprobantes",
    })
    cards.append({
        "label": "Total FCB", "value": round(total_fcb, 0), "prefix": "$ ",
        "hint": f"{fcb:,} comprobantes",
    })

    # Trend mensual 12m (sin filtros adicionales, solo periodo fijo 12m)
    rows = q(eng, """
        SELECT date_trunc('month', ci."fechaEmision")::date AS mes,
               COUNT(*)::int AS n,
               COALESCE(SUM(ci.total),0)::float AS total,
               COALESCE(SUM(CASE WHEN ci."tipoFc"='FCA' THEN ci.total ELSE 0 END),0)::float AS total_fca,
               COALESCE(SUM(CASE WHEN ci."tipoFc"='FCB' THEN ci.total ELSE 0 END),0)::float AS total_fcb
        FROM contabillium_dev."ContabilliumInvoice" ci
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml
          ON oml.id = ci."idVentaIntegracion"
        LEFT JOIN public.tienda_nube_orders tn
          ON tn.tienda_nube_id::text = ci."idVentaIntegracion"::text
        WHERE oml.id IS NULL AND tn.tienda_nube_id IS NULL
          AND ci."fechaEmision" >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """) or []
    trends = [
        {
            "label": "Facturacion total",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[2] or 0)} for r in rows],
        },
        {
            "label": "FCA",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[3] or 0)} for r in rows],
        },
        {
            "label": "FCB",
            "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[4] or 0)} for r in rows],
        },
    ]

    # Distribucion por plan
    rows = q(eng, f"""
        SELECT u."subscriptionId" AS plan_id,
               COALESCE(sm.name, 'Sin plan') AS plan_name,
               COALESCE(sm.price, 0)::float AS plan_price,
               COUNT(*)::int AS n,
               COALESCE(SUM(ci.total),0)::float AS total
        {base_from}
        GROUP BY 1, 2, 3
        ORDER BY total DESC NULLS LAST
        LIMIT 15
    """, params) or []
    by_plan = [{
        "category": f"{r[1] or 'Sin plan'}",
        "value": float(r[4] or 0),
        "extra": {
            "plan_id": int(r[0] or 0) if r[0] else 0,
            "precio": float(r[2] or 0),
            "cantidad": int(r[3] or 0),
        },
    } for r in rows]

    # Distribucion por tipoFc
    rows = q(eng, f"""
        SELECT ci."tipoFc",
               COUNT(*)::int AS n,
               COALESCE(SUM(ci.total),0)::float AS total
        {base_from}
        GROUP BY 1 ORDER BY 3 DESC
    """, params) or []
    by_tipo = [{
        "category": r[0] or "?",
        "value": float(r[2] or 0),
        "extra": {"cantidad": int(r[1] or 0)},
    } for r in rows]

    # Listing
    items_params = dict(params)
    HARD_CAP = 10000
    effective_limit = HARD_CAP if limit is None else max(1, min(int(limit), HARD_CAP))
    items_params["limit"] = effective_limit
    rows = q(eng, f"""
        SELECT ci.id,
               ci."tipoFc",
               ci."numeroComprobante",
               ci."fechaEmision"::date::text AS fecha_emision,
               ci.total::float,
               ci."idVentaIntegracion"::text,
               ci."idCliente",
               ci.cae,
               ci."linkPublico",
               cc.razon_social,
               cc.nro_doc,
               cc.email AS email_cliente,
               u.id AS user_id,
               u.fantasy_name,
               u.email AS user_email,
               u.dni AS user_dni,
               u."subscriptionId" AS plan_id,
               sm.name AS plan_name,
               u.subscription_status::text AS sub_status,
               u.end_date_subscription::date::text AS sub_end_date
        {base_from}
        ORDER BY ci."fechaEmision" DESC NULLS LAST, ci.id DESC
        LIMIT :limit
    """, items_params) or []
    items = [{
        "id": int(r[0] or 0),
        "tipo": r[1] or "",
        "numero": r[2] or "",
        "fecha_emision": r[3],
        "total": float(r[4] or 0),
        "id_venta_integracion": r[5],
        "id_cliente": int(r[6] or 0) if r[6] else None,
        "cae": r[7] or "",
        "link_publico": r[8] or "",
        "cliente_razon_social": r[9] or "",
        "cliente_dni": r[10] or "",
        "cliente_email": r[11] or "",
        "user_id": int(r[12] or 0) if r[12] else None,
        "fantasy_name": r[13] or "",
        "user_email": r[14] or "",
        "user_dni": r[15] or "",
        "plan_id": int(r[16] or 0) if r[16] else None,
        "plan_name": r[17] or "",
        "subscription_status": r[18] or "",
        "subscription_end_date": r[19],
    } for r in rows]

    # Lista de planes activos para el filtro del frontend
    rows = q(eng, """
        SELECT id, name, price::float FROM mercado_libre_dev."SubscriptionMeli"
        ORDER BY id
    """) or []
    plans = [{"id": int(r[0]), "name": r[1] or f"Plan {r[0]}", "price": float(r[2] or 0)} for r in rows]

    return {
        "unit": "unidrop",
        "period": period,
        "cards": cards,
        "trends": trends,
        "by_plan": by_plan,
        "by_tipo": by_tipo,
        "items": items,
        "items_count": len(items),
        "items_truncated": len(items) >= effective_limit,
        "plans": plans,
        "filters": {"plan": plan, "tipo": tipo, "search": search or ""},
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
