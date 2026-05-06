"""
Dashboard Finanzas - Unistore.
Cruza Contabilium (SalesOrder, SalesOrderItem, ReceiptItem) con TN.Order y meli.meli_orders.
Detecta gaps facturacion y muestra cobranzas / top conceptos.
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}


def finanzas_unistore(period: str = "30d") -> dict:
    days = PERIOD_DAYS.get(period, 30)
    eng = get_engine("unistore")
    p = {"days": days}

    cards: list[dict] = []

    # --- Facturacion mes ---
    fact_total = float(scalar(eng, """
        SELECT COALESCE(SUM(NULLIF(REPLACE(REPLACE("Total",',','.'),' ',''),'')::numeric),0)::float
        FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days)
    """, p) or 0)
    fact_prev = float(scalar(eng, """
        SELECT COALESCE(SUM(NULLIF(REPLACE(REPLACE("Total",',','.'),' ',''),'')::numeric),0)::float
        FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days2)
          AND fecha_creacion_at <  NOW() - make_interval(days => :days)
    """, {"days": days, "days2": days * 2}) or 0)
    delta_fact = ((fact_total - fact_prev) / fact_prev * 100) if fact_prev > 0 else None

    sales_orders = int(scalar(eng, """
        SELECT COUNT(*) FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days)
    """, p) or 0)

    # Sales orders facturadas (con invoiceNumber)
    facturadas = int(scalar(eng, """
        SELECT COUNT(*) FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days)
          AND ("invoiceNumber" IS NOT NULL OR "invoiceCAE" IS NOT NULL)
    """, p) or 0)
    rate_invoice = (facturadas / sales_orders * 100) if sales_orders > 0 else 0

    # Cobranzas: ReceiptItem en periodo
    cobrado = float(scalar(eng, """
        SELECT COALESCE(SUM("PrecioUnitario" * COALESCE("Cantidad",1)),0)::float
        FROM contabilium."ReceiptItem"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    # Ventas operativas (TN paid + ML paid) en periodo
    ventas_op = float(scalar(eng, """
        SELECT COALESCE(SUM(rev),0)::float FROM (
            SELECT CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END AS rev
            FROM tienda_nube."Order"
            WHERE "createdAt" >= NOW() - make_interval(days => :days)
            UNION ALL
            SELECT COALESCE(total_amount,0) FROM meli.meli_orders
            WHERE date_created >= NOW() - make_interval(days => :days)
              AND status IN ('paid','confirmed','shipped','delivered')
        ) x
    """, p) or 0)
    gap_pct = ((ventas_op - fact_total) / ventas_op * 100) if ventas_op > 0 else 0

    cards.append({"label": f"Facturacion ({period})", "value": round(fact_total, 0),
                  "prefix": "$ ", "delta": round(delta_fact, 1) if delta_fact is not None else None,
                  "hint": "SalesOrder Contabilium total"})
    cards.append({"label": "Sales orders emitidas", "value": sales_orders,
                  "hint": f"{facturadas:,} con CAE"})
    cards.append({"label": "% Facturadas", "value": round(rate_invoice, 1),
                  "suffix": "%", "hint": "Sales orders con invoiceNumber/CAE"})
    cards.append({"label": "Cobrado (ReceiptItems)", "value": round(cobrado, 0),
                  "prefix": "$ ", "hint": "Suma cantidad*precio recibos del periodo"})
    cards.append({"label": "Ventas operativas (TN+ML)", "value": round(ventas_op, 0),
                  "prefix": "$ ", "hint": "Para cruzar contra facturacion"})
    cards.append({"label": "Gap (vendido vs facturado)",
                  "value": round(gap_pct, 1), "suffix": "%",
                  "hint": f"$ {(ventas_op - fact_total):,.0f} sin facturar"})

    # --- Tendencia 12m ---
    series: list[dict] = []
    rows = q(eng, """
        SELECT date_trunc('month', fecha_creacion_at)::date,
               COALESCE(SUM(NULLIF(REPLACE(REPLACE("Total",',','.'),' ',''),'')::numeric),0)::float
        FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Facturacion Contabilium",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    rows = q(eng, """
        SELECT mes::date, SUM(rev)::float FROM (
            SELECT date_trunc('month', "createdAt") AS mes,
                   CASE WHEN "paymentStatus"='paid' THEN COALESCE(total,0) ELSE 0 END AS rev
            FROM tienda_nube."Order"
            WHERE "createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
            UNION ALL
            SELECT date_trunc('month', date_created), COALESCE(total_amount,0)
            FROM meli.meli_orders
            WHERE date_created >= date_trunc('month', NOW() - INTERVAL '11 months')
              AND status IN ('paid','confirmed','shipped','delivered')
        ) x
        GROUP BY 1 ORDER BY 1
    """) or []
    series.append({
        "label": "Ventas operativas TN+ML",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    })

    # --- Top conceptos facturados ---
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM("Concepto"),''),'(sin concepto)') AS concepto,
               SUM("Cantidad")::int AS cant,
               SUM("Cantidad" * "PrecioUnitario")::float AS revenue
        FROM contabilium."SalesOrderItem"
        WHERE "createdAt" >= NOW() - make_interval(days => :days)
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT 15
    """, p) or []
    top_conceptos = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"cantidad": int(r[1] or 0)},
    } for r in rows]

    # --- Distribucion estados sales orders ---
    rows = q(eng, """
        SELECT COALESCE("Estado",'desconocido'), COUNT(*)::int
        FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    estados_so = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # --- Distribucion invoiceStatus ---
    rows = q(eng, """
        SELECT COALESCE("invoiceStatus",'sin estado'), COUNT(*)::int
        FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 2 DESC
    """, p) or []
    invoice_status = [{"category": r[0], "value": float(r[1] or 0)} for r in rows]

    # --- Top integraciones (Origen/Integracion: TN/ML/etc) ---
    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM("Integracion"),''),'sin integracion'),
               COUNT(*)::int,
               COALESCE(SUM(NULLIF(REPLACE(REPLACE("Total",',','.'),' ',''),'')::numeric),0)::float
        FROM contabilium."SalesOrder"
        WHERE fecha_creacion_at >= NOW() - make_interval(days => :days)
        GROUP BY 1 ORDER BY 3 DESC
    """, p) or []
    by_integration = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"orders": int(r[1] or 0)},
    } for r in rows]

    return {
        "period": period,
        "cards": cards,
        "trends": series,
        "top_conceptos": top_conceptos,
        "estados_so": estados_so,
        "invoice_status": invoice_status,
        "by_integration": by_integration,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
