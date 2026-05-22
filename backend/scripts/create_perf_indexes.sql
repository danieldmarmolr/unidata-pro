-- ============================================================================
-- Indexes de performance para queries pesadas detectadas en QA audit
-- ============================================================================
--
-- Ejecutar en cada RDS por unidad (unistore_api, unidrop_api).
-- Usar CONCURRENTLY para no lockear las tablas durante la creacion - eso
-- significa que el comando NO puede ir dentro de una transaccion.
--
-- COMO CORRER:
--   1. Conectar al RDS via SSH tunnel:
--        railway.cmd run --service backend bash
--        (o usar tu cliente PG favorito apuntando al bastion)
--   2. Para cada base ejecutar el bloque correspondiente.
--   3. Verificar al final: \d <tabla> en psql muestra los indexes nuevos.
--
-- IMPORTANTE: Cada CREATE INDEX CONCURRENTLY debe correrse como statement
-- SEPARADO (no batch). Si fallan a la mitad, queda en INVALID - drop y reintenta.
-- ============================================================================


-- ============================================================================
-- UNISTORE_API · schema tienda_nube
-- ============================================================================

-- Tabla Order: filtrado por createdAt + paymentStatus en casi todos los queries
-- de dashboards/drilldowns. createdAt DESC + paymentStatus como cubierto.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tn_order_created_at_desc
  ON tienda_nube."Order" ("createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tn_order_payment_status_created
  ON tienda_nube."Order" ("paymentStatus", "createdAt" DESC);

-- Tabla OrderItem: join por orderId + filtros LIKE 'PVA%' en SKU.
-- El text_pattern_ops permite que LIKE 'PVA%' use el index (prefix match).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tn_orderitem_order_id
  ON tienda_nube."OrderItem" ("orderId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tn_orderitem_sku_prefix
  ON tienda_nube."OrderItem" (sku text_pattern_ops);

-- Tabla Customer: join por id (PK ya indexado) y filtros por email/billing.
-- No agregamos nada nuevo aca - ya hay PK.

-- Tabla Fulfillment: join por orderId.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tn_fulfillment_order_id
  ON tienda_nube."Fulfillment" ("orderId");


-- ============================================================================
-- UNISTORE_API · schema digip
-- ============================================================================

-- Tabla Pedido: lookup por orderId (link a tienda_nube."Order".id).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_digip_pedido_order_id
  ON digip."Pedido" ("orderId");

-- Tabla DespachoPedido: join por pedidoCodigo (text).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_digip_despacho_pedido_codigo
  ON digip."DespachoPedido" ("pedidoCodigo");


-- ============================================================================
-- UNISTORE_API · schema meli
-- ============================================================================

-- Tabla meli_orders: date_created es la columna mas filtrada (24h, 30d, 90d).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meli_orders_date_created_desc
  ON meli.meli_orders (date_created DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meli_orders_status_date
  ON meli.meli_orders (status, date_created DESC);

-- Tabla meli_order_items: filtrado por seller_sku + join por order_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meli_orderitems_seller_sku
  ON meli.meli_order_items (seller_sku);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meli_orderitems_order_id
  ON meli.meli_order_items (order_id);


-- ============================================================================
-- UNIDROP_API · schema public
-- ============================================================================

-- PaymentIntent: el "ground truth" de ventas Unidrop. Filtrado por createdAt
-- y por arrays mlOrderIds (queries de cruce).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pi_created_at_desc
  ON public."PaymentIntent" ("createdAt" DESC);

-- GIN para busqueda de arrays mlOrderIds y tnOrderIds (si existe la columna).
-- El GIN permite consultas con && (overlaps) y ANY() rapidas.
-- NOTA: si la columna no es bigint[], ajustar tipo.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pi_ml_order_ids_gin
  ON public."PaymentIntent" USING GIN ("mlOrderIds");

-- tienda_nube_orders: filtrado por created_at + payment_status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unidrop_tn_orders_created_at
  ON public.tienda_nube_orders (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unidrop_tn_orders_payment_status
  ON public.tienda_nube_orders (payment_status, created_at DESC);

-- tienda_nube_order_items: join por tienda_nube_order_id (NO order_id - gotcha!).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unidrop_tn_order_items_join
  ON public.tienda_nube_order_items (tienda_nube_order_id);

-- User: link via referrerId (subquery en dropshippers_master).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_referrer_id
  ON public."User" ("referrerId")
  WHERE "referrerId" IS NOT NULL;


-- ============================================================================
-- UNIDROP_API · schema mercado_libre_dev
-- ============================================================================

-- OrderMercadoLibre: filtrado por number (LIKE 'DROP-DNI-%') + dateCreated.
-- text_pattern_ops permite que LIKE 'DROP-12345678-%' use el index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oml_number_prefix
  ON mercado_libre_dev."OrderMercadoLibre" ("number" text_pattern_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oml_date_created_desc
  ON mercado_libre_dev."OrderMercadoLibre" ("dateCreated" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oml_status_date
  ON mercado_libre_dev."OrderMercadoLibre" ("status", "dateCreated" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oml_user_id
  ON mercado_libre_dev."OrderMercadoLibre" ("userId")
  WHERE "userId" IS NOT NULL;

-- OrderItemMercadoLibre: filtrado por sellerSku + join por orderId.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_omli_seller_sku
  ON mercado_libre_dev."OrderItemMercadoLibre" ("sellerSku");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_omli_order_id
  ON mercado_libre_dev."OrderItemMercadoLibre" ("orderId");


-- ============================================================================
-- VERIFICACION POST-CREACION
-- ============================================================================
-- Correr esta query para verificar que ningun index quedo en estado INVALID
-- (puede pasar si CREATE CONCURRENTLY falla a la mitad por error o cancel).
--
-- SELECT n.nspname AS schema, c.relname AS index_name, x.indisvalid AS valid
-- FROM pg_index x
-- JOIN pg_class c ON c.oid = x.indexrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE NOT x.indisvalid
--   AND n.nspname NOT IN ('pg_catalog', 'information_schema');
--
-- Si devuelve filas: DROP INDEX CONCURRENTLY <nombre>; y volver a crear.
