# UNIDATA · Inventario de Datos

> Snapshot consolidado de `unistore_api` y `unidrop_api`. Capturado: 2026-05-22.
>
> **Cuándo actualizar este doc:** cuando se agregue/elimine una tabla, schema o linkage clave entre fuentes. Para columnas nuevas dentro de tablas existentes, no hace falta — basta refrescar el query del Explorador.
>
> Re-generación de la fuente cruda con:
> ```sql
> SELECT c.table_schema, c.table_name,
>   (SELECT reltuples::bigint FROM pg_class WHERE oid = (c.table_schema||'.'||quote_ident(c.table_name))::regclass) AS approx_rows,
>   pg_size_pretty(pg_total_relation_size((c.table_schema||'.'||quote_ident(c.table_name))::regclass)) AS size,
>   string_agg(c.column_name || ':' || c.data_type, ' | ' ORDER BY c.ordinal_position) AS columns
> FROM information_schema.columns c
> JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
> WHERE c.table_schema NOT IN ('pg_catalog','information_schema','pg_toast') AND t.table_type = 'BASE TABLE'
> GROUP BY c.table_schema, c.table_name
> ORDER BY c.table_schema, c.table_name;
> ```

---

## Resumen ejecutivo

| DB | Schemas | Tablas | Tamaño dominante | Filas dominantes |
|---|---:|---:|---|---|
| **unistore_api** | 5 | 72 | `tienda_nube.OrderRaw` (427 MB) | `tienda_nube.OrderItem` (463K) |
| **unidrop_api** | 6 | 99 | `mercado_libre_dev.OrderMercadoLibre` (83 MB) | `public.User` (33K dropshippers) |

### Schemas de unistore_api

| Schema | Tablas | Propósito |
|---|---:|---|
| `tienda_nube` | 15 | Ventas TN del retail Unistore (Order, OrderItem, Customer, Product, Fulfillment) |
| `meli` | 11 | Ventas MELI del retail Unistore (orders, shipments, claims, returns, exchanges) |
| `digip` | 37 | WMS completo (Articulo, Pedido, Preparacion, Despacho, Stock, MovimientoAjuste, Contenedor, Ubicacion) |
| `contabilium` | 8 | ERP (SalesOrder, Receipt, Client, Tenant) |
| `public` | 1 | `_prisma_migrations` solo |

### Schemas de unidrop_api

| Schema | Tablas | Propósito |
|---|---:|---|
| `public` | 50 | Core backend Unidrop: dropshippers (User), TaloPay (PaymentIntent + PaymentTransaction), TN denormalizado (tienda_nube_orders), envíos (oca/lightdata/siempre), referidos, pixels |
| `mercado_libre_dev` | 15 | MELI Unidrop completo: OrderMercadoLibre, OrderItem, Publication, Account, Webhook, Return ecosystem |
| `contabillium_dev` | 20 | ERP Unidrop + catálogos (Country, Province, City, Stock con 18.7K filas) |
| `integracion_unifull` | 7 | **Nuevo / vacío** — infra B2B mayorista (Unifull) |
| `cresium` | 3 | **Poco documentado** — gateway de refunds (alternativa a Talo) |
| `digip_dev` | 4 | WMS subset (solo pedidos MELI, ver [memoria](../C:\Users\Daniel%20Marmol\.claude\projects)) |

---

## unistore_api

### Schema `tienda_nube` — Ventas TN Unistore (15 tablas)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`Order`** | 56.742 | 58 MB | Ground truth ventas TN Unistore | `id`, `number`, `status`, `paymentStatus`, `shippingStatus`, `total`, `gateway`, `gatewayName`, `paidAt`, `completedAt`, `cancelledAt`, `storefront` |
| **`OrderItem`** | 463.097 | 99 MB | Línea de pedido (1 fila por SKU por orden) | `orderId`, `productId`, `variantId`, `quantity`, `price`, `sku`, `barcode`, `cost`, `variantValues` |
| `OrderRaw` | 56.726 | **427 MB** | JSON crudo TN — fields no mapeados | `orderId`, `payload` (jsonb) |
| `OrderShippingAddress` | 56.759 | 11 MB | Dirección de envío | `orderId`, `address`, `locality`, `province`, `zipcode`, `customs` |
| `OrderBillingAddress` | 56.745 | 10 MB | Dirección de facturación | `orderId`, `address`, `documentType`, `businessName` |
| `OrderClientDetails` | 56.710 | 14 MB | Tracking attribution | `orderId`, `browserIp`, `userAgent` |
| `OrderCoupon` | 3.540 | 1.1 MB | Cupones aplicados | `orderId`, `code`, `type`, `value` |
| `OrderCustomerVisit` | 4.675 | 864 kB | UTM tracking | `orderId`, `landingPage`, `utmSource`, `utmCampaign` |
| `OrderPaymentDetails` | 56.699 | 6 MB | Detalle de pago | `orderId`, `method`, `creditCardCompany`, `installments` |
| `OrderPromotionalDiscount` | 56.689 | 5.8 MB | Descuentos promo | `orderId`, `totalDiscountAmount` |
| `Fulfillment` | 40.917 | 12 MB | Eventos de cumplimiento | `orderId`, `status`, `trackingCode`, `trackingUrl`, `carrierName`, `shippingType` |
| `Customer` | 22.252 | 10 MB | Padrón clientes finales | `id`, `email`, `phone`, `documentType`, `identification`, `totalSpent`, `businessName` |
| `CustomerAddress` | 24.692 | 7.5 MB | Direcciones de clientes | `customerId`, `address`, `province`, `isDefault` |
| `Product` | 1.691 | 7 MB | Catálogo TN | `id`, `name`, `brand`, `published`, `tags`, `categoriesRaw`, `seoTitle` |
| `ProductImage` | 9.250 | 7.5 MB | Imágenes producto | `productId`, `src`, `position`, `alt` |
| `ProductVariant` | 3.125 | 3.6 MB | Variantes (talles, colores) | `productId`, `price`, `promotionalPrice`, `stock`, `sku`, `barcode`, `cost`, `mpn` |
| `Store` | 1 | 64 kB | Tienda TN Unistore | `id`, `name` |

### Schema `meli` — Ventas MELI Unistore (11 tablas)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`meli_orders`** | 4.106 | 20 MB | Ground truth ventas MELI Unistore | `meli_order_id`, `status`, `total_amount`, `paid_amount`, `buyer_meli_id`, `shipping_id`, `payments`, `tags`, `feedback`, `taxes`, `coupon` |
| **`meli_shipments`** | 2.361 | 10 MB | Detalle envío (FLEX/PR/Full) | `meli_shipment_id`, `status`, `tracking_number`, `logistic_mode`, `logistic_type`, `logistic_direction`, `service_id`, `shipping_method_name`, `delivery_type`, `estimated_delivery_date`, `dim_height/width/length/weight` |
| `meli_order_items` | 3.886 | 1.9 MB | Items por orden ML | `order_id`, `meli_item_id`, `title`, `variation_id`, `seller_sku`, `quantity`, `unit_price`, `sale_fee` |
| `meli_buyers` | 3.520 | 1.3 MB | Compradores | `buyer_meli_id`, `nickname`, `first_name`, `email`, `ident_type`, `phone`, `state_name`, `contabilium_client_id` |
| `meli_claims` | 537 | 1.3 MB | Reclamos | `meli_claim_id`, `meli_order_id`, `status`, `type`, `stage`, `reason_id`, `claimed_quantity`, `resolution`, `due_date`, `affects_reputation` |
| `meli_claim_messages` | 1.491 | 1.8 MB | Mensajes dentro del reclamo | `claim_id`, `sender_role`, `receiver_role`, `message`, `translated_message`, `attachments` |
| `meli_returns` | 34 | 376 kB | Devoluciones MELI | `meli_return_id`, `meli_order_id`, `meli_claim_id`, `status`, `subtype`, `status_money`, `refund_at`, `shipments`, `return_orders` |
| `meli_return_reviews` | 26 | 88 kB | Reviews de devoluciones | `return_id`, `resource`, `method`, `resource_reviews` |
| `meli_exchanges` | 0 | 64 kB | Cambios (vacío) | `meli_claim_id`, `new_orders_ids`, `estimated_exchange_from` |
| `meli_integrations` | 1 | 48 kB | Token OAuth ML | `provider`, `account_alias`, `access_token`, `refresh_token`, `token_expires_at` |
| `meli_integration_audits` | 104 | 72 kB | Audit cambios OAuth | `action`, `old_status`, `new_status`, `performed_by` |
| `meli_sellers` | 0 | 48 kB | Vendedores (vacío) | `meli_seller_id`, `nickname`, `business_name`, `reputation_level` |

### Schema `digip` — WMS Unistore (37 tablas)

Convención inconsistente — ver [memoria digip-unistore-schema-gotchas](../../../C:\Users\Daniel%20Marmol\.claude\projects\c--Users-Daniel-Marmol-OneDrive---Fox-Electronics-Desktop-unidata-pro\memory\digip_unistore_schema_gotchas.md).

#### Catálogo

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `Articulo` | 1.454 | 928 kB | Catálogo SKUs WMS | `CodigoArticulo`, `Descripcion`, `DiasVidaUtil`, `UsaLote`, `EsVirtual`, `ArticuloTipoRotacion`, `Activo`, `PesoDeclaradoPromedio` |
| `ArticuloUnidadMedida` | 1.832 | 896 kB | Equivalencias de unidad (caja, bulto, unitario) | `articuloCodigo`, `UnidadMedida_Id`, `Unidades`, `EsUnidadDeVenta`, `Alto`, `Ancho`, `Profundo`, `Peso` |
| `ArticuloUnidadMedidaCodigo` | 2.435 | 464 kB | EANs / códigos secundarios | `unidadMedidaId`, `Codigo` |
| `UnidadMedida` | 0 | — | Catálogo de unidades de medida (vacío) | `unidadId`, `descripcion` |
| `Proveedor` | 1 | — | Catálogo de proveedores | `codigo`, `descripcion`, `requiereControlCiego` |

#### Clientes y ubicaciones

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `Cliente` | 3.151 | 1.1 MB | Clientes (B2B + retail) | `Codigo`, `Descripcion`, `IdentificadorFiscal`, `Activo`, `ubicacionesCount` |
| `ClienteUbicacion` | 3.392 | 3.5 MB | Direcciones de entrega | `Codigo`, `ClienteCodigo`, `Direccion`, `Provincia`, `Localidad`, `Latitud`, `Longitud`, `DiaEntrega`, `HorarioEntregaDesde/Hasta`, `CodigoZona` |

#### Pedidos y flujo

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`Pedido`** | 5.717 | 11 MB | Cabecera pedido DigiP | `id`, `Codigo`, `CodigoClienteUbicacion`, `PedidoEstado` (text), `PedidoEstadoCode` (int), `Fecha`, `FechaEstimadaEntrega`, `Importe`, `CodigoDespacho`, `ServicioDeEnvioTipo`, `orderId` (FK TN.Order.id), `digipSyncStatus` |
| **`PedidoDetalle`** | 43.856 | 18 MB | Items pedido | `pedidoId` (FK Pedido.id), `CodigoArticulo`, `DescripcionArticulo`, `Unidades`, `UnidadesSatisfecha`, `PesoDeclarado`, `Lote`, `FechaVencimiento` |
| `Preparacion` | 2.519 | 4.5 MB | Preparación por pedido | `pedidoCodigo` (FK Pedido.Codigo text), `preparacionId`, `preparacionTipo`, `preparacionEstado`, `fechaHoraEstado`, `codigoDeEnvio`, `servicioDeEnvioTipo` |
| `PreparacionContenedor` | 2.530 | 3.8 MB | Contenedores armados en preparación | `preparacionId`, `numero`, `cantidadBulto` |
| `PreparacionContenedorDetalle` | 25.012 | 8.6 MB | Items dentro de cada contenedor de prep | `contenedorId`, `codigoArticulo`, `articulo`, `unidades`, `lote`, `fechaVencimiento` |
| `Contenedor` | 5.047 | 2.1 MB | Contenedores (otra vista) | `pedidoId`, `Numero`, `CantidadBulto`, `Preparacion_Id` |
| `Despacho` | 5.316 | 1.7 MB | Despacho por pedido | `pedidoId`, `Codigo`, `Descripcion`, `DespachoEstado`, `Ubicacion` |
| `DespachoCompleto` | 12 | 1.3 MB | Despacho consolidado (multi-pedido) | `codigo`, `descripcion`, `despachoEstado`, `ubicacion` |
| `DespachoPedido` | 844 | 4.5 MB | Items del despacho consolidado | `despachoCompletoId`, `pedidoCodigo` (text), `pedidoEstado`, `fecha`, `fechaEstimadaEntrega`, `codigoDespacho`, `servicioDeEnvioTipo` |
| `DespachoPedidoDetalle` | 12.050 | 13 MB | Items despachados | `despachoPedidoId`, `unidades`, `unidadesSatisfecha`, `articuloCodigo`, `articuloDescripcion`, `articuloActivo` |
| `DespachoPreparacion` | 484 | 4.3 MB | Despacho de preparaciones | `despachoCompletoId`, `codigo`, `observacionAdministrador`, `tipo`, `fechaEntrega`, `bultos`, `clienteCodigo` |
| `DespachoPreparacionDetalle` | 5.958 | 12 MB | Items en despacho-preparación | `preparacionId`, `articuloCodigo`, `cantidadRequerida`, `altoPorUnidad`, `pesoPorUnidad`, `unidadMedida` |
| `MapeoDespachoUnistore` | 0 | — | Tabla configuración (vacía) | `codigoDespacho`, `descripcion`, `activo` |

#### Stock e inventario

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`Stock`** | 1.534 | 992 kB | **Agregado por SKU** — health real de inventario | `codigoArticulo`, `unidadesDisponibles`, `unidadesReservadas`, `unidadesBloqueadas`, `unidadesADespachar`, `unidadesEnRecepcion`, `unidadesTransitoInterno`, `unidadesVencidas`, `unidadesPedidas` |
| `StockDetalle` | 6.531 | 14 MB | Detalle por ubicación física | `stockId`, `areaDescripcion`, `areaAbreviacion`, `ubicacion`, `pasillo/posicion/nivel`, `contenedorNumero`, `articuloCodigo`, `unidades`, `lote`, `fechaVencimiento` |
| `MovimientoAjuste` | 4.067 | 4.7 MB | Ajustes manuales de inventario | `codigoArticulo`, `usuarioNombreApellido`, `ubicacionDescripcion`, `unidadesAnterior`, `unidadesNuevo`, `motivoAjuste`, `signo` (+/-), `loteAnterior/Nuevo` |
| `MovimientoAjusteMotivo` | 0 | — | Catálogo de motivos (vacío) | `motivoId`, `descripcion` |

#### Recepción (control ciego)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `ControlCiego` | 88 | 528 kB | Auditorías de recepción | `documentoNumero`, `fecha`, `estado`, `ubicacion`, `modo` |
| `ControlCiegoDetalle` | 2.480 | 872 kB | Items revisados | `controlCiegoId`, `contenedor`, `codigoArticulo`, `lote`, `fechaVencimiento`, `unidades` |
| `ControlCiegoRecepcion` | 83 | 120 kB | Recepción asociada al control | `controlCiegoId`, `recepcionId`, `numero`, `fecha`, `proveedor` |
| `ControlCiegoRecepcionDetalle` | 260 | 168 kB | Items por recepción | `recepcionId`, `numeroContenedorExterno`, `codigoArticulo`, `lote`, `unidades`, `linea` |
| `DocumentoRecepcion` | 29 | 128 kB | Documentos recepción | `recepcionId`, `numero`, `fecha`, `proveedor` |
| `DocumentoRecepcionDetalle` | 0 | — | Items doc recepción (vacío) | `recepcionDocId`, `codigoArticulo`, `unidades` |

#### Depósito físico

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `DepositoArea` | 0 | — | Áreas del depósito (vacía) | `areaId`, `areaTipo`, `abreviacion`, `cantidadUbicaciones` |
| `DepositoUbicacion` | 662 | 544 kB | Posiciones físicas (pasillo/nivel) | `ubicacionId`, `areaId`, `pasillo`, `posicion`, `nivel`, `ubicacionTipoId`, `articuloTipoRotacion`, `codigoUbicacion` |
| `DepositoContenedor` | 3.685 | 4.9 MB | Contenedores físicos | `contenedorId`, `numero`, `ubicacionId` |
| `DepositoContenedorDetalle` | 22.294 | 7.7 MB | Items dentro de cada contenedor físico | `contenedorId`, `codigoArticulo` (camelCase), `lote`, `fechaVencimiento`, `unidades` |

#### Otros

| Tabla | Filas | Propósito |
|---|---:|---|
| `TransporteVehiculo` | 0 | Catálogo vehículos transporte (vacío) |

### Schema `contabilium` — ERP Unistore (8 tablas)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `SalesOrder` | 8.477 | 5.3 MB | Cabecera factura proforma → factura | `IDIntegracion`, `IDVentaIntegracion` (= TN.Order.id o ML order id), `Integracion`, `NumeroOrden`, `Total`, `Estado`, `invoiceStatus`, `invoiceCAE`, `invoiceLink`, `invoiceNumber` |
| `SalesOrderItem` | 62.821 | 17 MB | Items factura | `salesOrderId`, `Cantidad`, `Codigo` (SKU), `Concepto`, `PrecioUnitario`, `Iva`, `Bonificacion`, `IdConcepto` |
| `Receipt` | 7.084 | 3 MB | Recibo / cobro | `contabilium_receipt_id`, `tn_order_id`, `meli_order_id`, `IDIntegracion`, `Origen`, `Canal`, `Numero`, `Cae`, `ImporteTotalBruto`, `FechaEmision` |
| `ReceiptItem` | 64.994 | 14 MB | Items recibo | `receiptId`, `Cantidad`, `Concepto`, `PrecioUnitario`, `Iva`, `Codigo` |
| `ReceiptTribute` | 0 | — | Tributos recibo (vacío) | `receiptId`, `Tipo`, `BaseImp`, `Alicuota`, `Importe` |
| `CreditNote` | 0 | — | Notas de crédito (vacío) | `salesOrderId`, `contabilium_nc_id`, `numero`, `cae`, `importeTotalBruto`, `linkPublico`, `pdfStorageKey` |
| `Client` | 8.188 | 4.6 MB | Padrón clientes Contabilium | `contabilium_id`, `RazonSocial`, `NombreFantasia`, `CondicionIva`, `NroDoc`, `Codigo` |
| `Tenant` | 1 | — | Tenant Contabilium | `name`, `cuit`, `accessToken`, `accessTokenExpires` |

### Schema `public` (1 tabla)

| Tabla | Filas | Propósito |
|---|---:|---|
| `_prisma_migrations` | 50 | Tracking de migraciones Prisma |

---

## unidrop_api

### Schema `public` — Core Unidrop (50 tablas)

#### Usuarios (dropshippers)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`User`** | 33.172 | 16 MB | Padrón completo de dropshippers | `id`, `name`, `email`, `dni`, `cuit`, `fantasy_name`, `personeria`, `phone`, `store_id`, `referral_code`, `profit_percentage`, `role`, `isActive`, `companyId`, `referrerId`, `mercadoLibreAccountId`, `subscriptionId`, `start_date_subscription`, `end_date_subscription`, `subscription_status`, `solo_lectura`, `auto_sync_prices_meli` |
| `Address` | 23.724 | 3.8 MB | Direcciones de dropshippers | `street`, `number`, `floor`, `postalCodeId`, `userId` |
| `ReferralLink` | 154 | 104 kB | Sistema de referidos | `referrerId`, `refereeId` |
| `AdminEmailAuditLog` | 0 | — | Cambios de email auditados (vacío) | `adminId`, `targetUserId`, `previousEmail`, `newEmail` |

#### TaloPay (ground truth ventas + suscripciones)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `CustomerPaymentAccount` | 6.005 | 2.8 MB | Cuentas TaloPay de dropshippers | `customer_id`, `cvu`, `alias`, `name`, `email`, `webhook_url`, `isActive`, `userId` |
| **`PaymentTransaction`** | 2.178 | 3.4 MB | Transferencias Talo recibidas (ventas) | `taloTransactionId`, `customerAccountId`, `amount`, `transactionTimestamp`, `rawPayload`, `status`, `senderCvu`, `senderCuit`, `commission`, `creditedAmount`, `overpaidAmount`, `tax_amount` |
| **`PaymentIntent`** | 2.165 | 664 kB | **Ground truth ventas Unidrop** (intent de cobro = una venta) | `customerAccountId`, `expectedAmount`, `paidAmount`, `pendingAmount`, `status`, `paymentTransactionId`, `orderIds` (array TN), `mlOrderIds` (array ML) |
| `PaymentTransactionOrder` | 2.969 | 464 kB | M2M Transaction ↔ Order | `paymentTransactionId`, `orderId`, `mlOrderId` |
| `PaymentTransactionSubscription` | 1.493 | 2.2 MB | Transferencias para suscripción | `taloTransactionId`, `customerAccountId`, `amount`, `commission`, `creditedAmount`, `overpaidAmount` |
| **`PaymentIntentSubscription`** | 5.305 | 1.3 MB | **Ground truth suscripciones** | `userId`, `subscriptionMeliId`, `customerAccountId`, `expectedAmount`, `paidAmount`, `status`, `paymentTransactionId`, `from_landing` |
| `PaymentRefund` | 0 | — | Refunds (vacío) | `paymentTransactionId`, `taloRefundId`, `refundType`, `amount`, `reason`, `blame`, `rawPayload` |

#### Tienda Nube denormalizada (para Unidrop)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`tienda_nube_orders`** | 1.597 | 5.3 MB | Órdenes TN de dropshippers denormalizadas | `tienda_nube_id`, `store_id`, `order_number`, `status`, `payment_status`, `total`, `gateway_name`, `shipping_carrier`, `paid_at`, `completed_at`, `user_id`, `contabilium_client_id`, `label_downloaded`, `manual_packed_marked_at`, `manual_payment_marked_at`, `owner_user_id` |
| `tienda_nube_order_items` | 2.212 | 744 kB | Items TN | `tienda_nube_line_item_id`, `tienda_nube_order_id`, `product_id`, `name`, `price`, `quantity`, `sku`, `cost`, `order_type` |
| `tienda_nube_order_custom_fields` | 0 | — | Campos custom (vacío) | `tienda_nube_custom_field_id`, `name`, `value_type`, `owner_resource` |
| `TiendaNubeCredential` | 7.766 | 5.1 MB | Credenciales TN de dropshippers | `store_id`, `access_token`, `scope`, `contabiliumTenantId` |
| `Store` | 0 | — | Tiendas TN (vacío en unidrop) | `name`, `email`, `logo`, `business_id`, `domains` |
| `StoreHook` | 0 | — | Webhooks TN configurados | `externalId`, `name` |
| `ProductTiendaNube` | 1.129 | 3.4 MB | Productos TN sincronizados | `external_id`, `name` (jsonb), `description`, `attributes`, `published`, `brand`, `tags` |
| `CategoryTiendaNube` | 80 | 304 kB | Categorías TN | `external_id`, `name`, `parent`, `seo_title`, `google_shopping_category` |
| `ProductCategoryTiendaNube` | 4.126 | 464 kB | M2M Producto ↔ Categoría TN | `productId`, `categoryId` |
| `ProductSubCategoryTiendaNube` | 0 | — | Subcategorías TN (vacío) | `categoryId`, `name` |
| `Variant` | 2.123 | 984 kB | Variantes producto | `external_id`, `product_id`, `price`, `compare_at_price`, `stock`, `sku`, `barcode`, `cost`, `mpn`, `age_group`, `gender`, `visible` |
| `Image` | 8.014 | 2.8 MB | Imágenes producto | `external_id`, `product_id`, `src`, `position`, `cloudinaryPublicId` |
| `InventoryLevel` | 0 | — | Stock por location TN (vacío) | `external_id`, `variant_id`, `location_id`, `stock` |

#### Logística

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `oca_shipments` | 107 | 1.7 MB | Envíos OCA | `order_tienda_nube_id`, `order_mercado_libre_id`, `numero_envio`, `status`, `destinatario_provincia`, `peso`, `costo_envio`, `ultimo_estado_oca`, `fecha_entrega`, `etiqueta_pdf_base64` |
| `lightdata_shipments` | 1.118 | 3 MB | Envíos LightData | `orden_tn_id`, `orden_ml_id`, `numero_envio_lightdata`, `remito_interno`, `estado`, `direccion_provincia`, `peso_kg`, `costo_envio_ars`, `etiqueta_pdf_base64`, `tracking_qr`, `tracking_url` |
| `SiempreLogisticaShipment` | 282 | 176 kB | **Integración Siempre Logística** (no documentada antes) | `trackingNumber`, `serviceId`, `delivery_pickup_id`, `receives`, `address`, `postal_code`, `items`, `provincia`, `valor_declarado`, `bultos` |
| `SiempreLogisticaReturn` | 0 | — | Devoluciones Siempre Logística (vacío) | `origen_provincia`, `origen_postal_code`, `destino_provincia`, `type_inversa`, `cambio_shipping_code` |
| `SiempreLogisticaToken` | 1 | — | Token OAuth Siempre | `token`, `expiresIn` |
| `pedidos_por_lotes` | 1.049 | 408 kB | Pedidos agrupados para packaging | `nombre_lote`, `number`, `platform`, `sku`, `cantidad`, `estado_pedido`, `packaged_at`, `etiqueta_url`, `tracking_number` |
| `pedidos_por_lotes_backup_*` | varios | — | Backups del packaging | (mismo schema, snapshots históricos) |

#### Geo (compartido)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `Country` | 0 | — | Países (vacío) | `name`, `isoCode` |
| `State` | 51 | 80 kB | Provincias | `name`, `countryId`, `contabiliumProvinceId` |
| `City` | 3.385 | 680 kB | Ciudades | `name`, `stateId`, `contabiliumCityId` |
| `PostalCode` | 6.134 | 992 kB | Códigos postales | `code`, `cityId` |

#### Misc

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `PixelMetaInfo` | 19.119 | 16 MB | Meta Pixel tracking | `fbc`, `fbp`, `client_user_agent`, `client_ip_address`, `userId` |
| `SkuPriceHistory` | 24.881 | 4.7 MB | **Audit trail cambios precio/costo por SKU** | `userId`, `sku`, `previousCost`, `newCost`, `previousPrice`, `newPrice`, `origin`, `changedAt` |
| `App` | 0 | — | Apps externas (vacío) | `name`, `apiKey` |
| `Webhook` | 0 | — | Webhooks (vacío) | `url`, `event`, `active`, `appId` |
| `WebhookDelivery` | 0 | — | Entregas de webhook (vacío) | `webhookId`, `payload`, `verified`, `status`, `responseCode` |
| `CompanyName` | 0 | — | Razones sociales (vacío) | `type` |
| `Category` / `SubCategory` | 0 | — | Categorías locales (no TN) | `name`, `isDeleted` |
| `Product` / `OrderItem` / `MyOrder` / `ProductCategory` / `ProductSubCategory` | 0 | — | Catálogo legacy local (vacío) | — |
| `_OrderTiendaNubeToPaymentIntent` | 660 | 128 kB | **Prisma m2m** TN ↔ PI | `A` (TN order id), `B` (PI id) |
| `_prisma_migrations` | 90 | 96 kB | Migraciones Prisma | — |

### Schema `mercado_libre_dev` — MELI Unidrop (15 tablas)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`OrderMercadoLibre`** | 2.658 | 83 MB | **Tabla central** ventas ML dropshippers | `id` (= ML order id bigint), `status`, `dateCreated`, `totalAmount`, `paidAmount`, `buyerId`, `sellerId`, `shippingId`, `tags`, `shipping_cost`, `total_cost`, `shipping_carrier`, `cancel_by_unidrop`, `notification_pack`, `notification_ship`, `missing_sku` (array), `number` (DROP-{dni}-N), `merchandise_cost`, `profit_for_subscription`, `label_downloaded`, `etiqueta_pdf_base64`, `owner_user_id` |
| `OrderItemMercadoLibre` | 3.279 | 4.2 MB | Items por orden ML | `orderId`, `itemId`, `title`, `variationId`, `sellerSku`, `imagesUrls`, `quantity`, `unitPrice`, `unitCost`, `orderType` (enum) |
| `PaymentMercadoLibre` | 2.772 | 512 kB | Pagos ML (referencia, no es GMV) | `id`, `orderId`, `transaction_amount`, `currency_id`, `status`, `date_created` |
| `MercadoLibreUserAccount` | 1.584 | 568 kB | OAuth ML por dropshipper | `mlUserId`, `nickname`, `siteId`, `email`, `accessToken`, `refreshToken`, `expiresAt`, `requiresReauth`, `contabiliumTenantId` |
| `MercadoLibreUserDailyToken` | 280 | 104 kB | Tokens diarios para webhooks | `userId`, `token`, `submittedAt` |
| `DropOrderCounter` | 387 | 112 kB | **Asigna número secuencial** DROP-{dni}-N | `dropshipperDni`, `lastNumber`, `updatedAt` |
| `PublicationUserMercadoLibre` | 15.334 | 8 MB | Publicaciones ML del dropshipper | `mlItemId`, `mlAccountId`, `title`, `skus` (array), `missingSkus` (array), `permalink`, `status`, `lastSentStock`, `variations`, `lastSentPrice`, `priceUpdateError`, `priceUpdateErrorAt`, `priceUpdateErrorSolution`, `stock` |
| `MercadoLibreReturn` | 272 | 168 kB | Devoluciones ML | `claimId`, `returnId`, `shipmentId`, `orderId`, `mlAccountId`, `status` (enum), `reason` (enum), `discrepancyType` (enum), `discrepancyNote`, `returnTrackingCode`, `carrier`, `amountToRefund`, `receivedAt`, `discrepancyPhotoUrl` |
| `MercadoLibreReturnHistory` | 487 | 128 kB | Transiciones de devolución | `returnId`, `fromStatus`, `toStatus`, `actorId`, `note` |
| `MercadoLibreReturnItem` | 0 | — | Items devueltos (vacío) | `returnId`, `itemId`, `title`, `sku`, `quantity`, `unitPrice`, `reason` |
| `MercadoLibreReturnAttachment` | 0 | — | Adjuntos devolución (vacío) | `returnId`, `url`, `type` |
| `SubscriptionMeli` | 4 | 48 kB | Planes de suscripción | `name`, `price`, `description`, `number_of_publications_allowed`, `combo_months`, `contabiliumServiceId` |
| `SubscriptionExtensionLog` | 0 | — | Extensiones manuales (vacío) | `adminId`, `targetUserId`, `subscriptionId`, `monthsAdded`, `reason` |
| `WebhookOrder` | 15.866 | **51 MB** | **Audit trail** webhooks orders ML | `orderId`, `payload` (jsonb), `mlAccountId` |
| `WebhookClaim` | 13.558 | 8 MB | **Audit trail** webhooks claims/devoluciones ML | `claimId`, `topic`, `resource`, `payload`, `mlUserId`, `mlAccountId`, `receivedAt` |
| `_OrderMercadoLibreToPaymentIntent` | 2.398 | 304 kB | **Prisma m2m** ML ↔ PI | `A` (ML order id), `B` (PI id) |

### Schema `contabillium_dev` — ERP Unidrop (20 tablas)

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| **`ContabilliumInvoice`** | 4.199 | 1.5 MB | Facturas emitidas Contabilium | `contabiliumId`, `tipoFc`, `puntoVenta`, `numeroComprobante`, `fechaEmision`, `cae`, `total`, `idCliente`, `idVentaIntegracion` (= TN.tienda_nube_id o ML order id), `linkPublico`, `observacionesAfip`, `cartShippingId` |
| `ContabiliumSalesOrder` | 5.553 | 2.2 MB | Órdenes de venta | `tenantId`, `idVentaIntegracion`, `estadoIntegracion`, `fechaEmision`, `condicionVenta`, `clienteId`, `contabilliumInvoiceId`, `paymentIntentSubscriptionId`, `sourceType`, `lastInvoiceError`, `cartShippingId`, `mergedIntoSalesOrderId` |
| `ContabiliumSalesOrderItem` | 3.197 | 544 kB | Items órdenes de venta | `orderId`, `codigo`, `concepto`, `cantidad`, `precioUnitario`, `bonificacion`, `iva` |
| `ContabiliumClient` | 2.051 | 720 kB | Clientes Contabilium | `contabilium_id`, `nro_doc`, `tenantId`, `razon_social`, `email`, `isActive`, `deletedAt` |
| **`ContabiliumStock`** | 18.738 | **22 MB** | **Stock sincronizado con Contabilium** | `tenantId`, `depositId`, `codigo` (SKU), `stockActual`, `stockReservado`, `stockConReservas`, `fechaActualizada` |
| `ContabilliumTenant` | 1 | — | Tenant Contabilium Unidrop | `name`, `cuit`, `accessToken`, `accessTokenExpires`, `integrationId`, `defaultIva` |
| `ContabiliumCity` | 22.903 | 2.5 MB | Catálogo ciudades Contabilium | `contabiliumId`, `nombre`, `idProvincia` |
| `ContabiliumCountry` | 174 | 80 kB | Catálogo países | `contabiliumId`, `nombre` |
| Resto (Province, Category, SubCategory, Deposito, SalesPoint, SalesCondition, CondicionVenta, EcommerceConfig, Product, Service, PurchaseOrder, PurchaseOrderItem) | 0 | — | Catálogos auxiliares Contabilium (vacíos / no usados todavía) | — |

### Schema `digip_dev` — WMS Unidrop subset (4 tablas)

Ver [memoria digip_dev_schema](../../../C:\Users\Daniel%20Marmol\.claude\projects\c--Users-Daniel-Marmol-OneDrive---Fox-Electronics-Desktop-unidata-pro\memory\digip_dev_schema.md).

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `pedidos` | 869 | 2.6 MB | Pedidos MELI sincronizados a DigiP | `Codigo` (= OML.number, 88.6% match), `PedidoEstado`, `Fecha`, `Importe`, `CodigoDespacho`, `orderId` (siempre NULL) |
| `pedidos_detalles` | 1.700 | 1.9 MB | Items por pedido | `pedidoId`, `CodigoArticulo`, `Unidades`, `UnidadesSatisfecha`, `Lote`, `FechaVencimiento` |
| `clientes` | 716 | 320 kB | Clientes DigiP Unidrop | `Codigo`, `Descripcion`, `IdentificadorFiscal`, `Activo` |
| `clientes_ubicaciones` | 721 | 848 kB | Direcciones de cliente | `Codigo`, `ClienteCodigo`, `Direccion`, `Provincia`, `Localidad` |

### Schema `cresium` — Gateway de refunds (3 tablas)

Alternativa a Talo para devoluciones MELI. Mayormente vacío todavía.

| Tabla | Filas | Tamaño | Propósito | Columnas clave |
|---|---:|---:|---|---|
| `UserBankAccount` | 211 | 104 kB | Cuentas bancarias verificadas para refunds | `userId`, `alias`, `cbu`, `cvu`, `taxId`, `bankName`, `holderName`, `cresiumToId`, `isVerified`, `lastVerifiedAt` |
| `MercadoLibreRefundOrder` | 0 | — | Refunds enviados (vacío) | `returnId`, `bankAccountId`, `amount`, `idempotencyKey`, `recipientCbu`, `status`, `cresiumPreviewId`, `cresiumTransactionId`, `refundedAt` |
| `CresiumTransactionEvent` | 0 | — | Eventos transaccionales Cresium (vacío) | `refundOrderId`, `cresiumTxId`, `type`, `status`, `totalAmount`, `netAmount`, `fees`, `rawPayload` |

### Schema `integracion_unifull` — B2B mayorista (7 tablas)

**Schema nuevo y vacío** — infra puesta para integración B2B Unifull. No usado actualmente.

| Tabla | Propósito |
|---|---|
| `products_owner` / `variants_owner` / `images_owner` / `categories_owner` / `product_categories_owner` | Catálogo de productos por owner (B2B multi-tenant) |
| `sku_externo` | SKUs externos vinculados a dropshippers |

---

## Linkages cross-schema clave

### Linkages dentro de unistore_api

| Origen | Destino | FK |
|---|---|---|
| `tienda_nube.Order.id` | `digip.Pedido.orderId` | bigint |
| `tienda_nube.Order.id` | `tienda_nube.OrderItem.orderId` | bigint |
| `tienda_nube.Order.id` | `tienda_nube.Fulfillment.orderId` | bigint |
| `tienda_nube.Order.id` | `contabilium.Receipt.tn_order_id` | bigint |
| `tienda_nube.Order.id` | `contabilium.SalesOrder.IDVentaIntegracion` (con `Integracion='tiendanube'`) | bigint |
| `meli.meli_orders.meli_order_id` | `contabilium.Receipt.meli_order_id` | bigint |
| `meli.meli_orders.meli_order_id` | `contabilium.SalesOrder.IDVentaIntegracion` (con `Integracion='meli'`) | bigint |
| `digip.Pedido.id` | `digip.PedidoDetalle.pedidoId` | int |
| `digip.Pedido.Codigo` | `digip.Preparacion.pedidoCodigo` | text |
| `digip.Pedido.Codigo` | `digip.DespachoPedido.pedidoCodigo` | text |
| `digip.DespachoPedido.id` | `digip.DespachoPedidoDetalle.despachoPedidoId` | int |
| `digip.DepositoContenedor.id` | `digip.DepositoContenedorDetalle.contenedorId` | int |
| `digip.StockDetalle.stockId` | `digip.Stock.id` | int |

### Linkages dentro de unidrop_api

| Origen | Destino | FK |
|---|---|---|
| `public.User.id` | `mercado_libre_dev.OrderMercadoLibre.owner_user_id` | int |
| `public.User.id` | `public.tienda_nube_orders.owner_user_id` | int |
| `public.User.dni` | `mercado_libre_dev.DropOrderCounter.dropshipperDni` (genera `DROP-{dni}-N`) | text |
| `public.User.mercadoLibreAccountId` | `mercado_libre_dev.MercadoLibreUserAccount.id` | int |
| `public.PaymentIntent.id` | `public._OrderTiendaNubeToPaymentIntent.B` | int |
| `public.tienda_nube_orders.tienda_nube_id` | `public._OrderTiendaNubeToPaymentIntent.A` | bigint |
| `public.PaymentIntent.id` | `public._OrderMercadoLibreToPaymentIntent.B` | int |
| `mercado_libre_dev.OrderMercadoLibre.id` | `public._OrderMercadoLibreToPaymentIntent.A` | bigint |
| `mercado_libre_dev.OrderMercadoLibre.id` | `mercado_libre_dev.OrderItemMercadoLibre.orderId` | bigint |
| `mercado_libre_dev.OrderMercadoLibre.number` (DROP-{dni}-N) | `digip_dev.pedidos.Codigo` | text (88.6% cobertura) |
| `mercado_libre_dev.OrderMercadoLibre.id` | `mercado_libre_dev.PaymentMercadoLibre.orderId` | bigint |
| `public.PaymentIntent.paymentTransactionId` | `public.PaymentTransaction.id` | int |
| `public.PaymentTransactionOrder.paymentTransactionId` | `public.PaymentTransaction.id` | int |
| `public.PaymentTransactionOrder.orderId` (TN) | `public.tienda_nube_orders.tienda_nube_id` | bigint |
| `public.PaymentTransactionOrder.mlOrderId` (ML) | `mercado_libre_dev.OrderMercadoLibre.id` | bigint |
| `mercado_libre_dev.MercadoLibreReturn.id` | `mercado_libre_dev.MercadoLibreReturnHistory.returnId` | int |
| `mercado_libre_dev.MercadoLibreReturn.id` | `cresium.MercadoLibreRefundOrder.returnId` | int |
| `cresium.UserBankAccount.id` | `cresium.MercadoLibreRefundOrder.bankAccountId` | int |

### Linkages cross-DB (puentes Unistore ↔ Unidrop)

No hay FKs físicos entre las dos DBs (engines separados). Los puentes son lógicos:

- **Tienda Nube**: ambos sistemas guardan TN orders, pero **storefront distinto** (Unistore TN es la tienda de retail; Unidrop tiene 1.500+ tiendas de dropshippers)
- **Catálogo SKU**: el `sku` de productos en TN/ML puede ser compartido entre Unistore retail y dropshippers — sin tabla unificada
- **Contabilium**: ambos tenants son distintos (Unistore retail vs Unidrop como facturador)

---

## Schema gotchas conocidos

1. **digip Unistore tiene 3 convenciones mezcladas** (PascalCase + camelCase + lowercase). Detalles joinan por `id` integer al padre, pero transiciones de estado por `Codigo` text. Ver [memoria `digip_unistore_schema_gotchas`](../../../C:\Users\Daniel%20Marmol\.claude\projects\c--Users-Daniel-Marmol-OneDrive---Fox-Electronics-Desktop-unidata-pro\memory\digip_unistore_schema_gotchas.md).

2. **digip_dev Unidrop es un subset chico** (4 tablas, solo MELI, no TN). `orderId` siempre NULL. Join único viable: `pedidos.Codigo = OML.number`.

3. **`Pedido.PedidoEstado`** es text libre, no enum — valores reales: `pendiente`, `preparacion`, `completo`, `eliminado`. `PedidoEstadoCode` int paralelo (1/2/3/4).

4. **Convención TN order_id**: el `tienda_nube_orders.tienda_nube_id` en unidrop_api es el mismo bigint que `tienda_nube.Order.id` en unistore_api (mismo namespace global de TN), **pero corresponden a tiendas distintas** (storefront).

5. **`MELI_orders.id`** es el ML order id externo bigint — el mismo que reciben los webhooks.

6. **Refunds**: `cresium` se inserta como reemplazo de Talo solo para devoluciones, aún sin uso productivo (todas tablas vacías salvo UserBankAccount).

7. **Webhook tables crecen rápido**: `WebhookOrder` (51 MB / 15K filas) y `WebhookClaim` (8 MB / 13K) — considerar TTL / archive si la DB crece.

8. **`OrderRaw` es enorme** (427 MB) — sirve para acceder a fields que no se mapearon en `Order`, pero no usar para queries operativas frecuentes.

---

## Referencias

- [CLAUDE.md](../CLAUDE.md) — guía del proyecto + reglas de engines + áreas
- [memory/digip_unistore_schema_gotchas.md](../../../C:\Users\Daniel%20Marmol\.claude\projects\c--Users-Daniel-Marmol-OneDrive---Fox-Electronics-Desktop-unidata-pro\memory\digip_unistore_schema_gotchas.md) — convenciones digip Unistore
- [memory/digip_dev_schema.md](../../../C:\Users\Daniel%20Marmol\.claude\projects\c--Users-Daniel-Marmol-OneDrive---Fox-Electronics-Desktop-unidata-pro\memory\digip_dev_schema.md) — schema digip_dev Unidrop
- [memory/unidrop_order_schema.md](../../../C:\Users\Daniel%20Marmol\.claude\projects\c--Users-Daniel-Marmol-OneDrive---Fox-Electronics-Desktop-unidata-pro\memory\unidrop_order_schema.md) — estructura órdenes Unidrop
- [scripts/_data_inventory_unistore.txt](../scripts/_data_inventory_unistore.txt) — snapshot crudo Unistore (gitignored)
- [scripts/_data_inventory_unidrop.txt](../scripts/_data_inventory_unidrop.txt) — snapshot crudo Unidrop (gitignored)
