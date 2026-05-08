"""
Finanzas Unidrop: facturacion Contabilium dev + cruce con orders + cobranzas Talo.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def finanzas_unidrop(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine("unidrop")
    p = {"days": days}
    p2 = {"days": days, "days2": days * 2}

    cards: list[dict] = []

    # Facturacion mensual Contabilium dev
    fact_total = float(scalar(eng, """
        SELECT COALESCE(SUM(total),0)::float
        FROM contabillium_dev."ContabilliumInvoice"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    fact_prev = float(scalar(eng, """
        SELECT COALESCE(SUM(total),0)::float
        FROM contabillium_dev."ContabilliumInvoice"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days2)
          AND "fechaEmision" <  NOW() - make_interval(days => :days)
    """, p2) or 0)
    delta_fact = ((fact_total - fact_prev) / fact_prev * 100) if fact_prev > 0 else None

    sales_orders = int(scalar(eng, """
        SELECT COUNT(*) FROM contabillium_dev."ContabiliumSalesOrder"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
    """, p) or 0)
    facturadas = int(scalar(eng, """
        SELECT COUNT(*) FROM contabillium_dev."ContabiliumSalesOrder"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
          AND "contabilliumInvoiceId" IS NOT NULL
    """, p) or 0)
    rate_inv = (facturadas / sales_orders * 100) if sales_orders > 0 else 0

    # Cobranzas Talo periodo (orders + subs)
    cobrado = float(scalar(eng, """
        SELECT (
            (SELECT COALESCE(SUM(amount),0)::float FROM public."PaymentTransaction"
              WHERE "createdAt" >= NOW() - make_interval(days => :days)) +
            (SELECT COALESCE(SUM(amount),0)::float FROM public."PaymentTransactionSubscription"
              WHERE "createdAt" >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)

    # Comisiones cobradas
    comisiones = float(scalar(eng, """
        SELECT (
            (SELECT COALESCE(SUM(commission),0)::float FROM public."PaymentTransaction"
              WHERE "createdAt" >= NOW() - make_interval(days => :days)) +
            (SELECT COALESCE(SUM(commission),0)::float FROM public."PaymentTransactionSubscription"
              WHERE "createdAt" >= NOW() - make_interval(days => :days))
        )
    """, p) or 0)

    # Ventas operativas (TN paid + ML)
    ventas_op = float(scalar(eng, """
        SELECT (
            (SELECT COALESCE(SUM(CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END),0)::float
              FROM public.tienda_nube_orders
              WHERE created_at >= NOW() - make_interval(days => :days)) +
            (SELECT COALESCE(SUM("totalAmount"),0)::float FROM mercado_libre_dev."OrderMercadoLibre"
              WHERE "dateCreated" >= NOW() - make_interval(days => :days)
                AND status IN ('paid','confirmed','shipped','delivered'))
        )
    """, p) or 0)

    cards.append({"label": f"Facturacion ({period})", "value": round(fact_total, 0),
                  "prefix": "$ ", "delta": round(delta_fact, 1) if delta_fact is not None else None,
                  "hint": "ContabilliumInvoice (dev)"})
    cards.append({"label": "Sales orders", "value": sales_orders,
                  "hint": f"{facturadas:,} con invoice"})
    cards.append({"label": "% Facturadas", "value": round(rate_inv, 1), "suffix": "%",
                  "hint": "SO con contabilliumInvoiceId"})
    cards.append({"label": "Cobrado Talo", "value": round(cobrado, 0),
                  "prefix": "$ ", "hint": "PaymentTx orders + subs"})
    cards.append({"label": "Comisiones cobradas", "value": round(comisiones, 0),
                  "prefix": "$ "})
    cards.append({"label": "Ventas operativas (TN+ML)", "value": round(ventas_op, 0),
                  "prefix": "$ "})

    # Tendencia 12m
    series: list[dict] = []
    rows = q(eng, """
        SELECT date_trunc('month', "fechaEmision")::date, COALESCE(SUM(total),0)::float
        FROM contabillium_dev."ContabilliumInvoice"
        WHERE "fechaEmision" >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Facturacion Contabilium dev",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    rows = q(eng, """
        SELECT mes::date, SUM(rev)::float FROM (
            SELECT date_trunc('month', created_at) AS mes,
                   CASE WHEN payment_status::text='paid' THEN COALESCE(total,0) ELSE 0 END AS rev
            FROM public.tienda_nube_orders
            WHERE created_at >= date_trunc('month', NOW() - INTERVAL '11 months')
            UNION ALL
            SELECT date_trunc('month', "dateCreated"), COALESCE("totalAmount",0)
            FROM mercado_libre_dev."OrderMercadoLibre"
            WHERE "dateCreated" >= date_trunc('month', NOW() - INTERVAL '11 months')
              AND status IN ('paid','confirmed','shipped','delivered')
        ) x GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Ventas operativas TN+ML",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    # Tipos de comprobante
    rows = q(eng, """
        SELECT COALESCE("tipoFc",'?'), COUNT(*)::int, COALESCE(SUM(total),0)::float
        FROM contabillium_dev."ContabilliumInvoice"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 3 DESC LIMIT 10
    """, p) or []
    by_tipo = [{
        "category": r[0], "value": float(r[2] or 0),
        "extra": {"cantidad": int(r[1] or 0)},
    } for r in rows]

    # Estados sales orders dev
    rows = q(eng, """
        SELECT COALESCE("estadoIntegracion",'?'), COUNT(*)::int
        FROM contabillium_dev."ContabiliumSalesOrder"
        WHERE "fechaEmision" >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    estados_so = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    return {
        "unit": "unidrop",
        "period": period,
        "cards": cards,
        "trends": series,
        "by_tipo": by_tipo,
        "estados_so": estados_so,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
