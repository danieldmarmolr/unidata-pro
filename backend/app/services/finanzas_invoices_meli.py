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


_GRAN_CONFIG = {
    "day":     {"trunc": "day",     "fmt": "%Y-%m-%d", "interval": "60 days"},
    "week":    {"trunc": "week",    "fmt": "%G-W%V",   "interval": "26 weeks"},
    "month":   {"trunc": "month",   "fmt": "%Y-%m",    "interval": "24 months"},
    "quarter": {"trunc": "quarter", "fmt": "%Y-Q",     "interval": "36 months"},
    "year":    {"trunc": "year",    "fmt": "%Y",       "interval": "5 years"},
}


def finanzas_invoices_meli(
    period: str = "30d",
    plan: str = "all",
    tipo: str = "all",
    search: str | None = None,
    limit: int | None = None,
    chart_granularity: str = "month",
    from_iso: str | None = None,
    to_iso: str | None = None,
) -> dict:
    """
    period: 7d|30d|90d|12m|custom
    plan: 'all' | str(subscriptionId)
    tipo: 'all' | 'FCA' | 'FCB'
    search: prefix-match en numeroComprobante, razon_social, dni, email, fantasy_name
    limit: tope de filas devueltas en items[]. Default None = todo (hard cap 10000).
    chart_granularity: day|week|month|quarter|year (ventana del trend chart, NO afecta KPIs)
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

    # Filtramos por createdAt (cuando se sync la factura) NO por fechaEmision
    # (que Contabilium setea a fecha futura del proximo ciclo de la sub).
    base_from = f"""
        FROM contabillium_dev."ContabilliumInvoice" ci
        {SUBS_FILTER_SQL}
        LEFT JOIN contabillium_dev."ContabiliumClient" cc ON cc.contabilium_id = ci."idCliente"
        LEFT JOIN public."User" u ON u.dni = cc.nro_doc
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        WHERE {SUBS_WHERE_SQL}
          AND ci."createdAt" >= :from_ts AND ci."createdAt" < :to_ts
          {extra_where}
    """

    # KPI cards
    cards: list[dict] = []
    totals = q(eng, f"""
        SELECT COUNT(*)::int AS n,
               COALESCE(SUM(ci.total),0)::float AS total,
               COUNT(*) FILTER (WHERE ci."tipoFc"='FCA')::int AS fca,
               COUNT(*) FILTER (WHERE ci."tipoFc"='FCB')::int AS fcb,
               COUNT(DISTINCT ci."idCliente")::int AS clientes
        {base_from}
    """, params) or [(0, 0.0, 0, 0, 0)]
    r = totals[0]
    n_inv, total, fca, fcb, clientes = (
        int(r[0] or 0), float(r[1] or 0),
        int(r[2] or 0), int(r[3] or 0), int(r[4] or 0),
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
          AND ci."createdAt" >= :from_ts_prev AND ci."createdAt" < :to_ts_prev
    """, p_prev) or 0)
    delta_total = ((total - prev_total) / prev_total * 100) if prev_total > 0 else None

    # Nuevos suscriptos por plan en el periodo: users cuya PRIMERA factura cae en el periodo
    nuevos_por_plan_rows = q(eng, """
        WITH first_inv AS (
            SELECT cc.contabilium_id AS id_cliente,
                   u."subscriptionId" AS plan_id,
                   MIN(ci."createdAt") AS first_at
            FROM contabillium_dev."ContabilliumInvoice" ci
            LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml ON oml.id = ci."idVentaIntegracion"
            LEFT JOIN public.tienda_nube_orders tn ON tn.tienda_nube_id::text = ci."idVentaIntegracion"::text
            LEFT JOIN contabillium_dev."ContabiliumClient" cc ON cc.contabilium_id = ci."idCliente"
            LEFT JOIN public."User" u ON u.dni = cc.nro_doc
            WHERE oml.id IS NULL AND tn.tienda_nube_id IS NULL
              AND u."subscriptionId" IS NOT NULL
            GROUP BY cc.contabilium_id, u."subscriptionId"
        )
        SELECT plan_id, COUNT(*)::int AS nuevos
        FROM first_inv
        WHERE first_at >= :from_ts AND first_at < :to_ts
        GROUP BY plan_id
    """, {"from_ts": w["from_ts"], "to_ts": w["to_ts"]}) or []
    nuevos_map = {int(r[0]): int(r[1]) for r in nuevos_por_plan_rows if r[0] is not None}

    # Nombre + precio de los 4 planes activos (orden por id para layout consistente)
    plan_rows = q(eng, """
        SELECT id, name, price::float
        FROM mercado_libre_dev."SubscriptionMeli"
        ORDER BY id
    """) or []

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
        "label": "Dropshippers facturados", "value": clientes,
        "hint": "Clientes Contabilium unicos",
    })

    # 4 cards: nuevos suscriptos por plan
    for pr in plan_rows:
        plan_id = int(pr[0])
        plan_name = pr[1] or f"Plan {plan_id}"
        plan_price = float(pr[2] or 0)
        n_nuevos = nuevos_map.get(plan_id, 0)
        cards.append({
            "label": f"Nuevos en {plan_name}",
            "value": n_nuevos,
            "hint": f"Primera factura en el periodo · ${plan_price:,.0f}/mes",
        })

    # Trend con granularidad ajustable: 1 serie por plan (4 planes)
    gran = chart_granularity if chart_granularity in _GRAN_CONFIG else "month"
    gconf = _GRAN_CONFIG[gran]
    rows = q(eng, f"""
        SELECT date_trunc('{gconf['trunc']}', ci."createdAt")::date AS bucket,
               COALESCE(u."subscriptionId", 0) AS plan_id,
               COALESCE(SUM(ci.total),0)::float AS total
        FROM contabillium_dev."ContabilliumInvoice" ci
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml ON oml.id = ci."idVentaIntegracion"
        LEFT JOIN public.tienda_nube_orders tn ON tn.tienda_nube_id::text = ci."idVentaIntegracion"::text
        LEFT JOIN contabillium_dev."ContabiliumClient" cc ON cc.contabilium_id = ci."idCliente"
        LEFT JOIN public."User" u ON u.dni = cc.nro_doc
        WHERE oml.id IS NULL AND tn.tienda_nube_id IS NULL
          AND ci."createdAt" >= date_trunc('{gconf['trunc']}', NOW() - INTERVAL '{gconf['interval']}')
        GROUP BY 1, 2 ORDER BY 1
    """) or []

    def _fmt_bucket(d) -> str:
        if not d:
            return ""
        if gran == "quarter":
            return f"{d.year}-Q{((d.month - 1) // 3) + 1}"
        return d.strftime(gconf["fmt"])

    # Pivotear: { bucket -> { plan_id -> total } }
    bucket_map: dict[str, dict[int, float]] = {}
    for r in rows:
        b = _fmt_bucket(r[0])
        if not b:
            continue
        bucket_map.setdefault(b, {})[int(r[1] or 0)] = float(r[2] or 0)
    sorted_buckets = sorted(bucket_map.keys())

    # 4 series por plan (mas 1 fallback "Sin plan" si existe)
    plan_id_to_name = {int(pr[0]): pr[1] or f"Plan {pr[0]}" for pr in plan_rows}
    trends = []
    for plan_id, plan_name in sorted(plan_id_to_name.items()):
        trends.append({
            "label": plan_name,
            "points": [{"date": b, "value": bucket_map.get(b, {}).get(plan_id, 0)} for b in sorted_buckets],
        })
    # Bucket "Sin plan" (user no matcheo): solo si tiene datos
    has_sin_plan = any(bucket_map.get(b, {}).get(0, 0) > 0 for b in sorted_buckets)
    if has_sin_plan:
        trends.append({
            "label": "Sin plan",
            "points": [{"date": b, "value": bucket_map.get(b, {}).get(0, 0)} for b in sorted_buckets],
        })

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
               u.end_date_subscription::date::text AS sub_end_date,
               ci."createdAt"::text AS fecha_sync
        {base_from}
        ORDER BY ci."createdAt" DESC NULLS LAST, ci.id DESC
        LIMIT :limit
    """, items_params) or []
    items = [{
        "id": int(r[0] or 0),
        "tipo": r[1] or "",
        "numero": r[2] or "",
        "fecha_emision": r[3],
        "fecha_sync": r[20],
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

    # Comparador por plan: facturado + nuevos + activos + deltas vs periodo previo
    facturado_por_plan_rows = q(eng, f"""
        SELECT COALESCE(u."subscriptionId", 0) AS plan_id,
               COALESCE(SUM(ci.total),0)::float AS total
        {base_from}
        GROUP BY 1
    """, params) or []
    facturado_map = {int(r[0]): float(r[1] or 0) for r in facturado_por_plan_rows}

    # Mismo cálculo pero en período previo, con los mismos filtros plan/tipo/search
    prev_params = dict(params)
    prev_params["from_ts"] = w["from_ts"] - dt.timedelta(days=prev_window_days)
    prev_params["to_ts"] = w["from_ts"]
    facturado_prev_rows = q(eng, f"""
        SELECT COALESCE(u."subscriptionId", 0) AS plan_id,
               COALESCE(SUM(ci.total),0)::float AS total
        {base_from}
        GROUP BY 1
    """, prev_params) or []
    facturado_prev_map = {int(r[0]): float(r[1] or 0) for r in facturado_prev_rows}

    # Nuevos en periodo previo
    nuevos_prev_rows = q(eng, """
        WITH first_inv AS (
            SELECT cc.contabilium_id AS id_cliente,
                   u."subscriptionId" AS plan_id,
                   MIN(ci."createdAt") AS first_at
            FROM contabillium_dev."ContabilliumInvoice" ci
            LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml ON oml.id = ci."idVentaIntegracion"
            LEFT JOIN public.tienda_nube_orders tn ON tn.tienda_nube_id::text = ci."idVentaIntegracion"::text
            LEFT JOIN contabillium_dev."ContabiliumClient" cc ON cc.contabilium_id = ci."idCliente"
            LEFT JOIN public."User" u ON u.dni = cc.nro_doc
            WHERE oml.id IS NULL AND tn.tienda_nube_id IS NULL
              AND u."subscriptionId" IS NOT NULL
            GROUP BY cc.contabilium_id, u."subscriptionId"
        )
        SELECT plan_id, COUNT(*)::int AS nuevos
        FROM first_inv
        WHERE first_at >= :from_ts_prev AND first_at < :to_ts_prev
        GROUP BY plan_id
    """, p_prev) or []
    nuevos_prev_map = {int(r[0]): int(r[1]) for r in nuevos_prev_rows if r[0] is not None}

    # Activos por plan (snapshot actual, no afectado por periodo)
    activos_rows = q(eng, """
        SELECT u."subscriptionId" AS plan_id, COUNT(*)::int AS activos
        FROM public."User" u
        WHERE u.subscription_status::text = 'ACTIVE'
          AND u.end_date_subscription > NOW()
          AND COALESCE(u."isActive", true) IS TRUE
          AND u."subscriptionId" IS NOT NULL
        GROUP BY 1
    """) or []
    activos_map = {int(r[0]): int(r[1]) for r in activos_rows if r[0] is not None}

    def _delta(curr: float, prev: float) -> float | None:
        if prev <= 0:
            return None
        return round((curr - prev) / prev * 100, 1)

    comparator_by_plan = []
    for pr in plan_rows:
        plan_id = int(pr[0])
        plan_name = pr[1] or f"Plan {plan_id}"
        plan_price = float(pr[2] or 0)
        facturado_curr = facturado_map.get(plan_id, 0.0)
        facturado_prev = facturado_prev_map.get(plan_id, 0.0)
        nuevos_curr = nuevos_map.get(plan_id, 0)
        nuevos_prev = nuevos_prev_map.get(plan_id, 0)
        activos = activos_map.get(plan_id, 0)
        comparator_by_plan.append({
            "plan_id": plan_id,
            "plan_name": plan_name,
            "plan_price": plan_price,
            "facturado": round(facturado_curr, 0),
            "facturado_prev": round(facturado_prev, 0),
            "facturado_delta_pct": _delta(facturado_curr, facturado_prev),
            "nuevos": nuevos_curr,
            "nuevos_prev": nuevos_prev,
            "nuevos_delta_pct": _delta(nuevos_curr, nuevos_prev),
            "activos": activos,
        })

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
        "comparator_by_plan": comparator_by_plan,
        "filters": {"plan": plan, "tipo": tipo, "search": search or ""},
        "chart_granularity": gran,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def get_latest_subscription_invoice_for_dni(dni: str) -> dict | None:
    """Devuelve la ultima factura Contabilium de suscripcion MELI para un DNI dado."""
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT ci."linkPublico",
               ci."numeroComprobante",
               ci.total::float,
               ci."fechaEmision"::date::text,
               ci."tipoFc"
        FROM contabillium_dev."ContabilliumInvoice" ci
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" oml
          ON oml.id = ci."idVentaIntegracion"
        LEFT JOIN public.tienda_nube_orders tn
          ON tn.tienda_nube_id::text = ci."idVentaIntegracion"::text
        LEFT JOIN contabillium_dev."ContabiliumClient" cc
          ON cc.contabilium_id = ci."idCliente"
        WHERE oml.id IS NULL AND tn.tienda_nube_id IS NULL
          AND cc.nro_doc = :dni
        ORDER BY ci."fechaEmision" DESC NULLS LAST
        LIMIT 1
    """, {"dni": dni})
    if not rows:
        return None
    r = rows[0]
    return {
        "url": r[0] or None,
        "numero": r[1] or "",
        "total": float(r[2] or 0),
        "fecha": r[3] or "",
        "tipo": r[4] or "",
    }
