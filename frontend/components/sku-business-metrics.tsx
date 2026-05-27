"use client";

import {
  Package, Boxes, Activity, Sigma, DollarSign, Wallet,
  Tag, ArrowUpRight, Percent, Coins, Users,
} from "lucide-react";
import { formatNumber, formatCurrency } from "@/lib/utils";

// 11 metricas business del SKU en formato strip denso. Respetan el filtro
// de periodo del topbar (menos Stock que es snapshot vigente).
// Layout: 1 grid de 11 columnas en desktop, 3-4 en mobile.

export type BusinessMetrics = {
  uv: number;
  stock_disponible: number;
  uv_prom_diario: number;
  uv_de_diario: number;
  facturacion: number;
  costo_unit_ars: number | null;
  precio_promedio: number;
  markup_unit: number;
  markup_pct: number | null;
  total_markup: number;
  total_clientes: number;
  dias_periodo: number;
  period_label: string;
};

type Props = { metrics: BusinessMetrics | null | undefined };

type MetricDef = {
  key: keyof BusinessMetrics;
  label: string;
  icon: any;
  format: "int" | "decimal" | "currency" | "pct";
  tone: string;
  hint: string;
  /** Resaltado especial (ej. ganancia/markup) */
  emphasis?: "good" | "neutral";
};

const METRICS: MetricDef[] = [
  { key: "uv", label: "U.V.", icon: Package, format: "int", tone: "text-text", hint: "Unidades vendidas en el periodo" },
  { key: "stock_disponible", label: "Stock", icon: Boxes, format: "int", tone: "text-cyan-700", hint: "Disponibles en DIGIP (snapshot vigente)" },
  { key: "uv_prom_diario", label: "Prom. diario U.V.", icon: Activity, format: "decimal", tone: "text-violet-700", hint: "Unidades / días del periodo" },
  { key: "uv_de_diario", label: "D.E. diario U.V.", icon: Sigma, format: "decimal", tone: "text-violet-700", hint: "Desviación estándar diaria · mide variabilidad" },
  { key: "facturacion", label: "Facturación", icon: DollarSign, format: "currency", tone: "text-primary", hint: "Revenue acumulado del periodo", emphasis: "good" },
  { key: "total_clientes", label: "Total clientes", icon: Users, format: "int", tone: "text-amber-700", hint: "Distintos compradores en el periodo" },
  { key: "costo_unit_ars", label: "Costo", icon: Coins, format: "currency", tone: "text-rose-700", hint: "Costo unitario ARS con IVA · lote vigente" },
  { key: "precio_promedio", label: "Precio", icon: Tag, format: "currency", tone: "text-text", hint: "Precio promedio efectivo = facturación / U.V." },
  { key: "markup_unit", label: "Markup", icon: ArrowUpRight, format: "currency", tone: "text-emerald-700", hint: "Precio − Costo (por unidad)" },
  { key: "markup_pct", label: "Markup %", icon: Percent, format: "pct", tone: "text-emerald-700", hint: "Markup / Costo × 100", emphasis: "good" },
  { key: "total_markup", label: "Total markup", icon: Wallet, format: "currency", tone: "text-emerald-800", hint: "Markup × U.V. del periodo", emphasis: "good" },
];

function fmtVal(v: number | null | undefined, format: MetricDef["format"]): string {
  if (v === null || v === undefined) return "—";
  if (!Number.isFinite(v)) return "—";
  if (format === "currency") return formatCurrency(Math.round(v));
  if (format === "pct") return `${v.toFixed(1)}%`;
  if (format === "decimal") return v.toFixed(2);
  return formatNumber(v);
}

export function SkuBusinessMetrics({ metrics }: Props) {
  if (!metrics) {
    return <div className="bg-surface border border-border rounded-xl h-[88px] mb-6 animate-pulse" />;
  }

  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2 mb-6">
      <div className="flex items-baseline justify-between mb-1.5 px-1">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">
          Métricas del periodo
        </div>
        <div className="text-[10px] text-text-muted">
          {metrics.period_label} · {metrics.dias_periodo} día{metrics.dias_periodo === 1 ? "" : "s"}
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-11 gap-1 divide-x divide-border/60">
        {METRICS.map((m) => {
          const v = metrics[m.key] as number | null | undefined;
          const Icon = m.icon;
          const emphasisCls =
            m.emphasis === "good"
              ? "bg-emerald-50/40"
              : "";
          return (
            <div
              key={m.key}
              className={`flex flex-col px-2.5 py-1.5 min-w-0 ${emphasisCls}`}
              title={m.hint}
            >
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-text-muted font-bold truncate">
                <Icon size={9} className={m.tone} />
                <span className="truncate">{m.label}</span>
              </div>
              <div className={`text-sm font-extrabold tabular-nums leading-tight mt-0.5 ${m.tone}`}>
                {fmtVal(v as number, m.format)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
