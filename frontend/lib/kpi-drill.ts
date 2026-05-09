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
  if (lc.includes("usuarios totales")) return { endpoint: `/api/drilldowns/saas/users-all${qs({ segment: seg })}`, title: "Usuarios totales", filename: "usuarios.csv" };
  if (lc.includes("suscripciones activas")) return { endpoint: `/api/drilldowns/saas/users-active${qs({ segment: seg })}`, title: "Suscripciones activas", filename: "subs_activas.csv" };
  if (lc.includes("nuevos usuarios")) return { endpoint: `/api/drilldowns/saas/users-new${qs({ period, segment: seg, from: ctx.customFrom, to: ctx.customTo })}`, title: `Nuevos usuarios (${period})`, filename: `nuevos_${period}.csv` };
  if (lc.includes("usuarios churneados") || lc.includes("churn")) return { endpoint: `/api/drilldowns/saas/users-churned${qs({ period, segment: seg, from: ctx.customFrom, to: ctx.customTo })}`, title: "Usuarios en churn", filename: `churn_${period}.csv` };
  if (lc.includes("vencer")) return { endpoint: `/api/drilldowns/saas/users-expiring${qs({ days: "7", segment: seg })}`, title: "Suscripciones a vencer (7 dias)", filename: "vencer_7d.csv" };
  if (lc.includes("tiendas")) return { endpoint: `/api/drilldowns/saas/tn-credentials`, title: "Tiendas TN conectadas", filename: "tiendas_tn.csv" };

  // TN orders
  if (lc.includes("gmv") || lc.includes("revenue") && !lc.includes("operativa") && !lc.includes("contabilium")) {
    return { endpoint: `/api/drilldowns/orders/paid${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes pagas (${period})`, subtitle: "Click filas para ver detalle", filename: `orders_paid_${period}.csv` };
  }
  if (lc.startsWith("ordenes") || lc === "ordenes" || lc.includes("ordenes unistore")) {
    return { endpoint: `/api/drilldowns/orders/all${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes (${period})`, filename: `orders_${period}.csv` };
  }
  if (lc.includes("ticket promedio") || lc.startsWith("aov")) {
    return { endpoint: `/api/drilldowns/orders/paid${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes que componen el AOV (${period})`, filename: `aov_${period}.csv` };
  }
  if (lc.includes("% pago confirmado")) {
    return { endpoint: `/api/drilldowns/orders/all${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes del periodo (${period})`, filename: `orders_${period}.csv` };
  }
  if (lc.includes("% cancel") || lc.includes("tasa de cancelacion")) {
    return { endpoint: `/api/drilldowns/orders/cancelled${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes canceladas (${period})`, filename: `cancelled_${period}.csv` };
  }
  if (lc.includes("pedidos atascados") || lc.includes("stuck")) {
    return { endpoint: `/api/drilldowns/orders/stuck`, title: "Pedidos atascados (paid sin fulfillment > 5 dias)", filename: "stuck.csv" };
  }
  if (lc.includes("pedidos pendientes")) {
    return { endpoint: `/api/drilldowns/orders/stuck`, title: "Pedidos pendientes", filename: "pending.csv" };
  }

  // Products
  if (lc.includes("productos publicados")) {
    return { endpoint: `/api/drilldowns/products/published`, title: "Productos publicados", filename: "products_pub.csv" };
  }
  if (lc.includes("sin movimiento")) {
    return { endpoint: `/api/drilldowns/products/no-movement?days=90`, title: "SKUs sin movimiento (>90d)", filename: "sin_mov.csv" };
  }
  if (lc.includes("stock critico")) {
    return { endpoint: `/api/drilldowns/products/stock-critico`, title: "SKUs con stock critico (<= 5)", filename: "stock_critico.csv" };
  }

  // Talo / Pagos
  if (lc.includes("cobrado") || lc.includes("volumen pagos") || lc.includes("volumen procesado") || lc.includes("talo")) {
    return { endpoint: `/api/drilldowns/talo/transactions${qs({ period, status: "paid", from: ctx.customFrom, to: ctx.customTo })}`, title: `Pagos Talo cobrados (${period})`, filename: `talo_${period}.csv` };
  }
  if (lc.includes("pendiente de cobro") || lc.includes("intents creados")) {
    return { endpoint: `/api/drilldowns/talo/transactions${qs({ period, status: "pending", from: ctx.customFrom, to: ctx.customTo })}`, title: `Pagos Talo pendientes (${period})`, filename: `talo_pend_${period}.csv` };
  }
  if (lc.includes("refunds") || lc.includes("reembols") || lc.includes("intents cancelados")) {
    return { endpoint: `/api/drilldowns/talo/transactions${qs({ period, status: "refunded", from: ctx.customFrom, to: ctx.customTo })}`, title: `Refunds / cancelados (${period})`, filename: `refunds_${period}.csv` };
  }

  // Subscriptions MELI
  if (lc.includes("usuarios activos en plan") || lc.includes("mrr")) {
    return { endpoint: `/api/drilldowns/subs-meli/active${qs({ plan: ctx.plan })}`, title: "Suscripciones MELI activas (MRR)", filename: "subs_meli.csv" };
  }

  // Devoluciones
  if (lc.includes("total devoluciones") || lc.includes("devoluciones mes") || lc === "devoluciones" || (lc.includes("devolucion") && !lc.includes("monto") && !lc.includes("abiertas") && !lc.includes("resueltas"))) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Devoluciones (${period})`, filename: `devoluciones_${period}.csv` };
  }
  if (lc.includes("monto") && (lc.includes("devolucion") || lc.includes("dev"))) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Monto de devoluciones (${period})`, filename: `monto_devoluciones_${period}.csv` };
  }
  if (lc.includes("abiertas") || lc.includes("pendientes")) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Devoluciones abiertas`, filename: `dev_abiertas.csv` };
  }
  if (lc.includes("resueltas") || lc.includes("cerradas")) {
    return { endpoint: `/api/drilldowns/devoluciones/list${qs({ period, modelo: ctx.modelo, from: ctx.customFrom, to: ctx.customTo })}`, title: `Devoluciones resueltas`, filename: `dev_resueltas.csv` };
  }

  // Vencimiento de suscripciones (Unidrop)
  if (lc.includes("vencen") || lc.includes("vence")) {
    const days = lc.match(/<\s*(\d+)\s*d/)?.[1] ?? "15";
    return { endpoint: `/api/drilldowns/saas/users-expiring${qs({ days, segment: seg })}`, title: `Suscripciones a vencer (${days}d)`, filename: `vencer_${days}d.csv` };
  }

  // Orders mes (Salud Unistore)
  if (lc.includes("orders") || lc.includes("órdenes") || lc.includes("ordenes mes")) {
    return { endpoint: `/api/drilldowns/orders/all${qs({ period, from: ctx.customFrom, to: ctx.customTo })}`, title: `Ordenes (${period})`, filename: `orders_${period}.csv` };
  }

  return undefined;
}
