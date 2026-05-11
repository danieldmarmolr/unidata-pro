"""
Storytelling automatico - narrativa del dia basada en datos reales.
Genera 5-7 blurbs cortos cross-unidad para el home, listos para compartir
con toda la empresa ("hoy esto, eso comparado con ayer/semana").

Cada blurb incluye un `link` opcional para que el frontend lo haga clickable:
- {"kind": "drill", "endpoint": "/api/drilldowns/...", "title": "...", "filename": "..."}
- {"kind": "navigate", "href": "/dashboard/..."}
"""
from __future__ import annotations

import datetime as dt

from app.utils.tz import today_ar, now_ar
import logging
from urllib.parse import quote

from app.db.engines import get_engine
from app.services._utils import q, scalar, table_exists

log = logging.getLogger("unidata.story")


def _fmt_money(v: float) -> str:
    return f"$ {v:,.0f}".replace(",", ".")


def _fmt_int(v: int) -> str:
    return f"{v:,}".replace(",", ".")


def _delta_phrase(now: float, prev: float, unit: str = "") -> str:
    if not prev:
        return ""
    pct = (now - prev) / prev * 100
    sign = "+" if pct >= 0 else ""
    direction = "arriba" if pct >= 0 else "abajo"
    return f"{sign}{pct:.0f}% {direction} vs ayer"


def today_story() -> dict:
    """
    Construye una lista de blurbs narrativos sobre el dia.
    Cada blurb: { type, icon, title, body, accent }
    """
    blurbs: list[dict] = []
    uni = get_engine("unistore")
    drop = get_engine("unidrop")

    today_date = today_ar()
    today_iso = today_date.isoformat()

    # ============================================================
    # 1) GMV total del dia + comparativa vs ayer
    # ============================================================
    try:
        gmv_today = float(scalar(uni, """
            SELECT COALESCE((SELECT SUM(total) FROM tienda_nube."Order"
                             WHERE "createdAt"::date = CURRENT_DATE
                               AND "paymentStatus"='paid'), 0)
                 + COALESCE((SELECT SUM(total_amount) FROM meli.meli_orders
                             WHERE date_created::date = CURRENT_DATE
                               AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        gmv_yest = float(scalar(uni, """
            SELECT COALESCE((SELECT SUM(total) FROM tienda_nube."Order"
                             WHERE "createdAt"::date = CURRENT_DATE - 1
                               AND "paymentStatus"='paid'), 0)
                 + COALESCE((SELECT SUM(total_amount) FROM meli.meli_orders
                             WHERE date_created::date = CURRENT_DATE - 1
                               AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        if gmv_today > 0:
            delta = _delta_phrase(gmv_today, gmv_yest)
            body = f"Unistore lleva {_fmt_money(gmv_today)} en GMV hoy"
            if delta: body += f", {delta}."
            else: body += "."
            blurbs.append({
                "type": "gmv_unistore",
                "icon": "💰",
                "title": "Pulso Unistore",
                "body": body,
                "accent": "#7a3eae",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/orders/paid?period=today",
                    "title": "Ordenes pagas de hoy",
                    "filename": "orders_paid_today.csv",
                },
            })
    except Exception as e:
        log.warning("story gmv fail: %s", e)

    # ============================================================
    # 1b) GMV Unidrop del dia (TN + MELI sumados sobre tablas Unidrop)
    # ============================================================
    try:
        drop_today = float(scalar(drop, """
            SELECT
              COALESCE((SELECT SUM(total) FROM public.tienda_nube_orders
                        WHERE created_at::date = CURRENT_DATE
                          AND payment_status = 'paid'), 0)
            + COALESCE((SELECT SUM("totalAmount") FROM mercado_libre_dev."OrderMercadoLibre"
                        WHERE "dateCreated"::date = CURRENT_DATE
                          AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        drop_yest = float(scalar(drop, """
            SELECT
              COALESCE((SELECT SUM(total) FROM public.tienda_nube_orders
                        WHERE created_at::date = CURRENT_DATE - 1
                          AND payment_status = 'paid'), 0)
            + COALESCE((SELECT SUM("totalAmount") FROM mercado_libre_dev."OrderMercadoLibre"
                        WHERE "dateCreated"::date = CURRENT_DATE - 1
                          AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        if drop_today > 0:
            delta = _delta_phrase(drop_today, drop_yest)
            body = f"Unidrop lleva {_fmt_money(drop_today)} en ventas dropshippers hoy"
            body += f", {delta}." if delta else "."
            blurbs.append({
                "type": "gmv_unidrop",
                "icon": "📦",
                "title": "Pulso Unidrop",
                "body": body,
                "accent": "#0ea5e9",
                "link": {
                    "kind": "navigate",
                    "href": "/dashboard/ventas?unit=unidrop",
                },
            })
    except Exception as e:
        log.warning("story gmv unidrop fail: %s", e)

    # ============================================================
    # 2) SKU lider por canal — uno por canal: TN/MELI Unistore, TN/MELI Unidrop
    # ============================================================
    # Helper para construir el blurb de un lider por canal
    def _leader_blurb(label: str, channel: str, sku: str, name: str, units: int, drill_endpoint: str, drill_filename: str) -> dict:
        clean_name = (name or sku)[:60]
        return {
            "type": f"top_sku_{channel}",
            "icon": "👑",
            "title": f"Lider {label}",
            "body": f"En {label} hoy lidera \"{clean_name}\" con {units} unidades vendidas.",
            "accent": "#a259ff",
            "link": {
                "kind": "drill",
                "endpoint": drill_endpoint,
                "title": f"Ordenes hoy de {clean_name} ({label})",
                "filename": drill_filename,
            },
        }

    # 2a) Lider TN Unistore
    try:
        rows = q(uni, """
            SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units,
                   MAX(oi."productId") AS product_id
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus"='paid' AND o."createdAt"::date = CURRENT_DATE
              AND oi.sku IS NOT NULL
              AND oi.sku NOT ILIKE '%PVA%'
            GROUP BY oi.sku ORDER BY SUM(oi.quantity * oi.price) DESC LIMIT 1
        """) or []
        if rows:
            sku, name, units, pid = rows[0]
            ep = f"/api/drilldowns/products/{int(pid)}/orders?period=today" if pid else "/api/drilldowns/orders/paid?period=today"
            blurbs.append(_leader_blurb("TN Unistore", "tn_unistore", sku, name, int(units or 0), ep, f"top_tn_unistore_{today_iso}.csv"))
    except Exception as e:
        log.warning("story sku TN unistore fail: %s", e)

    # 2b) Lider MELI Unistore - solo si meli_order_items existe en este schema
    if table_exists(uni, "meli", "meli_order_items"):
        try:
            rows = q(uni, """
                SELECT mi.seller_sku AS sku, MAX(mi.title) AS name, SUM(mi.quantity)::int AS units
                FROM meli.meli_order_items mi
                JOIN meli.meli_orders mo ON mo.id = mi.order_id
                WHERE mo.date_created::date = CURRENT_DATE
                  AND mo.status IN ('paid','confirmed','shipped','delivered')
                  AND mi.seller_sku IS NOT NULL
                  AND mi.seller_sku NOT ILIKE '%PVA%'
                GROUP BY mi.seller_sku ORDER BY SUM(mi.unit_price * mi.quantity) DESC LIMIT 1
            """) or []
            if rows:
                sku, name, units = rows[0]
                blurbs.append(_leader_blurb(
                    "MELI Unistore", "meli_unistore", sku, name, int(units or 0),
                    "/api/drilldowns/orders/paid?period=today&channel=meli",
                    f"top_meli_unistore_{today_iso}.csv",
                ))
        except Exception as e:
            log.debug("story sku MELI unistore fail: %s", e)

    # 2c) Lider TN Unidrop (si existe la tabla — try/except absorbe el error)
    try:
        rows = q(drop, """
            SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus"='paid' AND o."createdAt"::date = CURRENT_DATE
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku ORDER BY SUM(oi.quantity * oi.price) DESC LIMIT 1
        """) or []
        if rows:
            sku, name, units = rows[0]
            blurbs.append(_leader_blurb(
                "TN Unidrop", "tn_unidrop", sku, name, int(units or 0),
                "/api/drilldowns/orders/paid?period=today&unit=unidrop",
                f"top_tn_unidrop_{today_iso}.csv",
            ))
    except Exception as e:
        log.warning("story sku TN unidrop fail (probable: schema no existe): %s", e)

    # 2d) Lider MELI Unidrop - solo si la tabla existe en este schema
    if table_exists(drop, "meli", "meli_order_items"):
        try:
            rows = q(drop, """
            SELECT mi.seller_sku AS sku, MAX(mi.title) AS name, SUM(mi.quantity)::int AS units
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mo.date_created::date = CURRENT_DATE
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              AND mi.seller_sku IS NOT NULL
            GROUP BY mi.seller_sku ORDER BY SUM(mi.unit_price * mi.quantity) DESC LIMIT 1
            """) or []
            if rows:
                sku, name, units = rows[0]
                blurbs.append(_leader_blurb(
                    "MELI Unidrop", "meli_unidrop", sku, name, int(units or 0),
                    "/api/drilldowns/orders/paid?period=today&unit=unidrop&channel=meli",
                    f"top_meli_unidrop_{today_iso}.csv",
                ))
        except Exception as e:
            log.debug("story sku MELI unidrop fail: %s", e)

    # ============================================================
    # 3) Provincia con mas actividad hoy
    # ============================================================
    try:
        prov = q(uni, """
            SELECT COALESCE(NULLIF(TRIM(c."billingProvince"),''),
                            NULLIF(TRIM(osa.province),''),'(sin provincia)') AS prov,
                   COUNT(DISTINCT o.id)::int AS orders,
                   SUM(o.total)::float AS revenue
            FROM tienda_nube."Order" o
            LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
            LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
            WHERE o."paymentStatus" = 'paid' AND o."createdAt"::date = CURRENT_DATE
            GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 1
        """) or []
        if prov:
            p_name, p_orders, p_rev = prov[0][0], int(prov[0][1] or 0), float(prov[0][2] or 0)
            if p_orders > 0 and p_name != "(sin provincia)":
                blurbs.append({
                    "type": "top_province",
                    "icon": "📍",
                    "title": "Geografia del dia",
                    "body": f"{p_name} es la provincia mas activa hoy con {p_orders} ordenes y {_fmt_money(p_rev)} en revenue.",
                    "accent": "#06b6d4",
                    "link": {
                        "kind": "drill",
                        "endpoint": f"/api/drilldowns/provinces/{quote(p_name, safe='')}/orders?period=today",
                        "title": f"Ordenes hoy en {p_name}",
                        "filename": f"ordenes_{p_name.replace(' ', '_')}_{today_iso}.csv",
                    },
                })
    except Exception as e:
        log.warning("story province fail: %s", e)

    # ============================================================
    # 4) Cliente top del dia
    # ============================================================
    try:
        top_cust = q(uni, """
            SELECT c.id, COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
                   SUM(o.total)::float AS revenue,
                   COUNT(*)::int AS orders
            FROM tienda_nube."Order" o
            JOIN tienda_nube."Customer" c ON c.id = o."customerId"
            WHERE o."paymentStatus"='paid' AND o."createdAt"::date = CURRENT_DATE
            GROUP BY c.id, c.name, c.email
            ORDER BY revenue DESC LIMIT 1
        """) or []
        if top_cust:
            cid = int(top_cust[0][0] or 0)
            cn = top_cust[0][1]
            crev = float(top_cust[0][2] or 0)
            corders = int(top_cust[0][3] or 0)
            blurbs.append({
                "type": "top_customer",
                "icon": "🌟",
                "title": "Cliente del dia",
                "body": f"{cn} es el ticket mas alto de hoy con {_fmt_money(crev)} en {corders} {'orden' if corders == 1 else 'ordenes'}.",
                "accent": "#f59e0b",
                "link": {
                    "kind": "drill",
                    "endpoint": f"/api/drilldowns/customers/{cid}/orders?period=today",
                    "title": f"Ordenes hoy de {cn}",
                    "filename": f"ordenes_cliente_{cid}_{today_iso}.csv",
                } if cid else None,
            })
    except Exception as e:
        log.warning("story customer fail: %s", e)

    # ============================================================
    # 5) Suscripciones / churn Unidrop hoy
    # ============================================================
    try:
        new_users = int(scalar(drop, """
            SELECT COUNT(*) FROM public."User" WHERE "createdAt"::date = CURRENT_DATE
        """) or 0)
        churn = int(scalar(drop, """
            SELECT COUNT(*) FROM public."User"
            WHERE end_date_subscription::date = CURRENT_DATE
        """) or 0)
        if new_users > 0 or churn > 0:
            parts = []
            if new_users: parts.append(f"{new_users} {'nuevo usuario' if new_users == 1 else 'nuevos usuarios'}")
            if churn: parts.append(f"{churn} {'suscripcion vencida' if churn == 1 else 'suscripciones vencidas'}")
            # Linkear al drill que mas peso tenga (nuevos usuarios o churn)
            if new_users >= churn:
                link = {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/saas/users-new?period=today",
                    "title": "Nuevos usuarios hoy (Unidrop)",
                    "filename": "nuevos_today.csv",
                }
            else:
                link = {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/saas/users-churned?period=today",
                    "title": "Churn hoy (Unidrop)",
                    "filename": "churn_today.csv",
                }
            blurbs.append({
                "type": "saas_pulse",
                "icon": "📈",
                "title": "SaaS hoy",
                "body": f"En Unidrop: {' y '.join(parts)} en el dia.",
                "accent": "#10b981",
                "link": link,
            })
    except Exception as e:
        log.warning("story saas fail: %s", e)

    # ============================================================
    # 6) Pagos Talo del dia + comparativa
    # ============================================================
    try:
        talo_today = float(scalar(drop, """
            SELECT COALESCE(SUM(amount),0) FROM public."PaymentTransaction"
            WHERE "createdAt"::date = CURRENT_DATE
              AND status::text IN ('completed','succeeded','approved','paid','PROCESSED')
        """) or 0)
        talo_yest = float(scalar(drop, """
            SELECT COALESCE(SUM(amount),0) FROM public."PaymentTransaction"
            WHERE "createdAt"::date = CURRENT_DATE - 1
              AND status::text IN ('completed','succeeded','approved','paid','PROCESSED')
        """) or 0)
        if talo_today > 0:
            delta = _delta_phrase(talo_today, talo_yest)
            body = f"Talo proceso {_fmt_money(talo_today)} en pagos hoy"
            body += f", {delta}." if delta else "."
            blurbs.append({
                "type": "talo_pulse",
                "icon": "💳",
                "title": "Pagos Talo",
                "body": body,
                "accent": "#3b82f6",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/talo/transactions?period=today&status=paid",
                    "title": "Pagos Talo cobrados hoy",
                    "filename": "talo_today.csv",
                },
            })
    except Exception as e:
        log.warning("story talo fail: %s", e)

    # ============================================================
    # 7) Devoluciones (Unidev) - solo si hay
    # ============================================================
    try:
        eng_dev = get_engine("unidev")
        dev_today = int(scalar(eng_dev, """
            SELECT COUNT(*) FROM public.devoluciones
            WHERE fecha_creacion::date = CURRENT_DATE
        """) or 0)
        if dev_today > 0:
            blurbs.append({
                "type": "returns",
                "icon": "↩️",
                "title": "Devoluciones hoy",
                "body": f"Se {'abrio' if dev_today == 1 else 'abrieron'} {dev_today} {'caso' if dev_today == 1 else 'casos'} de devolucion en Unidev.",
                "accent": "#ec4899",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/devoluciones/list?period=today",
                    "title": "Devoluciones abiertas hoy",
                    "filename": "devoluciones_today.csv",
                },
            })
    except Exception as e:
        log.warning("story dev fail: %s", e)

    # ============================================================
    # 8) Stock critico Unistore (digip) - SKUs con stock < 5 unidades
    # ============================================================
    try:
        low_stock = int(scalar(uni, """
            SELECT COUNT(*)::int FROM (
              SELECT sd."articuloCodigo"
              FROM digip."StockDetalle" sd
              GROUP BY sd."articuloCodigo"
              HAVING SUM(sd.unidades) > 0 AND SUM(sd.unidades) <= 5
            ) x
        """) or 0)
        if low_stock > 0:
            blurbs.append({
                "type": "stock_alert",
                "icon": "⚠️",
                "title": "Stock critico Unistore",
                "body": f"Hay {low_stock} {'SKU' if low_stock == 1 else 'SKUs'} con stock bajo (1-5 unidades) en deposito Digip. Revisa reposicion.",
                "accent": "#dc2626",
                "link": {
                    "kind": "navigate",
                    "href": "/dashboard/stock-heatmap",
                },
            })
    except Exception as e:
        log.warning("story stock fail: %s", e)

    # ============================================================
    # 9) Logistica - ordenes pagas y sin despacho hace mas de 5 dias
    # ============================================================
    try:
        stuck = int(scalar(uni, """
            SELECT COUNT(*)::int
            FROM tienda_nube."Order" o
            WHERE o."paymentStatus" = 'paid'
              AND o.status NOT IN ('cancelled','closed')
              AND o."createdAt" < NOW() - INTERVAL '5 days'
              AND NOT EXISTS (
                SELECT 1 FROM digip."DespachoPedido" dp
                JOIN digip."Pedido" pd ON pd."Codigo" = dp."pedidoCodigo"
                WHERE pd."orderId" = o.id
              )
        """) or 0)
        if stuck > 0:
            blurbs.append({
                "type": "stuck_orders",
                "icon": "🚚",
                "title": "Logistica - ordenes atascadas",
                "body": f"{stuck} {'orden paga' if stuck == 1 else 'ordenes pagas'} sin despacho hace +5 dias. Revisa preparacion en Digip.",
                "accent": "#f97316",
                "link": {
                    "kind": "navigate",
                    "href": "/dashboard/logistica",
                },
            })
    except Exception as e:
        log.warning("story stuck fail: %s", e)

    # ============================================================
    # 10) Facturacion Contabilium del dia (Unistore + Unidrop)
    # ============================================================
    try:
        fact_unistore = float(scalar(uni, """
            SELECT COALESCE(SUM("Total"),0)::float
            FROM contabilium."SalesOrder"
            WHERE "FechaEmision"::date = CURRENT_DATE
        """) or 0)
        fact_unidrop = float(scalar(drop, """
            SELECT COALESCE(SUM(total),0)::float
            FROM contabillium_dev."ContabilliumInvoice"
            WHERE "fechaEmision"::date = CURRENT_DATE
        """) or 0)
        fact_total = fact_unistore + fact_unidrop
        if fact_total > 0:
            parts = []
            if fact_unistore > 0: parts.append(f"Unistore {_fmt_money(fact_unistore)}")
            if fact_unidrop > 0: parts.append(f"Unidrop {_fmt_money(fact_unidrop)}")
            blurbs.append({
                "type": "finanzas_pulse",
                "icon": "🧾",
                "title": "Facturacion hoy",
                "body": f"Contabilium emitio {_fmt_money(fact_total)} en facturas hoy ({' · '.join(parts)}).",
                "accent": "#16a34a",
                "link": {
                    "kind": "navigate",
                    "href": "/dashboard/finanzas",
                },
            })
    except Exception as e:
        log.warning("story finanzas fail: %s", e)

    # ============================================================
    # 11) Dropshippers Unidrop activos hoy (con orden paga TN o MELI)
    # ============================================================
    try:
        active_drops = int(scalar(drop, """
            SELECT COUNT(DISTINCT u.id)::int
            FROM public."User" u
            WHERE EXISTS (
              SELECT 1 FROM public.tienda_nube_orders o
              WHERE o.user_id = u.id
                AND o.created_at::date = CURRENT_DATE
                AND o.payment_status = 'paid'
            ) OR EXISTS (
              SELECT 1 FROM mercado_libre_dev."OrderMercadoLibre" mo
              JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
                ON mla."mlUserId"::text = mo."sellerId"::text
              WHERE mla."userId" = u.id
                AND mo."dateCreated"::date = CURRENT_DATE
                AND mo.status IN ('paid','confirmed','shipped','delivered')
            )
        """) or 0)
        if active_drops > 0:
            blurbs.append({
                "type": "drops_active",
                "icon": "🛒",
                "title": "Dropshippers activos",
                "body": f"{active_drops} {'dropshipper vendio' if active_drops == 1 else 'dropshippers vendieron'} hoy en TN o MELI Unidrop.",
                "accent": "#8b5cf6",
                "link": {
                    "kind": "navigate",
                    "href": "/dashboard/dropshippers",
                },
            })
    except Exception as e:
        log.warning("story drops active fail: %s", e)

    # Si no hay nada (raro), placeholder
    if not blurbs:
        blurbs.append({
            "type": "placeholder",
            "icon": "🌱",
            "title": "Dia tranquilo",
            "body": "Aun no hay actividad significativa en el dia. Revisa nuevamente mas tarde.",
            "accent": "#9ca3af",
        })

    return {
        "today_date": today_iso,
        "blurbs": blurbs,
        "generated_at": now_ar().isoformat(),
    }
