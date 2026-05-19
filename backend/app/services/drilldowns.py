"""
Drill-downs - resuelven detalle al hacer click sobre tablas/charts.
Cada funcion devuelve un set de filas listo para mostrar como tabla.
"""
from __future__ import annotations

import logging

from app.db.engines import get_engine
from app.services._utils import q, col_or_null, list_columns
from app.services._utils import resolve_window

log = logging.getLogger("unidata.drilldowns")

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365}


def _shipping_method_expr(eng) -> str:
    """Detecta dinamicamente la columna que mejor represente el metodo de envio en TN.
    Prioridad: Fulfillment.optionName (label exacto de TN) > carrierName > Order fallbacks.
    Si nada existe devuelve NULL::text AS metodo_envio.
    """
    parts = []
    # optionName = etiqueta canonoca TN ("OCA - Puerta a Puerta", "Microcentro Unistore", etc.)
    opt = col_or_null(eng, "tienda_nube", "Fulfillment", "f", ["optionName", "option_name"])
    if opt != "NULL::text":
        parts.append(opt)
    # carrierName = carrier real post-despacho
    carrier = col_or_null(eng, "tienda_nube", "Fulfillment", "f", [
        "carrierName", "carrier", "trackingCompany", "tracking_company",
    ])
    if carrier != "NULL::text":
        parts.append(carrier)
    # Order fallbacks (actualmente no existen en el schema pero defensivo)
    o_ship = col_or_null(eng, "tienda_nube", "Order", "o", [
        "shippingOption", "shipping_option", "shippingMethod", "shipping_method",
    ])
    if o_ship != "NULL::text":
        parts.append(o_ship)
    if not parts:
        return "NULL::text AS metodo_envio"
    expr = "COALESCE(" + ", ".join(parts) + ")"
    return f"NULLIF(TRIM({expr}::text), '') AS metodo_envio"


def _shipping_type_col(eng) -> str | None:
    """Devuelve f."shippingType" si la columna existe en Fulfillment, si no None."""
    ful_cols = list_columns(eng, "tienda_nube", "Fulfillment")
    return 'f."shippingType"' if "shippingType" in ful_cols else None


def _carrier_col(eng) -> str | None:
    """Devuelve f."carrierName" si existe en Fulfillment, si no None."""
    ful_cols = list_columns(eng, "tienda_nube", "Fulfillment")
    for c in ("carrierName", "carrier", "trackingCompany"):
        if c in ful_cols:
            return f'f."{c}"'
    return None


def _classify_channel_sql(
    method_alias: str = "metodo_envio",
    type_alias: str | None = None,
    carrier_alias: str | None = None,
    pva_alias: str | None = None,
) -> str:
    """CASE SQL que clasifica el metodo en canales discretos.
    - type_alias: shippingType; 'pickup' → Retiro, 'non-shippable' → Producto Digital
    - carrier_alias: carrierName — fallback cuando optionName es generico (ej. "Puerta a Puerta")
    - pva_alias: bool — TRUE si la orden tiene al menos un item con sku ILIKE 'PVA%'"""
    pva_clause = f"WHEN {pva_alias} = TRUE THEN 'Producto Digital'" if pva_alias else ""
    non_ship_clause = f"WHEN {type_alias} = 'non-shippable' THEN 'Producto Digital'" if type_alias else ""
    pickup_clause = f"WHEN {type_alias} = 'pickup' THEN 'Retiro presencial'" if type_alias else ""
    oca_carrier = f"OR {carrier_alias} ILIKE '%oca%'" if carrier_alias else ""
    andreani_carrier = f"OR {carrier_alias} ILIKE '%andreani%'" if carrier_alias else ""
    correo_carrier = f"OR {carrier_alias} ILIKE '%correo%'" if carrier_alias else ""
    unifast_carrier = f"OR {carrier_alias} ILIKE '%unifast%'" if carrier_alias else ""
    return f"""
        CASE
          {pva_clause}
          {non_ship_clause}
          {pickup_clause}
          WHEN {method_alias} ILIKE '%oca%'         {oca_carrier}            THEN 'OCA'
          WHEN {method_alias} ILIKE '%correo argentino%'
            OR {method_alias} ILIKE '%correo nube%'
            OR {method_alias} ILIKE '%envio nube%'
            OR {method_alias} ILIKE '%envío nube%'  {correo_carrier}         THEN 'Correo Argentino'
          WHEN {method_alias} ILIKE '%unifast%'     {unifast_carrier}        THEN 'Unifast'
          WHEN {method_alias} ILIKE '%retiro%'
            OR {method_alias} ILIKE '%pickup%'
            OR {method_alias} ILIKE '%microcentro%'
            OR {method_alias} ILIKE '%sucursal unistore%'                    THEN 'Retiro presencial'
          WHEN {method_alias} ILIKE '%moto%'                                 THEN 'Moto / Cadeteria'
          WHEN {method_alias} ILIKE '%andreani%'    {andreani_carrier}       THEN 'Andreani'
          WHEN {method_alias} ILIKE '%personalizado%'
            OR {method_alias} ILIKE '%a convenir%'
            OR {method_alias} ILIKE '%efectivo%'                             THEN 'Personalizado'
          WHEN {method_alias} ILIKE '%digital%'                              THEN 'Digital'
          WHEN {method_alias} IS NULL OR {method_alias} = ''                 THEN '(sin metodo)'
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
    """Listado de orders TN que contienen un producto especifico.

    Usa from_ts/to_ts del resolve_window: HOY = inicio del dia AR -> ahora
    (NO ultimas 24h rolling, que era el bug que mostraba ordenes de ayer
    cuando se filtraba HOY).
    """
    if unit != "unistore":
        return _serialize([], [])
    win = resolve_window(period, from_iso, to_iso)
    from_ts = win["from_ts"]
    to_ts = win["to_ts"]
    eng = get_engine(unit)
    rows = q(eng, """
        SELECT o.id, o.number, o."createdAt"::text AS fecha,
               o."paymentStatus", o."shippingStatus",
               o.total::float, oi.quantity, oi.price::float,
               (oi.quantity * oi.price)::float AS subtotal,
               COALESCE(NULLIF(TRIM(osa.province),''),'(sin provincia)') AS provincia,
               COALESCE(c.name, c.email, 'Customer ' || o."customerId"::text) AS cliente,
               o."customerId" AS customer_id
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        WHERE oi."productId"::text = :pid
          AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
        ORDER BY o."createdAt" DESC
        LIMIT 200
    """, {"pid": str(product_id), "from_ts": from_ts, "to_ts": to_ts}) or []
    return _serialize(
        rows,
        ["order_id", "numero", "fecha", "payment", "shipping", "total", "qty",
         "precio_unit", "subtotal", "provincia", "cliente", "customer_id"],
    )


def orders_by_province(unit: str, province: str, period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Listado de orders TN paid en una provincia. from_ts/to_ts del window."""
    if unit != "unistore":
        return _serialize([], [])
    win = resolve_window(period, from_iso, to_iso)
    from_ts = win["from_ts"]
    to_ts = win["to_ts"]
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
          AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
        ORDER BY o."createdAt" DESC
        LIMIT 200
    """, {"prov": province, "from_ts": from_ts, "to_ts": to_ts}) or []
    return _serialize(
        rows,
        ["order_id", "numero", "fecha", "payment", "shipping", "total", "ciudad", "cliente", "direccion", "customer_id"],
    )


def orders_by_customer_unistore(customer_id: int, period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Historial de orders de un customer, filtrado por periodo."""
    eng = get_engine("unistore")
    win = resolve_window(period, from_iso, to_iso)
    method_expr = _shipping_method_expr(eng)
    type_col = _shipping_type_col(eng)
    carrier_col = _carrier_col(eng)
    type_select = f", {type_col} AS shipping_type" if type_col else ""
    carrier_select = f", {carrier_col} AS carrier_name" if carrier_col else ""
    type_alias = "m.shipping_type" if type_col else None
    carrier_alias = "m.carrier_name" if carrier_col else None
    canal_sql = _classify_channel_sql(
        "m.metodo_envio", type_alias=type_alias,
        carrier_alias=carrier_alias, pva_alias="m.is_pva",
    )
    rows = q(eng, f"""
        WITH base AS (
          SELECT o.id, o.number, o."createdAt"::text AS fecha,
                 o."paymentStatus", o."shippingStatus", o.total::float,
                 COALESCE(NULLIF(TRIM(osa.province),''),'-') AS provincia,
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
          LEFT JOIN tienda_nube."OrderShippingAddress" osa ON osa."orderId" = o.id
          LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
          WHERE o."customerId" = :cid
            AND o."createdAt" >= :from_ts AND o."createdAt" < :to_ts
        )
        SELECT m.id, m.number, m.fecha, m."paymentStatus", m."shippingStatus",
               m.total, m.provincia,
               m.metodo_envio,
               {canal_sql} AS canal,
               m.empaquetada
        FROM base m
        ORDER BY m.fecha DESC
        LIMIT 200
    """, {"cid": int(customer_id), "from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(
        rows,
        ["order_id", "numero", "fecha", "payment", "shipping", "total", "provincia", "metodo_envio", "canal", "empaquetada"],
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

# _unit es columna oculta consumida por el frontend para construir el link
# correcto al detalle (Unidrop dropshipper vs Unistore customer).
_USER_COLS = ["id", "nombre", "email", "telefono", "provincia", "personeria", "creado", "vence", "activo", "_unit"]


def _user_province_expr(eng) -> str:
    """Detecta dinamicamente la columna de provincia en public.User de Unidrop.
    Antes se cruzaba con tienda_nube_orders (mezcla de unidades) — ahora
    sale exclusivamente del propio User. Soporta varias variantes posibles."""
    return col_or_null(eng, "public", "User", "u", [
        "province", "state", "region", "address_province",
        "provincia", "provinceName", "addressProvince",
        "billingProvince", "shippingProvince",
    ])


def _build_user_sql(eng) -> str:
    prov_expr = _user_province_expr(eng)
    return f"""
        SELECT u.id,
               COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, ''::text) AS nombre,
               u.email,
               COALESCE(NULLIF(TRIM(u.phone),''), '') AS telefono,
               COALESCE(NULLIF(TRIM({prov_expr}::text),''), '') AS provincia,
               COALESCE(u.personeria::text, '') AS personeria,
               u."createdAt"::text,
               u.end_date_subscription::text,
               COALESCE(u."isActive", TRUE) AS activo,
               'unidrop'::text AS _unit
        FROM public."User" u
        WHERE {{where}}
        ORDER BY {{order}} LIMIT 1000
    """


def _seg_clause(segment: str) -> str:
    if segment == "b2b": return " AND u.personeria::text = 'JURIDICA' "
    if segment == "b2c": return " AND u.personeria::text = 'FISICA' "
    return ""


def saas_users_all(segment: str = "all") -> dict:
    eng = get_engine("unidrop")
    where = "1=1" + _seg_clause(segment)
    rows = q(eng, _build_user_sql(eng).format(where=where, order='u."createdAt" DESC')) or []
    return _serialize(rows, _USER_COLS)


def saas_users_active(segment: str = "all") -> dict:
    eng = get_engine("unidrop")
    where = "u.end_date_subscription > NOW() AND COALESCE(u.\"isActive\", TRUE) IS TRUE" + _seg_clause(segment)
    rows = q(eng, _build_user_sql(eng).format(where=where, order="u.end_date_subscription ASC")) or []
    return _serialize(rows, _USER_COLS)


def saas_users_new(period: str = "30d", segment: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    where = 'u.start_date_subscription::date >= CAST(:from_ts AS date) AND u.start_date_subscription::date <= CAST(:to_ts AS date)' + _seg_clause(segment)
    sql_built = _build_user_sql(eng).format(where=where, order='u.start_date_subscription DESC')
    rows = q(eng, sql_built, {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, _USER_COLS)


def saas_users_churned(period: str = "30d", segment: str = "all", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    where = """u.end_date_subscription IS NOT NULL
               AND u.end_date_subscription >= :from_ts
               AND u.end_date_subscription < :to_ts""" + _seg_clause(segment)
    rows = q(eng, _build_user_sql(eng).format(where=where, order="u.end_date_subscription DESC"),
             {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, _USER_COLS)


def saas_users_expiring(days_window: int = 7, segment: str = "all") -> dict:
    eng = get_engine("unidrop")
    where = f"u.end_date_subscription BETWEEN NOW() AND NOW() + INTERVAL '{int(days_window)} days'" + _seg_clause(segment)
    rows = q(eng, _build_user_sql(eng).format(where=where, order="u.end_date_subscription ASC")) or []
    return _serialize(rows, _USER_COLS)


# ============================================================
# UNISTORE TN ORDERS / KPIs (Ventas, Gerencial, Logistica, Finanzas, CS)
# ============================================================

def _orders_serialize(rows: list) -> dict:
    return _serialize(rows, [
        "id", "numero", "fecha", "payment", "shipping", "status",
        "total", "cliente", "provincia", "metodo_envio", "canal", "empaquetada", "customer_id",
        "metodo_pago", "ganancia",
    ])


def _build_order_select(eng) -> str:
    method_expr = _shipping_method_expr(eng)
    type_col = _shipping_type_col(eng)
    carrier_col = _carrier_col(eng)
    type_select = f", {type_col} AS shipping_type" if type_col else ""
    carrier_select = f", {carrier_col} AS carrier_name" if carrier_col else ""
    type_alias = "m.shipping_type" if type_col else None
    carrier_alias = "m.carrier_name" if carrier_col else None
    canal_sql = _classify_channel_sql(
        "m.metodo_envio", type_alias=type_alias,
        carrier_alias=carrier_alias, pva_alias="m.is_pva",
    )
    return f"""
        WITH base AS (
          SELECT o.id, o.number, o."createdAt"::text AS fecha,
                 o."paymentStatus", o."shippingStatus", o.status,
                 o.total::float, COALESCE(c.name, c.email, '')::text AS cliente,
                 COALESCE(NULLIF(TRIM(c."billingProvince"),''),'-') AS provincia,
                 c.id AS customer_id,
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
          LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
          LEFT JOIN tienda_nube."Fulfillment" f ON f."orderId" = o.id
          WHERE {{where}}
        )
        SELECT m.id, m.number, m.fecha, m."paymentStatus", m."shippingStatus", m.status,
               m.total, m.cliente, m.provincia,
               m.metodo_envio,
               {canal_sql} AS canal,
               m.empaquetada,
               m.customer_id,
               m."gatewayName"
        FROM base m
        ORDER BY m.fecha DESC LIMIT 1000
    """


def _enrich_with_ganancia(eng, rows: list) -> list:
    """Agrega ganancia por orden cruzando items con costs_db. Retorna rows con índice 14 = ganancia."""
    if not rows:
        return rows
    order_ids = [r[0] for r in rows]
    items_rows = q(eng, """
        SELECT "orderId", sku, "quantity"::int
        FROM tienda_nube."OrderItem"
        WHERE "orderId" = ANY(:ids) AND sku IS NOT NULL AND sku <> ''
    """, {"ids": order_ids}) or []
    items_by_order: dict[int, list[tuple]] = {}
    for ir in items_rows:
        items_by_order.setdefault(ir[0], []).append((ir[1], ir[2]))  # sku, qty

    cost_by_sku: dict[str, float] = {}
    try:
        from app.db import costs_db
        for c in (costs_db.current_costs(limit=10000) or []):
            sku_key = (c.get("sku") or "").strip().lower()
            costo = c.get("costo_unit_ars") or c.get("costo_con_iva_unit_ars") or 0
            if sku_key and costo:
                cost_by_sku[sku_key] = float(costo)
    except Exception:
        pass

    enriched = []
    for r in rows:
        items = items_by_order.get(r[0], [])
        ganancia = None
        if items and cost_by_sku:
            costo_total = sum(cost_by_sku.get((sku or "").strip().lower(), 0) * qty for sku, qty in items)
            if costo_total > 0:
                ganancia = round(float(r[6] or 0) - costo_total, 0)
        enriched.append(list(r) + [ganancia])
    return enriched


def tn_orders_paid(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unistore")
    win = resolve_window(period, from_iso, to_iso)
    where = "o.\"paymentStatus\" = 'paid' AND o.\"createdAt\" >= :from_ts AND o.\"createdAt\" < :to_ts"
    rows = q(eng, _build_order_select(eng).format(where=where), {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _orders_serialize(_enrich_with_ganancia(eng, rows))


def tn_orders_all(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unistore")
    win = resolve_window(period, from_iso, to_iso)
    where = 'o."createdAt" >= :from_ts AND o."createdAt" < :to_ts'
    rows = q(eng, _build_order_select(eng).format(where=where), {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _orders_serialize(_enrich_with_ganancia(eng, rows))


def tn_orders_cancelled(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    eng = get_engine("unistore")
    win = resolve_window(period, from_iso, to_iso)
    where = "o.status = 'cancelled' AND o.\"createdAt\" >= :from_ts AND o.\"createdAt\" < :to_ts"
    rows = q(eng, _build_order_select(eng).format(where=where), {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _orders_serialize(_enrich_with_ganancia(eng, rows))


def tn_orders_stuck() -> dict:
    """paid + sin fulfillment > 5 dias."""
    eng = get_engine("unistore")
    where = """o."paymentStatus" = 'paid'
               AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
               AND o."createdAt" < NOW() - INTERVAL '5 days'"""
    rows = q(eng, _build_order_select(eng).format(where=where)) or []
    return _orders_serialize(rows)


def unidrop_orders_tn_paid(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Ordenes TN de DROPSHIPPERS (Unidrop, no Unistore). Source: unidrop.public.tienda_nube_orders.

    Cada fila tiene `number` (DROP-{dni}-{seq}) que se puede linkear al panel Unidrop.
    NUNCA mezclar con tienda_nube de Unistore (que es Fox Electronics).
    """
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    # tienda_nube_orders usa snake_case — billingProvince/shippingProvince no existen
    prov_col = col_or_null(eng, "public", "tienda_nube_orders", "tno", [
        "billing_province", "shipping_province", "billingProvince", "shippingProvince", "province",
    ])
    rows = q(eng, f"""
        SELECT tno.tienda_nube_id::text AS id,
               tno."number",
               tno.created_at::text AS fecha,
               tno.payment_status::text AS estado_pago,
               COALESCE(tno.total, 0)::float AS total,
               COALESCE(NULLIF(tno.contact_name,''), tno.contact_identification, '') AS cliente,
               COALESCE({prov_col}::text, '') AS provincia,
               tno.user_id AS dropshipper_id
        FROM public.tienda_nube_orders tno
        WHERE tno.payment_status::text = 'paid'
          AND tno.created_at >= :from_ts AND tno.created_at < :to_ts
        ORDER BY tno.created_at DESC NULLS LAST
        LIMIT 2000
    """, {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, [
        "id", "number", "fecha", "estado_pago", "total", "cliente", "provincia", "dropshipper_id",
    ])


def unidrop_orders_ml_paid(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Ordenes ML de DROPSHIPPERS (Unidrop, no Unistore Fox Electronics).
    Source: unidrop.mercado_libre_dev.OrderMercadoLibre.
    """
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    rows = q(eng, """
        SELECT o.id::text AS id,
               o."number",
               o.id::text AS ml_order_id,
               o."dateCreated"::text AS fecha,
               o.status::text AS estado,
               COALESCE(o."totalAmount", 0)::float AS total,
               COALESCE(o."profit_for_subscription", 0)::float AS profit_unidrop,
               COALESCE(o."shipping_cost", 0)::float AS shipping_cost
        FROM mercado_libre_dev."OrderMercadoLibre" o
        WHERE o.status IN ('paid','confirmed','shipped','delivered')
          AND o."dateCreated" >= :from_ts AND o."dateCreated" < :to_ts
        ORDER BY o."dateCreated" DESC NULLS LAST
        LIMIT 2000
    """, {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, [
        "id", "number", "ml_order_id", "fecha", "estado", "total", "profit_unidrop", "shipping_cost",
    ])


def unidrop_intents_processed(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Ordenes cobradas a Unidrop via Talo: PaymentIntent PROCESSED del periodo.
    Ground truth de lo que efectivamente facturamos.
    """
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    rows = q(eng, """
        SELECT pi.id::text AS intent_id,
               pi."createdAt"::text AS fecha,
               pi."paidAmount"::float AS pagado,
               COALESCE(array_length(pi."mlOrderIds",1), 0)::int AS ml_orders_count,
               COALESCE(array_length(pi."orderIds",1), 0)::int AS tn_orders_count,
               COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'User '||u.id::text) AS dropshipper,
               u.dni AS dni,
               u.id AS dropshipper_id
        FROM public."PaymentIntent" pi
        INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
        LEFT JOIN public."User" u ON u.id = cpa."userId"
        WHERE pi."status" = 'PROCESSED'
          AND pi."createdAt" >= :from_ts AND pi."createdAt" < :to_ts
        ORDER BY pi."createdAt" DESC NULLS LAST
        LIMIT 2000
    """, {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, [
        "intent_id", "fecha", "pagado", "ml_orders_count", "tn_orders_count",
        "dropshipper", "dni", "dropshipper_id",
    ])


def unidrop_orders_combined_paid(period: str = "30d", from_iso: str | None = None, to_iso: str | None = None) -> dict:
    """Ordenes TN + ML combinadas de Unidrop para el periodo. Fuente de verdad para el popup del blurb."""
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    rows = q(eng, """
        SELECT 'TN'::text AS canal,
               tno.tienda_nube_id::text AS id,
               tno."number",
               tno.created_at::text AS fecha,
               COALESCE(tno.total, 0)::float AS total,
               COALESCE(NULLIF(tno.contact_name,''), tno.contact_identification, '') AS cliente,
               ''::text AS provincia,
               tno.user_id::text AS dropshipper_id
        FROM public.tienda_nube_orders tno
        WHERE tno.payment_status::text = 'paid'
          AND tno.created_at >= :from_ts AND tno.created_at < :to_ts
        UNION ALL
        SELECT 'ML'::text AS canal,
               o.id::text AS id,
               o."number",
               o."dateCreated"::text AS fecha,
               COALESCE(o."totalAmount", 0)::float AS total,
               ''::text AS cliente,
               ''::text AS provincia,
               (SELECT mla."userId"::text FROM mercado_libre_dev."MercadoLibreUserAccount" mla
                WHERE mla."mlUserId"::text = o."sellerId"::text LIMIT 1) AS dropshipper_id
        FROM mercado_libre_dev."OrderMercadoLibre" o
        WHERE o.status IN ('paid','confirmed','shipped','delivered')
          AND o."dateCreated" >= :from_ts AND o."dateCreated" < :to_ts
        ORDER BY fecha DESC
        LIMIT 2000
    """, {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, ["canal", "id", "number", "fecha", "total", "cliente", "provincia", "dropshipper_id"])


def unidrop_dropshippers_active_today() -> dict:
    """Dropshippers con al menos una venta hoy (TN o MELI Unidrop), ordenados por GMV desc."""
    import datetime as dt
    from app.utils.tz import now_ar
    _UTC = dt.timezone.utc
    now_tz = now_ar()
    today_start_utc = now_tz.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(_UTC).replace(tzinfo=None)
    now_utc = now_tz.astimezone(_UTC).replace(tzinfo=None)

    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT
            u.id AS dropshipper_id,
            COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email, 'User '||u.id::text) AS nombre,
            u.email,
            u.dni,
            COALESCE(SUM(tn.total), 0)::float AS gmv_tn,
            COUNT(DISTINCT tn.tienda_nube_id)::int AS ordenes_tn,
            COALESCE(SUM(ml."totalAmount"), 0)::float AS gmv_ml,
            COUNT(DISTINCT ml.id)::int AS ordenes_ml
        FROM public."User" u
        LEFT JOIN public.tienda_nube_orders tn
            ON tn.user_id = u.id
            AND tn.created_at >= :today_start AND tn.created_at <= :now_utc
            AND tn.payment_status = 'paid'
        LEFT JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."userId" = u.id
        LEFT JOIN mercado_libre_dev."OrderMercadoLibre" ml
            ON ml."sellerId"::text = mla."mlUserId"::text
            AND ml."dateCreated" >= :today_start AND ml."dateCreated" <= :now_utc
            AND ml.status IN ('paid','confirmed','shipped','delivered')
        WHERE (
            (tn.tienda_nube_id IS NOT NULL)
            OR (ml.id IS NOT NULL)
        )
        GROUP BY u.id, u.fantasy_name, u.name, u.email, u.dni
        ORDER BY (COALESCE(SUM(tn.total), 0) + COALESCE(SUM(ml."totalAmount"), 0)) DESC
        LIMIT 500
    """, {"today_start": today_start_utc, "now_utc": now_utc}) or []
    return _serialize(rows, [
        "dropshipper_id", "nombre", "email", "dni",
        "gmv_tn", "ordenes_tn", "gmv_ml", "ordenes_ml",
    ])


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
    """Pagos Talo enriquecido con tipo (TN order / MELI order / Suscripcion u otros),
    numero de orden (DROP-DNI-Incremental para TN, MELI order id para ML), DNI y datos del usuario.

    Importante: TaloPay procesa multiples flujos UNIDROP — ordenes TN, ordenes MELI y, en algunos
    casos, suscripciones. Esta query clasifica cada PaymentTransaction en su tipo correcto en
    lugar de mostrarlo como una transaccion plana sin contexto.
    """
    eng = get_engine("unidrop")
    win = resolve_window(period, from_iso, to_iso)
    # creditedAmount puede no existir en todas las instancias del schema
    credited_col = col_or_null(eng, "public", "PaymentTransaction", "pt", ["creditedAmount", "credited_amount"])
    where = 'pt."createdAt" >= :from_ts AND pt."createdAt" < :to_ts'
    if status == "paid":
        where += " AND UPPER(pt.status::text) IN ('COMPLETED','SUCCEEDED','APPROVED','PAID','PROCESSED') "
    elif status == "pending":
        where += " AND UPPER(pt.status::text) = 'PENDING' "
    elif status == "refunded":
        where += " AND UPPER(pt.status::text) IN ('CANCELLED','REFUNDED','VOIDED') "
    rows = q(eng, f"""
        SELECT pt.id,
               pt."createdAt"::text AS fecha,
               pt.status::text AS status,
               pt.amount::float AS monto,
               COALESCE(pt.commission, 0)::float AS comision,
               COALESCE({credited_col}::float, 0) AS acreditado,
               COALESCE(pt."taloTransactionId", '') AS talo_id,
               -- tipo: orderIds y mlOrderIds son arrays PostgreSQL, NO jsonb
               CASE
                 WHEN EXISTS (
                   SELECT 1 FROM public."PaymentIntent" pi
                   WHERE pi."paymentTransactionId" = pt.id
                     AND pi."mlOrderIds" IS NOT NULL
                     AND array_length(pi."mlOrderIds", 1) > 0
                 ) THEN 'Orden MELI'
                 WHEN EXISTS (
                   SELECT 1 FROM public."PaymentIntent" pi
                   WHERE pi."paymentTransactionId" = pt.id
                     AND pi."orderIds" IS NOT NULL
                     AND array_length(pi."orderIds", 1) > 0
                 ) THEN 'Orden TN'
                 ELSE 'Suscripcion / Otros'
               END AS tipo,
               COALESCE((
                  SELECT string_agg(COALESCE(o.order_number, o.number::text), ', ')
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL unnest(pi."orderIds") AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid::text
                  WHERE pi."paymentTransactionId" = pt.id
                    AND pi."orderIds" IS NOT NULL
               ), '') AS orden_numero,
               COALESCE((
                  SELECT string_agg(mloid::text, ', ')
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL unnest(pi."mlOrderIds") AS mloid
                  WHERE pi."paymentTransactionId" = pt.id
                    AND pi."mlOrderIds" IS NOT NULL
               ), '') AS meli_orden_id,
               COALESCE((
                  SELECT u.id::text
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL unnest(pi."orderIds") AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid::text
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id
                    AND pi."orderIds" IS NOT NULL AND u.id IS NOT NULL
                  LIMIT 1
               ), '') AS user_id,
               COALESCE((
                  SELECT u.dni
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL unnest(pi."orderIds") AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid::text
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id
                    AND pi."orderIds" IS NOT NULL AND u.dni IS NOT NULL
                  LIMIT 1
               ), '') AS dni,
               COALESCE((
                  SELECT u.email
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL unnest(pi."orderIds") AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid::text
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id
                    AND pi."orderIds" IS NOT NULL AND u.email IS NOT NULL
                  LIMIT 1
               ), '') AS email,
               COALESCE((
                  SELECT u.phone
                  FROM public."PaymentIntent" pi
                  CROSS JOIN LATERAL unnest(pi."orderIds") AS oid
                  LEFT JOIN public.tienda_nube_orders o ON o.tienda_nube_id::text = oid::text
                  LEFT JOIN public."User" u ON u.id = o.user_id
                  WHERE pi."paymentTransactionId" = pt.id
                    AND pi."orderIds" IS NOT NULL AND u.phone IS NOT NULL
                  LIMIT 1
               ), '') AS telefono
        FROM public."PaymentTransaction" pt
        WHERE {where}
        ORDER BY pt."createdAt" DESC LIMIT 1000
    """, {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}) or []
    return _serialize(rows, [
        "id", "fecha", "status", "monto", "comision", "acreditado",
        "talo_id", "tipo", "orden_numero", "meli_orden_id",
        "user_id", "dni", "email", "telefono",
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
    except Exception as e:
        log.warning("devoluciones_list: no engine unidev: %s", e)
        return _serialize([], [])
    win = resolve_window(period, from_iso, to_iso)
    where = "d.fecha_creacion >= :from_ts AND d.fecha_creacion < :to_ts"
    p: dict = {"from_ts": win["from_ts"], "to_ts": win["to_ts"]}
    log.info("devoluciones_list: period=%s from=%s to=%s", period, win["from_ts"], win["to_ts"])
    if modelo != "all":
        where += " AND d.modelo_negocio = :m"
        p["m"] = modelo
    count_check = q(eng, f"SELECT COUNT(*) FROM public.devoluciones d WHERE {where}", p)
    log.info("devoluciones_list count_check: %s", count_check[0][0] if count_check else "NONE")
    # devolucion_items may not exist — check before joining
    has_items = q(eng, """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='devolucion_items' LIMIT 1
    """)
    if has_items:
        qty_col = col_or_null(eng, "public", "devolucion_items", "di", ["cantidad_solicitada", "quantity", "qty"])
        unit_col = col_or_null(eng, "public", "devolucion_items", "di", ["monto_unitario", "unit_price", "price", "monto"])
        join_sql = "LEFT JOIN public.devolucion_items di ON di.devolucion_id = d.devolucion_id"
        monto_expr = f"COALESCE(SUM({qty_col}::float * {unit_col}::float), 0)::float AS monto"
    else:
        join_sql = ""
        monto_expr = "0::float AS monto"
    rows = q(eng, f"""
        SELECT d.devolucion_id, d.fecha_creacion::text, d.estado_general,
               d.modelo_negocio, d.tipo_resolucion_preferida, d.cliente_email,
               {monto_expr}
        FROM public.devoluciones d
        {join_sql}
        WHERE {where}
        GROUP BY d.devolucion_id, d.fecha_creacion, d.estado_general,
                 d.modelo_negocio, d.tipo_resolucion_preferida, d.cliente_email
        ORDER BY d.fecha_creacion DESC LIMIT 1000
    """, p) or []
    log.info("devoluciones_list result rows: %d", len(rows))
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


# ============================================================
# CUSTOMER SUCCESS: drilldowns por estado del cliente y segmento RFM
# ============================================================

def cs_customers_by_status(status: str) -> dict:
    """Lista de customers Unistore en un estado de ciclo de vida dado.
    Estados validos: 'Nuevo', '2da compra', 'Convertido a Recurrente',
    'Recurrente', 'Recuperado'.
    """
    eng = get_engine("unistore")
    rows = q(eng, """
        WITH stats AS (
            SELECT "customerId" AS cid,
                   COUNT(*) AS orders,
                   MIN("createdAt")::text AS first_order,
                   MAX("createdAt")::text AS last_order,
                   SUM(total)::float AS total_spent
            FROM tienda_nube."Order"
            WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
            GROUP BY 1
        ),
        gaps AS (
            SELECT "customerId" AS cid,
                   MAX(EXTRACT(DAY FROM ("createdAt" - prev_at)))::int AS max_gap_days
            FROM (
                SELECT "customerId", "createdAt",
                       LAG("createdAt") OVER (PARTITION BY "customerId" ORDER BY "createdAt") AS prev_at
                FROM tienda_nube."Order"
                WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
            ) x WHERE prev_at IS NOT NULL
            GROUP BY 1
        ),
        classified AS (
            SELECT s.cid, s.orders, s.first_order, s.last_order, s.total_spent,
                   COALESCE(g.max_gap_days, 0) AS max_gap_days,
                   CASE
                     WHEN s.orders = 1 THEN 'Nuevo'
                     WHEN s.orders = 2 THEN '2da compra'
                     WHEN s.orders = 3 THEN 'Convertido a Recurrente'
                     WHEN s.orders >= 4 AND COALESCE(g.max_gap_days,0) > 180 THEN 'Recuperado'
                     WHEN s.orders >= 4 THEN 'Recurrente'
                     ELSE 'Otros'
                   END AS estado
            FROM stats s
            LEFT JOIN gaps g ON g.cid = s.cid
        )
        SELECT cl.cid AS customer_id,
               COALESCE(c.name, c.email, 'Customer ' || cl.cid::text) AS cliente,
               cl.orders AS ordenes,
               EXTRACT(DAY FROM (NOW() - cl.last_order::timestamp))::int AS recency_dias,
               cl.total_spent AS facturacion,
               (cl.total_spent / NULLIF(cl.orders, 0))::float AS ticket_promedio,
               COALESCE(c.email, '') AS email,
               COALESCE(c.phone, '') AS telefono,
               cl.first_order::date AS primera_compra,
               cl.last_order::date AS ultima_compra
        FROM classified cl
        LEFT JOIN tienda_nube."Customer" c ON c.id = cl.cid
        WHERE cl.estado = :st
        ORDER BY cl.total_spent DESC NULLS LAST
        LIMIT 1000
    """, {"st": status}) or []
    return _serialize(
        rows,
        ["customer_id", "cliente", "ordenes", "recency_dias", "facturacion",
         "ticket_promedio", "email", "telefono", "primera_compra", "ultima_compra"],
    )


def cs_customers_by_rfm(segment: str) -> dict:
    """Lista de customers Unistore en un segmento RFM dado.
    Segmentos validos: 'Champions', 'Fieles', 'Nuevos potenciales',
    'En riesgo', 'Perdidos', 'Standard'.
    """
    eng = get_engine("unistore")
    rows = q(eng, """
        WITH base AS (
            SELECT "customerId" AS cid,
                   COUNT(*) AS frequency,
                   EXTRACT(DAY FROM (NOW() - MAX("createdAt")))::int AS recency_days,
                   SUM(total)::float AS monetary
            FROM tienda_nube."Order"
            WHERE "paymentStatus" = 'paid' AND "customerId" IS NOT NULL
            GROUP BY 1
        ),
        scored AS (
            SELECT b.*,
                   NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
                   NTILE(5) OVER (ORDER BY frequency ASC) AS f_score,
                   NTILE(5) OVER (ORDER BY monetary ASC) AS m_score
            FROM base b
        ),
        classified AS (
            SELECT s.*,
                   CASE
                     WHEN r_score>=4 AND f_score>=4 AND m_score>=4 THEN 'Champions'
                     WHEN r_score>=3 AND f_score>=3 AND m_score>=3 THEN 'Fieles'
                     WHEN r_score>=4 AND f_score<=2 THEN 'Nuevos potenciales'
                     WHEN r_score<=2 AND f_score>=4 THEN 'En riesgo'
                     WHEN r_score<=1 AND f_score<=2 THEN 'Perdidos'
                     ELSE 'Standard'
                   END AS segmento
            FROM scored s
        )
        SELECT cl.cid AS customer_id,
               COALESCE(c.name, c.email, 'Customer ' || cl.cid::text) AS cliente,
               cl.frequency AS ordenes,
               cl.recency_days AS recency_dias,
               cl.monetary AS facturacion,
               (cl.r_score::text || cl.f_score::text || cl.m_score::text) AS rfm,
               COALESCE(c.email, '') AS email,
               COALESCE(c.phone, '') AS telefono,
               COALESCE(NULLIF(TRIM(c."billingProvince"),''), '-') AS provincia
        FROM classified cl
        LEFT JOIN tienda_nube."Customer" c ON c.id = cl.cid
        WHERE cl.segmento = :seg
        ORDER BY cl.monetary DESC NULLS LAST
        LIMIT 1000
    """, {"seg": segment}) or []
    return _serialize(
        rows,
        ["customer_id", "cliente", "ordenes", "recency_dias", "facturacion",
         "rfm", "email", "telefono", "provincia"],
    )

