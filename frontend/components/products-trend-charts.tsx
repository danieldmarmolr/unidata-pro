"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line,
  ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell,
} from "recharts";
import {
  TrendingUp, Layers, Package, BarChart3,
  ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CheckCircle2, Info, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";

export type ProductsUnit = "unistore" | "unidrop";

type StoryPack = {
  max_point: ({ date: string; label: string; vs_avg_pct: number } & Record<string, number>) | null;
  min_point: ({ date: string; label: string; vs_avg_pct: number } & Record<string, number>) | null;
  avg: number;
  std: number;
  outliers: Array<{ date: string; label: string; value: number; z: number; direction: "up" | "down" }>;
  momentum_pct: number;
  trend: "up" | "down" | "flat";
  trend_strength: number;
  prev_period: { points: any[]; total: number } | null;
  prev_total_diff_pct: number;
};

type ProfitDailyResp = {
  days: number;
  unit: string;
  points: Array<{
    date: string;
    revenue: number;
    costo: number;
    ganancia: number;
    ganancia_ma7: number;
    margen_pct: number;
  }>;
  story: StoryPack;
  insight: string;
  summary: {
    total_revenue: number;
    total_costo: number;
    total_ganancia: number;
    margen_promedio_pct: number;
  };
};

type CatalogActiveResp = {
  weeks: number;
  unit: string;
  total_publicados: number;
  universe_label: string;
  points: Array<{ date: string; skus_activos: number; pct_activo: number }>;
  story: StoryPack;
  insight: string;
  summary: { promedio_pct: number; max_pct: number; ultimo_pct: number };
};

type AbcDistResp = {
  months: number;
  unit: string;
  points: Array<{
    date: string;
    skus_a: number; skus_b: number; skus_c: number;
    rev_a: number; rev_b: number; rev_c: number;
    total_skus: number;
    concentracion_a_pct: number;
  }>;
  story: StoryPack;
  insight: string;
};

type CrossCorrResp = {
  unit: string;
  insights: Array<{
    severity: "good" | "warn" | "neutral";
    title: string;
    body: string;
  }>;
  deltas: {
    ganancia_pct: number;
    catalogo_activo_pct: number;
    concentracion_a_pct: number;
  };
};

const fmtTickK = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v}`;
};

const fmtDateShort = (iso: string) => {
  const parts = iso.split("-");
  if (parts.length < 3) return iso;
  return `${parts[2]}/${parts[1]}`;
};
const fmtMonthShort = (iso: string) => {
  const parts = iso.split("-");
  if (parts.length < 2) return iso;
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const m = parseInt(parts[1], 10);
  return `${meses[m - 1] ?? parts[1]} ${parts[0].slice(2)}`;
};

function TrendBadge({ trend, strength }: { trend: string; strength: number }) {
  if (trend === "up") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
        <ArrowUpRight size={10} /> {strength.toFixed(1)}%
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
        <ArrowDownRight size={10} /> {strength.toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-text-muted bg-soft border border-border rounded-full px-2 py-0.5">
      <Minus size={10} /> estable
    </span>
  );
}

function PrevBadge({ diff }: { diff: number }) {
  if (Math.abs(diff) < 1) return null;
  const positive = diff > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 border",
        positive ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200",
      )}
      title="Vs periodo anterior de igual longitud"
    >
      {positive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />} {diff.toFixed(1)}% vs prev
    </span>
  );
}

function InsightLine({ text }: { text: string }) {
  return (
    <div className="mt-3 flex items-start gap-2 text-[11px] text-text bg-soft/60 border border-border/60 rounded-lg px-2.5 py-2">
      <Sparkles size={12} className="mt-0.5 text-primary shrink-0" />
      <span className="leading-snug">{text}</span>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  children,
  rightStat,
  badges,
  insight,
}: {
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  children: React.ReactNode;
  rightStat?: React.ReactNode;
  badges?: React.ReactNode;
  insight?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${iconColor}20` }}>
            <Icon size={14} style={{ color: iconColor }} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-text flex items-center gap-2 flex-wrap">
              <span>{title}</span>
              {badges}
            </div>
            <div className="text-[10px] text-text-muted">{subtitle}</div>
          </div>
        </div>
        {rightStat}
      </div>
      {children}
      {insight && <InsightLine text={insight} />}
    </div>
  );
}

function ProfitDailyChart({ unit }: { unit: ProductsUnit }) {
  const { data } = useQuery<ProfitDailyResp>({
    queryKey: ["products-ts", "profit-daily", 90, unit],
    queryFn: () => api(`/api/dashboards/products/timeseries/profit-daily?days=90&unit=${unit}`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[280px] animate-pulse bg-soft rounded" />;

  const story = data.story;
  // Merge prev_period serie indexada por offset (no por fecha) para overlay punteado
  const prevPoints = story.prev_period?.points ?? [];
  const merged = data.points.map((p, i) => ({
    ...p,
    prev_ganancia: prevPoints[i]?.ganancia ?? null,
  }));
  const avg = story.avg || 0;
  const max = story.max_point;
  const min = story.min_point;

  return (
    <ChartCard
      title="Ganancia neta diaria · 90d"
      subtitle="Barras = ganancia del dia · linea = media movil 7d · linea punteada = 90d previos"
      icon={TrendingUp}
      iconColor="#10b981"
      badges={<><TrendBadge trend={story.trend} strength={story.trend_strength} /><PrevBadge diff={story.prev_total_diff_pct} /></>}
      rightStat={
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Total 90d</div>
          <div className="text-base font-extrabold tabular-nums">{formatCurrency(data.summary.total_ganancia)}</div>
          <div className="text-[10px] text-text-muted">{data.summary.margen_promedio_pct}% margen</div>
        </div>
      }
      insight={data.insight}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtTickK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <ReferenceLine y={avg} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `prom ${fmtTickK(avg)}`, position: "insideTopRight", fill: "#64748b", fontSize: 9 }} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            formatter={(value, name) => {
              if (name === "prev_ganancia") return [formatCurrency(Number(value ?? 0)), "Periodo previo"];
              if (name === "ganancia_ma7") return [formatCurrency(Number(value ?? 0)), "Media movil 7d"];
              return [formatCurrency(Number(value ?? 0)), "Ganancia"];
            }}
            labelFormatter={(label) => fmtDateShort(label as string)}
          />
          <Bar dataKey="ganancia" fill="#10b981" radius={[2, 2, 0, 0]}>
            {merged.map((entry, idx) => {
              const isOutDown = story.outliers.some((o) => o.date === entry.date && o.direction === "down");
              const isOutUp = story.outliers.some((o) => o.date === entry.date && o.direction === "up");
              const color = isOutDown ? "#dc2626" : isOutUp ? "#7c3aed" : "#10b981";
              return <Cell key={idx} fill={color} />;
            })}
          </Bar>
          <Line type="monotone" dataKey="ganancia_ma7" stroke="#7a3eae" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="prev_ganancia" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          {max && (
            <ReferenceDot x={max.date} y={max.ganancia as number} r={5} fill="#10b981" stroke="#fff" strokeWidth={2} ifOverflow="extendDomain">
              <></>
            </ReferenceDot>
          )}
          {min && (
            <ReferenceDot x={min.date} y={min.ganancia as number} r={5} fill="#ef4444" stroke="#fff" strokeWidth={2} ifOverflow="extendDomain">
              <></>
            </ReferenceDot>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RevenueCostProfitChart({ unit }: { unit: ProductsUnit }) {
  const { data } = useQuery<ProfitDailyResp>({
    queryKey: ["products-ts", "profit-daily", 90, unit],
    queryFn: () => api(`/api/dashboards/products/timeseries/profit-daily?days=90&unit=${unit}`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[280px] animate-pulse bg-soft rounded" />;

  const story = data.story;
  // Para storytelling reusamos la misma serie pero el insight aplica a ganancia.
  // Aca el insight propio es la compresion de margen — calculamos % margen diario
  // promedio primer tercio vs ultimo tercio.
  const pts = data.points;
  const n = pts.length;
  const third = Math.max(1, Math.floor(n / 3));
  const firstThird = pts.slice(0, third);
  const lastThird = pts.slice(-third);
  const margenInicio = firstThird.length
    ? firstThird.reduce((acc, p) => acc + (p.margen_pct ?? 0), 0) / firstThird.length
    : 0;
  const margenFinal = lastThird.length
    ? lastThird.reduce((acc, p) => acc + (p.margen_pct ?? 0), 0) / lastThird.length
    : 0;
  const margenDelta = margenFinal - margenInicio;
  const insightLocal = `Margen ${margenFinal.toFixed(1)}% (vs ${margenInicio.toFixed(1)}% al inicio · ${margenDelta >= 0 ? "+" : ""}${margenDelta.toFixed(1)}pp). Revenue ${formatCurrency(data.summary.total_revenue)} · costo ${formatCurrency(data.summary.total_costo)}.`;

  return (
    <ChartCard
      title="Revenue vs Costo vs Ganancia · 90d"
      subtitle="Detecta compresion de margen · area apilada"
      icon={Layers}
      iconColor="#7a3eae"
      badges={<PrevBadge diff={story.prev_total_diff_pct} />}
      rightStat={
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Revenue 90d</div>
          <div className="text-base font-extrabold tabular-nums">{formatCurrency(data.summary.total_revenue)}</div>
          <div className="text-[10px] text-text-muted">costo {formatCurrency(data.summary.total_costo)}</div>
        </div>
      }
      insight={insightLocal}
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-cost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="g-gan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtTickK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            formatter={(value, name) => [formatCurrency(Number(value ?? 0)), String(name ?? "")]}
            labelFormatter={(label) => fmtDateShort(label as string)}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconType="rect" />
          <Area type="monotone" dataKey="ganancia" name="Ganancia" stroke="#10b981" fill="url(#g-gan)" stackId="1" />
          <Area type="monotone" dataKey="costo" name="Costo" stroke="#f59e0b" fill="url(#g-cost)" stackId="1" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function CatalogActiveChart({ unit }: { unit: ProductsUnit }) {
  const { data } = useQuery<CatalogActiveResp>({
    queryKey: ["products-ts", "catalog-active", 52, unit],
    queryFn: () => api(`/api/dashboards/products/timeseries/catalog-active?weeks=52&unit=${unit}`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[280px] animate-pulse bg-soft rounded" />;

  const story = data.story;
  const prevPoints = story.prev_period?.points ?? [];
  const merged = data.points.map((p, i) => ({
    ...p,
    prev_pct: prevPoints[i]?.pct_activo ?? null,
  }));
  const avg = story.avg || 0;
  const max = story.max_point;
  const min = story.min_point;

  return (
    <ChartCard
      title="Catalogo activo · 52 semanas"
      subtitle={`% del catalogo (${formatNumber(data.total_publicados)} ${data.universe_label}) que vendio cada semana`}
      icon={Package}
      iconColor="#06b6d4"
      badges={<><TrendBadge trend={story.trend} strength={story.trend_strength} /><PrevBadge diff={story.prev_total_diff_pct} /></>}
      rightStat={
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ultima semana</div>
          <div className="text-base font-extrabold tabular-nums">{data.summary.ultimo_pct}%</div>
          <div className="text-[10px] text-text-muted">prom. {data.summary.promedio_pct}% · max {data.summary.max_pct}%</div>
        </div>
      }
      insight={data.insight}
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-cat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={avg} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `prom ${avg.toFixed(1)}%`, position: "insideTopRight", fill: "#64748b", fontSize: 9 }} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            formatter={(value, name) => {
              const n = Number(value ?? 0);
              if (name === "pct_activo") return [`${n}%`, "% activo"];
              if (name === "prev_pct") return [`${n}%`, "52sem previas"];
              return [formatNumber(n), String(name ?? "")];
            }}
            labelFormatter={(label) => fmtDateShort(label as string)}
          />
          <Area type="monotone" dataKey="pct_activo" stroke="#06b6d4" fill="url(#g-cat)" strokeWidth={2} />
          <Line type="monotone" dataKey="prev_pct" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          {max && (
            <ReferenceDot x={max.date} y={max.pct_activo as number} r={5} fill="#06b6d4" stroke="#fff" strokeWidth={2} ifOverflow="extendDomain">
              <></>
            </ReferenceDot>
          )}
          {min && (
            <ReferenceDot x={min.date} y={min.pct_activo as number} r={5} fill="#ef4444" stroke="#fff" strokeWidth={2} ifOverflow="extendDomain">
              <></>
            </ReferenceDot>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function AbcDistributionChart({ unit }: { unit: ProductsUnit }) {
  const { data } = useQuery<AbcDistResp>({
    queryKey: ["products-ts", "abc-dist", 12, unit],
    queryFn: () => api(`/api/dashboards/products/timeseries/abc-distribution?months=12&unit=${unit}`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[280px] animate-pulse bg-soft rounded" />;
  const last = data.points[data.points.length - 1];
  const story = data.story;
  return (
    <ChartCard
      title="Distribucion ABC mensual · 12 meses"
      subtitle="Cuantos SKUs concentran el revenue (concentracion creciente = riesgo)"
      icon={BarChart3}
      iconColor="#f59e0b"
      badges={<TrendBadge trend={story.trend} strength={story.trend_strength} />}
      rightStat={
        last && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Mes actual</div>
            <div className="text-base font-extrabold tabular-nums">{last.skus_a + last.skus_b + last.skus_c} SKUs</div>
            <div className="text-[10px] text-text-muted">{last.concentracion_a_pct}% clase A</div>
          </div>
        )
      }
      insight={data.insight}
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data.points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtMonthShort} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            labelFormatter={(label) => fmtMonthShort(label as string)}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} iconType="rect" />
          <Bar dataKey="skus_a" name="Clase A" stackId="abc" fill="#10b981" />
          <Bar dataKey="skus_b" name="Clase B" stackId="abc" fill="#f59e0b" />
          <Bar dataKey="skus_c" name="Clase C" stackId="abc" fill="#94a3b8" />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const SEV_STYLE: Record<string, { icon: any; bg: string; border: string; iconColor: string; tone: string }> = {
  good: { icon: CheckCircle2, bg: "bg-emerald-50", border: "border-emerald-200", iconColor: "#059669", tone: "text-emerald-900" },
  warn: { icon: AlertTriangle, bg: "bg-amber-50", border: "border-amber-200", iconColor: "#d97706", tone: "text-amber-900" },
  neutral: { icon: Info, bg: "bg-sky-50", border: "border-sky-200", iconColor: "#0284c7", tone: "text-sky-900" },
};

function CrossInsights({ unit }: { unit: ProductsUnit }) {
  const { data } = useQuery<CrossCorrResp>({
    queryKey: ["products-ts", "cross-corr", unit],
    queryFn: () => api(`/api/dashboards/products/timeseries/cross-correlations?unit=${unit}`),
    staleTime: 5 * 60_000,
  });

  if (!data) return <div className="h-[140px] bg-soft border border-border rounded-xl animate-pulse mb-6" />;

  const deltaPill = (label: string, value: number) => {
    const positive = value >= 0;
    return (
      <div className="flex items-center gap-2 bg-soft/60 border border-border rounded-lg px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</span>
        <span className={cn(
          "inline-flex items-center gap-0.5 text-xs font-extrabold tabular-nums",
          Math.abs(value) < 1 ? "text-text-muted" : positive ? "text-emerald-700" : "text-rose-700",
        )}>
          {Math.abs(value) < 1 ? <Minus size={10} /> : positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {value.toFixed(1)}%
        </span>
      </div>
    );
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles size={14} className="text-primary" />
          </div>
          <div>
            <div className="text-sm font-extrabold text-text">Lecturas cruzadas</div>
            <div className="text-[11px] text-text-muted">
              Correlaciones entre ganancia, catalogo activo y concentracion ABC (primer tercio vs ultimo tercio del periodo)
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {deltaPill("Ganancia", data.deltas.ganancia_pct)}
          {deltaPill("Catalogo activo", data.deltas.catalogo_activo_pct)}
          {deltaPill("Concentracion A", data.deltas.concentracion_a_pct)}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.insights.map((ins, i) => {
          const s = SEV_STYLE[ins.severity] ?? SEV_STYLE.neutral;
          const Icon = s.icon;
          return (
            <div key={i} className={cn("border rounded-lg px-3 py-2.5 flex gap-2 items-start", s.bg, s.border)}>
              <Icon size={14} style={{ color: s.iconColor }} className="mt-0.5 shrink-0" />
              <div className={cn("text-[12px] leading-snug", s.tone)}>
                <div className="font-bold">{ins.title}</div>
                <div className="text-[11px] opacity-90">{ins.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProductsTrendCharts({ unit = "unistore" }: { unit?: ProductsUnit }) {
  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <ProfitDailyChart unit={unit} />
        <RevenueCostProfitChart unit={unit} />
        <CatalogActiveChart unit={unit} />
        <AbcDistributionChart unit={unit} />
      </div>
      <CrossInsights unit={unit} />
    </div>
  );
}
