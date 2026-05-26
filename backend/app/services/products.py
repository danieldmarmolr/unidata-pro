"""
Productos - Unistore.
Vista global cross-canal (TN + ML) + drill 360 por SKU.
Cruza tienda_nube.OrderItem (TN), meli.meli_orders (ML), digip.StockDetalle (stock),
unidev.devolucion_items (devoluciones), costs SQLite (costo de importacion).
"""
from __future__ import annotations

import datetime as dt
import logging

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window
from app.services import costs as costs_svc
from app.utils.tz import today_ar
from app.services.drilldowns import (
    _classify_channel_sql,
    _shipping_method_expr,
    _shipping_type_col,
    _carrier_col,
)
log = logging.getLogger("unidata.products")

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


# ===================== OVERVIEW =====================

def products_overview(period: str = "30d", channel: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng_uni = get_engine("unistore")
    p = {"days": days}

    cards: list[dict] = []

    total_products = int(scalar(eng_uni, """
        SELECT COUNT(*) FROM tienda_nube."Product" WHERE published = TRUE
    """) or 0)

    skus_vendidos = int(scalar(eng_uni, """
        SELECT COUNT(DISTINCT oi.sku) FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
          AND oi.sku IS NOT NULL
          AND oi.sku NOT ILIKE '%PVA%'
    """, p) or 0)

    sin_movimiento = int(scalar(eng_uni, """
        SELECT COUNT(DISTINCT pv.sku)
        FROM tienda_nube."ProductVariant" pv
        WHERE pv.sku IS NOT NULL
          AND pv.sku NOT ILIKE '%PVA%'
          AND pv.sku NOT IN (
            SELECT DISTINCT oi.sku FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."createdAt" >= NOW() - INTERVAL '90 days'
              AND o."paymentStatus" = 'paid'
              AND oi.sku IS NOT NULL
              AND oi.sku NOT ILIKE '%PVA%'
          )
    """) or 0)

    skus_digip = int(scalar(eng_uni, """
        SELECT COUNT(DISTINCT "articuloCodigo")
        FROM digip."StockDetalle"
    """) or 0)

    sku_critico = int(scalar(eng_uni, """
        SELECT COUNT(*) FROM (
            SELECT "articuloCodigo" FROM digip."StockDetalle"
            GROUP BY 1 HAVING SUM(unidades) <= 5 AND SUM(unidades) >= 0
        ) x
    """) or 0)

    units_periodo = int(scalar(eng_uni, """
        SELECT COALESCE(SUM(oi.quantity),0)::bigint
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
    """, p) or 0)

    ordenes_periodo = int(scalar(eng_uni, """
        SELECT COUNT(DISTINCT o.id)
        FROM tienda_nube."Order" o
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
    """, p) or 0)

    skus_por_orden_avg = float(scalar(eng_uni, """
        SELECT AVG(per_order.distinct_skus)::float
        FROM tienda_nube."Order" o
        JOIN LATERAL (
          SELECT COUNT(DISTINCT oi.sku)::int AS distinct_skus
          FROM tienda_nube."OrderItem" oi
          WHERE oi."orderId" = o.id AND oi.sku IS NOT NULL
        ) per_order ON TRUE
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
    """, p) or 0)

    nuevos_7d = int(scalar(eng_uni, """
        SELECT COUNT(*) FROM (
          SELECT oi.sku, MIN(o."createdAt") AS primera_venta
          FROM tienda_nube."OrderItem" oi
          JOIN tienda_nube."Order" o ON o.id = oi."orderId"
          WHERE o."paymentStatus" = 'paid' AND oi.sku IS NOT NULL
            AND oi.sku NOT ILIKE '%PVA%'
          GROUP BY oi.sku
          HAVING MIN(o."createdAt") >= NOW() - INTERVAL '7 days'
        ) x
    """) or 0)

    stockout_14d = int(scalar(eng_uni, """
        WITH ventas_30d AS (
          SELECT oi.sku, SUM(oi.quantity)::float / 30.0 AS ventas_dia
          FROM tienda_nube."OrderItem" oi
          JOIN tienda_nube."Order" o ON o.id = oi."orderId"
          WHERE o."paymentStatus" = 'paid'
            AND o."createdAt" >= NOW() - INTERVAL '30 days'
            AND oi.sku IS NOT NULL
          GROUP BY oi.sku
        ),
        stock_act AS (
          SELECT "articuloCodigo" AS sku, SUM(unidades)::int AS stock
          FROM digip."StockDetalle" GROUP BY 1
        )
        SELECT COUNT(*)
        FROM ventas_30d v
        JOIN stock_act s ON s.sku = v.sku
        WHERE v.ventas_dia > 0 AND s.stock > 0
          AND (s.stock / v.ventas_dia) < 14
    """) or 0)

    ticket_unidades = (units_periodo / ordenes_periodo) if ordenes_periodo > 0 else 0.0
    catalogo_activo_pct = (skus_vendidos / total_products * 100) if total_products > 0 else 0.0

    cards.append({"label": "Productos publicados", "value": total_products, "hint": "Tienda Nube · published=TRUE"})
    cards.append({"label": f"SKUs vendidos ({period})", "value": skus_vendidos, "hint": "Distintos en orders pagas"})
    cards.append({"label": "Unidades vendidas", "value": units_periodo, "hint": "TN orders pagas"})
    cards.append({"label": "Ordenes pagas", "value": ordenes_periodo, "hint": "TN orders paid del periodo"})
    cards.append({"label": "Ticket de unidades", "value": round(ticket_unidades, 2), "hint": "Unidades / ordenes paid"})
    cards.append({"label": "SKUs por orden", "value": round(skus_por_orden_avg, 2), "hint": "Diversidad de carrito · promedio"})
    cards.append({"label": "Catalogo activo", "value": round(catalogo_activo_pct, 1), "suffix": "%", "hint": "SKUs vendidos / publicados"})
    cards.append({"label": "Nuevos 7d", "value": nuevos_7d, "hint": "SKUs con primera venta en ultimos 7 dias"})
    cards.append({"label": "Sin movimiento (>90d)", "value": sin_movimiento, "hint": "SKUs en catalogo sin venta hace 90+ dias"})
    cards.append({"label": "SKUs Digip", "value": skus_digip, "hint": "En el WMS"})
    cards.append({"label": "Stock critico", "value": sku_critico, "hint": "<= 5 unidades totales"})
    cards.append({"label": "Stockout 14d", "value": stockout_14d, "hint": "SKUs que se agotan en menos de 14 dias al ritmo actual"})

    # Top SKUs por revenue (universo top 80 para luego derivar ganancia per SKU)
    top_revenue_raw = q(eng_uni, """
        SELECT oi.sku, MAX(oi.name) AS name, MAX(oi."productId")::text AS product_id,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue,
               COUNT(DISTINCT oi."orderId")::int AS orders,
               COUNT(DISTINCT o."customerId")::int AS customers,
               (SELECT pi.src FROM tienda_nube."ProductImage" pi
                WHERE pi."productId" = MAX(oi."productId")
                ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
          AND oi.sku IS NOT NULL
          AND oi.sku NOT ILIKE '%PVA%'
        GROUP BY oi.sku
        ORDER BY revenue DESC LIMIT 80
    """, p) or []

    # Cruzar con engine para computar ganancia NETA por SKU agregada en el periodo.
    # Asumimos canal "online" (TaloPay 0.5%) que es ~90% de los cobros TN.
    from app.services.profit_engine import cost_index_unistore, calc_profit
    cost_idx = cost_index_unistore()
    ganancia_total_periodo = 0.0
    revenue_with_cost_periodo = 0.0
    enriched_skus: list[dict] = []
    for r in top_revenue_raw:
        sku_key = (r[0] or "").strip().lower()
        units = int(r[3] or 0)
        rev = float(r[4] or 0)
        cost_rec = cost_idx.get(sku_key)
        ganancia: float | None = None
        margen_pct: float | None = None
        iva_aliq: float | None = None
        if cost_rec and cost_rec.get("costo_con_iva") and units > 0 and rev > 0:
            sin_iva = float(cost_rec.get("costo_sin_iva") or 0)
            con_iva = float(cost_rec.get("costo_con_iva") or sin_iva)
            iva_aliq = cost_rec.get("iva_aliquot")
            pb = calc_profit(
                ingreso_bruto=rev,
                costo_sin_iva=sin_iva * units,
                costo_con_iva=con_iva * units,
                is_cash=False,
                iva_aliquot_override=iva_aliq,
            )
            ganancia = round(pb.ganancia_neta, 0)
            margen_pct = round(pb.margen_pct, 1)
            ganancia_total_periodo += pb.ganancia_neta
            revenue_with_cost_periodo += rev
        enriched_skus.append({
            "category": (r[1] or r[0])[:60],
            "value": rev,
            "extra": {
                "sku": r[0], "product_id": r[2],
                "units": units,
                "orders": int(r[5] or 0),
                "customers": int(r[6] or 0),
                "imagen": r[7] or "",
                "ganancia": ganancia,
                "margen_pct": margen_pct,
                "iva_aliquot": iva_aliq,
                "has_cost": ganancia is not None,
            },
        })

    # Top por revenue: los primeros 20 ya ordenados por la query
    top_products = enriched_skus[:20]

    # Top por GANANCIA NETA (este es el ranking que importa para decisiones).
    # SKUs sin costo cargado quedan abajo (ganancia=None → tratado como 0 para orden).
    top_ganancia_sorted = sorted(
        [s for s in enriched_skus if s["extra"].get("ganancia") is not None],
        key=lambda s: s["extra"]["ganancia"] or 0,
        reverse=True,
    )
    top_ganancia = []
    for s in top_ganancia_sorted[:20]:
        item = {
            "category": s["category"],
            "value": s["extra"]["ganancia"],  # ahora "value" es la GANANCIA, no el revenue
            "extra": {**s["extra"], "revenue": s["value"]},  # revenue queda en extra
        }
        top_ganancia.append(item)

    # KPI cards adicionales: ganancia agregada + margen promedio del periodo
    if revenue_with_cost_periodo > 0:
        margen_periodo = ganancia_total_periodo / revenue_with_cost_periodo * 100
        cards.append({
            "label": f"Ganancia neta ({period})",
            "value": round(ganancia_total_periodo, 0),
            "prefix": "$ ",
            "hint": f"Margen {margen_periodo:.1f}% sobre $ {revenue_with_cost_periodo:,.0f} con costo cargado",
        })

    top_brands = q(eng_uni, """
        SELECT COALESCE(NULLIF(TRIM(p.brand),''),'(sin marca)') AS brand,
               COUNT(DISTINCT p.id)::int AS productos,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        JOIN tienda_nube."Product" p ON p.id = oi."productId"
        WHERE o."createdAt" >= NOW() - make_interval(days => :days)
          AND o."paymentStatus" = 'paid'
        GROUP BY 1
        ORDER BY revenue DESC LIMIT 10
    """, p) or []
    top_brands_list = [{
        "category": r[0],
        "value": float(r[3] or 0),
        "extra": {"productos": int(r[1] or 0), "units": int(r[2] or 0)},
    } for r in top_brands]

    sin_mov_list = q(eng_uni, """
        WITH no_sales AS (
            SELECT DISTINCT pv.sku
            FROM tienda_nube."ProductVariant" pv
            WHERE pv.sku IS NOT NULL
              AND pv.sku NOT IN (
                SELECT DISTINCT oi.sku FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."createdAt" >= NOW() - INTERVAL '90 days'
                  AND o."paymentStatus" = 'paid' AND oi.sku IS NOT NULL
              )
        )
        SELECT ns.sku, MAX(p.name) AS name, COALESCE(MAX(p.brand),'') AS brand,
               COALESCE(SUM(sd.unidades), 0)::int AS stock_actual
        FROM no_sales ns
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = ns.sku
        LEFT JOIN tienda_nube."Product" p ON p.id = pv."productId"
        LEFT JOIN digip."StockDetalle" sd ON sd."articuloCodigo" = ns.sku
        GROUP BY ns.sku
        HAVING COALESCE(SUM(sd.unidades), 0) > 0
        ORDER BY stock_actual DESC LIMIT 20
    """) or []
    sin_movimiento_list = [{
        "category": (r[1] or r[0] or "?")[:60],
        "value": float(r[3] or 0),
        "extra": {"sku": r[0], "brand": r[2]},
    } for r in sin_mov_list]

    critico_alerta = q(eng_uni, """
        WITH stock_q AS (
            SELECT "articuloCodigo" AS sku, SUM(unidades)::int AS stock
            FROM digip."StockDetalle"
            GROUP BY 1
            HAVING SUM(unidades) >= 0 AND SUM(unidades) <= 5
        )
        SELECT s.sku, MAX(oi.name) AS name, s.stock,
               SUM(oi.quantity)::int AS units_vendidas
        FROM stock_q s
        JOIN tienda_nube."OrderItem" oi ON oi.sku = s.sku
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= NOW() - INTERVAL '30 days'
          AND o."paymentStatus" = 'paid'
        GROUP BY s.sku, s.stock
        ORDER BY units_vendidas DESC LIMIT 15
    """) or []
    stock_critico_alerta = [{
        "category": (r[1] or r[0])[:60],
        "value": float(r[3] or 0),
        "extra": {"sku": r[0], "stock": int(r[2] or 0)},
    } for r in critico_alerta]

    return {
        "period": period,
        "channel": channel,
        "cards": cards,
        "top_products": top_products,            # top por revenue (mantenido por compat)
        "top_ganancia": top_ganancia,            # NUEVO: top por ganancia neta (el ranking que importa)
        "top_brands": top_brands_list,
        "sin_movimiento": sin_movimiento_list,
        "stock_critico_alerta": stock_critico_alerta,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


# ===================== PRODUCT 360 (por SKU) =====================

def product_detail(sku: str, period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Vista 360 de un producto/SKU: ventas, canales, customers, devoluciones, stock.

    period: ventana usada para la nueva seccion 'recent_orders' (lista de ordenes
    que incluyen este SKU en el periodo). El resto de los KPIs siguen siendo
    lifetime salvo donde el nombre dice 'periodo'.
    """
    from app.services._utils import resolve_window
    win = resolve_window(period, from_iso, to_iso)
    from_ts = win["from_ts"]
    to_ts = win["to_ts"]
    eng = get_engine("unistore")

    # NOTA: las vistas extras del SKU 360 V2 (stock_detail, forecast,
    # unidrop_pricing, lotes_all) viven en endpoints separados
    # /products/sku/{sku}/stock-detail|forecast|unidrop-pricing|lotes
    # para no bloquear el render de la pagina principal.

    info = q(eng, """
        SELECT MAX(p.id) AS product_id,
               MAX(p.name) AS name,
               COALESCE(MAX(p.brand),'') AS brand,
               BOOL_OR(p.published) AS published,
               MAX(pv.price)::float AS price,
               MAX(pv.barcode) AS tn_barcode
        FROM tienda_nube."ProductVariant" pv
        JOIN tienda_nube."Product" p ON p.id = pv."productId"
        WHERE pv.sku = :sku
    """, {"sku": sku}) or []

    # EAN real: SIEMPRE de digip (fuente de verdad GS1).
    # tienda_nube.ProductVariant.barcode es un campo libre que casi nunca se llena;
    # el codigo escaneable real vive en digip.ArticuloUnidadMedidaCodigo y se prioriza
    # EAN-13 sobre EAN-12 / EAN-8. Mismo criterio que sku_enrichment.enrich_skus_unistore.
    digip_ean = ""
    try:
        ean_rows = q(eng, """
            SELECT c."Codigo"
            FROM digip."Articulo" a
            JOIN digip."ArticuloUnidadMedida" u ON u."articuloCodigo" = a."CodigoArticulo"
            JOIN digip."ArticuloUnidadMedidaCodigo" c ON c."unidadMedidaId" = u.id
            WHERE a."CodigoArticulo" = :sku
            ORDER BY CASE WHEN LENGTH(c."Codigo") = 13 THEN 0
                          WHEN LENGTH(c."Codigo") = 12 THEN 1
                          WHEN LENGTH(c."Codigo") = 8  THEN 2
                          ELSE 3 END,
                     c.id ASC
            LIMIT 1
        """, {"sku": sku}) or []
        if ean_rows and ean_rows[0][0]:
            digip_ean = str(ean_rows[0][0]).strip()
    except Exception:
        # Si digip falla, caemos al barcode de TN
        pass
    imgs = q(eng, """
        SELECT pi.src
        FROM tienda_nube."ProductImage" pi
        WHERE pi."productId" IN (
            SELECT pv."productId" FROM tienda_nube."ProductVariant" pv WHERE pv.sku = :sku
        )
        ORDER BY pi.position ASC NULLS LAST
        LIMIT 6
    """, {"sku": sku}) or []
    images = [r[0] for r in imgs if r[0]]

    product_info = None
    if info and info[0][0]:
        r = info[0]
        product_info = {
            "sku": sku,
            "product_id": int(r[0] or 0),
            "name": r[1] or "?",
            "brand": r[2] or "",
            "published": bool(r[3]) if r[3] is not None else False,
            "price": float(r[4] or 0),
            # EAN: digip (real) primero, TN.barcode como fallback de ultimo recurso
            "barcode": digip_ean or (r[5] or ""),
        }

    if not product_info:
        info2 = q(eng, """
            SELECT MAX(oi."productId")::text, MAX(oi.name), MAX(oi.barcode)
            FROM tienda_nube."OrderItem" oi WHERE oi.sku = :sku
        """, {"sku": sku}) or []
        if info2 and info2[0][1]:
            product_info = {
                "sku": sku,
                "product_id": int(info2[0][0] or 0),
                "name": info2[0][1] or "?",
                "brand": "", "published": None,
                "price": 0,
                "barcode": digip_ean or (info2[0][2] or ""),
            }

    cards: list[dict] = []

    lifetime = q(eng, """
        SELECT SUM(oi.quantity)::int,
               SUM(oi.quantity * oi.price)::float,
               COUNT(DISTINCT oi."orderId")::int,
               COUNT(DISTINCT o."customerId")::int,
               MIN(o."createdAt") AS first_sale,
               MAX(o."createdAt") AS last_sale
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE oi.sku = :sku AND o."paymentStatus" = 'paid'
    """, {"sku": sku}) or []
    total_units = int(lifetime[0][0] or 0) if lifetime else 0
    total_rev = float(lifetime[0][1] or 0) if lifetime else 0
    total_orders = int(lifetime[0][2] or 0) if lifetime else 0
    total_customers = int(lifetime[0][3] or 0) if lifetime else 0
    first_sale = lifetime[0][4].isoformat() if lifetime and lifetime[0][4] else None
    last_sale = lifetime[0][5].isoformat() if lifetime and lifetime[0][5] else None

    last_30 = q(eng, """
        SELECT SUM(oi.quantity)::int, SUM(oi.quantity*oi.price)::float
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE oi.sku = :sku
          AND o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - INTERVAL '30 days'
    """, {"sku": sku}) or []
    units_30 = int(last_30[0][0] or 0) if last_30 else 0
    rev_30 = float(last_30[0][1] or 0) if last_30 else 0

    # Stock "actual" para la KPI: lo que REALMENTE esta libre para vender.
    # Fuente: digip.Stock.unidadesDisponibles (panorama consolidado del SKU).
    # No usamos SUM(StockDetalle.unidades) porque ese total mete reservadas,
    # bloqueadas, vencidas, etc -> sobreestima el stock vendible.
    # Si digip.Stock no contesta, caemos al sum de StockDetalle como fallback.
    from app.services.sku_360_extras import _digip_stock_summary
    stock_breakdown = _digip_stock_summary(eng, sku)
    if stock_breakdown.get("available"):
        stock_disponibles = stock_breakdown["disponibles"]
        stock_total_fisico = stock_breakdown["total_fisico"]
        stock_hint = (
            f"reservadas {stock_breakdown['reservadas']} · "
            f"bloqueadas {stock_breakdown['bloqueadas']} · "
            f"a despachar {stock_breakdown['a_despachar']} · "
            f"en recepcion {stock_breakdown['en_recepcion']} · "
            f"transito {stock_breakdown['transito_interno']} · "
            f"vencidas {stock_breakdown['vencidas']} · "
            f"pedidas {stock_breakdown['pedidas']}"
        )
    else:
        stock_disponibles = int(scalar(eng, """
            SELECT SUM(unidades)::int FROM digip."StockDetalle"
            WHERE "articuloCodigo" = :sku
        """, {"sku": sku}) or 0)
        stock_total_fisico = stock_disponibles
        stock_hint = "Fallback: suma de digip.StockDetalle (sin breakdown)"

    cards.append({"label": "Revenue total (lifetime)", "value": round(total_rev, 0), "prefix": "$ "})
    cards.append({"label": "Unidades vendidas", "value": total_units})
    cards.append({"label": "Ordenes / clientes", "value": f"{total_orders} / {total_customers}",
                  "hint": "Distintos compradores"})
    cards.append({"label": "Revenue 30d", "value": round(rev_30, 0), "prefix": "$ ",
                  "hint": f"{units_30} unidades"})
    cards.append({"label": "Stock disponible (Digip)", "value": stock_disponibles,
                  "hint": f"Vendible · fisico total {stock_total_fisico} · " + stock_hint})

    rows = q(eng, """
        SELECT date_trunc('month', o."createdAt")::date AS mes,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE oi.sku = :sku
          AND o."paymentStatus" = 'paid'
          AND o."createdAt" >= date_trunc('month', NOW() - INTERVAL '11 months')
        GROUP BY 1 ORDER BY 1
    """, {"sku": sku}) or []
    monthly_trend = {
        "label": "Revenue mensual",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[2] or 0)} for r in rows],
    }
    units_trend = {
        "label": "Unidades mensuales",
        "points": [{"date": r[0].strftime("%Y-%m") if r[0] else "", "value": float(r[1] or 0)} for r in rows],
    }

    top_customers = q(eng, """
        SELECT c.id, COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue,
               COUNT(DISTINCT oi."orderId")::int AS orders,
               COALESCE(NULLIF(TRIM(c."billingProvince"),''),'-') AS provincia
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        WHERE oi.sku = :sku AND o."paymentStatus" = 'paid'
        GROUP BY c.id, c.name, c.email, c."billingProvince"
        ORDER BY revenue DESC LIMIT 15
    """, {"sku": sku}) or []
    top_customers_list = [{
        "category": r[1],
        "value": float(r[3] or 0),
        "extra": {
            "customer_id": int(r[0] or 0),
            "units": int(r[2] or 0),
            "orders": int(r[4] or 0),
            "provincia": r[5] or "-",
        },
    } for r in top_customers]

    rows = q(eng, """
        SELECT COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)') AS prov,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE oi.sku = :sku AND o."paymentStatus" = 'paid'
        GROUP BY 1
        ORDER BY revenue DESC LIMIT 10
    """, {"sku": sku}) or []
    by_province = [{
        "category": r[0],
        "value": float(r[2] or 0),
        "extra": {"units": int(r[1] or 0)},
    } for r in rows]

    rows = q(eng, """
        SELECT COALESCE("areaDescripcion",'(sin area)'),
               SUM(unidades)::int,
               COUNT(DISTINCT ubicacion)::int
        FROM digip."StockDetalle"
        WHERE "articuloCodigo" = :sku
        GROUP BY 1 ORDER BY 2 DESC
    """, {"sku": sku}) or []
    stock_by_area = [{
        "category": r[0],
        "value": float(r[1] or 0),
        "extra": {"ubicaciones": int(r[2] or 0)},
    } for r in rows]

    devs = []
    try:
        eng_dev = get_engine("unidev")
        rows = q(eng_dev, """
            SELECT d.devolucion_id, d.fecha_creacion::text, d.estado_general,
                   d.tipo_resolucion_preferida,
                   di.cantidad_solicitada, di.monto_unitario::float
            FROM public.devoluciones d
            JOIN public.devolucion_items di ON di.devolucion_id = d.devolucion_id
            WHERE di.sku = :sku
            ORDER BY d.fecha_creacion DESC LIMIT 20
        """, {"sku": sku}) or []
        devs = [{
            "category": r[0],
            "value": float((r[4] or 0) * (r[5] or 0)),
            "extra": {
                "fecha": r[1][:10] if r[1] else "",
                "estado": r[2] or "?",
                "resolucion": r[3] or "?",
                "cantidad": int(r[4] or 0),
            },
        } for r in rows]
    except Exception:
        pass

    cost_info = None
    try:
        cost_info = costs_svc.cost_for_sku(sku, in_ars=True)
        if cost_info and cost_info.get("legacy_lote"):
            # Lote viejo importado con parser malo: warning y NO calculamos
            cost_info["margen_warning"] = cost_info.get("legacy_warning") or (
                "Lote con data legacy - re-importar CSV VALOR PRODUCTO."
            )
        elif cost_info and cost_info.get("cost_ars") and total_rev and total_units:
            # Engine de ganancia NETA (caja real): descuenta costo c/IVA + IVA neto
            # a pagar + IIBB 5% + fee gateway 0.5% promedio (asumimos 90% online).
            # Alicuota IVA se DERIVA del lote del SKU (no se asume 21%).
            from app.services.profit_engine import calc_profit, derive_iva_aliquot
            unit_sin_iva = float(cost_info.get("cost_unit_ars") or 0)
            unit_con_iva = float(cost_info.get("cost_con_iva_unit_ars") or unit_sin_iva)
            iva_aliq = derive_iva_aliquot(unit_sin_iva, unit_con_iva)
            costo_sin_iva_total = unit_sin_iva * total_units
            costo_con_iva_total = unit_con_iva * total_units

            # Margen contable (revenue - costo) — la metrica vieja, para comparar
            margen_simple = total_rev - costo_sin_iva_total
            cost_info["margen_estimado_lifetime"] = round(margen_simple, 0)
            if total_rev > 0:
                cost_info["margen_pct"] = round(margen_simple / total_rev * 100, 1)

            # Ganancia NETA caja: blend 90% online / 10% efectivo aprox.
            # No tenemos breakdown real per orden aca (lo computa el modal),
            # pero el blend es buen proxy lifetime.
            pb_online = calc_profit(
                ingreso_bruto=total_rev,
                costo_sin_iva=costo_sin_iva_total,
                costo_con_iva=costo_con_iva_total,
                is_cash=False,
                iva_aliquot_override=iva_aliq,
            )
            pb_cash = calc_profit(
                ingreso_bruto=total_rev,
                costo_sin_iva=costo_sin_iva_total,
                costo_con_iva=costo_con_iva_total,
                is_cash=True,
                iva_aliquot_override=iva_aliq,
            )
            ganancia_neta_blend = 0.9 * pb_online.ganancia_neta + 0.1 * pb_cash.ganancia_neta
            cost_info["ganancia_neta_lifetime"] = round(ganancia_neta_blend, 0)
            cost_info["ganancia_neta_pct"] = round(ganancia_neta_blend / total_rev * 100, 1) if total_rev > 0 else None
            cost_info["profit_breakdown"] = pb_online.to_dict()  # desglose ejemplo (caso online)
            cost_info["iva_aliquot_derived"] = iva_aliq

            # Card para el frontend
            cards.append({
                "label": "Ganancia neta (lifetime)",
                "value": round(ganancia_neta_blend, 0),
                "prefix": "$ ",
                "hint": f"Margen {cost_info['ganancia_neta_pct']:.1f}% · descuenta costo + IVA + IIBB + fee gateway"
                if cost_info.get("ganancia_neta_pct") is not None else "Caja real",
            })
    except Exception as e:
        log.warning("product_detail ganancia neta fail: %s", e)

    if product_info:
        product_info["images"] = images

    # Ordenes que incluyen este SKU en el periodo seleccionado.
    # Es la nueva seccion 'recent_orders' que reemplaza el modal drilldown
    # cuando el user clickea un blurb del home story tipo 'En TN Unistore
    # hoy lidera X con N unidades'. Filtrar HOY = solo del calendar day.
    recent_orders: list[dict] = []
    try:
        _method_expr = _shipping_method_expr(eng)
        _type_col = _shipping_type_col(eng)
        _car_col = _carrier_col(eng)
        _type_select = f", {_type_col} AS shipping_type" if _type_col else ""
        _carrier_select = f", {_car_col} AS carrier_name" if _car_col else ""
        _type_alias = "m.shipping_type" if _type_col else None
        _carrier_alias = "m.carrier_name" if _car_col else None
        _canal_sql = _classify_channel_sql(
            "m.metodo_envio", type_alias=_type_alias,
            carrier_alias=_carrier_alias, pva_alias="m.is_pva",
        )
        rows = q(eng, f"""
            WITH base AS (
              SELECT o.id, o.number, o."createdAt"::text AS fecha,
                     o."paymentStatus", o."shippingStatus", o.status,
                     o.total::float, oi.quantity, oi.price::float,
                     (oi.quantity * oi.price)::float AS subtotal,
                     COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)') AS provincia,
                     COALESCE(c.name, c.email, 'Customer ' || o."customerId"::text) AS cliente,
                     o."customerId" AS customer_id,
                     EXISTS (
                       SELECT 1 FROM digip."DespachoPedido" dp
                       JOIN digip."Pedido" pd ON pd."Codigo" = dp."pedidoCodigo"
                       WHERE pd."orderId" = o.id
                     ) AS empaquetada,
                     {_method_expr}{_type_select}{_carrier_select},
                     EXISTS (
                       SELECT 1 FROM tienda_nube."OrderItem" oi2
                       WHERE oi2."orderId" = o.id AND oi2.sku ILIKE 'PVA%'
                     ) AS is_pva
              FROM tienda_nube."OrderItem" oi
              JOIN tienda_nube."Order" o ON o.id = oi."orderId"
              LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
              LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
              LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
              WHERE oi.sku = :sku
                AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
            )
            SELECT m.id, m.number, m.fecha,
                   m."paymentStatus", m."shippingStatus", m.status,
                   m.total, m.quantity, m.price, m.subtotal,
                   m.provincia, m.cliente, m.customer_id, m.empaquetada,
                   {_canal_sql} AS canal
            FROM base m
            ORDER BY m.fecha DESC
            LIMIT 200
        """, {"sku": sku, "from_ts": from_ts, "to_ts": to_ts}) or []
        recent_orders = [{
            "id": int(r[0]) if r[0] else None,
            "numero": str(r[1] or r[0] or ""),
            "fecha": (r[2] or "")[:16] if r[2] else "",
            "payment": r[3] or "",
            "shipping": r[4] or "",
            "status": r[5] or "",
            "total": float(r[6] or 0),
            "qty": int(r[7] or 0),
            "precio_unit": float(r[8] or 0),
            "subtotal": float(r[9] or 0),
            "provincia": r[10] or "",
            "cliente": r[11] or "",
            "customer_id": int(r[12] or 0) if r[12] else None,
            "empaquetada": bool(r[13]) if r[13] is not None else False,
            "canal": r[14] or "",
        } for r in rows]
    except Exception as e:
        log.warning("product_detail recent_orders fail: %s", e)

    return {
        "sku": sku,
        "product_info": product_info,
        "images": images,
        "cards": cards,
        "cost_info": cost_info,
        "monthly_revenue": monthly_trend,
        "monthly_units": units_trend,
        "top_customers": top_customers_list,
        "by_province": by_province,
        "stock_by_area": stock_by_area,
        "devoluciones": devs,
        "first_sale": first_sale,
        "last_sale": last_sale,
        # Nuevo: ordenes con este SKU en el periodo seleccionado
        "recent_orders": recent_orders,
        "period": period,
        "window_label": win.get("label", period),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


# ===================== CUSTOMER 360 =====================

# Cache de la mediana poblacional (gap 1ra->2da compra) - se recalcula cada hora
_POP_GAP_CACHE: dict[str, tuple[float, dt.datetime]] = {}
_POP_GAP_TTL = dt.timedelta(hours=1)


def _population_first_to_second_gap_unistore() -> float | None:
    """Mediana de dias entre 1ra y 2da compra de los customers Unistore TN.

    Sirve como cadencia 'baseline' para clientes con 1 sola compra: si su recency
    supera 1.2x/2x/3x de esta mediana, ya entra en En riesgo / Churn pendiente /
    Churn confirmado a pesar de no tener cadencia personal todavia.
    """
    cached = _POP_GAP_CACHE.get("unistore")
    if cached and (dt.datetime.now() - cached[1]) < _POP_GAP_TTL:
        return cached[0]
    try:
        eng = get_engine("unistore")
        rows = q(eng, """
            WITH ranked AS (
              SELECT "customerId" AS cid, "createdAt"::date AS d,
                     ROW_NUMBER() OVER (PARTITION BY "customerId" ORDER BY "createdAt") AS rn
              FROM tienda_nube."Order"
              WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
            ),
            first_two AS (
              SELECT cid,
                     MAX(CASE WHEN rn = 1 THEN d END) AS d1,
                     MAX(CASE WHEN rn = 2 THEN d END) AS d2
              FROM ranked WHERE rn <= 2 GROUP BY cid
            )
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (d2 - d1)) AS median_days
            FROM first_two WHERE d2 IS NOT NULL AND (d2 - d1) > 0
        """) or []
        if rows and rows[0] and rows[0][0] is not None:
            val = float(rows[0][0])
            _POP_GAP_CACHE["unistore"] = (val, dt.datetime.now())
            return val
    except Exception:
        pass
    return None


def customer_journey(customer_id: int) -> dict:
    """Storytelling de un cliente Unistore: timeline + cadencia personal.

    A diferencia de un "promedio de gap" generico, calcula la cadencia personal
    con promedio ponderado (mas peso a la ultima compra que al promedio
    historico). Esto detecta:
      - El cliente cuyo gap "real" se acorto (esta comprando mas seguido)
      - El cliente que se estiro vs SU ritmo (no vs el promedio de la base)

    Ponderacion:
      g >= 3 gaps: 0.6 ultimo + 0.3 anterior + 0.1 anterior-anterior
      g == 2:     0.7 ultimo + 0.3 anterior
      g == 1:     ultimo
      g == 0:     None (no se puede predecir, todavia primera compra)

    Estado:
      - "primera_compra": no hay gap
      - "en_ritmo":      dias_desde_ultima <= expected_gap * 1.2
      - "atrasado":      expected_gap*1.2 < dias <= expected_gap * 2
      - "muy_atrasado":  dias > expected_gap * 2  (riesgo churn alto)
    """
    eng = get_engine("unistore")

    rows = q(eng, """
        SELECT o.id,
               o."createdAt"::date AS d,
               o.total::float,
               COALESCE(it.units, 0)::int AS units,
               o.number
        FROM tienda_nube."Order" o
        LEFT JOIN (
          SELECT "orderId", SUM(quantity)::int AS units
          FROM tienda_nube."OrderItem"
          GROUP BY "orderId"
        ) it ON it."orderId" = o.id
        WHERE o."customerId" = :cid AND o."paymentStatus" = 'paid'
        ORDER BY o."createdAt" ASC
    """, {"cid": customer_id}) or []

    if not rows:
        return {
            "customer_id": customer_id,
            "events": [],
            "gaps": [],
            "expected_gap_days": None,
            "expected_next_date": None,
            "days_since_last": None,
            "status": "sin_compras",
            "status_label": "Sin compras pagadas",
            "narrative": "Aun no hizo su primera compra paga.",
        }

    today = today_ar()
    events: list[dict] = []
    gaps: list[int] = []
    prev_date: dt.date | None = None
    total_revenue = 0.0
    total_units = 0

    labels_ord = ["1ra compra", "2da compra", "3ra compra", "4ta compra", "5ta compra"]

    for idx, r in enumerate(rows):
        order_id = int(r[0])
        d = r[1]
        total = float(r[2] or 0)
        units = int(r[3] or 0)
        number = str(r[4] or order_id)
        gap = None
        if prev_date is not None:
            gap = (d - prev_date).days
            gaps.append(gap)
        total_revenue += total
        total_units += units
        # Stage lifecycle al momento de ESTA compra (segun # de compras hasta aca)
        n_so_far = idx + 1
        if n_so_far == 1: stage = "Nuevo"
        elif n_so_far == 2: stage = "Segunda compra"
        elif n_so_far == 3: stage = "Conv. a Recurrente"
        else: stage = "Recurrente"

        events.append({
            "order_id": order_id,
            "number": number,
            "label": labels_ord[idx] if idx < len(labels_ord) else f"{idx+1}a compra",
            "date": d.isoformat(),
            "total": round(total, 2),
            "units": units,
            "gap_days": gap,
            "stage": stage,
            "cumulative_revenue": round(total_revenue, 2),
            "cumulative_units": total_units,
        })
        prev_date = d

    # Cadencia personal con promedio ponderado
    expected_gap_days: float | None = None
    expected_next_date: str | None = None
    weighted_breakdown: list[dict] = []
    if len(gaps) >= 3:
        g_last, g_prev, g_prev2 = gaps[-1], gaps[-2], gaps[-3]
        expected_gap_days = 0.6 * g_last + 0.3 * g_prev + 0.1 * g_prev2
        weighted_breakdown = [
            {"weight": 0.6, "gap_days": g_last, "label": "ultimo gap"},
            {"weight": 0.3, "gap_days": g_prev, "label": "ant. gap"},
            {"weight": 0.1, "gap_days": g_prev2, "label": "pre-ant. gap"},
        ]
    elif len(gaps) == 2:
        g_last, g_prev = gaps[-1], gaps[-2]
        expected_gap_days = 0.7 * g_last + 0.3 * g_prev
        weighted_breakdown = [
            {"weight": 0.7, "gap_days": g_last, "label": "ultimo gap"},
            {"weight": 0.3, "gap_days": g_prev, "label": "ant. gap"},
        ]
    elif len(gaps) == 1:
        expected_gap_days = float(gaps[-1])
        weighted_breakdown = [{"weight": 1.0, "gap_days": gaps[-1], "label": "unico gap"}]

    if expected_gap_days is not None and prev_date is not None:
        expected_next_date = (prev_date + dt.timedelta(days=round(expected_gap_days))).isoformat()

    days_since_last = (today - prev_date).days if prev_date else None
    avg_gap_simple = round(sum(gaps) / len(gaps), 1) if gaps else None

    # Lifecycle ampliado alineado con CS overview (8 estados).
    # ACTIVO (en ritmo) escala segun # compras
    # OVERRIDE de Churn cuando ratio > umbral, Recuperado cuando volvio post-churn.
    n_orders = len(events)
    max_gap_hist = max(gaps) if gaps else 0
    cs_action = ""
    # Para clientes con 1 sola compra usamos la MEDIANA POBLACIONAL de gap
    # 1ra->2da de Unistore como baseline. Asi un cliente "Nuevo" con recency
    # alta no queda eternamente en Nuevo: si paso 2x la mediana ya es churn.
    pop_baseline = None
    if expected_gap_days is None and n_orders == 1:
        pop_baseline = _population_first_to_second_gap_unistore()
        if pop_baseline and days_since_last is not None:
            expected_gap_days = pop_baseline
            weighted_breakdown = [{
                "weight": 1.0, "gap_days": round(pop_baseline, 1),
                "label": "mediana poblacional 1ra->2da compra"
            }]
            if prev_date is not None:
                expected_next_date = (prev_date + dt.timedelta(days=round(pop_baseline))).isoformat()

    if days_since_last is None or expected_gap_days is None:
        status, status_label = "primera_compra", "Primera compra"
        cs_action = "Welcome flow + survey de primera compra"
        narrative = (
            f"Compro 1 sola vez ({events[-1]['date']}, $ {events[-1]['total']:,.0f}). "
            "Todavia no hay cadencia para predecir cuando volveria."
        )
    else:
        ratio = days_since_last / expected_gap_days if expected_gap_days > 0 else 0
        # Lifecycle stage (independiente de health)
        if n_orders == 1: stage = "Nuevo"
        elif n_orders == 2: stage = "Segunda compra"
        elif n_orders == 3: stage = "Conv. a Recurrente"
        else: stage = "Recurrente"

        # Recuperado: tuvo gap historico > 180d y volvio reciente (ratio bajo)
        if max_gap_hist > 180 and days_since_last <= 60:
            status, status_label = "recuperado", "Recuperado"
            cs_action = "Welcome back + entender por que volvio para replicarlo"
        elif ratio > 3.0:
            status, status_label = "churn_confirmado", f"{stage} · Churn confirmado"
            cs_action = "Campana de recuperacion + outreach management directo"
        elif ratio > 2.0:
            status, status_label = "churn_pendiente", f"{stage} · Churn pendiente"
            cs_action = "Outreach personal CS + descuento fuerte ahora"
        elif ratio > 1.2:
            status, status_label = "en_riesgo", f"{stage} · En riesgo"
            cs_action = "Email recordatorio + descuento blando 1ra recompra"
        else:
            # En ritmo segun lifecycle
            if n_orders == 1:
                status, status_label = "nuevo", "Nuevo"
                cs_action = "Welcome flow + survey de primera compra"
            elif n_orders == 2:
                status, status_label = "segunda_compra", "Segunda compra"
                cs_action = "Programa de fidelidad + cross-sell"
            elif n_orders == 3:
                status, status_label = "conv_recurrente", "Conv. a Recurrente"
                cs_action = "Reconocer como leal + upsell premium"
            else:
                status, status_label = "recurrente", "Recurrente"
                cs_action = "VIP perks + mantener satisfaccion"

        # Narrativa
        diff_vs_avg = ""
        if avg_gap_simple and expected_gap_days:
            d = expected_gap_days - avg_gap_simple
            if abs(d) >= 3:
                diff_vs_avg = (
                    f" Su ritmo reciente es {'mas rapido' if d < 0 else 'mas lento'} "
                    f"que su promedio historico ({avg_gap_simple:.0f} d)."
                )
        ritmo_txt = {
            "nuevo": "todavia es nuevo, esta dentro de su ventana de 2da compra",
            "segunda_compra": "viene comprando con regularidad personal",
            "conv_recurrente": "esta consolidado como cliente recurrente",
            "recurrente": "es un cliente leal de la marca",
            "en_riesgo": "se esta estirando, hay que activarlo",
            "churn_pendiente": "pasó al doble de su ritmo personal — outreach urgente",
            "churn_confirmado": "triplica su cadencia, se fugo del patron",
            "recuperado": "volvio despues de una fuga larga, retencion alta-prioridad",
        }.get(status, "estado evaluable")
        cadencia_origen = "mediana poblacional 1ra->2da compra" if pop_baseline else "cadencia personal"
        narrative = (
            f"Lleva {n_orders} compras pagas por $ {total_revenue:,.0f}. "
            f"Cadencia esperada ~{expected_gap_days:.0f} d entre compras "
            f"({cadencia_origen})."
            f"{diff_vs_avg} "
            f"Hace {days_since_last} d de su ultima → {ritmo_txt}. "
            f"Proxima estimada: {expected_next_date}."
        )

    # Detectar evento donde se rompio el patron: gap real > 2x expected.
    # Marcamos ese evento como churn_point para que la UI lo highlight.
    if expected_gap_days and gaps:
        # Asociar gap a su evento (events[1..] tienen gap_days)
        for ev in events:
            g = ev.get("gap_days")
            if g and expected_gap_days > 0 and g / expected_gap_days > 2.0:
                ev["churn_break"] = True
                ev["churn_ratio"] = round(g / expected_gap_days, 1)
            else:
                ev["churn_break"] = False

    # Computar gap_health POR EVENTO: que le paso al cliente durante el gap
    # que precede a ESTA compra. Si el gap supero 1.2x/2x/3x del expected en
    # ese momento, el cliente estuvo en en_riesgo / churn_pendiente / churn_confirmado
    # ANTES de hacer esta compra (= "recuperacion" de ese estado al comprar).
    pop_base = _population_first_to_second_gap_unistore()
    for i, ev in enumerate(events):
        g = ev.get("gap_days")
        if g is None:
            # Primera compra: no hay gap previo
            ev["gap_health"] = None
            ev["gap_health_label"] = None
            ev["gap_expected"] = None
            ev["transition_narrative"] = "Primera compra: arranca el ciclo. Bienvenida + survey."
            continue
        # Calcular expected_gap en EL MOMENTO de esta compra (con datos hasta i-1)
        prior_gaps = [x["gap_days"] for x in events[:i] if x.get("gap_days") is not None]
        if len(prior_gaps) >= 3:
            exp = 0.6 * prior_gaps[-1] + 0.3 * prior_gaps[-2] + 0.1 * prior_gaps[-3]
        elif len(prior_gaps) == 2:
            exp = 0.7 * prior_gaps[-1] + 0.3 * prior_gaps[-2]
        elif len(prior_gaps) == 1:
            exp = float(prior_gaps[-1])
        else:
            exp = pop_base  # 2da compra: comparar contra mediana poblacional
        ev["gap_expected"] = round(exp, 1) if exp else None
        if not exp or exp <= 0:
            ev["gap_health"] = None
            ev["gap_health_label"] = None
            ev["transition_narrative"] = None
            continue
        ratio = g / exp
        ev["gap_ratio"] = round(ratio, 2)
        prev_stage = events[i - 1]["stage"]
        if ratio > 3.0:
            ev["gap_health"] = "churn_confirmado"
            ev["gap_health_label"] = "Churn confirmado"
            ev["transition_narrative"] = (
                f"Durante este gap se fugo del patron: {prev_stage} → Churn confirmado "
                f"({g}d vs ~{round(exp)}d esperados). Volvio a comprar = RECUPERACION."
            )
        elif ratio > 2.0:
            ev["gap_health"] = "churn_pendiente"
            ev["gap_health_label"] = "Churn pendiente"
            ev["transition_narrative"] = (
                f"Durante este gap entro en Churn pendiente: {prev_stage} → Churn pendiente "
                f"({g}d vs ~{round(exp)}d). Volvio a comprar a tiempo."
            )
        elif ratio > 1.2:
            ev["gap_health"] = "en_riesgo"
            ev["gap_health_label"] = "En riesgo"
            ev["transition_narrative"] = (
                f"Durante este gap quedo En riesgo: {prev_stage} → {prev_stage} · En riesgo "
                f"({g}d vs ~{round(exp)}d). Recupero comprando."
            )
        else:
            ev["gap_health"] = "en_ritmo"
            ev["gap_health_label"] = "En ritmo"
            ev["transition_narrative"] = (
                f"Compra dentro del ritmo esperado ({g}d vs ~{round(exp)}d)."
            )

    # Order events DESC (most-recent first) para el sidebar storytelling
    events_desc = list(reversed(events))

    return {
        "customer_id": customer_id,
        "events": events_desc,
        "gaps": gaps,
        "avg_gap_days_simple": avg_gap_simple,
        "expected_gap_days": round(expected_gap_days, 1) if expected_gap_days else None,
        "expected_next_date": expected_next_date,
        "weighted_breakdown": weighted_breakdown,
        "days_since_last": days_since_last,
        "total_paid_orders": len(events),
        "total_revenue": round(total_revenue, 2),
        "total_units": total_units,
        "ticket_avg": round(total_revenue / len(events), 0) if events else 0,
        "status": status,
        "status_label": status_label,
        "cs_action": cs_action,
        "narrative": narrative,
    }


def customer_detail(customer_id: int) -> dict:
    """Vista 360 de un customer Unistore: orders, productos, cancelaciones, RFM."""
    eng = get_engine("unistore")

    info = q(eng, """
        SELECT id, name, email, phone, "totalSpent"::float,
               "billingProvince", "billingCity", "customerType",
               "firstInteraction"::text, active, "acceptsMarketing"
        FROM tienda_nube."Customer"
        WHERE id = :cid
    """, {"cid": customer_id}) or []
    customer_info = None
    if info:
        r = info[0]
        customer_info = {
            "id": int(r[0] or 0),
            "name": r[1] or "(sin nombre)",
            "email": r[2] or "",
            "phone": r[3] or "",
            "total_spent": float(r[4] or 0),
            "province": r[5] or "",
            "city": r[6] or "",
            "type": r[7] or "",
            "first_interaction": r[8],
            "active": bool(r[9]) if r[9] is not None else None,
            "accepts_marketing": bool(r[10]) if r[10] is not None else None,
        }

    cards: list[dict] = []

    lt = q(eng, """
        SELECT COUNT(*)::int AS orders,
               COUNT(*) FILTER (WHERE "paymentStatus"='paid')::int AS paid_orders,
               COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
               SUM(CASE WHEN "paymentStatus"='paid' THEN total ELSE 0 END)::float AS revenue,
               AVG(CASE WHEN "paymentStatus"='paid' THEN total END)::float AS aov,
               MAX("createdAt") AS last_order,
               MIN("createdAt") AS first_order
        FROM tienda_nube."Order"
        WHERE "customerId" = :cid
    """, {"cid": customer_id}) or []
    if lt:
        r = lt[0]
        orders = int(r[0] or 0)
        paid = int(r[1] or 0)
        cancelled = int(r[2] or 0)
        revenue = float(r[3] or 0)
        aov = float(r[4] or 0)
        last_order = r[5]
        first_order = r[6]
        recency_days = (dt.datetime.now(dt.timezone.utc) - last_order.replace(tzinfo=dt.timezone.utc)).days if last_order else None

        if paid >= 4:
            estado = "Recurrente"
        elif paid == 3:
            estado = "Convertido a Recurrente"
        elif paid == 2:
            estado = "2da compra"
        elif paid == 1:
            estado = "Nuevo"
        else:
            estado = "Sin compras"

        cards.append({"label": "Facturacion total Unistore", "value": round(revenue, 0), "prefix": "$ ",
                      "hint": f"Ticket promedio $ {aov:,.0f}" if aov else "Suma TN paid lifetime"})
        cards.append({"label": "Ordenes pagadas", "value": paid,
                      "hint": f"De {orders} totales · {cancelled} canceladas"})
        cards.append({"label": "Etapa del cliente", "value": estado,
                      "hint": "Segun ciclo de vida (Nuevo → 2da → Recurrente)"})
        cards.append({"label": "Ultima compra (dias)",
                      "value": f"{recency_days} d" if recency_days is not None else "—",
                      "hint": f"Compro el {last_order.strftime('%d/%m/%Y')}" if last_order else "Aun no compro"})
        cards.append({"label": "Ticket promedio", "value": round(aov, 0), "prefix": "$ ",
                      "hint": "Facturacion / ordenes pagadas"})
        cards.append({"label": "Tasa cancelacion",
                      "value": round(cancelled / orders * 100, 1) if orders else 0, "suffix": "%",
                      "hint": f"{cancelled} / {orders} ordenes"})

        # ----- LTV-ganancia: ganancia neta real del cliente vs facturacion -----
        # Itera sobre items de TODAS las orders paid del cliente, aplica engine.
        try:
            from app.services.profit_engine import cost_index_unistore, profit_for_order_items
            cost_idx = cost_index_unistore()
            items_rows = q(eng, """
                SELECT o.id, o.gateway, oi.sku, oi.quantity::int, oi.price::float
                FROM tienda_nube."Order" o
                JOIN tienda_nube."OrderItem" oi ON oi."orderId" = o.id
                WHERE o."customerId" = :cid AND o."paymentStatus" = 'paid'
                  AND oi.sku IS NOT NULL AND oi.sku <> ''
            """, {"cid": customer_id}) or []
            by_order: dict[int, dict] = {}
            for r in items_rows:
                oid = r[0]
                if oid not in by_order:
                    by_order[oid] = {"gateway": r[1], "items": []}
                by_order[oid]["items"].append((r[2], r[3], r[4]))

            total_ganancia = 0.0
            ordenes_con_costo = 0
            ordenes_total = len(by_order)
            for oid, od in by_order.items():
                is_cash = (od["gateway"] or "").lower() == "offline"
                pb = profit_for_order_items(od["items"], cost_idx=cost_idx, is_cash=is_cash)
                if pb.has_cost:
                    total_ganancia += pb.ganancia_neta
                    ordenes_con_costo += 1

            if ordenes_total > 0 and revenue > 0:
                cobertura = ordenes_con_costo / ordenes_total * 100
                ganancia_pct = total_ganancia / revenue * 100
                cards.append({
                    "label": "Ganancia neta lifetime",
                    "value": round(total_ganancia, 0), "prefix": "$ ",
                    "hint": f"Margen {ganancia_pct:.1f}% · cobertura costos {cobertura:.0f}% ({ordenes_con_costo}/{ordenes_total})",
                })
        except Exception as e:
            log.warning("customer_detail ganancia LTV fail: %s", e)

    method_expr = _shipping_method_expr(eng)
    type_col = _shipping_type_col(eng)
    carrier_col_expr = _carrier_col(eng)
    type_select = f", {type_col} AS shipping_type" if type_col else ""
    carrier_select = f", {carrier_col_expr} AS carrier_name" if carrier_col_expr else ""
    type_alias = "m.shipping_type" if type_col else None
    carrier_alias = "m.carrier_name" if carrier_col_expr else None
    canal_sql = _classify_channel_sql(
        "m.metodo_envio", type_alias=type_alias,
        carrier_alias=carrier_alias, pva_alias="m.is_pva",
    )
    rows = q(eng, f"""
        WITH base AS (
          SELECT o.id, o.number, o."createdAt"::text, o.status,
                 o."paymentStatus", o."shippingStatus", o.total::float,
                 {method_expr}{type_select}{carrier_select},
                 EXISTS (
                   SELECT 1 FROM tienda_nube."OrderItem" oi
                   WHERE oi."orderId" = o.id AND oi.sku ILIKE 'PVA%'
                 ) AS is_pva,
                 EXISTS (
                   SELECT 1 FROM digip."DespachoPedido" dp
                   JOIN digip."Pedido" pd ON pd."Codigo" = dp."pedidoCodigo"
                   WHERE pd."orderId" = o.id
                 ) AS empaquetada
          FROM tienda_nube."Order" o
          LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
          WHERE o."customerId" = :cid
        )
        SELECT m.id, m.number, m."createdAt", m.status,
               m."paymentStatus", m."shippingStatus", m.total,
               m.empaquetada,
               {canal_sql} AS canal
        FROM base m
        ORDER BY m."createdAt" DESC LIMIT 50
    """, {"cid": customer_id}) or []
    orders_list = [{
        "category": str(r[1] or r[0]),
        "value": float(r[6] or 0),
        "extra": {
            "id": int(r[0] or 0),
            "fecha": r[2][:10] if r[2] else "",
            "status": r[3] or "",
            "payment": r[4] or "",
            "shipping": r[5] or "",
            "empaquetada": bool(r[7]) if r[7] is not None else False,
            "canal": r[8] or "",
        },
    } for r in rows]

    rows = q(eng, """
        SELECT oi.sku, MAX(oi.name) AS name,
               SUM(oi.quantity)::int AS units,
               SUM(oi.quantity * oi.price)::float AS revenue,
               COUNT(DISTINCT oi."orderId")::int AS orders,
               (SELECT pi.src FROM tienda_nube."ProductImage" pi
                WHERE pi."productId" IN (
                    SELECT pv."productId" FROM tienda_nube."ProductVariant" pv WHERE pv.sku = oi.sku
                )
                ORDER BY pi.position ASC NULLS LAST LIMIT 1) AS imagen
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        WHERE o."customerId" = :cid AND o."paymentStatus" = 'paid'
        GROUP BY oi.sku
        ORDER BY revenue DESC LIMIT 15
    """, {"cid": customer_id}) or []
    # Enriquezco con ganancia neta per SKU usando el cost_idx ya construido arriba.
    # Reutilizo el cost_idx de la seccion LTV-ganancia (variable cost_idx queda en scope local).
    from app.services.profit_engine import calc_profit
    _cost_idx = locals().get("cost_idx") or {}
    top_products = []
    for r in rows:
        sku = r[0]
        sku_key = (sku or "").strip().lower()
        units = int(r[2] or 0)
        revenue = float(r[3] or 0)
        ganancia: float | None = None
        margen_pct: float | None = None
        crec = _cost_idx.get(sku_key)
        if crec and crec.get("costo_con_iva") and units > 0 and revenue > 0:
            sin_iva = float(crec.get("costo_sin_iva") or 0)
            con_iva = float(crec.get("costo_con_iva") or sin_iva)
            pb = calc_profit(
                ingreso_bruto=revenue,
                costo_sin_iva=sin_iva * units,
                costo_con_iva=con_iva * units,
                is_cash=False,
                iva_aliquot_override=crec.get("iva_aliquot"),
            )
            ganancia = round(pb.ganancia_neta, 0)
            margen_pct = round(pb.margen_pct, 1)
        top_products.append({
            "category": (r[1] or sku or "?")[:60],
            "value": revenue,
            "extra": {
                "sku": sku, "units": units, "orders": int(r[4] or 0),
                "imagen": r[5] or "",
                "ganancia": ganancia,
                "margen_pct": margen_pct,
            },
        })

    # BUGFIX: el LEFT JOIN OrderItem inflaba los counts de ordenes (contaba 1
    # fila por item). Ahora calculamos ordenes y items por separado y los
    # combinamos por mes. ordenes_pagas = COUNT DISTINCT orders paid del mes.
    rows = q(eng, """
        WITH ord AS (
          SELECT date_trunc('month', o."createdAt")::date AS mes,
                 COUNT(*)::int                                                 AS ordenes_total,
                 COUNT(*) FILTER (WHERE o."paymentStatus" = 'paid')::int       AS ordenes_pagas,
                 COUNT(*) FILTER (WHERE o.status = 'cancelled')::int           AS ordenes_canceladas,
                 COALESCE(SUM(CASE WHEN o."paymentStatus"='paid' THEN o.total ELSE 0 END),0)::float AS revenue
          FROM tienda_nube."Order" o
          WHERE o."customerId" = :cid
          GROUP BY 1
        ),
        items AS (
          SELECT date_trunc('month', o."createdAt")::date AS mes,
                 COALESCE(SUM(oi.quantity),0)::int                AS units,
                 COUNT(DISTINCT oi.sku)::int                      AS skus_distintos
          FROM tienda_nube."Order" o
          INNER JOIN tienda_nube."OrderItem" oi ON oi."orderId" = o.id
          WHERE o."customerId" = :cid AND o."paymentStatus" = 'paid'
          GROUP BY 1
        )
        SELECT ord.mes, ord.ordenes_total, ord.ordenes_pagas, ord.ordenes_canceladas,
               ord.revenue,
               COALESCE(items.units, 0)         AS units,
               COALESCE(items.skus_distintos,0) AS skus_distintos
        FROM ord
        LEFT JOIN items USING (mes)
        ORDER BY ord.mes
    """, {"cid": customer_id}) or []
    # Construyo el monthly trend base
    monthly_trend = [{
        "date": r[0].strftime("%Y-%m") if r[0] else "",
        "value": float(r[4] or 0),  # revenue es la metrica default (backwards compat)
        # Metricas adicionales para el chart interactivo:
        "revenue": float(r[4] or 0),
        "ordenes": int(r[1] or 0),
        "ordenes_pagas": int(r[2] or 0),
        "ordenes_canceladas": int(r[3] or 0),
        "units": int(r[5] or 0),
        "skus_distintos": int(r[6] or 0),
        "ticket_promedio": round(float(r[4] or 0) / max(int(r[2] or 1), 1), 0),
        "ganancia": 0.0,  # se rellena abajo
    } for r in rows]

    # Ganancia mensual: itero items paid del cliente agrupados por mes + engine.
    try:
        rows_items = q(eng, """
            SELECT date_trunc('month', o."createdAt")::date AS mes,
                   o.id, o.gateway, oi.sku, oi.quantity::int, oi.price::float
            FROM tienda_nube."Order" o
            JOIN tienda_nube."OrderItem" oi ON oi."orderId" = o.id
            WHERE o."customerId" = :cid AND o."paymentStatus" = 'paid'
              AND oi.sku IS NOT NULL AND oi.sku <> ''
            ORDER BY 1, 2
        """, {"cid": customer_id}) or []
        # Agrupo (mes, orderId) → items + gateway
        by_month_order: dict = {}
        for r in rows_items:
            mes_str = r[0].strftime("%Y-%m") if r[0] else ""
            oid = r[1]
            key = (mes_str, oid)
            if key not in by_month_order:
                by_month_order[key] = {"gateway": r[2], "items": []}
            by_month_order[key]["items"].append((r[3], r[4], r[5]))
        ganancia_by_month: dict[str, float] = {}
        from app.services.profit_engine import profit_for_order_items
        for (mes_str, _oid), od in by_month_order.items():
            is_cash = (od["gateway"] or "").lower() == "offline"
            pb = profit_for_order_items(od["items"], cost_idx=_cost_idx, is_cash=is_cash)
            if pb.has_cost:
                ganancia_by_month[mes_str] = ganancia_by_month.get(mes_str, 0.0) + pb.ganancia_neta
        for m in monthly_trend:
            m["ganancia"] = round(ganancia_by_month.get(m["date"], 0.0), 0)
    except Exception as e:
        log.warning("customer_detail monthly ganancia fail: %s", e)

    return {
        "customer_info": customer_info,
        "cards": cards,
        "orders": orders_list,
        "top_products": top_products,
        "monthly_trend": monthly_trend,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
