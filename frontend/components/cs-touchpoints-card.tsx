"use client";

/**
 * Timeline de touchpoints CS para un cliente o dropshipper especifico.
 * Lo embedean customer/[id] y dropshipper/[id] para que CS vea de un vistazo
 * todas las veces que UNIDATA contacto a esta persona y con que outcome.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { History, Send, MessageCircle, Trophy, X as XIcon, AlertTriangle, Clock } from "lucide-react";
import { api } from "@/lib/api";

type Touchpoint = {
  action_id: number;
  title: string;
  source_type: string;
  source_key: string;
  unit: "unistore" | "unidrop";
  priority: "low" | "normal" | "high";
  status: "pending" | "doing" | "done" | "cancelled";
  action_created_at: string;
  contact_status: "pending" | "contacted" | "responded" | "converted" | "no_response" | "opt_out";
  contact_at: string | null;
  response_at: string | null;
  converted_at: string | null;
  converted_amount: number | null;
  reply_notes: string | null;
};

type TouchpointsResp = {
  target_id: number;
  unit: "unistore" | "unidrop";
  items: Touchpoint[];
  summary: {
    total: number;
    contacted: number;
    responded: number;
    converted: number;
    revenue: number;
  };
};

const STATUS_META: Record<Touchpoint["contact_status"], { label: string; icon: any; chip: string }> = {
  pending:     { label: "Pendiente",   icon: Clock,          chip: "bg-zinc-100 text-zinc-700 border-zinc-300" },
  contacted:   { label: "Contactado",  icon: Send,           chip: "bg-blue-50 text-blue-700 border-blue-300" },
  responded:   { label: "Respondio",   icon: MessageCircle,  chip: "bg-amber-50 text-amber-700 border-amber-300" },
  converted:   { label: "Convirtio",   icon: Trophy,         chip: "bg-emerald-50 text-emerald-700 border-emerald-300" },
  no_response: { label: "Sin respuesta", icon: AlertTriangle, chip: "bg-rose-50 text-rose-700 border-rose-300" },
  opt_out:     { label: "Opt-out",     icon: XIcon,          chip: "bg-slate-100 text-slate-700 border-slate-300" },
};

export function CsTouchpointsCard({
  targetId,
  unit,
}: {
  targetId: number;
  unit: "unistore" | "unidrop";
}) {
  const { data, isLoading } = useQuery<TouchpointsResp>({
    queryKey: ["cs-touchpoints", targetId, unit],
    queryFn: () => api(`/api/cs-actions/touchpoints/${targetId}?unit=${unit}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text mb-2 inline-flex items-center gap-1.5">
          <History size={14} /> Historial CS · cargando...
        </div>
        <div className="h-20 bg-soft rounded animate-pulse" />
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text inline-flex items-center gap-1.5">
          <History size={14} /> Historial CS
        </div>
        <div className="text-xs text-text-muted mt-2">
          Este {unit === "unidrop" ? "dropshipper" : "cliente"} todavia no fue parte de ninguna campana CS.
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-gradient-to-r from-violet-50/40 to-transparent">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold text-text inline-flex items-center gap-1.5">
              <History size={14} /> Historial CS · touchpoints
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              Cada vez que UNIDATA contacto a esta persona desde una accion CS
            </div>
          </div>
          <div className="flex gap-2 flex-wrap text-[11px]">
            <Pill label="Total" value={s.total} cls="text-text" />
            <Pill label="Contactos" value={s.contacted} cls="text-blue-700" />
            <Pill label="Respondio" value={s.responded} cls="text-amber-700" />
            <Pill label="Convirtio" value={s.converted} cls="text-emerald-700" />
            {s.revenue > 0 && (
              <Pill
                label="Revenue"
                value={s.revenue.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}
                cls="text-emerald-700"
              />
            )}
          </div>
        </div>
      </div>

      <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
        {data.items.map((t) => {
          const meta = STATUS_META[t.contact_status];
          const Icon = meta.icon;
          return (
            <div key={t.action_id} className="px-5 py-3 hover:bg-soft/30 transition">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.chip}`}>
                  <Icon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <Link
                      href={`/dashboard/cs-acciones?action=${t.action_id}`}
                      className="text-sm font-semibold text-primary hover:underline truncate"
                      title={t.title}
                    >
                      {t.title}
                    </Link>
                    <div className="text-[10px] text-text-muted">
                      {fmtDateTime(t.action_created_at)} · #{t.action_id}
                    </div>
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    origen: {t.source_type} ({t.source_key}) · priority: <strong>{t.priority}</strong>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.chip}`}>
                      <Icon size={9} /> {meta.label}
                    </span>
                    {t.contact_at && (
                      <span className="text-[10px] text-text-muted">contactado: {fmtDateTime(t.contact_at)}</span>
                    )}
                    {t.response_at && t.contact_status !== "contacted" && (
                      <span className="text-[10px] text-amber-700">respondio: {fmtDateTime(t.response_at)}</span>
                    )}
                    {t.converted_at && (
                      <span className="text-[10px] text-emerald-700 font-bold">
                        convirtio: {fmtDateTime(t.converted_at)}
                        {t.converted_amount ? ` · ${t.converted_amount.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}` : ""}
                      </span>
                    )}
                  </div>
                  {t.reply_notes && (
                    <div className="mt-1.5 text-[11px] text-text bg-soft border border-border rounded px-2 py-1 italic">
                      "{t.reply_notes}"
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ label, value, cls }: { label: string; value: number | string; cls: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-border">
      <span className="text-[9px] uppercase tracking-wider text-text-muted font-bold">{label}</span>
      <span className={`font-extrabold tabular-nums ${cls}`}>{value}</span>
    </span>
  );
}

function fmtDateTime(s: string): string {
  try {
    const d = new Date(s);
    return d.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return s;
  }
}
