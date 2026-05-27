"""
Endpoints de exportacion masiva para todos los equipos.

Cada exporte devuelve un Excel xlsx (o CSV con ?format=csv) con datos
pre-procesados listos para campañas, cobranza, marketing, etc.

GET /api/exports/catalog        - Catalogo de exportes disponibles
GET /api/exports/vip-marketing  - Clientes VIP para marketing
GET /api/exports/customers-at-risk
GET /api/exports/dropshippers-active
GET /api/exports/stuck-orders
GET /api/exports/subs-expiring
GET /api/exports/stock-critico
GET /api/exports/top-skus-30d
GET /api/exports/devoluciones-abiertas
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.auth.security import current_user
from app.db.engines import get_engine
from app.services import customer_vip as vip_svc
from app.services import exports as export_svc
from app.services._utils import q

router = APIRouter(prefix="/api/exports", tags=["exports"])


_Format = Literal["xlsx", "csv", "json"]


def _respond(
    columns: list[str],
    rows: list[list],
    filename_base: str,
    format: str = "xlsx",
    title: str | None = None,
):
    """Empaqueta como xlsx, csv o json y devuelve la Response apropiada.
    format=json devuelve {columns, rows, row_count} para preview en
    DrillDownModal antes de descargar."""
    if format == "json":
        # Preview: devolver JSON serializable (convertir dates a iso str)
        out_rows = []
        for r in rows:
            out_rows.append([
                v.isoformat() if hasattr(v, "isoformat") else v
                for v in r
            ])
        return {
            "columns": columns,
            "rows": out_rows,
            "row_count": len(out_rows),
            "title": title or filename_base,
            "filename": filename_base,
        }
    if format == "csv":
        content = export_svc.to_csv_string(columns, rows)
        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
        )
    # default xlsx
    content = export_svc.to_xlsx_bytes(columns, rows, sheet_name=filename_base[:30], title=title)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'},
    )


@router.get("/catalog")
def get_catalog(_: Annotated[dict, Depends(current_user)]) -> dict:
    """Catalogo de exportes pre-armados agrupados por equipo."""
    return export_svc.get_catalog()


# ============================================================
# VIP marketing — Clientes VIP con campos de campañas
# ============================================================

@router.get("/vip-marketing")
def export_vip_marketing(
    _: Annotated[dict, Depends(current_user)],
    tier: Annotated[Literal["all", "gold", "silver", "bronze"], Query()] = "all",
    format: Annotated[_Format, Query()] = "xlsx",
):
    """VIP clients con email/telefono/tier/ultima_compra/recency para campañas."""
    data = vip_svc.list_vip_customers(tier)
    # Mapeo de columnas a labels human-readable
    col_labels = {
        "customer_id": "ID Cliente",
        "cliente": "Nombre",
        "email": "Email",
        "telefono": "Telefono",
        "tier": "Tier",
        "lifetime": "Facturacion total",
        "max_order": "Orden mas alta",
        "ticket_promedio": "Ticket promedio",
        "ordenes_pagadas": "Ordenes pagadas",
        "primera_compra": "Primera compra",
        "ultima_compra": "Ultima compra",
        "recency_dias": "Dias desde ultima compra",
        "provincia": "Provincia",
        "razon": "Razon VIP",
    }
    # Reordenamos columnas para que email/tel queden adelante (mas util para marketing)
    desired_order = [
        "customer_id", "cliente", "email", "telefono", "tier",
        "lifetime", "ordenes_pagadas", "ticket_promedio", "max_order",
        "ultima_compra", "recency_dias", "primera_compra", "provincia", "razon",
    ]
    src_cols = data["columns"]
    src_rows = data["rows"]
    out_cols = [col_labels.get(c, c) for c in desired_order if c in src_cols]
    idxs = [src_cols.index(c) for c in desired_order if c in src_cols]
    out_rows = [[r[i] for i in idxs] for r in src_rows]
    title = f"Clientes VIP {tier.upper() if tier != 'all' else 'TODOS'} — Campañas Marketing"
    return _respond(out_cols, out_rows, f"vip_marketing_{tier}", format, title=title)


# ============================================================
# Customers at risk (Posible churn) — para retencion CS
# ============================================================

@router.get("/customers-at-risk")
def export_customers_at_risk(
    _: Annotated[dict, Depends(current_user)],
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Customers Unistore con gap actual > 1.5x avg gap (posible churn)."""
    eng = get_engine("unistore")
    rows = q(eng, """
        WITH stats AS (
            SELECT c.id AS customer_id,
                   COALESCE(c.name, c.email, 'Customer '||c.id::text) AS cliente,
                   COALESCE(c.email,'') AS email,
                   COALESCE(c.phone,'') AS telefono,
                   COALESCE(NULLIF(TRIM(c."billingProvince"),''),'-') AS provincia,
                   COUNT(*) FILTER (WHERE o."paymentStatus"='paid')::int AS paid_orders,
                   COALESCE(SUM(o.total) FILTER (WHERE o."paymentStatus"='paid'),0)::float AS lifetime,
                   MAX(o."createdAt") FILTER (WHERE o."paymentStatus"='paid') AS ultima_compra,
                   EXTRACT(DAY FROM (NOW() - MAX(o."createdAt") FILTER (WHERE o."paymentStatus"='paid')))::int AS dias_desde_ultima
            FROM tienda_nube."Customer" c
            INNER JOIN tienda_nube."Order" o ON o."customerId" = c.id
            GROUP BY c.id, c.name, c.email, c.phone, c."billingProvince"
        ),
        gaps AS (
            SELECT "customerId" AS cid,
                   AVG(EXTRACT(DAY FROM ("createdAt" - prev_at)))::float AS avg_gap_days
            FROM (
                SELECT "customerId","createdAt",
                       LAG("createdAt") OVER (PARTITION BY "customerId" ORDER BY "createdAt") AS prev_at
                FROM tienda_nube."Order"
                WHERE "paymentStatus"='paid' AND "customerId" IS NOT NULL
            ) x WHERE prev_at IS NOT NULL
            GROUP BY 1
        )
        SELECT s.customer_id, s.cliente, s.email, s.telefono, s.provincia,
               s.paid_orders, s.lifetime, s.ultima_compra::date,
               s.dias_desde_ultima, COALESCE(g.avg_gap_days, 0)::int AS avg_gap_days
        FROM stats s
        LEFT JOIN gaps g ON g.cid = s.customer_id
        WHERE s.paid_orders >= 2
          AND s.dias_desde_ultima > GREATEST(60, COALESCE(g.avg_gap_days,0) * 1.5)
          AND s.dias_desde_ultima <= 365
        ORDER BY s.lifetime DESC NULLS LAST
        LIMIT 5000
    """) or []
    cols = ["ID Cliente", "Cliente", "Email", "Telefono", "Provincia",
            "Ordenes pagadas", "Facturacion total", "Ultima compra",
            "Dias desde ultima", "Gap promedio (dias)"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, "customers_at_risk", format,
                    title="Clientes en Posible Churn — Retención CS")


# ============================================================
# Dropshippers activos (Unidrop) - comercial
# ============================================================

@router.get("/dropshippers-active")
def export_dropshippers_active(
    _: Annotated[dict, Depends(current_user)],
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Dropshippers con suscripcion activa y al menos 1 venta en 30d."""
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT u.id, COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email) AS nombre,
               u.email, COALESCE(u.phone,'') AS telefono,
               COALESCE(sm.name,'-') AS plan, sm.price::float AS plan_precio,
               u.end_date_subscription::date AS sub_vence,
               EXTRACT(DAY FROM (u.end_date_subscription - NOW()))::int AS dias_vence,
               COALESCE((
                 SELECT SUM(p."totalAmount") FROM mercado_libre_dev."OrderMercadoLibre" o
                 INNER JOIN mercado_libre_dev."MercadoLibreUserAccount" mla ON mla."mlUserId"::text = o."sellerId"::text
                 LEFT JOIN (SELECT "orderId", SUM("totalAmount") AS "totalAmount"
                            FROM mercado_libre_dev."PaymentMercadoLibre"
                            WHERE "status" IN ('approved','paid') GROUP BY 1) p
                 ON p."orderId" = o.id
                 WHERE mla."userId" = u.id AND o."status" = 'paid'
                   AND o."dateCreated" >= NOW() - INTERVAL '30 days'
               ), 0)::float AS gmv_30d,
               COALESCE((
                 SELECT SUM(pi."pendingAmount") FROM public."PaymentIntent" pi
                 INNER JOIN public."CustomerPaymentAccount" cpa ON cpa.id = pi."customerAccountId"
                 WHERE cpa."userId" = u.id AND pi."status" <> 'PROCESSED'
                   AND COALESCE(pi."pendingAmount",0) > 0
               ), 0)::float AS deuda_pendiente
        FROM public."User" u
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        WHERE u."subscriptionId" IS NOT NULL
          AND COALESCE(u."isActive", TRUE) = TRUE
          AND u.end_date_subscription > NOW()
        ORDER BY gmv_30d DESC NULLS LAST
        LIMIT 5000
    """) or []
    cols = ["ID", "Nombre", "Email", "Telefono", "Plan", "Precio plan",
            "Vence sub", "Dias al vencimiento", "GMV 30d", "Deuda pendiente"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, "dropshippers_active", format,
                    title="Dropshippers Unidrop activos — Comercial")


# ============================================================
# Stuck orders — Logistica
# ============================================================

@router.get("/stuck-orders")
def export_stuck_orders(
    _: Annotated[dict, Depends(current_user)],
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Ordenes paid sin fulfillment hace mas de 5 dias."""
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT o.id, o.number, o."createdAt"::date AS fecha,
               COALESCE(c.name, c.email, '') AS cliente,
               COALESCE(c.email,'') AS email, COALESCE(c.phone,'') AS telefono,
               o.total::float,
               COALESCE(NULLIF(TRIM(c."billingProvince"),''),'-') AS provincia,
               EXTRACT(DAY FROM (NOW() - o."createdAt"))::int AS dias_atascado,
               o."shippingStatus"
        FROM tienda_nube."Order" o
        LEFT JOIN tienda_nube."Customer" c ON c.id = o."customerId"
        WHERE o."paymentStatus" = 'paid'
          AND o."shippingStatus" IN ('unpacked','unshipped','partially_packed','partially_fulfilled')
          AND o."createdAt" < NOW() - INTERVAL '5 days'
        ORDER BY o."createdAt" ASC
        LIMIT 5000
    """) or []
    cols = ["ID Orden", "Numero", "Fecha", "Cliente", "Email", "Telefono",
            "Total", "Provincia", "Dias atascado", "Shipping status"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, "stuck_orders", format,
                    title="Pedidos atascados (>5d sin fulfillment) — Logística")


# ============================================================
# Subscripciones por vencer — Cobranza
# ============================================================

@router.get("/subs-expiring")
def export_subs_expiring(
    _: Annotated[dict, Depends(current_user)],
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Dropshippers con suscripcion por vencer en N dias."""
    eng = get_engine("unidrop")
    rows = q(eng, """
        SELECT u.id, COALESCE(NULLIF(u.fantasy_name,''), u.name, u.email) AS nombre,
               u.email, COALESCE(u.phone,'') AS telefono,
               COALESCE(sm.name,'-') AS plan,
               sm.price::float AS plan_precio,
               u.end_date_subscription::date AS vence,
               EXTRACT(DAY FROM (u.end_date_subscription - NOW()))::int AS dias_al_vencimiento
        FROM public."User" u
        LEFT JOIN mercado_libre_dev."SubscriptionMeli" sm ON sm.id = u."subscriptionId"
        WHERE u.end_date_subscription BETWEEN NOW() AND NOW() + make_interval(days => :d)
          AND COALESCE(u."isActive", TRUE) = TRUE
        ORDER BY u.end_date_subscription ASC
    """, {"d": int(days)}) or []
    cols = ["ID", "Nombre", "Email", "Telefono", "Plan", "Precio plan", "Vence", "Dias al vencimiento"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, f"subs_expiring_{days}d", format,
                    title=f"Suscripciones por vencer ({days}d) — Cobranza")


# ============================================================
# Stock critico — Compras
# ============================================================

@router.get("/stock-critico")
def export_stock_critico(
    _: Annotated[dict, Depends(current_user)],
    format: Annotated[_Format, Query()] = "xlsx",
):
    """SKUs con menos de 5 unidades en deposito y con ventas en 30d."""
    eng = get_engine("unistore")
    rows = q(eng, """
        WITH stock_q AS (
            SELECT "codigoArticulo" AS sku, COALESCE("unidadesDisponibles", 0)::int AS stock
            FROM digip."Stock"
            WHERE COALESCE("unidadesDisponibles", 0) BETWEEN 1 AND 5
        ),
        sales_q AS (
            SELECT oi.sku, COUNT(DISTINCT oi."orderId")::int AS ordenes_30d,
                   SUM(oi.quantity)::int AS unidades_30d
            FROM tienda_nube."OrderItem" oi
            JOIN tienda_nube."Order" o ON o.id = oi."orderId"
            WHERE o."paymentStatus" = 'paid'
              AND o."createdAt" >= NOW() - INTERVAL '30 days'
            GROUP BY 1
        )
        SELECT s.sku, MAX(oi.name) AS nombre,
               COALESCE(MAX(pv.barcode), '') AS ean,
               s.stock AS stock_actual,
               COALESCE(sq.unidades_30d, 0) AS unidades_30d,
               COALESCE(sq.ordenes_30d, 0) AS ordenes_30d
        FROM stock_q s
        LEFT JOIN tienda_nube."OrderItem" oi ON oi.sku = s.sku
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = s.sku
        LEFT JOIN sales_q sq ON sq.sku = s.sku
        GROUP BY s.sku, s.stock, sq.unidades_30d, sq.ordenes_30d
        ORDER BY sq.unidades_30d DESC NULLS LAST
        LIMIT 5000
    """) or []
    cols = ["SKU", "Nombre", "EAN", "Stock actual", "Unidades vendidas 30d", "Ordenes 30d"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, "stock_critico", format,
                    title="SKUs con stock crítico (<5) — Compras")


# ============================================================
# Top SKUs 30 dias — Producto
# ============================================================

@router.get("/top-skus-30d")
def export_top_skus_30d(
    _: Annotated[dict, Depends(current_user)],
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Top SKUs por revenue ultimos 30 dias en Tienda Nube."""
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT oi.sku, MAX(oi.name) AS nombre,
               COALESCE(MAX(pv.barcode), '') AS ean,
               COALESCE(MAX(p.brand), '') AS marca,
               SUM(oi.quantity * oi.price)::float AS revenue,
               SUM(oi.quantity)::int AS unidades,
               COUNT(DISTINCT oi."orderId")::int AS ordenes
        FROM tienda_nube."OrderItem" oi
        JOIN tienda_nube."Order" o ON o.id = oi."orderId"
        LEFT JOIN tienda_nube."ProductVariant" pv ON pv.sku = oi.sku
        LEFT JOIN tienda_nube."Product" p ON p.id = pv."productId"
        WHERE o."paymentStatus" = 'paid'
          AND o."createdAt" >= NOW() - INTERVAL '30 days'
          AND oi.sku IS NOT NULL
        GROUP BY oi.sku
        ORDER BY revenue DESC NULLS LAST
        LIMIT 500
    """) or []
    cols = ["SKU", "Nombre", "EAN", "Marca", "Revenue 30d", "Unidades", "Ordenes"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, "top_skus_30d", format,
                    title="Top 500 SKUs últimos 30 días — Producto")


# ============================================================
# Devoluciones abiertas — Customer Service
# ============================================================

@router.get("/devoluciones-abiertas")
def export_devoluciones_abiertas(
    _: Annotated[dict, Depends(current_user)],
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Devoluciones Unidev sin resolver."""
    eng = get_engine("unistore")
    rows = q(eng, """
        SELECT d.devolucion_id, d.fecha_creacion::date AS fecha,
               COALESCE(d.cliente_email, '') AS cliente_email,
               COALESCE(d.modelo_negocio, '') AS modelo,
               COALESCE(d.tipo_resolucion_preferida, '') AS resolucion,
               COALESCE((SELECT SUM(di.cantidad_solicitada * di.monto_unitario)
                         FROM unidev.devolucion_items di
                         WHERE di.devolucion_id = d.devolucion_id), 0)::float AS monto,
               d.estado_general AS estado
        FROM unidev.devoluciones d
        WHERE d.estado_general IN ('abierta','pendiente','en_revision')
        ORDER BY d.fecha_creacion DESC
        LIMIT 5000
    """) or []
    cols = ["ID", "Fecha", "Email cliente", "Modelo negocio", "Resolución preferida", "Monto", "Estado"]
    rows_out = [list(r) for r in rows]
    return _respond(cols, rows_out, "devoluciones_abiertas", format,
                    title="Devoluciones abiertas — Customer Service")


# ============================================================
# Generic export: re-empaqueta cualquier drilldown como xlsx
# ============================================================

@router.get("/drilldown")
def export_drilldown(
    _: Annotated[dict, Depends(current_user)],
    endpoint: Annotated[str, Query()],
    title: Annotated[str | None, Query()] = None,
    filename: Annotated[str, Query()] = "export",
    format: Annotated[_Format, Query()] = "xlsx",
):
    """Empaqueta como xlsx la respuesta de cualquier endpoint de drilldown.
    Util para que el DrillDownModal exporte a Excel sin endpoint dedicado.

    El parametro endpoint debe ser un path interno (ej: /api/drilldowns/orders/all).
    """
    # Resolver el endpoint internamente seria ideal, pero por simplicidad,
    # delegamos al frontend que llame al endpoint y postee al export.
    # Por ahora dejamos este endpoint como placeholder de uso futuro.
    return Response(
        content="Use export_csv_from_browser fallback for now",
        media_type="text/plain",
        status_code=501,
    )
