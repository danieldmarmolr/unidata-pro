"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, TrendingUp, TrendingDown, Activity, Info } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { ExportButtons } from "@/components/export-buttons";
import { api } from "@/lib/api";
import { formatNumber, formatCurrency } from "@/lib/utils";

type Flow = {
  from: string;
  to: string;
  count: number;
  revenue_a: number;
  revenue_b: number;
};
type Alert = {
  severity: "high" | "medium" | "info";
  icon: string;
  title: string;
  body: string;
};
type SegmentAction = { que_es: string; que_hacer: string };
type Resp = {
  flows: Flow[];
  segments: Record<string, { label: string; color: string; icon: string; desc: string }>;
  actions?: Record<string, SegmentAction>;
  alerts: Alert[];
  current_month_start: string;
  previous_month_start: string;
  total_customers: number;
};

export default function RfmFlowsPage() {
  const { data, isLoading } = useQuery<Resp>({
    queryKey: ["rfm-flows"],
    queryFn: () => api("/api/dashboards/rfm-flows"),
    staleTime: 10 * 60_000,
  });
  const [popupKey, setPopupKey] = useState<string | null>(null);

  return (
    <>
      <Topbar
        title="RFM Flows · Migración mes a mes"
        subtitle="Cómo se mueven los clientes entre segmentos · alertas de fuga y reactivación"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 rounded-xl p-5 mb-6">
          <div className="text-sm font-bold text-violet-900 mb-1">¿Qué muestra?</div>
          <div className="text-xs text-violet-800/90 leading-relaxed">
            Cada cliente se clasifica en un segmento RFM en el <strong>mes previo</strong> y en el <strong>mes actual</strong>. Las transiciones (champions → at_risk, new → loyal, etc.) revelan dinámicas que un snapshot estático no muestra.
            <br />
            <strong>Foco operativo</strong>: las alertas abajo son los movimientos más accionables del último mes — fugas que requieren intervención y reactivaciones que demuestran qué tácticas funcionan.
          </div>
        </div>

        {/* Alertas accionables */}
        {data && data.alerts.length > 0 && (
          <div className="mb-6">
            <div className="text-sm font-bold text-text mb-3">Alertas accionables</div>
            <div className="space-y-2">
              {data.alerts.map((a, i) => (
                <div
                  key={i}
                  className={
                    "border rounded-xl p-4 flex items-start gap-3 " +
                    (a.severity === "high"
                      ? "bg-red-50 border-red-200"
                      : a.severity === "medium"
                      ? "bg-amber-50 border-amber-200"
                      : "bg-emerald-50 border-emerald-200")
                  }
                >
                  <span className="text-2xl shrink-0">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-text text-sm">{a.title}</div>
                    <div className="text-xs text-text-muted mt-0.5">{a.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabla flujos */}
        {isLoading && (
          <div className="bg-surface border border-border rounded-xl p-5 h-[400px] animate-pulse" />
        )}

        {data && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-bold text-text">Migración entre segmentos</div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {data.total_customers} clientes analizados · período {data.previous_month_start} → hoy
                </div>
              </div>
              <ExportButtons
                filename="rfm_flows_mom"
                columns={["From", "To", "Customers", "Revenue mes anterior", "Revenue mes actual"]}
                rows={data.flows.map((f) => [f.from, f.to, f.count, f.revenue_a, f.revenue_b])}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-text-muted bg-soft">
                  <tr>
                    <th className="text-left px-4 py-2">From</th>
                    <th className="text-center px-2 py-2"></th>
                    <th className="text-left px-4 py-2">To</th>
                    <th className="text-right px-4 py-2">Customers</th>
                    <th className="text-right px-4 py-2">Revenue ant.</th>
                    <th className="text-right px-4 py-2">Revenue act.</th>
                    <th className="text-right px-4 py-2">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flows.map((f, i) => {
                    const fromSeg = data.segments[f.from];
                    const toSeg = data.segments[f.to];
                    const delta = f.revenue_b - f.revenue_a;
                    const isCritical =
                      (f.from === "champions" && (f.to === "at_risk" || f.to === "_inactivo")) ||
                      (f.from === "loyal" && f.to === "at_risk");
                    const isWin =
                      (f.from === "_nuevo" || f.from === "hibernating" || f.from === "lost") &&
                      ["champions", "loyal", "potential_loyalist"].includes(f.to);
                    return (
                      <tr key={i} className={"border-t border-border hover:bg-soft transition " + (isCritical ? "bg-red-50/40" : isWin ? "bg-emerald-50/40" : "")}>
                        <td className="px-4 py-2.5">
                          <SegmentBadge id={f.from} seg={fromSeg} onClick={() => setPopupKey(f.from)} />
                        </td>
                        <td className="px-2 py-2.5 text-text-muted">
                          <ArrowRight size={14} />
                        </td>
                        <td className="px-4 py-2.5">
                          <SegmentBadge id={f.to} seg={toSeg} onClick={() => setPopupKey(f.to)} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">{formatNumber(f.count)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">{f.revenue_a > 0 ? formatCurrency(f.revenue_a) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{f.revenue_b > 0 ? formatCurrency(f.revenue_b) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {delta > 0 ? (
                            <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                              <TrendingUp size={11} /> {formatCurrency(delta)}
                            </span>
                          ) : delta < 0 ? (
                            <span className="text-red-700 font-semibold inline-flex items-center gap-0.5">
                              <TrendingDown size={11} /> {formatCurrency(Math.abs(delta))}
                            </span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {data.flows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-text-muted text-sm">
                        Sin datos suficientes para clasificar. Necesitamos al menos 2 meses de historia de órdenes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Popup educativo segmento */}
      {popupKey && data && data.segments[popupKey] && (
        <SegmentInfoPopup
          seg={data.segments[popupKey]}
          action={data.actions?.[popupKey]}
          onClose={() => setPopupKey(null)}
        />
      )}
    </>
  );
}

function SegmentInfoPopup({
  seg, action, onClose,
}: {
  seg: { label: string; color: string; icon: string; desc: string };
  action?: SegmentAction;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border-2 rounded-2xl shadow-2xl w-[min(560px,92vw)]"
        style={{ borderColor: seg.color + "60" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-start gap-3" style={{ background: `linear-gradient(90deg, ${seg.color}20, transparent)` }}>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-2xl shadow-md" style={{ background: `linear-gradient(135deg, ${seg.color}, ${seg.color}dd)` }}>
            {seg.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-extrabold text-text">{seg.label}</div>
            <div className="text-xs text-text-muted mt-0.5">{seg.desc}</div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text px-2 py-1 rounded">x</button>
        </div>
        <div className="px-5 py-4 border-t border-border space-y-3">
          {action ? (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">Que significa este segmento</div>
                <div className="text-sm text-text mt-1 leading-relaxed">{action.que_es}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: seg.color }}>Que hacer (accion recomendada)</div>
                <div className="text-sm text-text mt-1 leading-relaxed">{action.que_hacer}</div>
              </div>
            </>
          ) : (
            <div className="text-sm text-text-muted italic">Sin descripcion de accion disponible para este segmento todavia.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentBadge({ id, seg, onClick }: { id: string; seg?: { label: string; color: string; icon: string }; onClick?: () => void }) {
  // Casos especiales que no estan en SEGMENTS - no clickeables (no tienen accion)
  if (id === "_nuevo") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
        Nuevo este mes
      </span>
    );
  }
  if (id === "_inactivo") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
        <span className="w-2.5 h-2.5 rounded-full bg-zinc-400" />
        No compro este mes
      </span>
    );
  }
  if (!seg) {
    return <span className="text-xs text-text-muted">{id}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer hover:bg-soft hover:rounded px-1 py-0.5 transition"
      title={`${seg.label} — click para ver que hacer`}
    >
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: seg.color }} />
      <span>{seg.icon}</span>
      {seg.label}
      <Info size={10} className="opacity-40" />
    </button>
  );
}
