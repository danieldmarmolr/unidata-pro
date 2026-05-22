"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TrendingUp, Package, AlertTriangle, Calendar } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatNumber, formatCurrency } from "@/lib/utils";

type ForecastItem = {
  sku: string;
  nombre: string;
  units_30d: number;
  units_prev30d: number;
  units_90d: number;
  daily_velocity: number;
  trend_pct: number;
  forecast_30d: number;
  forecast_60d: number;
  forecast_30d_revenue: number;
  stock_actual: number;
  days_until_stockout: number | null;
  alert_30d: boolean;
  alert_60d: boolean;
  po_sugerida_30d: number;
  po_sugerida_60d: number;
};

type Resp = {
  forecasts: ForecastItem[];
  summary: {
    total_skus: number;
    total_units_30d: number;
    total_revenue_30d: number;
    alerts_30d: number;
    alerts_60d: number;
  };
  method: string;
};

export default function ForecastPage() {
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["forecast-batch"],
    queryFn: () => api("/api/dashboards/forecast-batch?top_n=100"),
    staleTime: 10 * 60_000,
  });

  return (
    <>
      <Topbar
        title="Forecast batch · Demanda 30-60 días"
        subtitle="Predicción por SKU + PO sugerida si stock no alcanza"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · Forecast" />
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-5 mb-6">
          <div className="text-sm font-bold text-blue-900 mb-1">¿Cómo se calcula?</div>
          <div className="text-xs text-blue-800/90 leading-relaxed">
            <strong>Método</strong>: velocidad diaria sobre últimos 90 días × (1 + tendencia 30d vs 30d previo, acotada a ±50%).
            <br />
            <strong>Por qué simple</strong>: con menos de 1 año de historia, modelos pesados (Prophet, ARIMA) sobreajustan. La media móvil con factor de tendencia es robusta y suficiente para PO de 30-60 días.
            <br />
            <strong>Acción inmediata</strong>: SKUs con alerta 🔴 = stock no alcanza el forecast → revisar PO sugerida y aprobar.
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard icon={Package} label="SKUs analizados" value={data.summary.total_skus.toString()} color="from-violet-500 to-fuchsia-500" />
            <SummaryCard icon={Calendar} label="Forecast 30d (unid)" value={formatNumber(data.summary.total_units_30d)} color="from-blue-500 to-cyan-500" />
            <SummaryCard icon={TrendingUp} label="Forecast 30d (revenue)" value={formatCurrency(data.summary.total_revenue_30d)} color="from-emerald-500 to-teal-500" />
            <SummaryCard icon={AlertTriangle} label="Alertas stockout 30d" value={data.summary.alerts_30d.toString()} color="from-red-500 to-rose-500" />
          </div>
        )}

        {isLoading && (
          <div className="bg-surface border border-border rounded-xl p-5 h-[500px] animate-pulse" />
        )}

        {data && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-bold text-text">Forecast por SKU (top 100 por demanda 30d)</div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {data.method} · Alertas primero, después por forecast desc
                </div>
              </div>
              <ExportButtons
                filename="forecast_batch_30d"
                columns={[
                  "SKU", "Nombre", "Velocidad/día", "Tendencia %", "Forecast 30d",
                  "Forecast 60d", "Stock actual", "Días hasta stockout",
                  "Alerta 30d", "Alerta 60d", "PO sugerida 30d", "PO sugerida 60d",
                ]}
                rows={data.forecasts.map((f) => [
                  f.sku, f.nombre, f.daily_velocity, f.trend_pct,
                  f.forecast_30d, f.forecast_60d, f.stock_actual,
                  f.days_until_stockout, f.alert_30d ? "SI" : "no",
                  f.alert_60d ? "SI" : "no", f.po_sugerida_30d, f.po_sugerida_60d,
                ])}
              />
            </div>
            <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">SKU / Producto</th>
                    <th className="text-right px-3 py-2">Vel/día</th>
                    <th className="text-right px-3 py-2">Tendencia</th>
                    <th className="text-right px-3 py-2">Fcst 30d</th>
                    <th className="text-right px-3 py-2">Fcst 60d</th>
                    <th className="text-right px-3 py-2">Stock</th>
                    <th className="text-right px-3 py-2">Días stock</th>
                    <th className="text-right px-3 py-2">PO 30d</th>
                    <th className="text-right px-3 py-2">PO 60d</th>
                  </tr>
                </thead>
                <tbody>
                  {data.forecasts.map((f, i) => (
                    <tr key={i} className={"border-t border-border hover:bg-soft transition " + (f.alert_30d ? "bg-red-50/40" : f.alert_60d ? "bg-amber-50/30" : "")}>
                      <td className="px-3 py-2">
                        <Link href={`/dashboard/productos/${encodeURIComponent(f.sku)}`} className="text-primary hover:underline font-medium block">{f.nombre}</Link>
                        <div className="text-[10px] font-mono text-text-muted">{f.sku}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.daily_velocity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={f.trend_pct > 5 ? "text-emerald-700 font-semibold" : f.trend_pct < -5 ? "text-red-700 font-semibold" : "text-text-muted"}>
                          {f.trend_pct > 0 ? "+" : ""}{f.trend_pct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatNumber(f.forecast_30d)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(f.forecast_60d)}</td>
                      <td className={"px-3 py-2 text-right tabular-nums " + (f.alert_30d ? "text-red-700 font-bold" : "")}>{formatNumber(f.stock_actual)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.days_until_stockout !== null ? (
                          <span className={f.days_until_stockout < 30 ? "text-red-700 font-bold" : f.days_until_stockout < 60 ? "text-amber-700 font-semibold" : "text-text-muted"}>
                            {f.days_until_stockout}d
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.po_sugerida_30d > 0 ? (
                          <span className="text-red-700 font-bold">{formatNumber(f.po_sugerida_30d)}</span>
                        ) : <span className="text-text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.po_sugerida_60d > 0 ? formatNumber(f.po_sugerida_60d) : <span className="text-text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
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
