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
import logging
from urllib.parse import quote

from app.db.engines import get_engine
from app.services._utils import q, scalar

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

    today_date = dt.date.today()
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
                "type": "gmv",
                "icon": "💰",
                "title": "Pulso del dia",
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
    # 2) SKU lider TN hoy vs SKU lider ML hoy (cross-canal narrativa)
    # ============================================================
    try:
        tn_top = q(uni, """
            SELECT oi.sku, MAX(oi.name) AS name, SUM(oi.quantity)::int AS units,
                   SUM(oi.quantity * oi.price)::float AS revenue
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus"='paid' AND o."createdAt"::date = CURRENT_DATE
              AND oi.sku IS NOT NULL
            GROUP BY oi.sku ORDER BY revenue DESC LIMIT 1
        """) or []
        ml_top = q(uni, """
            SELECT mi.seller_sku AS sku, MAX(mi.title) AS name, SUM(mi.quantity)::int AS units,
                   SUM(mi.unit_price * mi.quantity)::float AS revenue
            FROM meli.meli_order_items mi
            JOIN meli.meli_orders mo ON mo.id = mi.order_id
            WHERE mo.date_created::date = CURRENT_DATE
              AND mo.status IN ('paid','confirmed','shipped','delivered')
              AND mi.seller_sku IS NOT NULL
            GROUP BY mi.seller_sku ORDER BY revenue DESC LIMIT 1
        """) or []

        if tn_top and ml_top:
            tn_sku = tn_top[0][0]
            ml_sku = ml_top[0][0]
            tn_n, tn_u = (tn_top[0][1] or tn_sku)[:50], int(tn_top[0][2] or 0)
            ml_n, ml_u = (ml_top[0][1] or ml_sku)[:50], int(ml_top[0][2] or 0)
            if tn_sku == ml_sku:
                body = f"El SKU {tn_sku} ({tn_n}) lidera HOY en ambos canales — {tn_u} ud en Tienda Nube y {ml_u} ud en Mercado Libre."
            else:
                body = f"En Tienda Nube manda \"{tn_n}\" ({tn_u} ud), mientras que en Mercado Libre el lider es \"{ml_n}\" ({ml_u} ud)."
            blurbs.append({
                "type": "top_sku_split",
                "icon": "👑",
                "title": "Lideres por canal",
                "body": body,
                "accent": "#a259ff",
                "link": {
                    "kind": "navigate",
                    "href": f"/dashboard/productos/{quote(tn_sku, safe='')}",
                },
            })
        elif tn_top:
            tn_sku = tn_top[0][0]
            tn_n = (tn_top[0][1] or tn_sku)[:50]
            blurbs.append({
                "type": "top_sku_tn",
                "icon": "👑",
                "title": "Lider TN",
                "body": f"En Tienda Nube hoy lidera \"{tn_n}\" con {int(tn_top[0][2] or 0)} unidades vendidas.",
                "accent": "#a259ff",
                "link": {
                    "kind": "navigate",
                    "href": f"/dashboard/productos/{quote(tn_sku, safe='')}",
                },
            })
    except Exception as e:
        log.warning("story sku fail: %s", e)

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
                        "kind": "navigate",
                        "href": "/dashboard/mapa",
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
                    "kind": "navigate",
                    "href": f"/dashboard/customer/{cid}",
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
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
