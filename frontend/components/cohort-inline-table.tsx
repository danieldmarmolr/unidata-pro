"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { X, Download, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { ExportButtons } from "@/components/export-buttons";
import { ActionableFooter } from "@/components/actionable-footer";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { WhatsAppPhone } from "@/components/whatsapp-phone";

type Row = {
  customer_id: number;
  nombre: string;
  email?: string;
  phone?: string;
  dni?: string;
  ordenes_total?: number;
  ordenes_periodo?: number;
  revenue_periodo?: number;
  ultima_compra?: string;
  primera_compra?: string;
  dias_desde_ultima?: number;
  // Unidrop:
  ml_total?: number;
  tn_total?: number;
  ml_periodo?: number;
  tn_periodo?: number;
  fecha_alta?: string;
  vence_suscripcion?: string;
};

type Resp = {
  state?: string;
  unit?: "unistore" | "unidrop";
  customers?: Row[];
  rows?: Row[];   // fallback
  total?: number;
};

export function CohortInlineTable({
  state,
  stateLabel,
  color,
  unit,
  qs,
  onClose,
}: {
  state: string;
  stateLabel: string;
  color: string;
  unit: "unistore" | "unidrop";
  qs: string;
  onClose: () => void;
}) {
  const endpoint = `/api/dashboards/cohorts/customers?state=${encodeURIComponent(state)}&unit=${unit}&${qs}`;
  const { data, isLoading, error } = useQuery<Resp>({
    queryKey: ["cohort-customers", state, unit, qs],
    queryFn: () => api<Resp>(endpoint),
    staleTime: 30_000,
  });

  const items = data?.customers ?? data?.rows ?? [];
  const labelEntidad = unit === "unidrop" ? "dropshipper" : "cliente";
  const labelEntidadPlural = unit === "unidrop" ? "dropshippers" : "clientes";

  const detailHref = (id: number) =>
    unit === "unidrop"
      ? `/dashboard/dropshipper/${id}`
      : `/dashboard/customer/${id}`;

  const targetIds = items
    .map((r) => Number(r.customer_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const csvColumns = unit === "unidrop"
    ? ["ID", "Dropshipper", "Email", "Telefono", "Ventas ML", "Ventas TN", "Revenue periodo", "Ult. venta", "Dias desde ult."]
    : ["ID", "Cliente", "Email", "Telefono", "Ordenes (total)", "Ordenes (periodo)", "Revenue periodo", "Ult. compra", "Dias desde ult."];

  const csvRows = items.map((r) =>
    unit === "unidrop"
      ? [r.customer_id, r.nombre, r.email || "", r.phone || "", r.ml_total ?? 0, r.tn_total ?? 0, r.revenue_periodo ?? 0, r.ultima_compra || "", r.dias_desde_ultima ?? ""]
      : [r.customer_id, r.nombre, r.email || "", r.phone || "", r.ordenes_total ?? 0, r.ordenes_periodo ?? 0, r.revenue_periodo ?? 0, r.ultima_compra || "", r.dias_desde_ultima ?? ""]
  );

  const suggestedAction = (() => {
    switch (state) {
      case "posible_churn":
        return "Contactar por WhatsApp para reactivar. Recordar producto / ofrecer cupon / preguntar feedback. Plazo: 7 dias.";
      case "perdidos":
        return "Campania de winback. Asunto: 'Te extranamos' + descuento agresivo. Si no responde en 14 dias, marcar como churn confirmado.";
      case "nuevo":
        return "Onboarding: agradecer la compra, asegurar buena experiencia, pedir review.";
      case "segunda_compra":
        return "Reforzar relacion - 2da compra es el momento clave para convertir a recurrente. Programa de fidelidad / discount en 3ra compra.";
      case "conv_recurrente":
        return "Cliente que se esta volviendo recurrente. Confirmar producto, ofrecer cross-sell, pedir testimonio.";
      case "recurrente":
        return "Top del funnel. Reconocer, premiar (envio gratis / acceso anticipado).";
      case "recuperado":
        return "Volvio despues de >180d. Entender por que se fue - encuesta corta + onboarding tipo cliente nuevo.";
      default:
        return "Accionar manualmente segun contexto.";
    }
  })();

  return (
    <div
      className="bg-surface border-2 rounded-xl overflow-hidden mb-6 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200"
      style={{ borderColor: `${color}50` }}
    >
      {/* Header */}
      <div
        className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: `linear-gradient(90deg, ${color}10, transparent)` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-2.5 h-10 rounded-full flex-shrink-0"
            style={{ background: color }}
          />
          <div className="min-w-0">
            <div className="text-sm font-bold text-text">
              {stateLabel} · {labelEntidadPlural}
            </div>
            <div className="text-[11px] text-text-muted">
              {isLoading
                ? "Cargando..."
                : items.length === 0
                ? `Sin ${labelEntidadPlural} en este estado para el periodo seleccionado`
                : `${items.length} ${items.length === 1 ? labelEntidad : labelEntidadPlural} · click para abrir vista 360`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <ExportButtons
              filename={`cohort_${state}_${unit}`}
              columns={csvColumns}
              rows={csvRows}
            />
          )}
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-soft text-xs text-text-muted hover:text-text transition"
          >
            <X size={12} /> Cerrar
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[480px] overflow-y-auto">
        {error && (
          <div className="p-5 text-sm text-red-700 bg-red-50 border-t border-red-200">
            Error cargando {labelEntidadPlural}: {(error as Error).message}
          </div>
        )}

        {isLoading && !error && (
          <div className="p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-soft rounded animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && items.length === 0 && !error && (
          <div className="p-8 text-center text-text-muted text-sm">
            Sin {labelEntidadPlural} para mostrar. Probá ampliar el periodo en el filtro de arriba.
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">{unit === "unidrop" ? "Dropshipper" : "Cliente"}</th>
                <th className="text-left px-2 py-2">WhatsApp</th>
                {unit === "unidrop" ? (
                  <>
                    <th className="text-right px-2 py-2">Ventas ML</th>
                    <th className="text-right px-2 py-2">Ventas TN</th>
                  </>
                ) : (
                  <>
                    <th className="text-right px-2 py-2">Ordenes total</th>
                    <th className="text-right px-2 py-2">Ordenes periodo</th>
                  </>
                )}
                <th className="text-right px-2 py-2">Revenue periodo</th>
                <th className="text-right px-2 py-2">Ult. {unit === "unidrop" ? "venta" : "compra"}</th>
                <th className="text-right px-2 py-2">Dias</th>
                <th className="text-right px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.customer_id} className="border-t border-border hover:bg-soft/40 transition">
                  <td className="px-3 py-2">
                    <Link href={detailHref(r.customer_id)} className="block">
                      <div className="font-semibold text-primary hover:underline truncate max-w-[280px]">{r.nombre}</div>
                      {r.email && (
                        <div className="text-[10px] text-text-muted font-mono truncate max-w-[280px]">{r.email}</div>
                      )}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-[11px]">
                    {r.phone ? (
                      <WhatsAppPhone phone={r.phone} variant="chip" />
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  {unit === "unidrop" ? (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.ml_total ?? 0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.tn_total ?? 0)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.ordenes_total ?? 0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatNumber(r.ordenes_periodo ?? 0)}</td>
                    </>
                  )}
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">
                    {formatCurrency(r.revenue_periodo ?? 0)}
                  </td>
                  <td className="px-2 py-2 text-right text-text-muted">{r.ultima_compra || "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-text-muted">
                    {r.dias_desde_ultima !== undefined && r.dias_desde_ultima !== null
                      ? `${r.dias_desde_ultima}d`
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Link href={detailHref(r.customer_id)} className="inline-flex items-center text-primary opacity-60 hover:opacity-100">
                      <ExternalLink size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer accionable: crea cs_action con los target_ids del estado actual */}
      {!isLoading && items.length > 0 && (
        <ActionableFooter
          sourceType="manual"
          sourceKey={`cohort_${state}`}
          unit={unit}
          title={`Cohorte ${stateLabel} (${unit}) · ${items.length} ${labelEntidadPlural}`}
          suggestedAction={suggestedAction}
          targetIds={targetIds}
          csvFilename={`cohort_${state}_${unit}`}
          csvHeaders={csvColumns}
          csvRows={csvRows}
          accentColor={color}
          actionLabel="Generar accion CS"
        />
      )}
    </div>
  );
}
