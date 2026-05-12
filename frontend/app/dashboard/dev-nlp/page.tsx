"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, MessageSquare, Package, TrendingDown, RotateCcw } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Sample = {
  descripcion: string;
  sku: string;
  cantidad: number;
  fecha: string | null;
  estado: string;
  resolucion?: string;
};
type Cluster = {
  cluster: string;
  count_items: number;
  count_unidades: number;
  monto_total: number;
  skus_distintos: number;
  top_skus: { sku: string; unidades: number }[];
  samples: Sample[];
};
type Sin = {
  descripcion: string;
  sku: string;
  cantidad: number;
  fecha: string | null;
  estado: string;
};
type Resp = {
  period_days: number;
  total_items_analizados: number;
  total_unidades: number;
  total_monto: number;
  clusters: Cluster[];
  sin_clasificar: Sin[];
  metodo: string;
};

const PERIOD_OPTS = [
  { value: 30, label: "30 dias" },
  { value: 60, label: "60 dias" },
  { value: 90, label: "90 dias" },
  { value: 180, label: "180 dias" },
  { value: 365, label: "1 año" },
];

export default function DevNlpPage() {
  const [periodDays, setPeriodDays] = useState(90);
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["dev-nlp", periodDays],
    queryFn: () => api(`/api/dashboards/dev-nlp?period_days=${periodDays}`),
    staleTime: 10 * 60_000,
  });

  return (
    <>
      <Topbar
        title="NLP Devoluciones · Análisis de causas"
        subtitle="Clustering de causas de devoluciones · Unidev · lexicon manual"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* Header explicativo */}
        <div className="bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 rounded-xl p-5 mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[300px]">
            <div className="text-sm font-bold text-rose-900 mb-1">¿Qué muestra?</div>
            <div className="text-xs text-rose-800/90 leading-relaxed">
              Aplica clustering por palabras clave a las descripciones de fallas (texto libre de Unidev).
              Identifica patrones operativos: <strong>defectos</strong>, <strong>daño en envío</strong>,
              <strong> talle/color erróneo</strong>, <strong>calidad baja</strong>, etc.
              <br />
              <strong>Acción</strong>: si un cluster sube vs mes pasado (ej. "Llegó dañado"), revisar
              empaquetado o courier. Si "Producto defectuoso" sube en un SKU específico → problema de lote.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] uppercase tracking-wider font-bold text-rose-900">Periodo</label>
            <select
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
              className="px-3 py-1.5 text-xs border border-rose-300 rounded-lg bg-white"
            >
              {PERIOD_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* KPIs cabecera */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard icon={MessageSquare} label="Items con causa" value={formatNumber(data.total_items_analizados)} color="from-rose-500 to-pink-500" />
            <SummaryCard icon={Package} label="Unidades devueltas" value={formatNumber(data.total_unidades)} color="from-rose-600 to-rose-700" />
            <SummaryCard icon={TrendingDown} label="Monto involucrado" value={formatCurrency(data.total_monto)} color="from-red-500 to-rose-500" />
            <SummaryCard icon={AlertTriangle} label="Sin clasificar" value={String(data.sin_clasificar.length)} color="from-amber-500 to-orange-500" />
          </div>
        )}

        {isLoading && (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        )}

        {data && (
          <>
            {/* CLUSTERS */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-bold text-text inline-flex items-center gap-2">
                    <MessageSquare size={14} /> Clusters de causas detectados
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">{data.metodo}</div>
                </div>
                <ExportButtons
                  filename={`dev_nlp_clusters_${periodDays}d`}
                  columns={["Cluster", "Items", "Unidades", "Monto", "SKUs distintos"]}
                  rows={data.clusters.map((c) => [c.cluster, c.count_items, c.count_unidades, c.monto_total, c.skus_distintos])}
                />
              </div>
              {data.clusters.length === 0 ? (
                <div className="p-8 text-center text-text-muted text-sm">
                  Sin causas clasificables en el periodo. Probá ampliar el periodo o revisar el lexicon en backend/services/dev_nlp.py.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {data.clusters.map((c) => (
                    <ClusterRow key={c.cluster} c={c} />
                  ))}
                </div>
              )}
            </div>

            {/* SIN CLASIFICAR */}
            {data.sin_clasificar.length > 0 && (
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-bold text-text">Descripciones sin clasificar (top 20)</div>
                    <div className="text-[11px] text-text-muted mt-0.5">Para revisar manualmente y agregar al lexicon</div>
                  </div>
                  <ExportButtons
                    filename={`dev_nlp_sin_clasificar_${periodDays}d`}
                    columns={["Descripcion", "SKU", "Cantidad", "Fecha", "Estado"]}
                    rows={data.sin_clasificar.map((s) => [s.descripcion, s.sku, s.cantidad, s.fecha, s.estado])}
                  />
                </div>
                <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                  {data.sin_clasificar.map((s, i) => (
                    <div key={i} className="p-3 text-xs">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="font-mono text-text-muted">
                          {s.sku ? `SKU ${s.sku}` : "(sin SKU)"} · {s.fecha || "—"} · {s.cantidad}u
                        </div>
                        <span className="text-rose-700 font-semibold text-[10px]">{s.estado || "—"}</span>
                      </div>
                      <div className="text-text-muted italic mt-1">"{s.descripcion}"</div>
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

function ClusterRow({ c }: { c: Cluster }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-4 hover:bg-soft/30 transition">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <button
          onClick={() => setExpanded((x) => !x)}
          className="font-bold text-text text-left hover:underline cursor-pointer inline-flex items-center gap-1"
        >
          <RotateCcw size={12} className="text-rose-600" /> {c.cluster}
          <span className="text-[10px] text-text-muted ml-2">
            {expanded ? "(ocultar muestras)" : "(ver muestras)"}
          </span>
        </button>
        <div className="text-xs text-text-muted">
          <strong className="text-text">{formatNumber(c.count_items)}</strong> items ·{" "}
          <strong className="text-text">{formatNumber(c.count_unidades)}</strong> unid ·{" "}
          <strong className="text-rose-700">{formatCurrency(c.monto_total)}</strong> ·{" "}
          <strong className="text-text">{c.skus_distintos}</strong> SKUs
        </div>
      </div>

      {/* Top SKUs en este cluster */}
      {c.top_skus.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {c.top_skus.map((sk) => (
            <Link
              key={sk.sku}
              href={`/dashboard/productos/${encodeURIComponent(sk.sku)}`}
              className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-900 transition"
              title={`Ver SKU ${sk.sku}`}
            >
              {sk.sku} <span className="text-rose-700 font-bold">×{sk.unidades}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Muestras de descripciones */}
      {expanded && c.samples.length > 0 && (
        <div className="space-y-1.5 mt-3 pl-4 border-l-2 border-rose-200">
          {c.samples.map((s, i) => (
            <div key={i} className="text-[11px] text-text-muted bg-rose-50/40 rounded px-2 py-1.5 italic">
              "{s.descripcion}"
              <div className="not-italic text-[10px] mt-0.5">
                SKU <span className="font-mono">{s.sku || "—"}</span> · {s.cantidad}u · {s.fecha || "?"} · {s.estado} {s.resolucion ? `→ ${s.resolucion}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} text-white flex items-center justify-center shadow-md mb-2`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-extrabold text-text tabular-nums">{value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  );
}
