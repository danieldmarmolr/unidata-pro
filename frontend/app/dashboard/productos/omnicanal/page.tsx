"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Info } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { DashboardHeader } from "@/components/dashboard-header";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type SkuRow = {
  sku: string;
  name: string;
  units_total: number;
  units_unistore: number;
  units_unidrop: number;
  share_unistore_pct: number;
  share_unidrop_pct: number;
  unistore_tn: { units: number; revenue: number; avg_price: number };
  unistore_ml: { units: number; revenue: number; avg_price: number };
  unidrop_tn: { units: number; revenue: number; avg_price: number };
  unidrop_ml: {
    units: number;
    revenue_retail: number;
    revenue_mayorista: number;
    avg_unit_price: number;
    avg_unit_cost: number;
  };
  spread_retail_pct: number | null;
  margen_drp_ml_pct: number | null;
  precio_mayorista_avg: number;
  precio_retail_unistore_avg: number;
  precio_retail_unidrop_avg: number;
};

type WholesaleResp = {
  period_days: number;
  skus: SkuRow[];
  summary: {
    total_skus: number;
    total_units: number;
    skus_con_dato_mayorista: number;
    spread_retail_avg_pct: number;
    margen_drp_avg_pct: number;
  };
  generated_at: string;
  todo: string[];
};

export default function OmnicanalPage() {
  const [period, setPeriod] = useState(90);
  const { data, isFetching } = useQuery<WholesaleResp>({
    queryKey: ["products-wholesale", period],
    queryFn: () => api(`/api/dashboards/products/wholesale-table?period_days=${period}&limit=200`),
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <Topbar
        title="Producto · Omnicanal mayorista"
        subtitle="Precio + volumen en los 4 canales · spread retail · margen del dropshipper"
      />

      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · Omnicanal" />
        <DashboardHeader
          generatedAt={data?.generated_at}
          isFetching={isFetching}
          filters={
            <select
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="px-3 py-1.5 text-xs border border-border rounded-lg"
            >
              <option value={30}>Ultimos 30 dias</option>
              <option value={90}>Ultimos 90 dias</option>
              <option value={180}>Ultimos 180 dias</option>
              <option value={365}>Ultimo ano</option>
            </select>
          }
        />

        <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <Info size={16} className="text-violet-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-violet-900">
            <strong>Que es:</strong> Vista cruzada de cada SKU en los 4 canales del grupo —
            Unistore TN, Unistore MELI (Fox Electronics), Unidrop TN (dropshippers) y Unidrop MELI
            (dropshippers). Para Unidrop MELI tenemos costo mayorista (lo que el dropshipper paga a Unistore)
            + precio retail (lo que el dropshipper le cobra al consumidor final), asi se puede calcular
            el margen del dropshipper y el spread entre el precio de Unistore directo vs Unidrop.
            <br />
            <strong>Como usarlo:</strong> Detectar SKUs con margen del dropshipper muy alto (Unistore podria
            subir su PVP mayorista) o muy bajo (riesgo de que el dropshipper deje de comprar). Ver donde
            hay arbitraje entre canales.
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
            <KpiBox label="SKUs analizados" value={formatNumber(data.summary.total_skus)} hint={`top por volumen en ${data.period_days}d`} />
            <KpiBox label="Unidades totales" value={formatNumber(data.summary.total_units)} hint="cross-canal en el periodo" />
            <KpiBox label="Spread retail promedio" value={`${data.summary.spread_retail_avg_pct >= 0 ? "+" : ""}${data.summary.spread_retail_avg_pct}%`}
              hint="precio Unidrop vs Unistore" />
            <KpiBox label="Margen dropshipper avg" value={`${data.summary.margen_drp_avg_pct}%`} hint="(retail - mayorista) / retail · MELI" />
          </div>
        )}

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-text">Tabla omnicanal por SKU</h3>
              <p className="text-[11px] text-text-muted">
                Ordenado por unidades totales · {data?.skus.length ?? 0} SKUs · click para abrir SKU 360
              </p>
            </div>
            {data && (
              <ExportButtons
                filename={`omnicanal_${period}d`}
                columns={[
                  "SKU", "Nombre", "Unid total", "Unid Unistore", "Unid Unidrop",
                  "%Unistore", "Precio Uni TN", "Precio Uni ML", "Precio Drp TN",
                  "Precio Drp ML retail", "Precio Drp ML costo (mayorista)",
                  "Spread retail %", "Margen Drp ML %",
                ]}
                rows={data.skus.map((r) => [
                  r.sku, r.name, r.units_total, r.units_unistore, r.units_unidrop,
                  r.share_unistore_pct, r.unistore_tn.avg_price, r.unistore_ml.avg_price,
                  r.unidrop_tn.avg_price, r.unidrop_ml.avg_unit_price, r.unidrop_ml.avg_unit_cost,
                  r.spread_retail_pct ?? "", r.margen_drp_ml_pct ?? "",
                ])}
              />
            )}
          </div>

          <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="text-left px-2 py-2">SKU / Producto</th>
                  <th className="text-right px-2 py-2">Unidades</th>
                  <th className="text-right px-2 py-2">Mix Uni / Drp</th>
                  <th className="text-right px-2 py-2 bg-violet-50">Precio Uni TN</th>
                  <th className="text-right px-2 py-2 bg-violet-50">Precio Uni ML</th>
                  <th className="text-right px-2 py-2 bg-amber-50">Precio Drp TN</th>
                  <th className="text-right px-2 py-2 bg-amber-50">Precio Drp ML</th>
                  <th className="text-right px-2 py-2 bg-emerald-50">Costo mayorista</th>
                  <th className="text-right px-2 py-2">Spread retail</th>
                  <th className="text-right px-2 py-2">Margen Drp</th>
                </tr>
              </thead>
              <tbody>
                {data?.skus.map((r) => (
                  <tr key={r.sku} className="border-t border-border hover:bg-soft/40">
                    <td className="px-2 py-1.5">
                      <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`}
                        className="text-primary hover:underline font-medium block truncate max-w-[280px]">
                        {r.name}
                      </Link>
                      <div className="text-[9px] text-text-muted/70 font-mono">{r.sku}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold">{formatNumber(r.units_total)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      <span className="text-violet-700 font-semibold">{r.share_unistore_pct}%</span>
                      <span className="text-text-muted/60"> / </span>
                      <span className="text-amber-700 font-semibold">{r.share_unidrop_pct}%</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums bg-violet-50/40">
                      {r.unistore_tn.avg_price > 0 ? formatCurrency(r.unistore_tn.avg_price) : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums bg-violet-50/40">
                      {r.unistore_ml.avg_price > 0 ? formatCurrency(r.unistore_ml.avg_price) : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums bg-amber-50/40">
                      {r.unidrop_tn.avg_price > 0 ? formatCurrency(r.unidrop_tn.avg_price) : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums bg-amber-50/40">
                      {r.unidrop_ml.avg_unit_price > 0 ? formatCurrency(r.unidrop_ml.avg_unit_price) : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums bg-emerald-50/40 font-bold">
                      {r.precio_mayorista_avg > 0 ? formatCurrency(r.precio_mayorista_avg) : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.spread_retail_pct !== null ? (
                        <span className={r.spread_retail_pct >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                          {r.spread_retail_pct >= 0 ? "+" : ""}{r.spread_retail_pct}%
                        </span>
                      ) : <span className="text-text-muted/40">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.margen_drp_ml_pct !== null ? (
                        <span className={
                          r.margen_drp_ml_pct >= 30 ? "text-emerald-700 font-bold"
                          : r.margen_drp_ml_pct >= 10 ? "text-amber-700 font-bold"
                          : "text-rose-700 font-bold"
                        }>{r.margen_drp_ml_pct}%</span>
                      ) : <span className="text-text-muted/40">—</span>}
                    </td>
                  </tr>
                ))}
                {!data && (
                  <tr><td colSpan={10} className="text-center py-12 text-text-muted">Cargando dataset omnicanal…</td></tr>
                )}
                {data?.skus.length === 0 && (
                  <tr><td colSpan={10} className="text-center py-12 text-text-muted">Sin SKUs con datos cross-canal en el periodo</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {data?.todo && data.todo.length > 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="text-xs font-bold text-amber-900 mb-2">📌 Roadmap omnicanal — proximas iteraciones</div>
            <ul className="list-disc pl-5 text-xs text-amber-800 space-y-1">
              {data.todo.map((t) => <li key={t}>{t}</li>)}
            </ul>
            <div className="text-[10px] text-amber-700 mt-2">
              Detalles tecnicos en <code className="font-mono">docs/OMNICANAL_PRODUCTOS.md</code>.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function KpiBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className="text-2xl font-extrabold text-text mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
