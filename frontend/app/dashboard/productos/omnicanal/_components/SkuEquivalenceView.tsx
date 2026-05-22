"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, ArrowRight, ImageOff, CheckCircle2, XCircle, Network } from "lucide-react";
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
  imagen_unistore: string;
  ean_unistore: string;
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
  const [actions, setActions] = useState<Record<string, "accept" | "reject">>({});

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

  const setAction = (key: string, action: "accept" | "reject" | null) => {
    setActions((prev) => {
      const next = { ...prev };
      if (action === null) delete next[key];
      else next[key] = action;
      return next;
    });
  };

  const proposalKey = (p: Proposal) => `${p.canal}|${p.sku_canal}|${p.sku_unistore}`;
  const acceptedCount = Object.values(actions).filter((a) => a === "accept").length;
  const rejectedCount = Object.values(actions).filter((a) => a === "reject").length;

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-fuchsia-50 to-pink-50 border border-fuchsia-200 rounded-xl p-4 flex items-start gap-3">
        <Info size={16} className="text-fuchsia-600 shrink-0 mt-0.5" />
        <div className="flex-1 text-xs text-fuchsia-900">
          <strong>Qué es:</strong> Sugerencias automáticas de mapeo de SKUs cross-canal. El sistema
          identifica los SKUs <em>huérfanos</em> de Unidrop (no aparecen exactos en Unistore) y propone
          un match candidato. Las cards de abajo muestran los dos productos lado a lado para que puedas
          decidir visualmente si son el mismo producto físico.
          <br />
          <strong>Cómo usarlo:</strong> Empezá por las <em>alta confianza</em> y aceptá las que veas
          obvias. Las <em>media confianza</em> requieren ojo humano: el match puede ser una variante
          (color/tamaño) del mismo producto o un SKU completamente distinto que comparte prefijo. La
          tabla canónica se persistirá en próxima iteración (las decisiones acá son visuales por ahora).
        </div>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryBox label="Unistore activos" value={formatNumber(data.summary.uni_skus_activos)} />
          <SummaryBox label="Unidrop ML activos" value={formatNumber(data.summary.drp_ml_skus_activos)} />
          <SummaryBox label="Match exacto ML" value={formatNumber(data.summary.match_exacto_uni_ml)} color="emerald" />
          <SummaryBox label="Huérfanos Drp ML" value={formatNumber(data.summary.huerfanos_drp_ml)} color="amber" />
          <SummaryBox label="Propuestas total" value={formatNumber(data.summary.propuestas)} />
          <SummaryBox label="Alta confianza" value={formatNumber(data.summary.propuestas_alta_confianza)} color="emerald" />
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-3">
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
          <div className="flex-1" />
          {data && (
            <ExportButtons
              filename={`sku_equivalencias_${months}m`}
              columns={["Canal", "SKU canal", "Nombre canal", "Unidades canal", "SKU Unistore", "Nombre Unistore", "Unidades Unistore", "EAN Unistore", "Score", "Match type", "Decisión local"]}
              rows={filtered.map((p) => [
                p.canal, p.sku_canal, p.name_canal, p.units_canal, p.sku_unistore, p.name_unistore, p.units_unistore, p.ean_unistore, p.score, p.match_type, actions[proposalKey(p)] ?? "",
              ])}
            />
          )}
        </div>

        {(acceptedCount > 0 || rejectedCount > 0) && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 text-[11px]">
            <span className="text-text-muted">Decisiones locales:</span>
            {acceptedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                <CheckCircle2 size={12} /> {acceptedCount} aceptadas
              </span>
            )}
            {rejectedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                <XCircle size={12} /> {rejectedCount} rechazadas
              </span>
            )}
            <span className="text-text-muted/60 text-[10px]">
              · Las decisiones se exportan en el CSV/XLSX. La tabla canónica `sku_omnichannel_map` se persistirá en próxima iteración.
            </span>
          </div>
        )}
      </div>

      {/* Cards visuales lado a lado */}
      <div className="grid grid-cols-1 gap-3">
        {filtered.map((p) => {
          const key = proposalKey(p);
          const action = actions[key];
          const ratio = p.units_unistore > 0 ? p.units_canal / p.units_unistore : 0;
          return (
            <ProposalCard
              key={key}
              p={p}
              action={action}
              ratio={ratio}
              onAccept={() => setAction(key, action === "accept" ? null : "accept")}
              onReject={() => setAction(key, action === "reject" ? null : "reject")}
            />
          );
        })}
        {filtered.length === 0 && !isFetching && (
          <div className="text-center py-10 text-text-muted bg-surface border border-border rounded-xl">
            <Network size={32} className="mx-auto text-text-muted/40 mb-2" />
            Sin propuestas con esos filtros. Probá relajar los filtros o bajar el mínimo de unidades.
          </div>
        )}
      </div>
    </div>
  );
}

function ProposalCard({
  p, action, ratio, onAccept, onReject,
}: {
  p: Proposal;
  action: "accept" | "reject" | undefined;
  ratio: number;
  onAccept: () => void;
  onReject: () => void;
}) {
  const isAlta = p.score.startsWith("alta");
  const cardBorder =
    action === "accept" ? "border-emerald-400 ring-2 ring-emerald-200"
    : action === "reject" ? "border-rose-400 ring-2 ring-rose-200 opacity-60"
    : isAlta ? "border-emerald-200" : "border-amber-200";

  return (
    <div className={`bg-surface border-2 rounded-xl overflow-hidden transition ${cardBorder}`}>
      <div className={`px-3 py-2 border-b text-[10px] flex items-center justify-between gap-2 ${
        isAlta ? "bg-emerald-50/60 text-emerald-900 border-emerald-200" : "bg-amber-50/60 text-amber-900 border-amber-200"
      }`}>
        <div className="flex items-center gap-2">
          <span className={`inline-block font-bold px-2 py-0.5 rounded border ${
            isAlta ? "border-emerald-300 bg-emerald-100" : "border-amber-300 bg-amber-100"
          }`}>
            {isAlta ? "✓ Alta confianza" : "≈ Media confianza"}
          </span>
          <span className="opacity-80">{p.match_type}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReject}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold transition ${
              action === "reject" ? "bg-rose-600 text-white border-rose-700" : "bg-white text-rose-700 border-rose-300 hover:bg-rose-50"
            }`}
          >
            <XCircle size={11} /> Rechazar
          </button>
          <button
            onClick={onAccept}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold transition ${
              action === "accept" ? "bg-emerald-600 text-white border-emerald-700" : "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            }`}
          >
            <CheckCircle2 size={11} /> Aceptar match
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-0">
        {/* Lado izquierdo: SKU canal (Unidrop huérfano) */}
        <div className="p-4 bg-amber-50/30">
          <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold mb-2 flex items-center gap-2">
            {p.canal === "unidrop_ml" ? "🛒 Huérfano Unidrop ML" : "🛍️ Huérfano Unidrop TN"}
            <span className="text-text-muted/60 normal-case font-normal">— No aparece en Unistore</span>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-16 h-16 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
              <ImageOff size={20} className="text-text-muted/40" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-text leading-tight">{p.name_canal}</div>
              <div className="text-[10px] text-text-muted font-mono mt-1">{p.sku_canal}</div>
              <div className="text-xs text-text-muted mt-2">
                <strong className="text-amber-700">{formatNumber(p.units_canal)}</strong> unidades vendidas
              </div>
            </div>
          </div>
        </div>

        {/* Centro: flecha + ratio */}
        <div className="hidden lg:flex flex-col items-center justify-center px-4 py-2 bg-soft/30">
          <ArrowRight size={28} className="text-primary mb-2" />
          <div className="text-[9px] uppercase tracking-wider text-text-muted text-center">Ratio volumen</div>
          <div className="text-sm font-extrabold text-text tabular-nums">
            {ratio > 0 ? `${(ratio * 100).toFixed(0)}%` : "—"}
          </div>
          <div className="text-[9px] text-text-muted text-center">canal vs Unistore</div>
        </div>

        {/* Lado derecho: SKU Unistore candidato */}
        <div className="p-4 bg-violet-50/30">
          <div className="text-[10px] uppercase tracking-wider text-violet-700 font-bold mb-2 flex items-center gap-2">
            🏪 Match Unistore candidato
            <span className="text-text-muted/60 normal-case font-normal">— En catálogo TN propio</span>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-16 h-16 rounded-md bg-white border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
              {p.imagen_unistore ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imagen_unistore} alt={p.name_unistore} className="w-full h-full object-cover" loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : <ImageOff size={20} className="text-text-muted/40" />}
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/productos/${encodeURIComponent(p.sku_unistore)}`}
                className="text-sm font-bold text-primary hover:underline leading-tight block">
                {p.name_unistore}
              </Link>
              <div className="text-[10px] text-text-muted font-mono mt-1">
                {p.sku_unistore}{p.ean_unistore ? ` · EAN ${p.ean_unistore}` : ""}
              </div>
              <div className="text-xs text-text-muted mt-2">
                <strong className="text-violet-700">{formatNumber(p.units_unistore)}</strong> unidades vendidas
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de volumen comparativa */}
      <div className="px-4 py-2 bg-soft/30 border-t border-border">
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span className="w-20 text-right">canal:</span>
          <div className="flex-1 h-2 bg-soft/50 rounded overflow-hidden">
            <div className="h-full bg-amber-500"
              style={{ width: `${Math.min(100, (p.units_canal / Math.max(p.units_canal, p.units_unistore, 1)) * 100)}%` }} />
          </div>
          <span className="w-16 tabular-nums">{formatNumber(p.units_canal)}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-muted mt-1">
          <span className="w-20 text-right">Unistore:</span>
          <div className="flex-1 h-2 bg-soft/50 rounded overflow-hidden">
            <div className="h-full bg-violet-500"
              style={{ width: `${Math.min(100, (p.units_unistore / Math.max(p.units_canal, p.units_unistore, 1)) * 100)}%` }} />
          </div>
          <span className="w-16 tabular-nums">{formatNumber(p.units_unistore)}</span>
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
