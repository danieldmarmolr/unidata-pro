"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { tnAdminUrl, fmtArDateTime } from "@/lib/dates";
import { OrderStatusPipeline } from "@/components/order-status-pipeline";

/**
 * Fila de orden expandible con el formato canonico de UNIDATA:
 *  - Numero de orden con link al admin de TN
 *  - Fecha
 *  - Pipeline visual de 5 estados (Recibida → Pagada → Empaquetada → Enviada → Recibida)
 *  - Total
 *  - Click despliega los items con imagen + SKU + cantidad + precio + total
 *
 * Se usa identico en Customer 360 (Ordenes ultimas 50) y en CS (Cancelaciones
 * recientes) para consistencia visual cross-feature. Si en algun momento
 * necesitamos diferenciar Unistore vs Unidrop, ya estamos en un componente
 * unico y se decide aca.
 */

export type OrderRowData = {
  /** Internal TN order id (sirve para /api/drilldowns/orders/{id}/detail) */
  id: number;
  /** Numero visible (#XXX) - normalmente order_number, sino fallback a id */
  numero: string;
  fecha: string | null;
  total: number;
  payment?: string | null;
  shipping?: string | null;
  /** Status general TN (cancelled / open / closed) */
  status?: string | null;
  /** True si paso por DespachoPedido (digip) */
  empaquetada?: boolean | null;
  /** Canal de envio (ej: "OCA", "Retiro presencial", "Producto Digital") — determina flujo del pipeline */
  canal?: string | null;
  /** Subtitulo opcional - aparece chiquito abajo del numero (ej: razon de cancelacion, provincia, dias hace) */
  subtitle?: string | null;
  /** Si se provee, el subtitle se renderiza como link a esta URL */
  subtitleHref?: string | null;
  /** Chip extra a la derecha (ej: "STAFF") - opcional */
  badge?: { label: string; cls: string } | null;
  /** Método de pago TN (ej: "Pago Nube - Transferencia o depósito") — agrega una td extra */
  metodo_pago?: string | null;
  /** Ganancia estimada = revenue - costo lotes. null = sin datos de costo */
  ganancia?: number | null;
};

type OrderItem = {
  id: number;
  name: string;
  sku: string | null;
  quantity: number;
  price: number;
  subtotal: number;
  imagen?: string | null;
};

export function ExpandableOrderRow({
  order,
  idx,
  onOpenDetail,
  cols = 6,
  extraCells,
}: {
  order: OrderRowData;
  idx: number;
  onOpenDetail?: (id: number) => void;
  /** Cantidad de columnas que ocupa la fila expandida. Default 6. */
  cols?: number;
  /** Celdas extras inyectadas entre "Estado del pedido" y "Total orden".
   * Las usa la tabla de SKU 360 para mostrar Markup $ / Markup % / % infl
   * del SKU especifico en cada pedido. */
  extraCells?: import("react").ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const orderId = order.id;
  const hasPago = order.metodo_pago !== undefined;
  const hasGanancia = order.ganancia !== undefined;

  const orderDetail = useQuery<{ items: OrderItem[] }>({
    queryKey: ["order-items-with-img", orderId],
    queryFn: () => api(`/api/drilldowns/orders/${orderId}/detail`),
    enabled: open && !!orderId,
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <tr
        className={"border-t border-border hover:bg-soft transition cursor-pointer " + (open ? "bg-soft" : "")}
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-3 py-2 align-middle text-text-muted text-xs">{idx}</td>
        <td className="px-3 py-2 align-middle">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
            <a
              href={tnAdminUrl(orderId)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-mono font-semibold text-primary hover:underline inline-flex items-center gap-1"
              title="Abrir orden en Tienda Nube admin"
            >
              #{order.numero}
              <ExternalLink size={10} className="opacity-70" />
            </a>
            {order.badge && (
              <span className={"inline-block text-[10px] px-1.5 py-0.5 rounded-full border font-bold " + order.badge.cls}>
                {order.badge.label}
              </span>
            )}
          </div>
          {order.subtitle && (
            <div className="text-[10px] text-text-muted mt-0.5 ml-5">
              {order.subtitleHref ? (
                <button
                  onClick={(e) => { e.stopPropagation(); router.push(order.subtitleHref!); }}
                  className="hover:text-primary hover:underline transition"
                >
                  {order.subtitle}
                </button>
              ) : order.subtitle}
            </div>
          )}
        </td>
        <td className="px-3 py-2 align-middle text-xs text-text-muted whitespace-nowrap">{fmtArDateTime(order.fecha)}</td>
        {hasPago && (
          <td className="px-3 py-2 align-middle max-w-[140px]">
            <span className="text-[11px] text-text-muted truncate block" title={order.metodo_pago ?? ""}>
              {order.metodo_pago || "—"}
            </span>
          </td>
        )}
        <td className="px-3 py-2 align-middle">
          <OrderStatusPipeline
            payment={order.payment}
            shipping={order.shipping}
            orderStatus={order.status}
            packed={order.empaquetada ?? false}
            canal={order.canal}
            compact
          />
        </td>
        {extraCells}
        <td className="px-3 py-2 align-middle text-right font-bold tabular-nums">{formatCurrency(order.total)}</td>
        {hasGanancia && (
          <td className="px-3 py-2 align-middle text-right tabular-nums text-xs font-semibold">
            {order.ganancia == null ? (
              <span className="text-text-muted">—</span>
            ) : order.ganancia >= 0 ? (
              <span className="text-emerald-600">{formatCurrency(order.ganancia)}</span>
            ) : (
              <span className="text-red-500">{formatCurrency(order.ganancia)}</span>
            )}
          </td>
        )}
        {onOpenDetail && (
          <td className="px-3 py-2 align-middle text-center">
            <button
              onClick={(ev) => { ev.stopPropagation(); onOpenDetail(orderId); }}
              className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary"
              title="Abrir detalle completo"
            >
              <ExternalLink size={12} />
            </button>
          </td>
        )}
      </tr>
      {open && (
        <tr>
          <td colSpan={cols} className="bg-bg border-t border-border p-0">
            <div className="px-12 py-4">
              {orderDetail.isLoading ? (
                <div className="text-text-muted text-sm py-4">Cargando items...</div>
              ) : orderDetail.data?.items && orderDetail.data.items.length > 0 ? (
                <>
                  <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                    Producto · Unidades · Precio unitario · Total
                  </div>
                  <div className="space-y-1">
                    {orderDetail.data.items.map((it) => (
                      <a
                        key={it.id}
                        href={it.sku ? `/dashboard/productos/${encodeURIComponent(it.sku)}` : "#"}
                        target={it.sku ? "_blank" : undefined}
                        rel="noopener noreferrer"
                        className="grid grid-cols-[48px_1fr_60px_100px_100px] gap-3 items-center px-2 py-2 rounded hover:bg-soft transition"
                      >
                        <div className="w-12 h-12 rounded border border-border bg-soft overflow-hidden flex items-center justify-center">
                          {it.imagen ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.imagen} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
                          ) : <span className="text-[9px] text-text-muted">sin img</span>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-primary truncate">{it.name}</div>
                          {it.sku && <div className="text-[10px] text-text-muted font-mono">SKU {it.sku}</div>}
                        </div>
                        <div className="text-xs text-text text-right tabular-nums">{it.quantity}x</div>
                        <div className="text-xs text-text-muted text-right tabular-nums">{formatCurrency(it.price)}</div>
                        <div className="text-xs font-semibold text-text text-right tabular-nums">{formatCurrency(it.subtotal)}</div>
                      </a>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-text-muted text-sm py-4">Sin items disponibles.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
