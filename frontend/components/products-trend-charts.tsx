"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { TrendingUp, Layers, Package, BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type ProfitDailyResp = {
  days: number;
  points: Array<{
    date: string;
    revenue: number;
    costo: number;
    ganancia: number;
    ganancia_ma7: number;
    margen_pct: number;
  }>;
  summary: {
    total_revenue: number;
    total_costo: number;
    total_ganancia: number;
    margen_promedio_pct: number;
  };
};

type CatalogActiveResp = {
  weeks: number;
  total_publicados: number;
  points: Array<{ date: string; skus_activos: number; pct_activo: number }>;
  summary: { promedio_pct: number; max_pct: number; ultimo_pct: number };
};

type AbcDistResp = {
  months: number;
  points: Array<{
    date: string;
    skus_a: number; skus_b: number; skus_c: number;
    rev_a: number; rev_b: number; rev_c: number;
    total_skus: number;
    concentracion_a_pct: number;
  }>;
};

const fmtTickK = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v}`;
};

const fmtDateShort = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
};
const fmtMonthShort = (iso: string) => {
  const [y, m] = iso.split("-");
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${meses[parseInt(m, 10) - 1]} ${y.slice(2)}`;
};

function ChartCard({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  children,
  rightStat,
}: {
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  children: React.ReactNode;
  rightStat?: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${iconColor}20` }}>
            <Icon size={14} style={{ color: iconColor }} />
          </div>
          <div>
            <div className="text-xs font-bold text-text">{title}</div>
            <div className="text-[10px] text-text-muted">{subtitle}</div>
          </div>
        </div>
        {rightStat}
      </div>
      {children}
    </div>
  );
}

function ProfitDailyChart() {
  const { data } = useQuery<ProfitDailyResp>({
    queryKey: ["products-ts", "profit-daily", 90],
    queryFn: () => api(`/api/dashboards/products/timeseries/profit-daily?days=90`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[220px] animate-pulse bg-soft rounded" />;
  return (
    <ChartCard
      title="Ganancia neta diaria · 90d"
      subtitle="Barras = ganancia del dia · linea = media movil 7d"
      icon={TrendingUp}
      iconColor="#10b981"
      rightStat={
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Total 90d</div>
          <div className="text-base font-extrabold tabular-nums">{formatCurrency(data.summary.total_ganancia)}</div>
          <div className="text-[10px] text-text-muted">{data.summary.margen_promedio_pct}% margen</div>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data.points} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtTickK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            formatter={(value: number, name: string) => [formatCurrency(value), name === "ganancia" ? "Ganancia" : "Media movil 7d"]}
            labelFormatter={(label) => fmtDateShort(label as string)}
          />
          <Bar dataKey="ganancia" fill="#10b981" radius={[2, 2, 0, 0]} />
          <Line type="monotone" dataKey="ganancia_ma7" stroke="#7a3eae" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function RevenueCostProfitChart() {
  const { data } = useQuery<ProfitDailyResp>({
    queryKey: ["products-ts", "profit-daily", 90],
    queryFn: () => api(`/api/dashboards/products/timeseries/profit-daily?days=90`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[220px] animate-pulse bg-soft rounded" />;
  return (
    <ChartCard
      title="Revenue vs Costo vs Ganancia · 90d"
      subtitle="Detecta compresion de margen · area apilada"
      icon={Layers}
      iconColor="#7a3eae"
      rightStat={
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Revenue 90d</div>
          <div className="text-base font-extrabold tabular-nums">{formatCurrency(data.summary.total_revenue)}</div>
          <div className="text-[10px] text-text-muted">costo {formatCurrency(data.summary.total_costo)}</div>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data.points} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7a3eae" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#7a3eae" stopOpacity={0} />
            </linearGradient>
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
            formatter={(value: number, name: string) => [formatCurrency(value), name]}
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

function CatalogActiveChart() {
  const { data } = useQuery<CatalogActiveResp>({
    queryKey: ["products-ts", "catalog-active", 52],
    queryFn: () => api(`/api/dashboards/products/timeseries/catalog-active?weeks=52`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[220px] animate-pulse bg-soft rounded" />;
  return (
    <ChartCard
      title="Catalogo activo · 52 semanas"
      subtitle={`% del catalogo (${formatNumber(data.total_publicados)} SKUs) que vendio cada semana`}
      icon={Package}
      iconColor="#06b6d4"
      rightStat={
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ultima semana</div>
          <div className="text-base font-extrabold tabular-nums">{data.summary.ultimo_pct}%</div>
          <div className="text-[10px] text-text-muted">prom. {data.summary.promedio_pct}% · max {data.summary.max_pct}%</div>
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data.points} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g-cat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eadefc" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={{ borderRadius: 8, fontSize: 11 }}
            formatter={(value: number, name: string, props: any) => {
              if (name === "pct_activo") return [`${value}%`, "% activo"];
              return [formatNumber(value), name];
            }}
            labelFormatter={(label) => fmtDateShort(label as string)}
          />
          <Area type="monotone" dataKey="pct_activo" stroke="#06b6d4" fill="url(#g-cat)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function AbcDistributionChart() {
  const { data } = useQuery<AbcDistResp>({
    queryKey: ["products-ts", "abc-dist", 12],
    queryFn: () => api(`/api/dashboards/products/timeseries/abc-distribution?months=12`),
    staleTime: 5 * 60_000,
  });
  if (!data) return <div className="h-[220px] animate-pulse bg-soft rounded" />;
  const last = data.points[data.points.length - 1];
  return (
    <ChartCard
      title="Distribucion ABC mensual · 12 meses"
      subtitle="Cuantos SKUs concentran el revenue (concentracion creciente = riesgo)"
      icon={BarChart3}
      iconColor="#f59e0b"
      rightStat={
        last && (
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Mes actual</div>
            <div className="text-base font-extrabold tabular-nums">{last.skus_a + last.skus_b + last.skus_c} SKUs</div>
            <div className="text-[10px] text-text-muted">{last.concentracion_a_pct}% clase A</div>
          </div>
        )
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data.points} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
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

export function ProductsTrendCharts() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
      <ProfitDailyChart />
      <RevenueCostProfitChart />
      <CatalogActiveChart />
      <AbcDistributionChart />
    </div>
  );
}
