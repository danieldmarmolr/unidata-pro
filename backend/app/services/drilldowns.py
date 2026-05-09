"""
Drill-downs - resuelven detalle al hacer click sobre tablas/charts.
Cada funcion devuelve un set de filas listo para mostrar como tabla.
"""
from __future__ import annotations

from app.db.engines import get_engine
from app.services._utils import q, col_or_null
from app.services._utils import resolve_window

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def _shipping_method_expr(eng) -> str:
    """Detecta dinamicamente la columna que mejor represente el metodo de envio
    en TN. Devuelve un fragmento SQL que se puede usar directamente como columna
    derivada llamada `metodo_envio`. Soporta:
        - Order.shippingOption (string descriptivo TN, ej "Envio Nube - Correo Argentino Clasico")
        - Order.shippingPickupType (pickup vs ship)
        - Fulfillment.trackingCompany (carrier real)
    Si nada existe devuelve NULL::text.
    """
    parts = []
    o = col_or_null(eng, "tienda_nube", "Order", "o", [
        "shippingOption", "shipping_option",
        "shippingMethod", "shipping_method",
        "shippingPickupType", "shipping_pickup_type",
    ])
    if o != "NULL::text":
        parts.append(o)
    f = col_or_null(eng, "tienda_nube", "Fulfillment", "f", [
        "trackingCompany", "tracking_company", "carrierName", "carrier",
    ])
    if f != "NULL::text":
        parts.append(f)
    if not parts:
        return "NULL::text AS metodo_envio"
    # COALESCE primero el carrier real (Fulfillment), luego el option de Order
    expr = "COALESCE(" + ", ".join(reversed(parts)) + ")"
    return f"NULLIF(TRIM({expr}::text), '') AS metodo_envio"


def _classify_channel_sql(method_alias: str = "metodo_envio") -> str:
    """Devuelve un CASE SQL que clasifica el metodo en canales discretos:
    OCA / Correo Argentino / Unifast / Retiro presencial / Personalizado / Otro.
    Recibe el alias de la columna ya calculada."""
    return f"""
        CASE
          WHEN {method_alias} ILIKE '%oca%'                                 THEN 'OCA'
          WHEN {method_alias} ILIKE '%correo argentino%'
            OR {method_alias} ILIKE '%correo nube%'
            OR {method_alias} ILIKE '%envio nube%'                          THEN 'Correo Argentino'
          WHEN {method_alias} ILIKE '%unifast%'                             THEN 'Unifast'
          WHEN {method_alias} ILIKE '%retiro%'
            OR {method_alias} ILIKE '%pickup%'
            OR {method_alias} ILIKE '%microcentro%'
            OR {method_alias} ILIKE '%sucursal unistore%'                   THEN 'Retiro presencial'
          WHEN {method_alias} ILIKE '%moto%'                                THEN 'Moto / Cadeteria'
          WHEN {method_alias} ILIKE '%andreani%'                            THEN 'Andreani'
          WHEN {method_alias} ILIKE '%personalizado%'
            OR {method_alias} ILIKE '%a convenir%'                          THEN 'Personalizado'
          WHEN {method_alias} IS NULL OR {method_alias} = ''                THEN '(sin metodo)'
          ELSE 'Otro'
        END
    """


def _serialize(rows: list, columns: list[str]) -> dict:
    return {
        "columns": columns,
        "rows": [list(r) for r in (rows or [])],
        "row_count": len(rows or []),
    }


def orders_by_product(unit: str, product_id: str, period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Listado de orders TN que contienen un producto especifico."""
    if unit != "unistore":
        return _serialize([], [])
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine(unit)
    rows = q(eng, """
        SELECT o.id, o.number, o."createdAt"::text AS fecha,
               o."paymentStatus", o."shippingStatus",
               o.total::float, oi.quantity, oi.price::float,
               (oi.quantity * oi.price)::float AS subtotal,
               COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)') AS provincia
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE oi."productId"::text = :pid
          AND o."createdAt" >= NOW() - make_interval(days => :days)
        ORDER BY o."createdAt" DESC
        LIMIT 200
    """, {"pid": str(product_id), "days": days}) or []
    return _serialize(
        rows,
        ["order_id", "numero", "fecha", "payment", "shipping", "total", "qty", "precio_unit", "subtotal", "provincia"],
    )


def orders_by_province(unit: str, province: str, period: str = "30d") -> dict:
    """Listado de orders TN paid en una provincia."""
    if unit != "unistore":
        return _serialize([], [])
    days = resolve_window(period, from_iso, to_iso)["days"]
    eng = get_engine(unit)
    rows = q(eng, """
        SELECT o.id, o.number, o."createdAt"::text AS fecha,
               o."paymentStatus", o."shippingStatus",
               o.total::float,
               COALESCE(NULLIF(TRIM(osa.city),''),'(sin ciudad)') AS ciudad,
               COALESCE(o."contactName",'') AS cliente,
               COALESCE(osa.address,'') AS direccion,
               o."customerId" AS customer_id
        FROM tienda_nube."Order" o
        JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        WHERE COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)') = :prov
          AND o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - make_interval(days => :days)
        ORDER BY o."createdAt" DESC
        LIMIT 200
    """, {"prov": province, "days": days}) or []
    return _serialize(
        rows,
        ["order_id", "numero", "fecha", "payment", "shipping", "total", "ciudad", "cliente", "direccion", "customer_id"],
    )


def orders_by_customer_unistore(customer_id: int) -> dict:
    """Historial de orders de un customer."""
    eng = get_engine("unistore")
    method_expr = _shipping_method_expr(eng)
    canal_sql = _classify_channel_sql("m.metodo_envio")
    rows = q(eng, f"""
        WITH base AS (
          SELECT o.id, o.number, o."createdAt"::text AS fecha,
                 o."paymentStatus", o."shippingStatus", o.total::float,
                 COALESCE(NULLIF(TRIM(osa.province),''),'-') AS provincia,
                 {method_expr}
          FROM tienda_nube."Order" o
          LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
          LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
          WHERE o."customerId" = :cid
        )
        SELECT m.id, m.number, m.fecha, m."paymentStatus", m."shippingStatus",
               m.total, m.provincia,
               m.metodo_envio,
               {canal_sql} AS canal
        FROM base m
        ORDER BY m.fecha DESC
        LIMIT 200
    """, {"cid": int(customer_id)}) or []
    return _serialize(
        rows,
        ["order_id", "numero", "fecha", "payment", "shipping", "total", "provincia", "metodo_envio", "canal"],
    )


def transactions_by_account(account_id: int) -> dict:
    """Historial de PaymentTransaction de un customerAccountId Unidrop."""
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT pt.id, pt."taloTransactionId" AS talo_id,
               pt."createdAt"::text AS fecha,
               pt.amount::float, pt.commission::float,
               COALESCE(pt.status::text, '-') AS status,
               COALESCE(pt."senderCuit",'-') AS sender_cuit
        FROM public."PaymentTransaction" pt
        WHERE pt."customerAccountId" = :aid
        ORDER BY pt."createdAt" DESC
        LIMIT 200
    """, {"aid": int(account_id)}) or []
    return _serialize(
        rows,
        ["id", "talo_id", "fecha", "amount", "commission", "status", "sender_cuit"],
    )


def order_detail_full(order_id: int) -> dict:
    """
    Detalle completo de una orden TN (mimic Tienda Nube admin):
    items con imagenes, direcciones, customer, pago, eventos timeline.
    """
    eng = get_engine("unistore")

    # Header de orden
    head = q(eng, """
        SELECT o.id, o.number, o.status, o."paymentStatus", o."shippingStatus",
               o."createdAt"::text, o."paidAt"::text, o."cancelledAt"::text,
               o."closedAt"::text, o."completedAt"::text,
               o."cancelReason", o.note, o."ownerNote",
               o.subtotal::float, o."totalShipping"::float, o."totalDiscount"::float,
               COALESCE(o."discountCoupon",0)::float, o.total::float,
               o."contactEmail", o."contactPhone", o."contactName", o."contactIdentification",
               o.gateway, o."gatewayName", o."paymentDueDate"::text,
               o.weight::float, o."customerId", o."storeId"
        FROM tienda_nube."Order" o
        WHERE o.id = :oid
    """, {"oid": int(order_id)}) or []
    if not head:
        return {"error": "order not found"}
    r = head[0]
    order = {
        "id": int(r[0] or 0),
        "number": r[1] or "",
        "status": r[2] or "",
        "payment_status": r[3] or "",
        "shipping_status": r[4] or "",
        "created_at": r[5],
        "paid_at": r[6],
        "cancelled_at": r[7],
        "closed_at": r[8],
        "completed_at": r[9],
        "cancel_reason": r[10] or "",
        "note": r[11] or "",
        "owner_note": r[12] or "",
        "subtotal": float(r[13] or 0),
        "total_shipping": float(r[14] or 0),
        "total_discount": float(r[15] or 0),
        "discount_coupon": float(r[16] or 0),
        "total": float(r[17] or 0),
        "contact_email": r[18] or "",
        "contact_phone": r[19] or "",
        "contact_name": r[20] or "",
        "contact_identification": r[21] or "",
        "gateway": r[22] or "",
        "gateway_name": r[23] or "",
        "payment_due_date": r[24],
        "weight": float(r[25] or 0),
        "customer_id": int(r[26]) if r[26] else None,
        "store_id": int(r[27]) if r[27] else None,
    }

    # Items con imagen (join ProductImage por productId, primera imagen por position)
    items = q(eng, """
        SELECT oi.id, oi.name, oi.sku, oi.quantity::int, oi.price::float,
               (oi.quantity * oi.price)::float AS subtotal,
               oi."productId",
               oi."variantValues"::text AS variantes,
               (
                 SELECT pi.src FROM tienda_nube."ProductImage" pi
                 WHERE pi."productId" = oi."productId"
                 ORDER BY pi.position ASC NULLS LAST LIMIT 1
               ) AS imagen
        FROM tienda_nube."OrderItem" oi
        WHERE oi."orderId" = :oid
        ORDER BY oi.id
    """, {"oid": int(order_id)}) or []
    order["items"] = [{
        "id": int(x[0] or 0),
        "name": x[1] or "",
        "sku": x[2] or "",
        "quantity": int(x[3] or 0),
        "price": float(x[4] or 0),
        "subtotal": float(x[5] or 0),
        "product_id": int(x[6]) if x[6] else None,
        "variantes": x[7],
        "imagen": x[8],
    } for x in items]

    # Direccion de shipping
    addr = q(eng, """
        SELECT name, phone, address, number, floor, locality, zipcode, city, province, country
        FROM tienda_nube."OrderShippingAddress"
        WHERE "orderId" = :oid LIMIT 1
    """, {"oid": int(order_id)}) or []
    order["shipping_address"] = (
        {
            "name": addr[0][0] or "",
            "phone": addr[0][1] or "",
            "address": addr[0][2] or "",
            "number": addr[0][3] or "",
            "floor": addr[0][4] or "",
            "locality": addr[0][5] or "",
            "zipcode": addr[0][6] or "",
            "city": addr[0][7] or "",
            "province": addr[0][8] or "",
            "country": addr[0][9] or "",
        } if addr else None
    )

    # Customer (billing) si tenemos customerId
    if order["customer_id"]:
        c = q(eng, """
            SELECT id, name, email, phone, identification, "billingAddress", "billingNumber",
                   "billingCity", "billingProvince", "billingZipcode", "totalSpent", "customerType"
            FROM tienda_nube."Customer" WHERE id = :cid
        """, {"cid": order["customer_id"]}) or []
        if c:
            cr = c[0]
            order["customer"] = {
                "id": int(cr[0] or 0),
                "name": cr[1] or "",
                "email": cr[2] or "",
                "phone": cr[3] or "",
                "identification": cr[4] or "",
                "billing_address": cr[5] or "",
                "billing_number": cr[6] or "",
                "billing_city": cr[7] or "",
                "billing_province": cr[8] or "",
                "billing_zipcode": cr[9] or "",
                "total_spent": float(cr[10] or 0),
                "customer_type": cr[11] or "",
            }

    # Eventos timeline derivados
    events = []
    if order["created_at"]:
        events.append({"icon": "🛒", "label": f"Pedido #{order['number']} creado", "ts": order["created_at"]})
    if order["paid_at"]:
        events.append({"icon": "💰", "label": "Pago confirmado", "ts": order["paid_at"]})
    if order["cancelled_at"]:
        reason = order["cancel_reason"] or "(sin razon registrada)"
        events.append({"icon": "❌", "label": f"Venta cancelada · razon: {reason}", "ts": order["cancelled_at"]})
    if order["completed_at"]:
        events.append({"icon": "📦", "label": "Pedido completado", "ts": order["completed_at"]})
    events.sort(key=lambda e: e["ts"] or "", reverse=True)
    order["history"] = events

    # TN admin URL
    order["tn_admin_url"] = f"https://unistore8.mitiendanube.com/admin/orders/{order['id']}"

    return order


def stuck_order_detail(order_id: int) -> dict:
    """Items de una order especifica + estado de su fulfillment."""
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT oi.id, oi.name, oi.sku, oi.quantity,
               oi.price::float, (oi.quantity * oi.price)::float AS subtotal
        FROM tienda_nube."OrderItem" oi
        WHERE oi."orderId" = :oid
        ORDER BY (oi.quantity * oi.price) DESC
    """, {"oid": int(order_id)}) or []
    return _serialize(rows, ["item_id", "producto", "sku", "qty", "precio_unit", "subtotal"])


# ============================================================
# SAAS / UNIDROP USER LISTS
# ============================================================

_USER_COLS = ["id", "nombre", "email", "telefono", "provincia", "personeria", "creado", "vence", "activo"]
_USER_SQL = """
    SELECT u.id,
           COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, ''::text) AS nombre,
           u.email,
           COALESCE(NULLIF(TRIM(u.phone),''), '') AS telefono,
           COALESCE((
              SELECT NULLIF(TRIM(o.billing_province),'')
              FROM public.tienda_nube_orders o
              WHERE o.user_id = u.id
                AND o.billing_province IS NOT NULL
              ORDER BY o.created_at DESC NULLS LAST LIMIT 1
           ), '') AS provincia,
           COALESCE(u.personeria::text, '') AS personeria,
           u."createdAt"::text,
           u.end_date_subscription::text,
           COALESCE(u."isActive", TRUE) AS activo
    FROM public."User" u
    WHERE {where}
    ORDER BY {order} LIMIT 1000
"""


def _seg_clause(segment: str) -> str:
    if segment == "b2b": return " AND u.personeria::text = 'JURIDICA' "
    if segment == "b2c": return " AND u.personeria::text = 'FISICA' "
    return ""


def saas_users_all(segment: str = "all") -> dict:
    eng = get_engine("unidrop")
    where = "1=1" + _seg_clause(segment)
    rows = q(eng, _USER_SQL.format(where=where, order='u."createdAt" DESC')) or []
    return _serialize(rows, _USER_COLS)


def saas_users_active(segment: str = "all") -> dict:
    eng = get_engine("unidrop")
    where = "u.end_date_subscription > NOW() AND COALESCE(u.\"isActive\", TRUE) IS TRUE" + _seg_clause(segment)
    rows = q(eng, _USER_SQL.format(where=where, order="u.end_date_subscription ASC")) or []
    return _serialize(rows, _USER_COLS)


def saas_users_new(period: str = "30d", segment: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unidrop")
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = 'u."createdAt" >= NOW() - make_interval(days => :d)' + _seg_clause(segment)
    sql = _USER_SQL.format(where=where, order='u."createdAt" DESC')
    rows = q(eng, sql, {"d": days}) or []
    return _serialize(rows, _USER_COLS)


def saas_users_churned(period: str = "30d", segment: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unidrop")
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = """u.end_date_subscription IS NOT NULL
               AND u.end_date_subscription >= NOW() - make_interval(days => :d)
               AND u.end_date_subscription <= NOW()""" + _seg_clause(segment)
    rows = q(eng, _USER_SQL.format(where=where, order="u.end_date_subscription DESC"), {"d": days}) or []
    return _serialize(rows, _USER_COLS)


def saas_users_expiring(days_window: int = 7, segment: str = "all") -> dict:
    eng = get_engine("unidrop")
    where = f"u.end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '{int(days_window)} days'" + _seg_clause(segment)
    rows = q(eng, _USER_SQL.format(where=where, order="u.end_date_subscription ASC")) or []
    return _serialize(rows, _USER_COLS)


# ============================================================
# UNISTORE TN ORDERS / KPIs (Ventas, Gerencial, Logistica, Finanzas, CS)
# ============================================================

def _orders_serialize(rows: list) -> dict:
    # customer_id queda al final como columna oculta — el frontend la usa para construir
    # el link al perfil del cliente y la oculta visualmente
    return _serialize(rows, [
        "id", "numero", "fecha", "payment", "shipping", "status",
        "total", "cliente", "provincia", "metodo_envio", "canal", "customer_id",
    ])


def _build_order_select(eng) -> str:
    method_expr = _shipping_method_expr(eng)
    canal_sql = _classify_channel_sql("m.metodo_envio")
    return f"""
        WITH base AS (
          SELECT o.id, o.number, o."createdAt"::text AS fecha,
                 o."paymentStatus", o."shippingStatus", o.status,
                 o.total::float, COALESCE(c.name, c.email, '')::text AS cliente,
                 COALESCE(NULLIF(TRIM(c."billingProvince"),''),'-') AS provincia,
                 c.id AS customer_id,
                 {method_expr}
          FROM tienda_nube."Order" o
          LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
          LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
          WHERE {{where}}
        )
        SELECT m.id, m.number, m.fecha, m."paymentStatus", m."shippingStatus", m.status,
               m.total, m.cliente, m.provincia,
               m.metodo_envio,
               {canal_sql} AS canal,
               m.customer_id
        FROM base m
        ORDER BY m.fecha DESC LIMIT 1000
    """


def tn_orders_paid(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = "o.\"paymentStatus\" = 'paid' AND o.\"createdAt\" >= NOW() - make_interval(days => :d)"
    rows = q(eng, _build_order_select(eng).format(where=where), {"d": days}) or []
    return _orders_serialize(rows)


def tn_orders_all(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = 'o."createdAt" >= NOW() - make_interval(days => :d)'
    rows = q(eng, _build_order_select(eng).format(where=where), {"d": days}) or []
    return _orders_serialize(rows)


def tn_orders_cancelled(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unistore")
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = "o.status = 'cancelled' AND o.\"createdAt\" >= NOW() - make_interval(days => :d)"
    rows = q(eng, _build_order_select(eng).format(where=where), {"d": days}) or []
    return _orders_serialize(rows)


def tn_orders_stuck() -> dict:
    """paid + sin fulfillment > 5 dias."""
    eng = get_engine("unistore")
    where = """o."paymentStatus" = 'paid'
               AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
               AND o."createdAt" < NOW() - INTERVAL '5 days'"""
    rows = q(eng, _build_order_select(eng).format(where=where)) or []
    return _orders_serialize(rows)


def tn_products_published() -> dict:
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT p.id, p.name, COALESCE(p.brand,'') AS marca,
               (SELECT MAX(pv.price)::float FROM tienda_nube."ProductVariant" pv WHERE pv."productId" = p.id) AS precio,
               (SELECT COUNT(*) FROM tienda_nube."ProductVariant" pv WHERE pv."productId" = p.id) AS variantes,
               COALESCE(p."freeShipping", FALSE) AS free_shipping,
               p."createdAt"::text
        FROM tienda_nube."Product" p
        WHERE p.published = TRUE
        ORDER BY p."createdAt" DESC LIMIT 1000
    """) or []
    return _serialize(rows, ["id", "producto", "marca", "precio", "variantes", "free_shipping", "creado"])


def tn_skus_no_movement(days: int = 90) -> dict:
    eng = get_engine("unistore")
    rows = q(eng, """
        WITH no_sales AS (
            SELECT DISTINCT pv.sku
            FROM tienda_nube."ProductVariant" pv
            WHERE pv.sku IS NOT NULL
              AND pv.sku NOT ILIKE '%PVA%'
              AND pv.sku NOT IN (
                SELECT DISTINCT oi.sku FROM tienda_nube."OrderItem" oi
                JOIN tienda_nube."Order" o ON o.id = oi."orderId"
                WHERE o."createdAt" >= NOW() - make_interval(days => :d)
                  AND o."paymentStatus" = 'paid' AND oi.sku IS NOT NULL
              )
        )
        SELECT ns.sku, MAX(p.name) AS producto, COALESCE(MAX(p.brand),'') AS marca,
               COALESCE(SUM(sd.unidades),0)::int AS stock_actual
        FROM no_sales ns
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = ns.sku
        LEFT JOIN tienda_nube."Product" p ON p.id = pv."productId"
        LEFT JOIN digip."StockDetalle" sd ON sd."articuloCodigo" = ns.sku
        GROUP BY ns.sku
        ORDER BY stock_actual DESC LIMIT 1000
    """, {"d": int(days)}) or []
    return _serialize(rows, ["sku", "producto", "marca", "stock_actual"])


def tn_stock_critico() -> dict:
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT sd."articuloCodigo" AS sku,
               SUM(sd.unidades)::int AS stock,
               COUNT(DISTINCT sd.ubicacion)::int AS ubicaciones,
               MAX(p.name) AS producto
        FROM digip."StockDetalle" sd
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = sd."articuloCodigo"
        LEFT JOIN tienda_nube."Product" p ON p.id = pv."productId"
        GROUP BY sd."articuloCodigo"
        HAVING SUM(sd.unidades) >= 0 AND SUM(sd.unidades) <= 5
        ORDER BY stock ASC LIMIT 1000
    """) or []
    return _serialize(rows, ["sku", "stock", "ubicaciones", "producto"])


# ============================================================
# UNIDROP / TALO / SUBSCRIPTIONS
# ============================================================

def talo_transactions(period: str = "30d", status: str | None = None, from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Pagos Talo enriquecido con orden TN (DROP-DNI-Incremental), DNI y datos del usuario."""
    eng = get_engine("unidrop")
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = 'pt."createdAt" >= NOW() - make_interval(days => :d)'
    if status == "paid":
        where += " AND pt.status::text = 'PROCESSED' "
    elif status == "pending":
        where += " AND pt.status::text = 'PENDING' "
    elif status == "refunded":
        where += " AND pt.status::text IN ('CANCELLED','REFUNDED','VOIDED') "
    rows = q(eng, f"""
        SELECT pt.id,
               pt."createdAt"::text AS fecha,
               pt.status::text AS status,
               pt.amount::float AS monto,
               pt.commission::float AS comision,
               pt."creditedAmount"::float AS acreditado,
               COALESCE(pt."taloTransactionId", '') AS talo_id,
               -- intent + orden TN
               COALESCE((
                  SELECT string_agg(o.number, ', ')
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                      WHEN jsonb_typeof(pi."orderIds"::jsonb) = 'array' THEN pi."orderIds"::jsonb
                      ELSE '[]'::jsonb
                    END
                  ) AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid
                  WHERE pi."paymentTransactionId" = pt.id
               ), '') AS orden_numero,
               -- user via tienda_nube_orders.user_id
               COALESCE((
                  SELECT u.id::text
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                      WHEN jsonb_typeof(pi."orderIds"::jsonb) = 'array' THEN pi."orderIds"::jsonb
                      ELSE '[]'::jsonb
                    END
                  ) AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id AND u.id IS NOT NULL
                  LIMIT 1
               ), '') AS user_id,
               COALESCE((
                  SELECT u.dni
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                      WHEN jsonb_typeof(pi."orderIds"::jsonb) = 'array' THEN pi."orderIds"::jsonb
                      ELSE '[]'::jsonb
                    END
                  ) AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id AND u.dni IS NOT NULL
                  LIMIT 1
               ), '') AS dni,
               COALESCE((
                  SELECT u.email
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                      WHEN jsonb_typeof(pi."orderIds"::jsonb) = 'array' THEN pi."orderIds"::jsonb
                      ELSE '[]'::jsonb
                    END
                  ) AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id AND u.email IS NOT NULL
                  LIMIT 1
               ), '') AS email,
               COALESCE((
                  SELECT u.phone
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL jsonb_array_elements_text(
                    CASE
                      WHEN jsonb_typeof(pi."orderIds"::jsonb) = 'array' THEN pi."orderIds"::jsonb
                      ELSE '[]'::jsonb
                    END
                  ) AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id AND u.phone IS NOT NULL
                  LIMIT 1
               ), '') AS telefono
        FROM public."PaymentTransaction" pt
        WHERE {where}
        ORDER BY pt."createdAt" DESC LIMIT 1000
    """, {"d": days}) or []
    return _serialize(rows, [
        "id", "fecha", "status", "monto", "comision", "acreditado",
        "talo_id", "orden_numero", "user_id", "dni", "email", "telefono",
    ])


def subs_meli_active(plan: str | None = None) -> dict:
    """Usuarios Unidrop con suscripcion MELI vigente + plan + total cobrado."""
    eng = get_engine("unidrop")
    plan_filter = ""
    if plan and plan != "all":
        plan_filter = f' AND u."subscriptionId" = {int(plan)} '
    rows = q(eng, f"""
        SELECT u.id,
               COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, '') AS nombre,
               u.email,
               COALESCE(u.personeria::text, '') AS personeria,
               COALESCE(sm.name, '(sin plan)') AS plan,
               u.end_date_subscription::text AS vence,
               u."createdAt"::text AS creado,
               COALESCE((
                 SELECT SUM(pis."paidAmount")::float
                 FROM public."PaymentIntentSubscription" pis
                 WHERE pis."userId" = u.id
                   AND pis.status::text = 'PROCESSED'
               ), 0) AS total_cobrado
        FROM public."User" u
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        WHERE u.end_date_subscription > NOW()
          AND COALESCE(u."isActive", TRUE) IS TRUE
          {plan_filter}
        ORDER BY u.end_date_subscription DESC LIMIT 1000
    """) or []
    return _serialize(rows, ["user_id", "nombre", "email", "personeria", "plan", "vence", "creado", "total_cobrado"])


# ============================================================
# DEVOLUCIONES (Unidev)
# ============================================================

def devoluciones_list(period: str = "30d", modelo: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    try:
        eng = get_engine("unidev")
    except Exception:
        return _serialize([], [])
    days = resolve_window(period, from_iso, to_iso)["days"]
    where = "d.fecha_creacion >= NOW() - make_interval(days => :d) "
    p: dict = {"d": days}
    if modelo != "all":
        where += " AND d.modelo_negocio = :m "
        p["m"] = modelo
    rows = q(eng, f"""
        SELECT d.devolucion_id, d.fecha_creacion::text, d.estado_general,
               d.modelo_negocio, d.tipo_resolucion_preferida, d.cliente_email,
               COALESCE((SELECT SUM(di.cantidad_solicitada * di.monto_unitario)
                         FROM public.devolucion_items di WHERE di.devolucion_id = d.devolucion_id), 0)::float AS monto
        FROM public.devoluciones d
        WHERE {where}
        ORDER BY d.fecha_creacion DESC LIMIT 1000
    """, p) or []
    return _serialize(rows, ["id", "fecha", "estado", "modelo", "resolucion", "email", "monto"])


def tn_credentials_active() -> dict:
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT tc.store_id, tc."storeName", tc.user_id,
               u.email, u.personeria, tc."createdAt"::text
        FROM public."TiendaNubeCredential" tc
        LEFT JOIN public."User" u ON u.id = tc.user_id
        WHERE tc.store_id IS NOT NULL
        ORDER BY tc."createdAt" DESC LIMIT 1000
    """) or []
    return _serialize(rows, ["store_id", "tienda", "user_id", "email", "personeria", "creado"])

