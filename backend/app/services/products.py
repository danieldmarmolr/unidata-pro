"""
Productos - Unistore.
Vista global cross-canal (TN + ML) + drill 360 por SKU.
Cruza tienda_nube.OrderItem (TN), meli.meli_orders (ML), digip.StockDetalle (stock),
unidev.devolucion_items (devoluciones), costs SQLite (costo de importacion).
"""
from __future__ import annotations

import datetime as dt

from app.db.engines import get_engine
from app.services._utils import q, scalar
from app.services._utils import resolve_window
from app.services import costs as costs_svc

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

    cards.append({"label": "Productos publicados", "value": total_products, "hint": "Tienda Nube · published=TRUE"})
    cards.append({"label": f"SKUs vendidos ({period})", "value": skus_vendidos, "hint": "Distintos en orders pagas"})
    cards.append({"label": "Unidades vendidas", "value": units_periodo, "hint": "TN orders pagas"})
    cards.append({"label": "Sin movimiento (>90d)", "value": sin_movimiento, "hint": "SKUs en catalogo sin venta hace 90+ dias"})
    cards.append({"label": "SKUs Digip", "value": skus_digip, "hint": "En el WMS"})
    cards.append({"label": "Stock critico", "value": sku_critico, "hint": "<= 5 unidades totales"})

    top_revenue = q(eng_uni, """
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
        ORDER BY revenue DESC LIMIT 20
    """, p) or []
    top_products = [{
        "category": (r[1] or r[0])[:60],
        "value": float(r[4] or 0),
        "extra": {
            "sku": r[0], "product_id": r[2],
            "units": int(r[3] or 0),
            "orders": int(r[5] or 0),
            "customers": int(r[6] or 0),
            "imagen": r[7] or "",
        },
    } for r in top_revenue]

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
        "top_products": top_products,
        "top_brands": top_brands_list,
        "sin_movimiento": sin_movimiento_list,
        "stock_critico_alerta": stock_critico_alerta,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


# ===================== PRODUCT 360 (por SKU) =====================

def product_detail(sku: str) -> dict:
    """Vista 360 de un producto/SKU: ventas, canales, customers, devoluciones, stock."""
    eng = get_engine("unistore")

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

    stock_total = int(scalar(eng, """
        SELECT SUM(unidades)::int FROM digip."StockDetalle"
        WHERE "articuloCodigo" = :sku
    """, {"sku": sku}) or 0)

    cards.append({"label": "Revenue total (lifetime)", "value": round(total_rev, 0), "prefix": "$ "})
    cards.append({"label": "Unidades vendidas", "value": total_units})
    cards.append({"label": "Ordenes / clientes", "value": f"{total_orders} / {total_customers}",
                  "hint": "Distintos compradores"})
    cards.append({"label": "Revenue 30d", "value": round(rev_30, 0), "prefix": "$ ",
                  "hint": f"{units_30} unidades"})
    cards.append({"label": "Stock actual (Digip)", "value": stock_total,
                  "hint": "Suma todas las areas"})

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
        if cost_info and cost_info.get("cost_ars") and total_rev:
            margen_ars = total_rev - (total_units or 0) * cost_info["cost_ars"]
            cost_info["margen_estimado_lifetime"] = round(margen_ars, 0)
            if total_rev > 0:
                cost_info["margen_pct"] = round(margen_ars / total_rev * 100, 1)
    except Exception:
        pass

    if product_info:
        product_info["images"] = images

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
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


# ===================== CUSTOMER 360 =====================

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

    rows = q(eng, """
        SELECT o.id, o.number, o."createdAt"::text, o.status,
               o."paymentStatus", o."shippingStatus", o.total::float,
               EXISTS (
                 SELECT 1 FROM digip."DespachoPedido" dp
                 JOIN digip."Pedido" pd ON pd."Codigo" = dp."pedidoCodigo"
                 WHERE pd."orderId" = o.id
               ) AS empaquetada
        FROM tienda_nube."Order" o
        WHERE o."customerId" = :cid
        ORDER BY o."createdAt" DESC LIMIT 50
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
    top_products = [{
        "category": (r[1] or r[0] or "?")[:60],
        "value": float(r[3] or 0),
        "extra": {
            "sku": r[0], "units": int(r[2] or 0), "orders": int(r[4] or 0),
            "imagen": r[5] or "",
        },
    } for r in rows]

    rows = q(eng, """
        SELECT date_trunc('month', "createdAt")::date,
               COUNT(*)::int,
               SUM(CASE WHEN "paymentStatus"='paid' THEN total ELSE 0 END)::float
        FROM tienda_nube."Order"
        WHERE "customerId" = :cid
        GROUP BY 1 ORDER BY 1
    """, {"cid": customer_id}) or []
    monthly_trend = [{
        "date": r[0].strftime("%Y-%m") if r[0] else "",
        "value": float(r[2] or 0),
    } for r in rows]

    return {
        "customer_info": customer_info,
        "cards": cards,
        "orders": orders_list,
        "top_products": top_products,
        "monthly_trend": monthly_trend,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
