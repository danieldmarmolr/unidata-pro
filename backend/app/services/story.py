"""
Storytelling automatico - narrativa del dia basada en datos reales.
Genera blurbs cortos cross-unidad para el home.

Comparacion apples-to-apples: cada blurb compara "hoy hasta ahora" vs
"ayer a esta misma hora" (ej: si son las 15:43, compara 0:00-15:43 de hoy
contra 0:00-15:43 de ayer).

Cada blurb incluye un `link` con `kind: "drill"` para que el frontend
abra un popup con la data que respalda el numero contado.
"""
from __future__ import annotations

import datetime as dt
from urllib.parse import quote
import logging

from app.utils.tz import today_ar, now_ar
from app.db.engines import get_engine
from app.services._utils import q, scalar, table_exists

log = logging.getLogger("unidata.story")


def _fmt_money(v: float) -> str:
    return f"$ {v:,.0f}".replace(",", ".")


def _fmt_int(v: int) -> str:
    return f"{v:,}".replace(",", ".")


def _delta_phrase(now: float, prev: float) -> str:
    if not prev:
        return ""
    pct = (now - prev) / prev * 100
    sign = "+" if pct >= 0 else ""
    direction = "arriba" if pct >= 0 else "abajo"
    return f"{sign}{pct:.0f}% {direction} vs ayer a esta hora"


# ── Helpers de ventana temporal ──────────────────────────────────────────────
# "Hoy hasta ahora": desde medianoche local hasta NOW()
# "Ayer misma hora": mismo intervalo corrido 24h hacia atras

def _tw(col: str) -> str:
    """Fragmento WHERE para hoy hasta NOW() sobre la columna dada."""
    return f"{col} >= CURRENT_DATE::timestamp AND {col} <= NOW()"


def _yw(col: str) -> str:
    """Fragmento WHERE para ayer hasta la misma hora de NOW()."""
    return f"{col} >= (CURRENT_DATE - 1)::timestamp AND {col} <= NOW() - INTERVAL '1 day'"


def today_story() -> dict:
    blurbs: list[dict] = []
    uni  = get_engine("unistore")
    drop = get_engine("unidrop")

    today_date = today_ar()
    today_iso  = today_date.isoformat()

    # ── 1) GMV Unistore ───────────────────────────────────────────────────────
    try:
        gmv_today = float(scalar(uni, f"""
            SELECT COALESCE((SELECT SUM(total) FROM tienda_nube."Order"
                             WHERE {_tw('"createdAt"')} AND "paymentStatus"='paid'), 0)
                 + COALESCE((SELECT SUM(total_amount) FROM meli.meli_orders
                             WHERE {_tw('date_created')}
                               AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        gmv_yest = float(scalar(uni, f"""
            SELECT COALESCE((SELECT SUM(total) FROM tienda_nube."Order"
                             WHERE {_yw('"createdAt"')} AND "paymentStatus"='paid'), 0)
                 + COALESCE((SELECT SUM(total_amount) FROM meli.meli_orders
                             WHERE {_yw('date_created')}
                               AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        if gmv_today > 0:
            delta = _delta_phrase(gmv_today, gmv_yest)
            body  = f"Unistore lleva {_fmt_money(gmv_today)} en GMV hoy"
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
                    "title": "Ordenes pagas de hoy · Unistore",
                    "filename": "orders_paid_today.csv",
                },
            })
    except Exception as e:
        log.warning("story gmv fail: %s", e)

    # ── 1b) GMV Unidrop ───────────────────────────────────────────────────────
    try:
        drop_today = float(scalar(drop, f"""
            SELECT
              COALESCE((SELECT SUM(total) FROM public.tienda_nube_orders
                        WHERE {_tw('created_at')} AND payment_status = 'paid'), 0)
            + COALESCE((SELECT SUM("totalAmount") FROM mercado_libre_dev."OrderMercadoLibre"
                        WHERE {_tw('"dateCreated"')}
                          AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        drop_yest = float(scalar(drop, f"""
            SELECT
              COALESCE((SELECT SUM(total) FROM public.tienda_nube_orders
                        WHERE {_yw('created_at')} AND payment_status = 'paid'), 0)
            + COALESCE((SELECT SUM("totalAmount") FROM mercado_libre_dev."OrderMercadoLibre"
                        WHERE {_yw('"dateCreated"')}
                          AND status IN ('paid','confirmed','shipped','delivered')), 0)
        """) or 0)
        if drop_today > 0:
            delta = _delta_phrase(drop_today, drop_yest)
            body  = f"Unidrop lleva {_fmt_money(drop_today)} en ventas dropshippers hoy"
            body += f", {delta}." if delta else "."
            blurbs.append({
                "type": "gmv_unidrop",
                "icon": "📦",
                "title": "Pulso Unidrop",
                "body": body,
                "accent": "#0ea5e9",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/unidrop/orders-combined?period=today",
                    "title": "Ordenes TN+ML pagas de hoy · Unidrop",
                    "filename": "unidrop_orders_today.csv",
                },
            })
    except Exception as e:
        log.warning("story gmv unidrop fail: %s", e)

    # ── 2) SKU lider por canal ────────────────────────────────────────────────
    def _leader_blurb(label: str, channel: str, sku: str, name: str, units: int,
                      drill_endpoint: str, drill_filename: str) -> dict:
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
                "title": f"Ordenes de hoy · {label}",
                "filename": drill_filename,
            },
        }

    # 2a) Lider TN Unistore
    try:
        rows = q(uni, f"""
            SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units,
                   MAX(oi."productId") AS product_id
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus"='paid' AND {_tw('o."createdAt"')}
              AND oi.sku IS NOT NULL AND oi.sku NOT ILIKE '%PVA%'
            GROUP BY oi.sku ORDER BY SUM(oi.quantity * oi.price) DESC LIMIT 1
        """) or []
        if rows:
            sku, name, units, pid = rows[0]
            ep = (f"/api/drilldowns/products/{int(pid)}/orders?period=today"
                  if pid else "/api/drilldowns/orders/paid?period=today")
            blurbs.append(_leader_blurb(
                "TN Unistore", "tn_unistore", sku, name, int(units or 0),
                ep, f"top_tn_unistore_{today_iso}.csv",
            ))
    except Exception as e:
        log.warning("story sku TN unistore fail: %s", e)

    # 2b) Lider MELI Unistore
    if table_exists(uni, "meli", "meli_order_items"):
        try:
            rows = q(uni, f"""
                SELECT mi.seller_sku AS sku, MAX(mi.title) AS name, SUM(mi.quantity)::int AS units
                FROM meli.meli_order_items mi
                JOIN meli.meli_orders mo ON mo.id = mi.order_id
                WHERE {_tw('mo.date_created')}
                  AND mo.status IN ('paid','confirmed','shipped','delivered')
                  AND mi.seller_sku IS NOT NULL AND mi.seller_sku NOT ILIKE '%PVA%'
                GROUP BY mi.seller_sku ORDER BY SUM(mi.unit_price * mi.quantity) DESC LIMIT 1
            """) or []
            if rows:
                sku, name, units = rows[0]
                blurbs.append(_leader_blurb(
                    "MELI Unistore", "meli_unistore", sku, name, int(units or 0),
                    "/api/drilldowns/orders/paid?period=today",
                    f"top_meli_unistore_{today_iso}.csv",
                ))
        except Exception as e:
            log.debug("story sku MELI unistore fail: %s", e)

    # 2c) Lider TN Unidrop
    try:
        rows = q(drop, f"""
            SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus"='paid' AND {_tw('o."createdAt"')}
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku ORDER BY SUM(oi.quantity * oi.price) DESC LIMIT 1
        """) or []
        if rows:
            sku, name, units = rows[0]
            blurbs.append(_leader_blurb(
                "TN Unidrop", "tn_unidrop", sku, name, int(units or 0),
                "/api/drilldowns/unidrop/orders-tn?period=today",
                f"top_tn_unidrop_{today_iso}.csv",
            ))
    except Exception as e:
        log.warning("story sku TN unidrop fail: %s", e)

    # 2d) Lider MELI Unidrop
    if table_exists(drop, "meli", "meli_order_items"):
        try:
            rows = q(drop, f"""
                SELECT mi.seller_sku AS sku, MAX(mi.title) AS name, SUM(mi.quantity)::int AS units
                FROM meli.meli_order_items mi
                JOIN meli.meli_orders mo ON mo.id = mi.order_id
                WHERE {_tw('mo.date_created')}
                  AND mo.status IN ('paid','confirmed','shipped','delivered')
                  AND mi.seller_sku IS NOT NULL
                GROUP BY mi.seller_sku ORDER BY SUM(mi.unit_price * mi.quantity) DESC LIMIT 1
            """) or []
            if rows:
                sku, name, units = rows[0]
                blurbs.append(_leader_blurb(
                    "MELI Unidrop", "meli_unidrop", sku, name, int(units or 0),
                    "/api/drilldowns/unidrop/orders-ml?period=today",
                    f"top_meli_unidrop_{today_iso}.csv",
                ))
        except Exception as e:
            log.debug("story sku MELI unidrop fail: %s", e)

    # ── 3) Provincia con mas actividad ───────────────────────────────────────
    try:
        prov = q(uni, f"""
            SELECT COALESCE(NULLIF(TRIM(c."billingProvince"),''),
                            NULLIF(TRIM(osa.province),''),'(sin provincia)') AS prov,
                   COUNT(DISTINCT o.id)::int AS orders,
                   SUM(o.total)::float AS revenue
            FROM tienda_nube."Order" o
            LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
            LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
            WHERE o."paymentStatus" = 'paid' AND {_tw('o."createdAt"')}
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

    # ── 4) Cliente top del dia ────────────────────────────────────────────────
    try:
        top_cust = q(uni, f"""
            SELECT c.id, COALESCE(c.name, c.email, 'Customer ' || c.id::text) AS nombre,
                   SUM(o.total)::float AS revenue, COUNT(*)::int AS orders
            FROM tienda_nube."Order" o
            JOIN tienda_nube."Customer" c ON c.id = o."customerId"
            WHERE o."paymentStatus"='paid' AND {_tw('o."createdAt"')}
            GROUP BY c.id, c.name, c.email ORDER BY revenue DESC LIMIT 1
        """) or []
        if top_cust:
            cid     = int(top_cust[0][0] or 0)
            cn      = top_cust[0][1]
            crev    = float(top_cust[0][2] or 0)
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

    # ── 5) Nuevos dropshippers suscritos + revenue suscripciones hoy ─────────
    try:
        new_subs = int(scalar(drop, """
            SELECT COUNT(*) FROM public."User"
            WHERE start_date_subscription::date = CURRENT_DATE
        """) or 0)
        subs_rev_today = float(scalar(drop, f"""
            SELECT COALESCE(SUM(amount), 0) FROM public."PaymentTransactionSubscription"
            WHERE {_tw('"createdAt"')}
        """) or 0)
        subs_rev_yest = float(scalar(drop, f"""
            SELECT COALESCE(SUM(amount), 0) FROM public."PaymentTransactionSubscription"
            WHERE {_yw('"createdAt"')}
        """) or 0)
        if new_subs > 0 or subs_rev_today > 0:
            parts = []
            if new_subs:
                parts.append(f"{new_subs} {'nuevo suscriptor' if new_subs == 1 else 'nuevos suscriptores'}")
            if subs_rev_today > 0:
                delta = _delta_phrase(subs_rev_today, subs_rev_yest)
                rev_str = f"{_fmt_money(subs_rev_today)} cobrados en suscripciones"
                if delta: rev_str += f" ({delta})"
                parts.append(rev_str)
            blurbs.append({
                "type": "subs_pulse",
                "icon": "💎",
                "title": "SaaS · Suscripciones",
                "body": f"Unidrop: {' · '.join(parts)} hoy.",
                "accent": "#10b981",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/saas/users-new?period=today",
                    "title": "Nuevos suscriptores hoy · Unidrop",
                    "filename": "nuevos_suscriptores_today.csv",
                },
            })
    except Exception as e:
        log.warning("story subs fail: %s", e)

    # ── 6) SaaS churn hoy ────────────────────────────────────────────────────
    try:
        churn = int(scalar(drop, """
            SELECT COUNT(*) FROM public."User"
            WHERE end_date_subscription::date = CURRENT_DATE
        """) or 0)
        if churn > 0:
            blurbs.append({
                "type": "saas_churn",
                "icon": "📉",
                "title": "SaaS · Vencimientos",
                "body": f"{churn} {'suscripcion vence' if churn == 1 else 'suscripciones vencen'} hoy en Unidrop.",
                "accent": "#ef4444",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/saas/users-churned?period=today",
                    "title": "Suscripciones vencidas hoy",
                    "filename": "churn_today.csv",
                },
            })
    except Exception as e:
        log.warning("story churn fail: %s", e)

    # ── 7) Pagos Talo del dia ─────────────────────────────────────────────────
    try:
        talo_today = float(scalar(drop, f"""
            SELECT COALESCE(SUM(amount),0) FROM public."PaymentTransaction"
            WHERE {_tw('"createdAt"')}
              AND status::text IN ('completed','succeeded','approved','paid','PROCESSED')
        """) or 0)
        talo_yest = float(scalar(drop, f"""
            SELECT COALESCE(SUM(amount),0) FROM public."PaymentTransaction"
            WHERE {_yw('"createdAt"')}
              AND status::text IN ('completed','succeeded','approved','paid','PROCESSED')
        """) or 0)
        if talo_today > 0:
            delta = _delta_phrase(talo_today, talo_yest)
            body  = f"Talo proceso {_fmt_money(talo_today)} en pagos hoy"
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

    # ── 8) Devoluciones Unidev ────────────────────────────────────────────────
    try:
        eng_dev = get_engine("unidev")
        dev_today = int(scalar(eng_dev, f"""
            SELECT COUNT(*) FROM public.devoluciones
            WHERE {_tw('fecha_creacion')}
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

    # ── 9) Stock critico Unistore ─────────────────────────────────────────────
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
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/products/stock-critico",
                    "title": "SKUs con stock critico · Unistore",
                    "filename": "stock_critico.csv",
                },
            })
    except Exception as e:
        log.warning("story stock fail: %s", e)

    # ── 10) Ordenes atascadas ─────────────────────────────────────────────────
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
                "title": "Logistica · ordenes atascadas",
                "body": f"{stuck} {'orden paga' if stuck == 1 else 'ordenes pagas'} sin despacho hace +5 dias. Revisa preparacion en Digip.",
                "accent": "#f97316",
                "link": {
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/orders/stuck",
                    "title": "Ordenes pagas sin despacho (+5 dias)",
                    "filename": "ordenes_atascadas.csv",
                },
            })
    except Exception as e:
        log.warning("story stuck fail: %s", e)

    # ── 11) Facturacion Contabilium ───────────────────────────────────────────
    try:
        fact_unistore = float(scalar(uni, f"""
            SELECT COALESCE(SUM("Total"),0)::float FROM contabilium."SalesOrder"
            WHERE {_tw('"FechaEmision"')}
        """) or 0)
        fact_unidrop = float(scalar(drop, f"""
            SELECT COALESCE(SUM(total),0)::float FROM contabillium_dev."ContabilliumInvoice"
            WHERE {_tw('"fechaEmision"')}
        """) or 0)
        fact_total = fact_unistore + fact_unidrop
        if fact_total > 0:
            parts = []
            if fact_unistore > 0: parts.append(f"Unistore {_fmt_money(fact_unistore)}")
            if fact_unidrop > 0:  parts.append(f"Unidrop {_fmt_money(fact_unidrop)}")
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

    # ── 12) Dropshippers activos hoy ─────────────────────────────────────────
    try:
        active_drops = int(scalar(drop, f"""
            SELECT COUNT(DISTINCT u.id)::int
            FROM public."User" u
            WHERE EXISTS (
              SELECT 1 FROM public.tienda_nube_orders o
              WHERE o.user_id = u.id AND {_tw('o.created_at')}
                AND o.payment_status = 'paid'
            ) OR EXISTS (
              SELECT 1 FROM mercado_libre_dev."OrderMercadoLibre" mo
              JOIN mercado_libre_dev."MercadoLibreUserAccount" mla
                ON mla."mlUserId"::text = mo."sellerId"::text
              WHERE mla."userId" = u.id AND {_tw('mo."dateCreated"')}
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
                    "kind": "drill",
                    "endpoint": "/api/drilldowns/unidrop/dropshippers-active-today",
                    "title": "Dropshippers con ventas hoy",
                    "filename": "dropshippers_activos_hoy.csv",
                },
            })
    except Exception as e:
        log.warning("story drops active fail: %s", e)

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
