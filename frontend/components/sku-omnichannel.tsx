"use client";

import { useQuery } from "@tanstack/react-query";
import { Store, ShoppingCart, Boxes, Award, AlertTriangle, Info, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Channel = {
  available: boolean;
  units_30d: number;
  units_90d: number;
  units_total: number;
  revenue_30d: number;
  revenue_90d: number;
  revenue_total: number;
  orders_total: number;
  first_sale: string | null;
  last_sale: string | null;
  ticket_promedio: number;
  avg_price: number;
  name: string | null;
  error: string | null;
};

type Inconsistencia = {
  tipo: string;
  severity: "info" | "warning" | "error";
  mensaje: string;
};

type Resp = {
  sku: string;
  nombre: string | null;
  channels: {
    unistore_tn: Channel;
    unistore_meli: Channel;
    unidrop_tn: Channel;
    unidrop_meli: Channel;
  };
  totales: {
    units_30d: number;
    units_90d: number;
    units_total: number;
    revenue_30d: number;
    revenue_90d: number;
    revenue_total: number;
    orders_total: number;
    channels_activos: number;
  };
  inconsistencias: Inconsistencia[];
  monthly_by_channel: {
    mes: string;
    unistore_tn: number;
    unistore_meli: number;
    unidrop_tn: number;
    unidrop_meli: number;
    rev_unistore_tn: number;
    rev_unistore_meli: number;
    rev_unidrop_tn: number;
    rev_unidrop_meli: number;
  }[];
};

const CHANNEL_META: Record<
  keyof Resp["channels"],
  { label: string; subtitle: string; icon: any; color: string; accent: string }
> = {
  unistore_tn: {
    label: "Unistore TN",
    subtitle: "Retail propio · Tienda Nube",
    icon: Store,
    color: "from-violet-500 to-fuchsia-500",
    accent: "border-violet-200 bg-violet-50/40",
  },
  unistore_meli: {
    label: "Unistore MELI",
    subtitle: "Fox Electronics · Mercado Libre",
    icon: Award,
    color: "from-amber-500 to-yellow-500",
    accent: "border-amber-200 bg-amber-50/40",
  },
  unidrop_tn: {
    label: "Unidrop TN",
    subtitle: "Dropshippers · Tienda Nube",
    icon: ShoppingCart,
    color: "from-cyan-500 to-sky-500",
    accent: "border-cyan-200 bg-cyan-50/40",
  },
  unidrop_meli: {
    label: "Unidrop MELI",
    subtitle: "Dropshippers · Mercado Libre",
    icon: Boxes,
    color: "from-emerald-500 to-teal-500",
    accent: "border-emerald-200 bg-emerald-50/40",
  },
};

function SeverityIcon({ severity }: { severity: Inconsistencia["severity"] }) {
  if (severity === "error") return <XCircle size={14} className="text-red-600 shrink-0 mt-0.5" />;
  if (severity === "warning") return <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />;
  return <Info size={14} className="text-blue-600 shrink-0 mt-0.5" />;
}

function ChannelCard({ keyName, c }: { keyName: keyof Resp["channels"]; c: Channel }) {
  const meta = CHANNEL_META[keyName];
  const Icon = meta.icon;
  return (
    <div className={`border-2 rounded-xl p-4 ${meta.accent} ${!c.available ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{meta.subtitle}</div>
          <div className="text-sm font-extrabold text-text truncate">{meta.label}</div>
        </div>
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${meta.color} text-white flex items-center justify-center shadow shrink-0`}>
          <Icon size={16} />
        </div>
      </div>

      {c.error ? (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
          Fuente inaccesible: {c.error}
        </div>
      ) : !c.available ? (
        <div className="text-xs text-text-muted italic mt-3">Sin ventas registradas en este canal</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <div className="text-[10px] text-text-muted uppercase">Unid. 30d</div>
              <div className="font-bold tabular-nums">{formatNumber(c.units_30d)}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted uppercase">Rev. 30d</div>
              <div className="font-bold tabular-nums">{formatCurrency(c.revenue_30d)}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted uppercase">Unid. total</div>
              <div className="text-sm tabular-nums">{formatNumber(c.units_total)}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted uppercase">Rev. total</div>
              <div className="text-sm tabular-nums">{formatCurrency(c.revenue_total)}</div>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-text-muted space-y-0.5">
            <div>
              <span>Ordenes: <strong className="text-text">{formatNumber(c.orders_total)}</strong></span>
              {" · "}
              <span>Ticket: <strong className="text-text">{formatCurrency(c.ticket_promedio)}</strong></span>
            </div>
            <div>Precio prom.: <strong className="text-text">{formatCurrency(c.avg_price)}</strong></div>
            {c.last_sale && <div>Ult. venta: <strong className="text-text">{c.last_sale.slice(0, 10)}</strong></div>}
          </div>
        </>
      )}
    </div>
  );
}

export function SkuOmnichannel({ sku }: { sku: string }) {
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["sku-omnichannel", sku],
    queryFn: () => api(`/api/dashboards/sku-omnichannel/${encodeURIComponent(sku)}`),
    staleTime: 5 * 60_000,
    enabled: !!sku,
  });

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5 mb-6">
        <div className="h-6 w-64 bg-soft rounded animate-pulse mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 bg-soft rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  if (!data || !data.channels) return null;

  const channels = data.channels;
  const maxMonthlyUnits = Math.max(
    1,
    ...data.monthly_by_channel.map((m) => m.unistore_tn + m.unistore_meli + m.unidrop_tn + m.unidrop_meli),
  );

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="text-sm font-bold text-text">Vista omnicanal del SKU · 4 fuentes orquestadas</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            Mismo SKU, 4 canales distintos. UNIDATA cruza las 2 bases (unistore_api + unidrop_api) con sus 4 esquemas.
          </p>
        </div>
        <div className="text-xs text-text-muted">
          Canales con ventas: <strong className="text-text">{data.totales.channels_activos}/4</strong>
          {" · "}
          Total 30d: <strong className="text-text">{formatNumber(data.totales.units_30d)} unid · {formatCurrency(data.totales.revenue_30d)}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <ChannelCard keyName="unistore_tn" c={channels.unistore_tn} />
        <ChannelCard keyName="unistore_meli" c={channels.unistore_meli} />
        <ChannelCard keyName="unidrop_tn" c={channels.unidrop_tn} />
        <ChannelCard keyName="unidrop_meli" c={channels.unidrop_meli} />
      </div>

      {data.inconsistencias.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Inconsistencias detectadas ({data.inconsistencias.length})
          </div>
          <div className="space-y-1.5">
            {data.inconsistencias.map((it, i) => (
              <div
                key={i}
                className={
                  "flex items-start gap-2 text-xs rounded-lg px-3 py-2 border " +
                  (it.severity === "error"
                    ? "bg-red-50 border-red-200 text-red-900"
                    : it.severity === "warning"
                    ? "bg-amber-50 border-amber-200 text-amber-900"
                    : "bg-blue-50 border-blue-200 text-blue-900")
                }
              >
                <SeverityIcon severity={it.severity} />
                <div>{it.mensaje}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.monthly_by_channel.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-2">
            Mix mensual por canal · ultimos 12 meses (unidades)
          </div>
          <div className="space-y-1.5">
            {data.monthly_by_channel.slice(-12).map((m) => {
              const total = m.unistore_tn + m.unistore_meli + m.unidrop_tn + m.unidrop_meli;
              const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
              return (
                <div key={m.mes} className="flex items-center gap-2 text-[11px]">
                  <div className="w-14 font-mono text-text-muted shrink-0">{m.mes}</div>
                  <div className="flex-1 h-5 bg-soft rounded overflow-hidden flex">
                    {m.unistore_tn > 0 && <div className="bg-violet-500 h-full" style={{ width: pct(m.unistore_tn) + "%" }} title={`Unistore TN: ${m.unistore_tn}`} />}
                    {m.unistore_meli > 0 && <div className="bg-amber-500 h-full" style={{ width: pct(m.unistore_meli) + "%" }} title={`Unistore MELI: ${m.unistore_meli}`} />}
                    {m.unidrop_tn > 0 && <div className="bg-cyan-500 h-full" style={{ width: pct(m.unidrop_tn) + "%" }} title={`Unidrop TN: ${m.unidrop_tn}`} />}
                    {m.unidrop_meli > 0 && <div className="bg-emerald-500 h-full" style={{ width: pct(m.unidrop_meli) + "%" }} title={`Unidrop MELI: ${m.unidrop_meli}`} />}
                  </div>
                  <div className="w-20 text-right tabular-nums font-semibold text-text">{formatNumber(total)} u</div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-text-muted">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-violet-500" /> Unistore TN</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500" /> Unistore MELI</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-cyan-500" /> Unidrop TN</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-500" /> Unidrop MELI</span>
          </div>
        </div>
      )}
    </div>
  );
}
