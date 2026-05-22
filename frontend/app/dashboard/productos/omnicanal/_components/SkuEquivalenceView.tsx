"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import Link from "next/link";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

type Proposal = {
  sku_canal: string;
  name_canal: string;
  units_canal: number;
  canal: "unidrop_ml" | "unidrop_tn";
  sku_unistore: string;
  name_unistore: string;
  units_unistore: number;
  score: string;
  match_type: string;
};

type EquivalenceResp = {
  summary: {
    period_months: number;
    min_units: number;
    uni_skus_activos: number;
    drp_ml_skus_activos: number;
    drp_tn_skus_activos: number;
    match_exacto_uni_ml: number;
    match_exacto_uni_tn: number;
    huerfanos_drp_ml: number;
    huerfanos_drp_tn: number;
    huerfanos_unistore: number;
    propuestas: number;
    propuestas_alta_confianza: number;
  };
  proposals: Proposal[];
  generated_at: string;
};

type ScoreFilter = "all" | "alta" | "media";
type CanalFilter = "all" | "unidrop_ml" | "unidrop_tn";

export function SkuEquivalenceView() {
  const [months, setMonths] = useState(6);
  const [minUnits, setMinUnits] = useState(5);
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [canalFilter, setCanalFilter] = useState<CanalFilter>("all");
  const [search, setSearch] = useState("");

  const { data, isFetching } = useQuery<EquivalenceResp>({
    queryKey: ["sku-equivalence", months, minUnits],
    queryFn: () => api(`/api/dashboards/products/sku-equivalence?period_months=${months}&min_units=${minUnits}`),
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    let p = data?.proposals ?? [];
    if (scoreFilter !== "all") p = p.filter((x) => x.score.startsWith(scoreFilter));
    if (canalFilter !== "all") p = p.filter((x) => x.canal === canalFilter);
    const s = search.trim().toLowerCase();
    if (s) {
      p = p.filter((x) =>
        x.sku_canal.toLowerCase().includes(s) ||
        x.sku_unistore.toLowerCase().includes(s) ||
        x.name_canal.toLowerCase().includes(s) ||
        x.name_unistore.toLowerCase().includes(s),
      );
    }
    return p;
  }, [data, scoreFilter, canalFilter, search]);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-fuchsia-50 to-pink-50 border border-fuchsia-200 rounded-xl p-4 flex items-start gap-3">
        <Info size={16} className="text-fuchsia-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs text-fuchsia-900">
          <strong>Qué es:</strong> Sugerencias automáticas de mapeo de SKUs cross-canal. El sistema
          identifica los SKUs <em>huérfanos</em> de Unidrop (no aparecen exacto en Unistore) y propone
          un match candidato usando: (1) match exacto post-normalización (uppercase + sin separadores),
          (2) prefijo común + nombre similar (distancia Levenshtein del nombre del producto).
          <br />
          <strong>Cómo usarlo:</strong> Revisar las propuestas <em>alta confianza</em> primero (match
          normalizado) y aceptarlas para construir una tabla canónica <code>sku_omnichannel_map</code>.
          Las <em>media confianza</em> requieren ojo humano: el match puede ser una variante (color/tamaño)
          del mismo producto o un SKU completamente distinto que comparte prefijo.
        </div>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <SummaryBox label="Unistore activos" value={formatNumber(data.summary.uni_skus_activos)} />
          <SummaryBox label="Unidrop ML activos" value={formatNumber(data.summary.drp_ml_skus_activos)} />
          <SummaryBox label="Match exacto ML" value={formatNumber(data.summary.match_exacto_uni_ml)} color="emerald" />
          <SummaryBox label="Huérfanos Drp ML" value={formatNumber(data.summary.huerfanos_drp_ml)} color="amber" />
          <SummaryBox label="Propuestas total" value={formatNumber(data.summary.propuestas)} />
          <SummaryBox label="Alta confianza" value={formatNumber(data.summary.propuestas_alta_confianza)} color="emerald" />
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-text">Propuestas de mapeo cross-canal</h3>
              <p className="text-[11px] text-text-muted">
                {formatNumber(filtered.length)} propuestas · ordenadas por volumen del canal Unidrop
              </p>
            </div>
            <ExportButtons
              filename={`sku_equivalencias_${months}m`}
              columns={["Canal", "SKU canal", "Nombre canal", "Unidades canal", "SKU Unistore", "Nombre Unistore", "Unidades Unistore", "Score", "Match type"]}
              rows={filtered.map((p) => [p.canal, p.sku_canal, p.name_canal, p.units_canal, p.sku_unistore, p.name_unistore, p.units_unistore, p.score, p.match_type])}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar SKU o nombre…"
              className="px-3 py-1.5 text-xs border border-border rounded-lg w-[260px] focus:outline-none focus:border-primary"
            />
            <Chip selected={scoreFilter === "all"} onClick={() => setScoreFilter("all")}>Todas</Chip>
            <Chip selected={scoreFilter === "alta"} onClick={() => setScoreFilter("alta")}>Alta confianza</Chip>
            <Chip selected={scoreFilter === "media"} onClick={() => setScoreFilter("media")}>Media confianza</Chip>
            <div className="w-px h-5 bg-border mx-1" />
            <Chip selected={canalFilter === "all"} onClick={() => setCanalFilter("all")}>Todos canales</Chip>
            <Chip selected={canalFilter === "unidrop_ml"} onClick={() => setCanalFilter("unidrop_ml")}>Solo Unidrop ML</Chip>
            <Chip selected={canalFilter === "unidrop_tn"} onClick={() => setCanalFilter("unidrop_tn")}>Solo Unidrop TN</Chip>
            <div className="w-px h-5 bg-border mx-1" />
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ventana</label>
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))}
              className="px-2 py-1 text-xs border border-border rounded">
              <option value={3}>3m</option>
              <option value={6}>6m</option>
              <option value={12}>12m</option>
            </select>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-bold ml-1">Mín unidades</label>
            <select value={minUnits} onChange={(e) => setMinUnits(Number(e.target.value))}
              className="px-2 py-1 text-xs border border-border rounded">
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
            </select>
            {isFetching && <span className="text-[10px] text-text-muted">Calculando…</span>}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2">Canal</th>
                <th className="text-left px-3 py-2">SKU canal</th>
                <th className="text-right px-3 py-2">Unid canal</th>
                <th className="text-center w-8">→</th>
                <th className="text-left px-3 py-2">SKU Unistore candidato</th>
                <th className="text-right px-3 py-2">Unid Unistore</th>
                <th className="text-left px-3 py-2">Confianza / tipo de match</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={`${p.canal}-${p.sku_canal}-${i}`} className="border-t border-border hover:bg-soft/40">
                  <td className="px-3 py-1.5">
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${
                      p.canal === "unidrop_ml" ? "text-amber-700 bg-amber-50 border-amber-200"
                                               : "text-purple-700 bg-purple-50 border-purple-200"
                    }`}>
                      {p.canal === "unidrop_ml" ? "Drp ML" : "Drp TN"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium truncate max-w-[260px]" title={p.name_canal}>{p.name_canal}</div>
                    <div className="text-[9px] text-text-muted/70 font-mono">{p.sku_canal}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(p.units_canal)}</td>
                  <td className="text-center text-text-muted/50">→</td>
                  <td className="px-3 py-1.5">
                    <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_unistore)}`}
                      className="text-primary hover:underline font-medium truncate max-w-[260px] block">{p.name_unistore}</Link>
                    <div className="text-[9px] text-text-muted/70 font-mono">{p.sku_unistore}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(p.units_unistore)}</td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded border mr-2 ${
                      p.score.startsWith("alta") ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                                 : "text-amber-700 bg-amber-50 border-amber-200"
                    }`}>
                      {p.score.startsWith("alta") ? "Alta" : "Media"}
                    </span>
                    <span className="text-text-muted text-[10px]">{p.match_type}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !isFetching && (
                <tr><td colSpan={7} className="text-center py-10 text-text-muted">Sin propuestas con esos filtros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={"px-2.5 py-1 text-[11px] rounded-md transition border " +
        (selected ? "bg-primary text-white border-primary" : "bg-soft text-text-muted border-transparent hover:border-primary/40")}
    >
      {children}
    </button>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color?: "emerald" | "amber" }) {
  const accent = color === "emerald" ? "border-emerald-300 bg-emerald-50/40"
    : color === "amber" ? "border-amber-300 bg-amber-50/40"
    : "border-border";
  return (
    <div className={`bg-surface border ${accent} rounded-xl p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className="text-2xl font-extrabold text-text mt-1 tabular-nums">{value}</div>
    </div>
  );
}
