"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquare, AlertTriangle, Search } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type EnumRow = { motivo: string; count: number; revenue_perdido: number };
type Cluster = {
  cluster: string;
  count: number;
  revenue_perdido: number;
  samples: { orden_id: number; fecha: string | null; nota: string; monto: number }[];
};
type SinClasif = { orden_id: number; fecha: string | null; nota: string; monto: number };

type Resp = {
  total_cancelaciones_90d: number;
  total_revenue_perdido: number;
  by_enum: EnumRow[];
  by_cluster_nlp: Cluster[];
  sin_clasificar: SinClasif[];
  metodo: string;
};

export default function CancelNlpPage() {
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["cancel-nlp"],
    queryFn: () => api("/api/dashboards/cancel-nlp"),
    staleTime: 10 * 60_000,
  });

  return (
    <>
      <Topbar
        title="Cancelaciones · Análisis de motivos"
        subtitle="Clustering de razones de cancelación · 90 días"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 rounded-xl p-5 mb-6">
          <div className="text-sm font-bold text-rose-900 mb-1">¿Qué muestra?</div>
          <div className="text-xs text-rose-800/90 leading-relaxed">
            Dos vistas: (1) <strong>Motivo enum</strong> de TN (lo que pone el operador en el dropdown) y (2) <strong>Cluster NLP</strong> que aplica un lexicon manual sobre las notas libres del cliente/staff.
            <br />
            <strong>Acción</strong>: si un cluster sube mes a mes (ej. "Demora en envío"), atacar la causa. Si "Producto incorrecto" es top, revisar las imágenes y descripciones de los SKUs más cancelados.
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            <SummaryCard label="Cancelaciones 90d" value={formatNumber(data.total_cancelaciones_90d)} color="from-rose-500 to-pink-500" />
            <SummaryCard label="Revenue perdido" value={formatCurrency(data.total_revenue_perdido)} color="from-red-500 to-rose-500" />
            <SummaryCard label="Sin clasificar (notas libres)" value={String(data.sin_clasificar.length)} color="from-zinc-500 to-zinc-600" />
          </div>
        )}

        {isLoading && (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        )}

        {data && (
          <>
            {/* CLUSTERS NLP */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-bold text-text inline-flex items-center gap-2">
                    <MessageSquare size={14} /> Clusters NLP sobre notas libres
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">{data.metodo}</div>
                </div>
                <ExportButtons
                  filename="cancelaciones_clusters_nlp"
                  columns={["Cluster", "Cantidad", "Revenue perdido"]}
                  rows={data.by_cluster_nlp.map((c) => [c.cluster, c.count, c.revenue_perdido])}
                />
              </div>
              {data.by_cluster_nlp.length === 0 ? (
                <div className="p-8 text-center text-text-muted text-sm">
                  Sin notas libres clasificables. Probá agregar más palabras clave al lexicon en backend/services/cancel_nlp.py.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {data.by_cluster_nlp.map((c) => (
                    <div key={c.cluster} className="p-4">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                        <div className="font-bold text-text">{c.cluster}</div>
                        <div className="text-xs text-text-muted">
                          <strong className="text-text">{c.count}</strong> casos · <strong className="text-rose-700">{formatCurrency(c.revenue_perdido)}</strong> perdidos
                        </div>
                      </div>
                      {c.samples.length > 0 && (
                        <div className="space-y-1.5 mt-2">
                          {c.samples.map((s, i) => (
                            <div key={i} className="text-[11px] text-text-muted bg-soft/40 rounded px-2 py-1.5 italic border-l-2 border-rose-300">
                              "{s.nota}" — orden {s.orden_id} · {formatCurrency(s.monto)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ENUM TN */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-bold text-text">Motivos enum (campo oficial de TN)</div>
                <ExportButtons
                  filename="cancelaciones_motivos_tn"
                  columns={["Motivo", "Cantidad", "Revenue perdido"]}
                  rows={data.by_enum.map((e) => [e.motivo, e.count, e.revenue_perdido])}
                />
              </div>
              <table className="w-full text-sm">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-2">Motivo</th>
                    <th className="text-right px-4 py-2">Cantidad</th>
                    <th className="text-right px-4 py-2">Revenue perdido</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_enum.map((e) => (
                    <tr key={e.motivo} className="border-t border-border hover:bg-soft transition">
                      <td className="px-4 py-2.5 font-mono text-xs">{e.motivo}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(e.count)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">{formatCurrency(e.revenue_perdido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* SIN CLASIFICAR */}
            {data.sin_clasificar.length > 0 && (
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-bold text-text inline-flex items-center gap-2">
                      <Search size={14} /> Notas sin clasificar (top 20)
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">Para revisar manualmente y agregar al lexicon</div>
                  </div>
                  <ExportButtons
                    filename="cancelaciones_sin_clasificar"
                    columns={["Orden", "Fecha", "Nota", "Monto"]}
                    rows={data.sin_clasificar.map((s) => [s.orden_id, s.fecha, s.nota, s.monto])}
                  />
                </div>
                <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                  {data.sin_clasificar.map((s, i) => (
                    <div key={i} className="p-3 text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-text-muted">#{s.orden_id} · {s.fecha}</span>
                        <span className="text-rose-700 font-semibold">{formatCurrency(s.monto)}</span>
                      </div>
                      <div className="text-text-muted italic mt-1">"{s.nota}"</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} text-white flex items-center justify-center shadow-md mb-2`}>
        <AlertTriangle size={18} />
      </div>
      <div className="text-2xl font-extrabold text-text tabular-nums">{value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  );
}
