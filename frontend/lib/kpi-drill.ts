import type { KpiDrill } from "@/components/kpi-card";

type Ctx = {
  period?: string;
  channel?: string;
  segment?: string;
  modelo?: string;
  unit?: string;
  plan?: string;
  customFrom?: string | null;
  customTo?: string | null;
};

function qs(extra: Record<string, string | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

/**
 * Returns a drill spec for a known KPI card label, or undefined if unknown.
 * Match is by lowercase substring on label. Order matters (more specific first).
 */
export function getCardDrill(label: string, ctx: Ctx = {}): KpiDrill | undefined {
  const lc = label.toLowerCase();
  const period = ctx.period ?? "30d";
  const fromTo = qs({ from: ctx.customFrom, to: ctx.customTo });
  const seg = ctx.segment ?? "all";

  // SaaS / Unidrop users
  if (lc.includes("usuarios totales")) return { endpoint: `/api/drilldowns/saas/users-all${qs({ segment: seg })}`, title: "Usuarios totales", subtitle: "Fuente: users.db · tabla User (Unidrop) · todos los registros", filename: "usuarios.csv" };
  if (lc.includes("suscripciones activas")) return { endpoint: `/api/drilldowns/saas/users-active${qs({ segment: seg })}`, title: "Suscripciones activas", subtitle: "Fuente: users.db · User con suscripción activa (no vencida)", filename: "subs_activas.csv" };
  if (lc.includes("nuevos usuarios") || lc.includes("usuarios nuevos")) return { endpoint: `/api/drilldowns/saas/users-new${qs({ period, segment: seg, from: ctx.customFrom, to: ctx.customTo })}`, title: `Nuevos usuarios (${period})`, subtitle: `Fuente: users.db · User.createdAt en el período · segmento: ${seg}`, filename: `nuevos_${period}.csv` };
  if (lc.includes("usuarios churneados") || lc.includes("churn")) return { endpoint: `/api/drilldowns/saas/users-churned${qs({ period, segment: seg, from: ctx.customFrom, to: ctx.customTo })}`, title: "Usuarios en churn", subtitle: "Fuente: users.db · suscripción vencida o cancelada en el período", filename: `churn_${period}.csv` };
  if (lc.includes("vencer")) return { endpoint: `/api/drilldowns/saas/users-expiring${qs({ days: "7", segment: seg })}`, title: "Suscripciones a vencer (7 dias)", subtitle: "Fuente: users.db · expiresAt <= hoy + 7 días · aún activas", filename: "vencer_7d.csv" };
  if (lc.includes("tiendas")) return { endpoint: `/api/drilldowns/saas/tn-credentials`, title: "Tiendas TN conectadas", subtitle: "Fuente: TiendaNubeCredential (Unidrop) · credenciales de tiendas activas", filename: "tiendas_tn.csv" };

  // UNIDROP cards (deben matchear ANTES que el catch-all de gmv abajo, que va a Unistore)
  if (lc.includes("facturado a unidrop")) {
    return { endpoint: `/api/drilldowns/unidrop/intents-processed${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Facturado a Unidrop (${period})`, subtitle: "Fuente: PaymentIntent (Talo) · status=PROCESSED · GMV = transaction_amount", filename: `unidrop_facturado_${period}.csv` };
  }
  if (lc.includes("ordenes cobradas via talo")) {
    return { endpoint: `/api/drilldowns/unidrop/intents-processed${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes cobradas via Talo (${period})`, subtitle: "Fuente: PaymentIntent (Talo) · status=PROCESSED · una fila por intent (puede incluir varias órdenes)", filename: `unidrop_cobradas_${period}.csv` };
  }
  if ((lc.includes("gmv") && (lc.includes("dropshipper") || lc.includes("unidrop"))) && lc.includes("tn")) {
    return { endpoint: `/api/drilldowns/unidrop/orders-tn${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes TN dropshippers Unidrop (${period})`, subtitle: "Fuente: tienda_nube_orders (unidrop_api) · payment_status='paid' · enriquecido con datos del dropshipper", filename: `unidrop_tn_${period}.csv` };
  }
  if ((lc.includes("gmv") && (lc.includes("dropshipper") || lc.includes("unidrop"))) && lc.includes("ml")) {
    return { endpoint: `/api/drilldowns/unidrop/orders-ml${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes ML dropshippers Unidrop (${period})`, subtitle: "Fuente: OrderMercadoLibre (unidrop_api) · estado=paid · enriquecido con User del dropshipper", filename: `unidrop_ml_${period}.csv` };
  }
  if (lc.includes("gmv unidrop") || (lc.includes("gmv") && lc.includes("unidrop"))) {
    return { endpoint: `/api/drilldowns/unidrop/intents-processed${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `GMV Unidrop · cobranzas Talo (${period})`, subtitle: "Fuente: PaymentIntent (Talo) · status=PROCESSED · fuente canónica de GMV Unidrop (no TN ni ML directamente)", filename: `unidrop_gmv_${period}.csv` };
  }

  // TN orders Unistore (el catch-all gmv solo entra para cards que NO son Unidrop)
  if (lc.includes("gmv") || lc.includes("revenue") && !lc.includes("operativa") && !lc.includes("contabilium")) {
    return { endpoint: `/api/drilldowns/orders/paid${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes pagas Unistore (${period})`, subtitle: "Fuente: tienda_nube.Order · paymentStatus='paid' · Unistore (no Unidrop)", filename: `orders_paid_${period}.csv` };
  }
  if (lc.startsWith("ordenes") || lc === "ordenes" || lc.includes("ordenes unistore")) {
    return { endpoint: `/api/drilldowns/orders/all${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes (${period})`, subtitle: "Fuente: tienda_nube.Order · todos los estados · Unistore", filename: `orders_${period}.csv` };
  }
  if (lc.includes("ticket promedio") || lc.startsWith("aov")) {
    return { endpoint: `/api/drilldowns/orders/paid${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes que componen el AOV (${period})`, subtitle: "Fuente: tienda_nube.Order · paymentStatus='paid' · AOV = GMV / cant. órdenes", filename: `aov_${period}.csv` };
  }
  if (lc.includes("% pago confirmado")) {
    return { endpoint: `/api/drilldowns/orders/all${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes del periodo (${period})`, subtitle: "Fuente: tienda_nube.Order · % = pagas / total · todos los estados incluidos", filename: `orders_${period}.csv` };
  }
  if (lc.includes("% cancel") || lc.includes("tasa de cancelacion")) {
    return { endpoint: `/api/drilldowns/orders/cancelled${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes canceladas (${period})`, subtitle: "Fuente: tienda_nube.Order · status='cancelled' · tasa = canceladas / total", filename: `cancelled_${period}.csv` };
  }
  if (lc.includes("pedidos atascados") || lc.includes("stuck")) {
    return { endpoint: `/api/drilldowns/orders/stuck`, title: "Pedidos atascados (paid sin fulfillment > 5 dias)", subtitle: "Fuente: tienda_nube.Order · paymentStatus='paid' + shippingStatus IN ('ready','pending') + createdAt > 5 días", filename: "stuck.csv" };
  }
  if (lc.includes("pedidos pendientes")) {
    return { endpoint: `/api/drilldowns/orders/stuck`, title: "Pedidos pendientes", subtitle: "Fuente: tienda_nube.Order · pagados sin despacho (fulfillment pendiente)", filename: "pending.csv" };
  }

  // Products
  if (lc.includes("productos publicados")) {
    return { endpoint: `/api/drilldowns/products/published`, title: "Productos publicados", subtitle: "Fuente: tienda_nube.products (Unistore) · status='active'", filename: "products_pub.csv" };
  }
  if (lc.includes("sin movimiento")) {
    return { endpoint: `/api/drilldowns/products/no-movement?days=90`, title: "SKUs sin movimiento (>90d)", subtitle: "Fuente: tienda_nube.OrderItem · SKUs sin aparición en órdenes pagas en los últimos 90 días", filename: "sin_mov.csv" };
  }
  if (lc.includes("stock critico")) {
    return { endpoint: `/api/drilldowns/products/stock-critico`, title: "SKUs con stock critico (<= 5)", subtitle: "Fuente: tienda_nube.products (Unistore) · stock actual <= 5 unidades", filename: "stock_critico.csv" };
  }

  // Talo / Pagos
  if (lc.includes("cobrado") || lc.includes("volumen pagos") || lc.includes("volumen procesado") || lc.includes("talo")) {
    return { endpoint: `/api/drilldowns/talo/transactions${qs({ period, status: "paid", from: ctx.customFrom, to: ctx.customTo })}`, title: `Pagos Talo cobrados (${period})`, subtitle: "Fuente: PaymentIntent (Talo / unidrop_api) · status=PROCESSED · monto acreditado real", filename: `talo_${period}.csv` };
  }
  if (lc.includes("pendiente de cobro") || lc.includes("intents creados")) {
    return { endpoint: `/api/drilldowns/talo/transactions${qs({ period, status: "pending", from: ctx.customFrom, to: ctx.customTo })}`, title: `Pagos Talo pendientes (${period})`, subtitle: "Fuente: PaymentIntent (Talo / unidrop_api) · status=PENDING · aún no acreditados", filename: `talo_pend_${period}.csv` };
  }
  if (lc.includes("refunds") || lc.includes("reembols") || lc.includes("intents cancelados")) {
    return { endpoint: `/api/drilldowns/talo/transactions${qs({ period, status: "refunded", from: ctx.customFrom, to: ctx.customTo })}`, title: `Refunds / cancelados (${period})`, subtitle: "Fuente: PaymentIntent (Talo / unidrop_api) · status=REFUNDED o CANCELLED", filename: `refunds_${period}.csv` };
  }

  // Subscriptions MELI
  if (lc.includes("usuarios activos en plan") || lc.includes("mrr")) {
    return { endpoint: `/api/drilldowns/subs-meli/active${qs({ plan: ctx.plan })}`, title: "Suscripciones MELI activas (MRR)", subtitle: "Fuente: mercado_libre.Subscription (Unistore) · estado=active · MRR = suma fee mensual", filename: "subs_meli.csv" };
  }

  // Devoluciones
  if (lc.includes("total devoluciones") || lc.includes("devoluciones mes") || lc === "devoluciones" || (lc.includes("devolucion") && !lc.includes("monto") && !lc.includes("abiertas") && !lc.includes("resueltas"))) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Devoluciones (${period})`, subtitle: "Fuente: tabla devoluciones (Unidev) · tickets de retiro, garantía o cambio ingresados en el período", filename: `devoluciones_${period}.csv` };
  }
  if (lc.includes("monto") && (lc.includes("devolucion") || lc.includes("dev"))) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Monto de devoluciones (${period})`, subtitle: "Fuente: tabla devoluciones (Unidev) · suma del valor de mercadería devuelta en el período", filename: `monto_devoluciones_${period}.csv` };
  }
  if (lc.includes("abiertas") || lc.includes("pendientes")) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period: "90d", modelo: ctx.modelo })}`, title: `Devoluciones abiertas (actualmente)`, filename: `dev_abiertas.csv`, subtitle: "Fuente: tabla devoluciones (Unidev) · estado abierto/pendiente · sin filtro de período (últimos 90d)" };
  }
  if (lc.includes("resueltas") || lc.includes("cerradas")) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Devoluciones resueltas`, subtitle: "Fuente: tabla devoluciones (Unidev) · estado cerrado/resuelto en el período", filename: `dev_resueltas.csv` };
  }

  // Vencimiento de suscripciones (Unidrop)
  if (lc.includes("vencen") || lc.includes("vence")) {
    const days = lc.match(/<\s*(\d+)\s*d/)?.[1] ?? "15";
    return { endpoint: `/api/drilldowns/saas/users-expiring${qs({ days, segment: seg })}`, title: `Suscripciones a vencer (${days}d)`, subtitle: `Fuente: users.db · User.expiresAt entre hoy y hoy + ${days} días`, filename: `vencer_${days}d.csv` };
  }

  // Orders mes (Salud Unistore)
  if (lc.includes("orders") || lc.includes("órdenes") || lc.includes("ordenes mes")) {
    return { endpoint: `/api/drilldowns/orders/all${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes (${period})`, subtitle: "Fuente: tienda_nube.Order (Unistore) · todos los estados", filename: `orders_${period}.csv` };
  }

  return undefined;
}
