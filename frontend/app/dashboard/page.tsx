"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { FileDown } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { KpiCard } from "@/components/kpi-card";
import { getCardDrill } from "@/lib/kpi-drill";
import { RevenueChart, DONUT_COLORS, DONUT_TO_SERIES } from "@/components/revenue-chart";
import { DonutChart } from "@/components/donut-chart";
import { CategoryTable } from "@/components/generic-table";
import { IntegrationHealthList } from "@/components/integration-health";
import { AlertsPanel } from "@/components/alerts-panel";
import { DrillDownModal } from "@/components/drilldown-modal";
import { api, getToken } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import type { ExecutiveOverview, CategoryValue, KpiCard as KpiCardT } from "@/lib/types";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { fmtArDateTime, todayArIso } from "@/lib/dates";

type UnitMetric = {
  label: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  delta?: number | null;
};

type UnitHealth = {
  unit: string;
  label: string;
  color: string;
  metrics: UnitMetric[];
};

type ExtendedExec = ExecutiveOverview & {
  revenue_mix?: CategoryValue[];
  unit_health?: UnitHealth[];
  top_products_cross?: CategoryValue[];
  lifecycle_mix?: CategoryValue[];
  unidev_analysis?: {
    top_motivos: CategoryValue[];
    top_resoluciones: CategoryValue[];
    top_skus: CategoryValue[];
  };
};

function UnitHealthCard({ u, drillCtx }: { u: UnitHealth; drillCtx: Ctx }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-8 rounded-full" style={{ backgroundColor: u.color }} />
        <div className="text-sm font-bold text-text">{u.label}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {u.metrics.map((m) => {
          const drill = getCardDrill(m.label, drillCtx);
          return (
            <UnitMetricCell key={m.label} m={m} drill={drill} />
          );
        })}
      </div>
    </div>
  );
}

type Ctx = Parameters<typeof getCardDrill>[1];

function UnitMetricCell({ m, drill }: { m: UnitMetric; drill: ReturnType<typeof getCardDrill> }) {
  const [open, setOpen] = useState(false);
  const interactive = !!drill;
  const content = (
    <>
      <div className="flex items-start justify-between gap-1">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          {m.label}
        </div>
        {interactive && (
          <span className="text-text-muted opacity-0 group-hover:opacity-100 transition">
            <SearchIcon />
          </span>
        )}
      </div>
      <div className="font-extrabold text-text mt-1 text-base tabular-nums">
        {m.prefix ?? ""}
        {typeof m.value === "number" ? formatNumber(m.value) : m.value}
        {m.suffix ?? ""}
      </div>
      {m.delta !== null && m.delta !== undefined && (
        <div
          className={
            "text-[10px] font-semibold mt-0.5 " +
            (m.delta >= 0 ? "text-emerald-600" : "text-error")
          }
        >
          {m.delta >= 0 ? "+" : ""}
          {m.delta.toFixed(1)}% vs mes ant
        </div>
      )}
    </>
  );
  if (!interactive) {
    return <div className="bg-soft rounded-lg p-3">{content}</div>;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-soft rounded-lg p-3 text-left hover:bg-soft/70 hover:ring-2 hover:ring-primary/30 transition group cursor-pointer w-full"
        title={`Click para ver detalle: ${drill.title ?? m.label}`}
      >
        {content}
      </button>
      {open && (
        <DrillDownModal
          title={drill.title ?? m.label}
          subtitle={drill.subtitle ?? ""}
          endpoint={drill.endpoint}
          filename={drill.filename ?? `${m.label.toLowerCase().replace(/\W+/g, "_")}.csv`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function UnidevMiniTable({
  title, rows, color, suffix, extraKey, extraLabel,
}: {
  title: string;
  rows: CategoryValue[];
  color: string;
  suffix?: string;
  extraKey?: string;
  extraLabel?: string;
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">{title}</div>
        <div className="text-xs text-text-muted italic py-6 text-center">Sin datos en el periodo</div>
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-3">{title}</div>
      <div className="space-y-1.5">
        {rows.slice(0, 8).map((r, i) => {
          const extra = (r as any).extra ?? {};
          const extraVal = extraKey ? extra[extraKey] : undefined;
          return (
            <div key={(r.category as string) + i} className="text-xs">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="font-medium text-text truncate max-w-[200px]" title={r.category as string}>{r.category}</span>
                <span className="tabular-nums font-bold" style={{ color }}>
                  {formatNumber(r.value)}{suffix ?? ""}
                </span>
              </div>
              <div className="h-1.5 bg-soft rounded overflow-hidden">
                <div className="h-full" style={{ background: color, width: `${(r.value / max) * 100}%` }} />
              </div>
              {extraVal !== undefined && extraLabel && (
                <div className="text-[10px] text-text-muted mt-0.5">
                  {extraLabel}: <strong className="text-text">{extraVal}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnidevDrillCell({ m, drill }: { m: UnitMetric; drill: ReturnType<typeof getCardDrill> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-white/70 rounded-lg p-3 border border-rose-100 hover:border-rose-400 hover:bg-white transition text-left group"
      >
        <div className="text-[9px] uppercase tracking-wider text-rose-700/70 font-bold truncate">{m.label}</div>
        <div className="text-base font-extrabold text-rose-900 mt-0.5 tabular-nums">
          {m.prefix ?? ""}{typeof m.value === "number" ? formatNumber(m.value) : m.value}{m.suffix ?? ""}
        </div>
        <div className="text-[9px] text-rose-600 opacity-0 group-hover:opacity-100 transition mt-0.5">
          Ver detalle →
        </div>
      </button>
      {open && drill && (
        <DrillDownModal
          title={drill.title ?? m.label}
          subtitle={drill.subtitle ?? ""}
          endpoint={drill.endpoint}
          filename={drill.filename ?? "devolucion.csv"}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export default function ExecutiveDashboardPage() {
  const [generating, setGenerating] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const router = useRouter();
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const _qs = periodToQuery(period, customFrom, customTo);
  const periodLabel: string = ({
    today: "HOY",
    yesterday: "AYER",
    "7d": "7 dias",
    "30d": "30 dias",
    "90d": "90 dias",
    "12m": "12 meses",
    custom: customFrom && customTo ? `${customFrom} → ${customTo}` : "rango",
  } as Record<string, string>)[period] || period;

  const { data, isLoading, error, refetch, isFetching } = useQuery<ExtendedExec>({
    queryKey: ["dashboards", "executive", period, customFrom, customTo],
    queryFn: () => api<ExtendedExec>(`/api/dashboards/executive?${_qs}`),
    staleTime: 60_000,
  });

  async function downloadMonthlyPdf() {
    setGenerating(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${apiUrl}/api/reports/monthly`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ym = todayArIso().slice(0, 7);
      a.href = url;
      a.download = `unidata_reporte_${ym}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Error generando PDF: ${e instanceof Error ? e.message : e}`);
    } finally {
      setGenerating(false);
    }
  }

  const cardHref = (c: KpiCardT): string | undefined => {
    const lc = c.label.toLowerCase();
    if (lc.includes("gmv") || lc.includes("ordenes unistore") || lc.includes("aov")) return "/dashboard/ventas";
    if (lc.includes("cancel")) return "/dashboard/cs";
    if (lc.includes("tiendas") || lc.includes("suscripciones") || lc.includes("mrr")) return "/dashboard/saas";
    if (lc.includes("talo")) return "/dashboard/pagos";
    if (lc.includes("devolucion")) return "/dashboard/devoluciones";
    return undefined;
  };

  return (
    <>
      <Topbar
        title="Gerencia"
        subtitle="Vista consolidada del grupo Unistore · Unistore + Unidrop + Unidev · todos los filtros del topbar afectan estos datos"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={downloadMonthlyPdf}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 transition disabled:opacity-50"
          >
            <FileDown size={14} />
            {generating ? "Generando PDF..." : "Reporte ejecutivo (PDF)"}
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error cargando el dashboard: {(error as Error).message}{" "}
            <button onClick={() => refetch()} className="underline ml-2">
              Reintentar
            </button>
          </div>
        )}

        {/* HOY snapshot - barra compacta expandible (cross-app, Gerencia es la vista canonica) */}
        <TodayPanel title="Comparador HOY" allowCrossToggle={false} />


        {/* Cards top */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-5 gap-4 mb-6">
          {isLoading || !data
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
              ))
            : data.cards.map((c) => <KpiCard key={c.label} data={c} drill={getCardDrill(c.label, { period, customFrom, customTo })} />)}
        </div>

        {/* Per-unit health */}
        {data?.unit_health && data.unit_health.length > 0 && (
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3">
              Salud por unidad de negocio · {periodLabel}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {data.unit_health.map((u) => (
                <UnitHealthCard key={u.unit} u={u} drillCtx={{ period, customFrom, customTo }} />
              ))}
            </div>
          </div>
        )}

        {/* Analisis post-venta: causas + resoluciones + SKUs con mas devs (Unidev) */}
        {data?.unidev_analysis && (
          <div className="bg-rose-50/30 border border-rose-200 rounded-xl p-5 mb-6">
            <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-900">
                    Analisis post-venta · {periodLabel}
                  </span>
                  <span className="text-[10px] bg-rose-200/60 text-rose-800 px-2 py-0.5 rounded-full font-semibold">
                    Unidev
                  </span>
                </div>
                <div className="text-[11px] text-rose-700/70 mt-0.5">
                  Causas de falla · tipo de resolucion · SKUs con mas devoluciones del periodo
                </div>
              </div>
              <a
                href="/dashboard/devoluciones"
                className="text-[11px] text-rose-700 font-semibold hover:text-rose-900 transition flex items-center gap-1 shrink-0"
              >
                Ver analisis completo →
              </a>
            </div>
            {/* Mini KPIs de devoluciones */}
            {data.unit_health && (() => {
              const unidev = data.unit_health.find((u: UnitHealth) => u.unit === "unidev");
              if (!unidev) return null;
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {unidev.metrics.map((m) => {
                    const drill = getCardDrill(m.label, { period, customFrom, customTo });
                    const cell = (
                      <div className="bg-white/70 rounded-lg p-3 border border-rose-100">
                        <div className="text-[9px] uppercase tracking-wider text-rose-700/70 font-bold truncate">{m.label}</div>
                        <div className="text-base font-extrabold text-rose-900 mt-0.5 tabular-nums">
                          {m.prefix ?? ""}{typeof m.value === "number" ? formatNumber(m.value) : m.value}{m.suffix ?? ""}
                        </div>
                      </div>
                    );
                    if (drill) {
                      return (
                        <UnidevDrillCell key={m.label} m={m} drill={drill} />
                      );
                    }
                    return <div key={m.label}>{cell}</div>;
                  })}
                </div>
              );
            })()}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <UnidevMiniTable title="Top causas (motivos de falla)" rows={data.unidev_analysis.top_motivos} color="#f43f5e" suffix=" unid" extraKey="items" extraLabel="items" />
              <UnidevMiniTable title="Tipo de resolucion preferida" rows={data.unidev_analysis.top_resoluciones} color="#fb923c" suffix=" devs" />
              <UnidevMiniTable title="SKUs mas devueltos" rows={data.unidev_analysis.top_skus} color="#ef4444" suffix=" u" extraKey="items" extraLabel="items" />
            </div>
          </div>
        )}

        {/* Clientes VIP - cards por tier */}
        <VipKpiSection />


        {/* Revenue chart + Revenue mix donut */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            ) : (
              <RevenueChart
                series={data.revenue_by_channel}
                filterSeries={selectedChannel}
              />
            )}
          </div>
          <div>
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            ) : (
              <DonutChart
                caption={`Mix de revenue · ${periodLabel}`}
                data={(data.revenue_mix ?? []).map((r) => ({ name: r.category, value: r.value }))}
                height={300}
                colorMap={DONUT_COLORS}
                highlightName={selectedChannel ? (Object.entries(DONUT_TO_SERIES).find(([, v]) => v === selectedChannel)?.[0] ?? null) : null}
                onSliceClick={(d) => {
                  const seriesLabel = DONUT_TO_SERIES[d.name] ?? null;
                  setSelectedChannel((prev) => prev === seriesLabel ? null : seriesLabel);
                }}
              />
            )}
          </div>
        </div>

        {/* Top products cross-canal + Lifecycle */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            </>
          ) : (
            <>
              <CategoryTable
                caption="Top 15 productos cross-canal (30d)"
                subtitle="TN + ML combinados · click para abrir SKU 360"
                data={data.top_products_cross ?? []}
                formatter="currency"
                extraColumns={[
                  { key: "sku", label: "SKU", format: "raw" },
                  { key: "units", label: "Unid", format: "number" },
                  { key: "tn", label: "TN", format: "currency" },
                  { key: "ml", label: "ML", format: "currency" },
                ]}
                onRowClick={(r) => {
                  const sku = r.extra?.sku;
                  if (typeof sku === "string" && sku) {
                    router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
                  }
                }}
              />
              <CategoryTable
                caption="Lifecycle de customers Unistore"
                subtitle="Nuevo · 2da · Convertido · Recurrente"
                data={data.lifecycle_mix ?? []}
                formatter="number"
                extraColumns={[{ key: "revenue", label: "Revenue total", format: "currency" }]}
              />
            </>
          )}
        </div>

        {/* Alerts + Integration health */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div>
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
            ) : (
              <AlertsPanel alerts={data.top_alerts} />
            )}
          </div>
          <div className="xl:col-span-2">
            {isLoading || !data ? (
              <div className="bg-surface border border-border rounded-xl p-5 h-[200px] animate-pulse" />
            ) : (
              <IntegrationHealthList items={data.integration_health} />
            )}
          </div>
        </div>

        {data && (
          <div className="mt-6 text-xs text-text-muted text-right">
            Datos generados: {fmtArDateTime(data.generated_at)}
            {isFetching && " · refrescando..."}
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================
// Clientes VIP — KPIs cross-unidad clickeables
// ============================================================
type VipOverview = {
  total_vips: number;
  tiers: {
    gold: { count: number; lifetime_total: number };
    silver: { count: number; lifetime_total: number };
    bronze: { count: number; lifetime_total: number };
  };
  lifetime_total: number;
  rules: Record<string, number>;
};

function VipKpiSection() {
  const [drillTier, setDrillTier] = useState<"all" | "gold" | "silver" | "bronze" | null>(null);
  const { data, isLoading } = useQuery<VipOverview>({
    queryKey: ["vip-overview"],
    queryFn: () => api<VipOverview>("/api/dashboards/customers-vip/overview"),
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3">Clientes VIP</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-surface border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    {
      label: "Total VIPs",
      count: data.total_vips,
      lifetime: data.lifetime_total,
      tier: "all" as const,
      icon: "★",
      bg: "from-violet-500 to-fuchsia-600",
      border: "border-violet-300",
      hint: "Ticket promedio ≥ $300k · cada compra premium",
    },
    {
      label: "VIP Gold",
      count: data.tiers.gold.count,
      lifetime: data.tiers.gold.lifetime_total,
      tier: "gold" as const,
      icon: "👑",
      bg: "from-yellow-400 to-amber-500",
      border: "border-amber-300",
      hint: "Ticket promedio > $1M · VIP elite",
    },
    {
      label: "VIP Silver",
      count: data.tiers.silver.count,
      lifetime: data.tiers.silver.lifetime_total,
      tier: "silver" as const,
      icon: "💎",
      bg: "from-slate-400 to-zinc-500",
      border: "border-slate-300",
      hint: "Ticket promedio $500k – $1M",
    },
    {
      label: "VIP Bronze",
      count: data.tiers.bronze.count,
      lifetime: data.tiers.bronze.lifetime_total,
      tier: "bronze" as const,
      icon: "⭐",
      bg: "from-orange-400 to-amber-500",
      border: "border-amber-300",
      hint: "Ticket promedio $300k – $500k",
    },
  ];

  return (
    <>
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-3 flex items-center gap-2">
          Clientes VIP
          <span className="text-[10px] font-normal text-text-muted">
            · ticket promedio ≥ $300k · click para drilldown
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <button
              key={c.tier}
              onClick={() => setDrillTier(c.tier)}
              className={`bg-surface border-2 ${c.border} rounded-xl p-4 hover:shadow-lg transition text-left group`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{c.label}</div>
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${c.bg} text-white flex items-center justify-center shadow-md text-lg`}>
                  {c.icon}
                </div>
              </div>
              <div className="text-3xl font-extrabold text-text tabular-nums">{formatNumber(c.count)}</div>
              <div className="text-[11px] text-text-muted mt-0.5">
                Lifetime total: <span className="font-bold text-text">{formatCurrency(c.lifetime)}</span>
              </div>
              <div className="text-[9px] text-text-muted mt-2 line-clamp-2">{c.hint}</div>
              <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-primary font-semibold opacity-0 group-hover:opacity-100 transition">
                Ver clientes →
              </div>
            </button>
          ))}
        </div>
      </div>

      {drillTier && (
        <DrillDownModal
          title={drillTier === "all" ? "Todos los clientes VIP" : `Clientes VIP · ${drillTier.toUpperCase()}`}
          subtitle="Click un cliente para abrir su perfil 360 · CSV exportable"
          endpoint={`/api/dashboards/customers-vip?tier=${drillTier}`}
          filename={`vip_${drillTier}.csv`}
          onClose={() => setDrillTier(null)}
        />
      )}
    </>
  );
}
