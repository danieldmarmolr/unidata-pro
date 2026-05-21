"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search, Download, X, Filter as FilterIcon, RotateCcw } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { CategoryTable } from "@/components/generic-table";
import { InteractiveMetricChart } from "@/components/interactive-metric-chart";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type InvoiceItem = {
  id: number;
  tipo: string;
  numero: string;
  fecha_emision: string | null;
  total: number;
  id_venta_integracion: string | null;
  id_cliente: number | null;
  cae: string;
  link_publico: string;
  cliente_razon_social: string;
  cliente_dni: string;
  cliente_email: string;
  user_id: number | null;
  fantasy_name: string;
  user_email: string;
  user_dni: string;
  plan_id: number | null;
  plan_name: string;
  subscription_status: string;
  subscription_end_date: string | null;
};

type Plan = { id: number; name: string; price: number };

type ChartGranularity = "day" | "week" | "month" | "quarter" | "year";

type Resp = {
  unit: string;
  period: string;
  cards: KpiCardT[];
  trends: TimeSeries[];
  by_plan: CategoryValue[];
  by_tipo: CategoryValue[];
  items: InvoiceItem[];
  items_count: number;
  items_truncated: boolean;
  plans: Plan[];
  filters: { plan: string; tipo: string; search: string };
  chart_granularity: ChartGranularity;
  generated_at: string;
};

const GRAN_OPTIONS: { value: ChartGranularity; label: string; window: string }[] = [
  { value: "day", label: "Día", window: "60 días" },
  { value: "week", label: "Semana", window: "26 semanas" },
  { value: "month", label: "Mes", window: "24 meses" },
  { value: "quarter", label: "Trimestre", window: "12 trimestres" },
  { value: "year", label: "Año", window: "5 años" },
];

function downloadCsv(items: InvoiceItem[]) {
  const header = [
    "fecha_emision", "tipo", "numero", "total", "cae",
    "cliente_razon_social", "cliente_dni", "cliente_email",
    "fantasy_name", "user_dni", "user_email", "plan_name",
    "subscription_status", "subscription_end_date", "link_publico",
  ];
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [header.join(",")];
  for (const it of items) {
    lines.push(header.map((h) => escape((it as unknown as Record<string, unknown>)[h])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `facturas-suscripciones-meli-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function FacturasSuscripcionesMeliPanel() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const periodQs = periodToQuery(period, customFrom, customTo);

  const [plan, setPlan] = useState<string>("all");
  const [tipo, setTipo] = useState<"all" | "FCA" | "FCB">("all");
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [granularity, setGranularity] = useState<ChartGranularity>("month");

  const qs = useMemo(() => {
    const base = new URLSearchParams(periodQs);
    if (plan !== "all") base.set("plan", plan);
    if (tipo !== "all") base.set("tipo", tipo);
    if (search) base.set("search", search);
    base.set("chart_granularity", granularity);
    return base.toString();
  }, [periodQs, plan, tipo, search, granularity]);

  const { data, isLoading, isFetching, error } = useQuery<Resp>({
    queryKey: ["dashboards", "finanzas", "invoices-meli", period, customFrom, customTo, plan, tipo, search, granularity],
    queryFn: () => api(`/api/dashboards/finanzas/invoices-meli?${qs}`),
    staleTime: 60_000,
  });

  const planNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of (data?.plans ?? [])) m.set(p.id, p.name);
    return m;
  }, [data?.plans]);

  const activePlanName = plan !== "all" && /^\d+$/.test(plan)
    ? planNameById.get(Number(plan)) ?? `Plan ${plan}`
    : null;
  const hasActiveFilters = plan !== "all" || tipo !== "all" || search !== "";
  const clearAllFilters = () => { setPlan("all"); setTipo("all"); setSearch(""); setSearchInput(""); };

  // Click handler para CategoryTable de plan / tipo
  const handlePlanClick = (row: { category: string; value: number; extra?: Record<string, number | string | boolean | null> | null }) => {
    const pid = row.extra?.plan_id;
    if (typeof pid === "number" && pid > 0) setPlan(String(pid));
  };
  const handleTipoClick = (row: { category: string; value: number; extra?: Record<string, number | string | boolean | null> | null }) => {
    const t = row.category;
    if (t === "FCA" || t === "FCB") setTipo(t);
  };

  // Total visible (suma de items filtrados ya devueltos)
  const visibleTotal = useMemo(
    () => (data?.items ?? []).reduce((acc, r) => acc + (r.total || 0), 0),
    [data?.items],
  );

  return (
    <div>
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
          Error: {(error as Error).message}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {isLoading || !data
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
            ))
          : data.cards.map((c) => <KpiCard key={c.label} data={c} />)}
      </div>

      {/* Trend con selector de granularidad */}
      <div className="mb-6">
        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
        ) : (
          <div className="bg-surface border border-border rounded-xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
              <div>
                <div className="text-sm font-bold text-text">Facturacion suscripciones MELI</div>
                <div className="text-xs text-text-muted mt-0.5">
                  Ventana: {GRAN_OPTIONS.find((g) => g.value === granularity)?.window}
                  {" · "}FCA = Responsable Inscripto / Monotributo · FCB = Consumidor Final
                </div>
              </div>
              <div className="inline-flex bg-soft border border-border rounded-lg p-1">
                {GRAN_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGranularity(g.value)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition whitespace-nowrap ${
                      granularity === g.value
                        ? "bg-surface text-primary shadow-sm"
                        : "text-text-muted hover:text-primary"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <InteractiveMetricChart
              points={(() => {
                const map = new Map<string, { date: string; [k: string]: number | string }>();
                for (const s of (data.trends || [])) {
                  for (const p of (s.points || [])) {
                    const existing = map.get(p.date) ?? { date: p.date };
                    existing[s.label] = p.value;
                    map.set(p.date, existing);
                  }
                }
                return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
              })()}
              metrics={(data.trends || []).map((s, i) => ({
                key: s.label,
                label: s.label,
                kind: "currency" as const,
                color: ["#7a3eae", "#10b981", "#f59e0b"][i % 3],
              }))}
              defaultPrimary={data.trends?.[0]?.label}
              defaultSecondary={data.trends?.[1]?.label}
              height={320}
            />
          </div>
        )}
      </div>

      {/* Breakdowns (click filtra el listing) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
        ) : (
          <CategoryTable
            caption="Facturacion por plan"
            subtitle="Click un plan para filtrar el listado de abajo"
            data={data.by_plan}
            formatter="currency"
            extraColumns={[
              { key: "cantidad", label: "Cant", format: "number" },
              { key: "precio", label: "Precio", format: "currency" },
            ]}
            autoDrill={false}
            onRowClick={handlePlanClick}
          />
        )}
        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
        ) : (
          <CategoryTable
            caption="Facturacion por tipo de comprobante"
            subtitle="Click FCA o FCB para filtrar el listado de abajo"
            data={data.by_tipo}
            formatter="currency"
            extraColumns={[{ key: "cantidad", label: "Cant", format: "number" }]}
            autoDrill={false}
            onRowClick={handleTipoClick}
          />
        )}
      </div>

      {/* Listing */}
      <div className="bg-surface border border-border rounded-xl p-4 sm:p-5">
        {/* Header del listing */}
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-bold text-text">Listado de facturas</div>
            <div className="text-xs text-text-muted mt-0.5">
              {isFetching && !data
                ? "Cargando..."
                : `${(data?.items_count ?? 0).toLocaleString("es-AR")} facturas · ${formatCurrency(visibleTotal)} total`}
              {data?.items_truncated && <span className="text-amber-700 ml-2">· tope 10.000 alcanzado, refina con filtros</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="inline-flex bg-soft border border-border rounded-lg p-1">
              {(["all", "FCA", "FCB"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
                    tipo === t ? "bg-surface text-primary shadow-sm" : "text-text-muted hover:text-primary"
                  }`}
                >
                  {t === "all" ? "Todos" : t}
                </button>
              ))}
            </div>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="bg-soft border border-border rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text"
            >
              <option value="all">Todos los planes</option>
              {(data?.plans ?? []).map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name} ({formatCurrency(p.price)})
                </option>
              ))}
            </select>
            <div className="inline-flex items-center gap-1 bg-soft border border-border rounded-lg px-2 py-1">
              <Search size={12} className="text-text-muted" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }}
                placeholder="Buscar nro, DNI, email, fantasy..."
                className="bg-transparent text-xs px-1 py-0.5 outline-none w-52"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(""); setSearch(""); }}
                  className="text-text-muted hover:text-text"
                  aria-label="Limpiar"
                >
                  <X size={12} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setSearch(searchInput.trim())}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary text-white hover:opacity-90"
              >
                Buscar
              </button>
            </div>
            <button
              type="button"
              disabled={!data?.items?.length}
              onClick={() => data && downloadCsv(data.items)}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border hover:bg-soft disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={12} /> CSV
            </button>
          </div>
        </div>

        {/* Indicador de filtros activos */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 mb-3 pt-3 border-t border-border">
            <FilterIcon size={12} className="text-text-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Filtros activos:</span>
            {tipo !== "all" && (
              <FilterChip label={`Tipo: ${tipo}`} onClear={() => setTipo("all")} />
            )}
            {activePlanName && (
              <FilterChip label={`Plan: ${activePlanName}`} onClear={() => setPlan("all")} />
            )}
            {search && (
              <FilterChip label={`Búsqueda: ${search}`} onClear={() => { setSearch(""); setSearchInput(""); }} />
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-primary transition px-2 py-0.5"
            >
              <RotateCcw size={11} /> Limpiar todo
            </button>
          </div>
        )}

        {/* Tabla */}
        <div className="overflow-x-auto -mx-4 sm:mx-0 max-h-[640px] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-soft">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <th className="py-2.5 px-3">Fecha</th>
                <th className="py-2.5 px-2">Tipo</th>
                <th className="py-2.5 px-2">Numero</th>
                <th className="py-2.5 px-2">Dropshipper</th>
                <th className="py-2.5 px-2">DNI</th>
                <th className="py-2.5 px-2">Plan</th>
                <th className="py-2.5 px-2">Estado sub</th>
                <th className="py-2.5 px-2 text-right">Total</th>
                <th className="py-2.5 px-3 text-right">Factura</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="py-12 text-center text-text-muted text-sm">Cargando...</td></tr>
              )}
              {!isLoading && (!data || data.items.length === 0) && (
                <tr><td colSpan={9} className="py-12 text-center text-text-muted text-sm">Sin facturas para los filtros aplicados.</td></tr>
              )}
              {!isLoading && data?.items.map((r, i) => (
                <tr
                  key={r.id}
                  className={`border-t border-border hover:bg-soft transition ${i % 2 === 1 ? "bg-soft/30" : ""}`}
                >
                  <td className="py-2 px-3 text-text-muted text-xs tabular-nums whitespace-nowrap">{r.fecha_emision ?? "—"}</td>
                  <td className="py-2 px-2">
                    <button
                      type="button"
                      onClick={() => setTipo(r.tipo === "FCA" || r.tipo === "FCB" ? r.tipo as "FCA" | "FCB" : "all")}
                      title={`Filtrar por ${r.tipo}`}
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:ring-2 hover:ring-primary/30 transition ${
                        r.tipo === "FCA" ? "bg-purple-50 text-purple-700 border border-purple-200"
                                         : "bg-blue-50 text-blue-700 border border-blue-200"}`}
                    >
                      {r.tipo || "—"}
                    </button>
                  </td>
                  <td className="py-2 px-2 font-mono text-xs whitespace-nowrap">{r.numero || "—"}</td>
                  <td className="py-2 px-2 max-w-[220px]">
                    {r.user_id ? (
                      <Link
                        href={`/dashboard/dropshipper/${r.user_id}`}
                        className="text-primary hover:underline font-medium text-xs truncate block"
                        title={r.fantasy_name || r.cliente_razon_social || r.user_email || ""}
                      >
                        {r.fantasy_name || r.cliente_razon_social || r.user_email || `User ${r.user_id}`}
                      </Link>
                    ) : (
                      <span className="text-text-muted text-xs truncate block" title={r.cliente_razon_social}>
                        {r.cliente_razon_social || "—"}
                      </span>
                    )}
                    {r.user_email && (
                      <div className="text-[10px] text-text-muted truncate" title={r.user_email}>{r.user_email}</div>
                    )}
                  </td>
                  <td className="py-2 px-2 text-xs font-mono tabular-nums whitespace-nowrap">{r.user_dni || r.cliente_dni || "—"}</td>
                  <td className="py-2 px-2 text-xs">
                    {r.plan_id ? (
                      <button
                        type="button"
                        onClick={() => setPlan(String(r.plan_id))}
                        title={`Filtrar por ${r.plan_name}`}
                        className="text-left hover:text-primary hover:underline transition"
                      >
                        {r.plan_name || `Plan ${r.plan_id}`}
                      </button>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    {r.subscription_status ? (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        r.subscription_status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-gray-100 text-gray-600 border border-gray-200"}`}>
                        {r.subscription_status}
                      </span>
                    ) : <span className="text-text-muted">—</span>}
                    {r.subscription_end_date && (
                      <div className="text-[10px] text-text-muted mt-0.5">Vto: {r.subscription_end_date}</div>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold whitespace-nowrap">{formatCurrency(r.total)}</td>
                  <td className="py-2 px-3 text-right">
                    {r.link_publico ? (
                      <a
                        href={r.link_publico}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-semibold"
                      >
                        Ver <ExternalLink size={11} />
                      </a>
                    ) : <span className="text-text-muted text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {!isLoading && (data?.items.length ?? 0) > 0 && (
              <tfoot className="sticky bottom-0 bg-surface border-t-2 border-primary/30">
                <tr>
                  <td colSpan={7} className="py-2 px-3 text-xs font-semibold text-text">
                    Total visible ({(data?.items_count ?? 0).toLocaleString("es-AR")} facturas)
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-bold text-text">{formatCurrency(visibleTotal)}</td>
                  <td className="py-2 px-3" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold border border-primary/20">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="hover:bg-primary/20 rounded-full p-0.5 transition"
        aria-label={`Limpiar ${label}`}
      >
        <X size={10} />
      </button>
    </span>
  );
}
