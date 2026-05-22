"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Zap, Package, AlertTriangle, TrendingDown, TrendingUp, DollarSign, X } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Combo = {
  sku_a: string; sku_b: string; co_orders: number;
  name_a: string; name_b: string; accion: string; razon: string;
};
type Reposicion = {
  sku: string; nombre: string; units_30d: number; daily_velocity: number;
  stock_actual: number; days_left: number; urgencia: string; accion: string;
};
type Liquidar = {
  sku: string; nombre: string; units_30d: number; units_prev30d: number;
  stock_actual: number; pct_change: number; accion: string;
};
type Pricing = {
  sku: string; nombre: string; units_30d: number; units_prev30d: number;
  precio_actual: number; precio_sugerido: number; accion: string; razon: string;
};
type OptimizerResp = {
  unit?: "unistore" | "unidrop";
  combos: Combo[];
  reposiciones: Reposicion[];
  liquidar: Liquidar[];
  pricing: Pricing[];
  notas?: Partial<Record<"combos" | "reposiciones" | "liquidar" | "pricing", string>>;
  summary: {
    combos_count: number;
    reposiciones_count: number;
    liquidar_count: number;
    pricing_count: number;
  };
};

type FilterKey = "combos" | "reposiciones" | "liquidar" | "pricing";
type Unit = "unistore" | "unidrop";

export default function SkuOptimizerPage() {
  const [unit, setUnit] = useState<Unit>("unistore");
  const { data, isLoading } = useQuery<OptimizerResp>({
    queryKey: ["sku-optimizer", unit],
    queryFn: () => api(`/api/dashboards/sku-optimizer?unit=${unit}`),
    staleTime: 5 * 60_000,
  });
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const toggle = (k: FilterKey) => setActiveFilter((cur) => (cur === k ? null : k));
  const show = (k: FilterKey) => activeFilter === null || activeFilter === k;

  return (
    <>
      <Topbar
        title="SKU Optimizer"
        subtitle="Recomendaciones accionables · combos · reposición urgente · liquidar · subir precio"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · SKU Optimizer" />
        {/* Unit selector: Unistore (retail propio) vs Unidrop (red de dropshippers) */}
        <div className="mb-4 inline-flex bg-soft rounded-xl p-1 border border-border">
          <button
            onClick={() => setUnit("unistore")}
            className={
              "px-4 py-1.5 text-xs font-bold rounded-lg transition " +
              (unit === "unistore" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")
            }
          >
            UNISTORE
          </button>
          <button
            onClick={() => setUnit("unidrop")}
            className={
              "px-4 py-1.5 text-xs font-bold rounded-lg transition " +
              (unit === "unidrop" ? "bg-surface shadow text-text" : "text-text-muted hover:text-text")
            }
          >
            UNIDROP
          </button>
        </div>

        {/* Intro */}
        <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-5 mb-6 flex items-start gap-3">
          <Zap size={20} className="text-violet-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-violet-900 mb-1">¿Qué hace el optimizador?</div>
            <div className="text-xs text-violet-800/90 leading-relaxed">
              Cruza varios análisis (cross-sell, lifecycle, stockout, tendencias) y devuelve <strong>4 listas de acciones concretas</strong> que el equipo puede ejecutar esta semana. No son métricas para mirar — son recomendaciones para apretar el botón:
            </div>
            <ul className="text-xs text-violet-800/90 mt-2 space-y-0.5 ml-4 list-disc">
              <li><strong>Combos:</strong> bundles a armar con descuento agresivo</li>
              <li><strong>Reposición urgente:</strong> qué pedir YA antes de quebrar stock</li>
              <li><strong>Liquidar / discontinuar:</strong> qué sacar de catálogo</li>
              <li><strong>Subir precio:</strong> SKUs con poder de pricing inexplotado</li>
            </ul>
          </div>
        </div>

        {/* Summary cards - actúan como filtros */}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <SummaryCard icon={Package} label="Combos sugeridos" value={data.summary.combos_count} color="from-emerald-500 to-teal-500" active={activeFilter === "combos"} onClick={() => toggle("combos")} />
              <SummaryCard icon={AlertTriangle} label="Reposición urgente" value={data.summary.reposiciones_count} color="from-red-500 to-rose-500" active={activeFilter === "reposiciones"} onClick={() => toggle("reposiciones")} />
              <SummaryCard icon={TrendingDown} label="Liquidar/discontinuar" value={data.summary.liquidar_count} color="from-amber-500 to-orange-500" active={activeFilter === "liquidar"} onClick={() => toggle("liquidar")} />
              <SummaryCard icon={DollarSign} label="Subir precio" value={data.summary.pricing_count} color="from-blue-500 to-cyan-500" active={activeFilter === "pricing"} onClick={() => toggle("pricing")} />
            </div>
            <div className="mb-6 text-[11px] text-text-muted flex items-center gap-2">
              {activeFilter ? (
                <>
                  <span>Mostrando solo: <strong className="text-text capitalize">{activeFilter}</strong>.</span>
                  <button onClick={() => setActiveFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border hover:bg-soft transition">
                    <X size={11} /> Limpiar filtro
                  </button>
                </>
              ) : (
                <span>Tocá una tarjeta para filtrar a esa sección.</span>
              )}
            </div>
          </>
        )}

        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[300px] animate-pulse" />
            ))}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* COMBOS */}
            {show("combos") && (
            <Section
              icon={Package}
              title="Combos sugeridos"
              subtitle="Pares de SKUs que se compran juntos frecuentemente — armar bundle con descuento"
              color="emerald"
              exportFilename="sku_optimizer_combos"
              exportColumns={["SKU A", "Nombre A", "SKU B", "Nombre B", "Co-órdenes", "Acción"]}
              exportRows={data.combos.map((c) => [c.sku_a, c.name_a, c.sku_b, c.name_b, c.co_orders, c.accion])}
            >
              {data.combos.length === 0 ? (
                <Empty msg="Sin combos detectados con criterio actual" />
              ) : (
                <div className="space-y-2">
                  {data.combos.map((c, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50/30">
                      <div className="text-xl font-extrabold text-emerald-600 w-8 text-center">{i + 1}</div>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        <Link href={`/dashboard/productos/${encodeURIComponent(c.sku_a)}`} className="hover:underline">
                          <span className="font-mono text-primary text-xs">{c.sku_a}</span> · {c.name_a}
                        </Link>
                        <Link href={`/dashboard/productos/${encodeURIComponent(c.sku_b)}`} className="hover:underline">
                          <span className="font-mono text-primary text-xs">{c.sku_b}</span> · {c.name_b}
                        </Link>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-emerald-700">{c.co_orders} órd.</div>
                        <div className="text-[10px] text-text-muted">juntos en 90d</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            )}

            {/* REPOSICION */}
            {show("reposiciones") && (
            <Section
              icon={AlertTriangle}
              title={unit === "unidrop" ? "Top movers Unidrop · verificar stock Unistore" : "Reposición urgente"}
              subtitle={unit === "unidrop"
                ? "SKUs con mayor velocidad en la red de dropshippers · stock fisico vive en Unistore"
                : "SKUs con < 14 días de stock al ritmo actual de venta — ordenar YA"}
              note={data.notas?.reposiciones}
              color="red"
              exportFilename="sku_optimizer_reposicion"
              exportColumns={["SKU", "Nombre", "Unid 30d", "Vel. diaria", "Stock", "Días restantes", "Urgencia", "Acción"]}
              exportRows={data.reposiciones.map((r) => [r.sku, r.nombre, r.units_30d, r.daily_velocity, r.stock_actual, r.days_left, r.urgencia, r.accion])}
            >
              {data.reposiciones.length === 0 ? (
                <Empty msg="Sin SKUs en riesgo de stockout - bien hecho 👍" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left py-2">SKU / Producto</th>
                      <th className="text-right py-2">Vel.</th>
                      <th className="text-right py-2">Stock</th>
                      <th className="text-right py-2">Días</th>
                      <th className="text-left py-2 pl-3">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reposiciones.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-2">
                          <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`} className="text-primary hover:underline font-medium">{r.nombre}</Link>
                          <div className="text-[10px] font-mono text-text-muted">{r.sku}</div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{r.daily_velocity}/día</td>
                        <td className="py-2 text-right tabular-nums">
                          {r.stock_actual < 0 ? <span className="text-text-muted italic text-xs">en Unistore</span> : formatNumber(r.stock_actual)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {r.stock_actual < 0
                            ? <span className="text-amber-700 text-xs">verificar</span>
                            : <span className={r.days_left < 7 ? "text-red-600 font-bold" : "text-amber-700 font-bold"}>{r.days_left}d</span>}
                        </td>
                        <td className="py-2 pl-3 text-xs text-text-muted">{r.accion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            )}

            {/* LIQUIDAR */}
            {show("liquidar") && (
            <Section
              icon={TrendingDown}
              title="Liquidar o discontinuar"
              subtitle={unit === "unidrop"
                ? "Ventas en caída en la red Unidrop — comunicar a dropshippers"
                : "Ventas en caída con stock alto — liberar capital atado"}
              note={data.notas?.liquidar}
              color="amber"
              exportFilename="sku_optimizer_liquidar"
              exportColumns={["SKU", "Nombre", "Unid 30d", "Unid 30d previo", "Stock", "% Cambio", "Acción"]}
              exportRows={data.liquidar.map((r) => [r.sku, r.nombre, r.units_30d, r.units_prev30d, r.stock_actual, r.pct_change, r.accion])}
            >
              {data.liquidar.length === 0 ? (
                <Empty msg="Sin SKUs en caida critica" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left py-2">SKU / Producto</th>
                      <th className="text-right py-2">30d</th>
                      <th className="text-right py-2">Previo</th>
                      <th className="text-right py-2">Cambio</th>
                      <th className="text-right py-2">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.liquidar.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-2">
                          <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`} className="text-primary hover:underline font-medium">{r.nombre}</Link>
                          <div className="text-[10px] font-mono text-text-muted">{r.sku}</div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{r.units_30d}</td>
                        <td className="py-2 text-right tabular-nums">{r.units_prev30d}</td>
                        <td className="py-2 text-right tabular-nums">
                          <span className="text-red-600 font-bold">{r.pct_change}%</span>
                        </td>
                        <td className="py-2 text-right tabular-nums text-amber-700">
                          {r.stock_actual < 0 ? <span className="text-text-muted italic text-xs">en Unistore</span> : formatNumber(r.stock_actual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            )}

            {/* PRICING */}
            {show("pricing") && (
            <Section
              icon={DollarSign}
              title="Candidatos a subir precio"
              subtitle="Demanda estable + alto volumen → poder de pricing inexplotado"
              color="blue"
              exportFilename="sku_optimizer_pricing"
              exportColumns={["SKU", "Nombre", "Unid 30d", "Precio actual", "Precio sugerido", "Razón"]}
              exportRows={data.pricing.map((r) => [r.sku, r.nombre, r.units_30d, r.precio_actual, r.precio_sugerido, r.razon])}
            >
              {data.pricing.length === 0 ? (
                <Empty msg="Sin candidatos claros con criterio actual" />
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left py-2">SKU / Producto</th>
                      <th className="text-right py-2">Precio actual</th>
                      <th className="text-right py-2">+5% sugerido</th>
                      <th className="text-right py-2">30d</th>
                      <th className="text-left py-2 pl-3">Razón</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pricing.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-2">
                          <Link href={`/dashboard/productos/${encodeURIComponent(r.sku)}`} className="text-primary hover:underline font-medium">{r.nombre}</Link>
                          <div className="text-[10px] font-mono text-text-muted">{r.sku}</div>
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(r.precio_actual)}</td>
                        <td className="py-2 text-right tabular-nums font-bold text-blue-700">{formatCurrency(r.precio_sugerido)}</td>
                        <td className="py-2 text-right tabular-nums">{r.units_30d}</td>
                        <td className="py-2 pl-3 text-xs text-text-muted">{r.razon}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function SummaryCard({ icon: Icon, label, value, color, active, onClick }: { icon: any; label: string; value: number; color: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-left bg-surface border rounded-xl p-4 transition cursor-pointer hover:shadow-md hover:-translate-y-0.5 " +
        (active ? "border-primary ring-2 ring-primary/30 shadow-md" : "border-border")
      }
    >
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} text-white flex items-center justify-center shadow-md mb-2`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-extrabold text-text tabular-nums">{value}</div>
      <div className="text-[11px] text-text-muted">{label}{active ? " · filtrando" : ""}</div>
    </button>
  );
}

function Section({ icon: Icon, title, subtitle, color, exportFilename, exportColumns, exportRows, note, children }: any) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-600 border-emerald-200",
    red: "text-red-600 border-red-200",
    amber: "text-amber-600 border-amber-200",
    blue: "text-blue-600 border-blue-200",
  };
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Icon size={20} className={colorMap[color]?.split(" ")[0] ?? ""} />
          <div>
            <div className="text-sm font-bold text-text">{title}</div>
            <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>
          </div>
        </div>
        <ExportButtons filename={exportFilename} columns={exportColumns} rows={exportRows} />
      </div>
      {note && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
          <strong className="font-semibold">Nota Unidrop:</strong> {note}
        </div>
      )}
      {children}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="py-8 text-center text-text-muted text-sm">{msg}</div>;
}
