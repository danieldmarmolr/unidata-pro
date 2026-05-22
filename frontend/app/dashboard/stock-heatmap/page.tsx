"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Warehouse, Package } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { DashboardHeader } from "@/components/dashboard-header";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

type Cell = { area: string; units: number };
type SkuRow = {
  sku: string;
  nombre: string;
  brand: string;
  total: number;
  cells: Cell[];
};
type Resp = {
  areas: { name: string; total: number }[];
  skus: SkuRow[];
  max_units: number;
  total_stock: number;
  top_skus_param: number;
  generated_at: string;
};

function colorFor(units: number, max: number): string {
  if (!units || units <= 0) return "rgba(148, 163, 184, 0.05)";
  const t = Math.min(1, units / max);
  // Escala violeta (paleta Unistore)
  const alpha = 0.15 + t * 0.7;
  return `rgba(122, 62, 174, ${alpha.toFixed(3)})`;
}

function textColorFor(units: number, max: number): string {
  if (!units || units <= 0) return "var(--text-muted, #94a3b8)";
  const t = units / max;
  return t > 0.45 ? "white" : "var(--text, #1e293b)";
}

export default function StockHeatmapPage() {
  const [topSkus, setTopSkus] = useState(30);

  const { data, isLoading, isFetching } = useQuery<Resp>({
    queryKey: ["stock-heatmap", topSkus],
    queryFn: () => api(`/api/dashboards/stock-heatmap?top_skus=${topSkus}`),
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Heatmap de Stock"
        subtitle="SKU × area de deposito · concentracion logistica · cross-area"
      />

      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · Stock" />
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <select
              value={topSkus}
              onChange={(e) => setTopSkus(Number(e.target.value))}
              className="px-3 py-1.5 text-xs rounded-lg border border-border bg-bg outline-none focus:border-primary"
            >
              <option value={20}>Top 20 SKUs</option>
              <option value={30}>Top 30 SKUs</option>
              <option value={50}>Top 50 SKUs</option>
              <option value={100}>Top 100 SKUs</option>
            </select>
          }
        />

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <KpiBox icon={Boxes} label="Stock total" value={formatNumber(data?.total_stock || 0)} accent="primary" />
          <KpiBox icon={Warehouse} label="Areas activas" value={formatNumber(data?.areas?.length || 0)} accent="emerald" />
          <KpiBox icon={Package} label="SKUs en grilla" value={formatNumber(data?.skus?.length || 0)} accent="amber" />
        </div>

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
            Cargando heatmap...
          </div>
        ) : data.skus.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-muted text-sm">
            Sin datos de stock disponibles.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-text">SKU × Area</h3>
                <p className="text-[11px] text-text-muted">Color violeta proporcional a unidades disponibles</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted">
                  <tr>
                    <th className="text-left px-3 py-2 sticky left-0 bg-soft z-10 min-w-[200px] uppercase tracking-wider text-[10px]">SKU</th>
                    <th className="text-right px-2 py-2 uppercase tracking-wider text-[10px]">Total</th>
                    {data.areas.map((a) => (
                      <th
                        key={a.name}
                        className="text-center px-2 py-2 uppercase tracking-wider text-[10px] min-w-[80px]"
                        title={`${a.name} - total ${formatNumber(a.total)}`}
                      >
                        <div className="truncate max-w-[100px] mx-auto" title={a.name}>{a.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.skus.map((s) => (
                    <tr key={s.sku} className="border-t border-border hover:bg-soft/30">
                      <td className="px-3 py-2 sticky left-0 bg-surface group-hover:bg-soft z-10">
                        <Link
                          href={`/dashboard/productos/${encodeURIComponent(s.sku)}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {s.nombre}
                        </Link>
                        <div className="text-[10px] text-text-muted truncate max-w-[200px]">
                          {s.sku}{s.brand ? ` · ${s.brand}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-bold">
                        {formatNumber(s.total)}
                      </td>
                      {s.cells.map((c, i) => (
                        <td
                          key={i}
                          className="text-center px-1 py-1 tabular-nums"
                          style={{
                            background: colorFor(c.units, data.max_units),
                            color: textColorFor(c.units, data.max_units),
                          }}
                          title={`${s.sku} · ${c.area}: ${formatNumber(c.units)} u`}
                        >
                          {c.units > 0 ? formatNumber(c.units) : "·"}
                        </td>
                      ))}
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

function KpiBox({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: "primary" | "emerald" | "amber" }) {
  const accentClasses = {
    primary: "from-primary to-accent",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${accentClasses[accent]} text-white flex items-center justify-center shadow-md`}>
          <Icon size={14} />
        </div>
      </div>
      <div className="text-xl font-extrabold text-text tabular-nums">{value}</div>
    </div>
  );
}
