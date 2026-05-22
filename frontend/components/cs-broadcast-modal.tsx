"use client";

/**
 * Modal de Difusion WhatsApp para una accion CS.
 *
 * Flujo:
 *  1. Fetch targets enriquecidos (nombre + telefono + email + dni).
 *  2. El operador escribe un mensaje template con variables: {{nombre}}, {{primer_nombre}}.
 *  3. Por cada target con telefono, el modal genera wa.me/<digits>?text=<encoded>.
 *  4. Al clickear el link, el target queda marcado como 'contacted' (PATCH status).
 *  5. Tambien permite descargar CSV listo para blast manual.
 */

import { useEffect, useMemo, useState } from "react";
import {
  X, Send, Download, CheckCircle2, Phone, Loader2, AlertTriangle, ExternalLink,
  Save, BookmarkPlus, Star,
} from "lucide-react";
import { api } from "@/lib/api";
import { waLink } from "@/lib/whatsapp";

type Target = {
  target_id: number;
  nombre: string;
  email: string;
  phone: string;
  dni?: string;
  ciudad?: string;
  lifetime_total?: number;
  ultima_compra?: string | null;
  dias_desde_ultima?: number | null;
  ordenes_total?: number;
  ticket_promedio?: number;
  monto_ultima?: number;
  top_sku?: string;
  top_producto?: string;
  contact_status: "pending" | "contacted" | "responded" | "converted" | "no_response" | "opt_out";
  contact_at?: string | null;
  response_at?: string | null;
  converted_at?: string | null;
  converted_amount?: number | null;
  notes?: string | null;
};

type TargetsResp = {
  action_id: number;
  unit: "unistore" | "unidrop";
  items: Target[];
  stats: {
    total: number;
    pending: number;
    contacted: number;
    responded: number;
    converted: number;
    contact_rate: number;
    conversion_rate: number;
    converted_amount: number;
  };
};

type CsTemplate = {
  id: number;
  name: string;
  body: string;
  source_type: string | null;
  unit: "unistore" | "unidrop" | null;
  times_used: number;
  conversion_rate: number;
  actions_count: number;
  targets_count: number;
  converted: number;
};

const STATUS_COLORS: Record<Target["contact_status"], string> = {
  pending:     "bg-zinc-100 text-zinc-700 border-zinc-300",
  contacted:   "bg-blue-50 text-blue-700 border-blue-300",
  responded:   "bg-amber-50 text-amber-700 border-amber-300",
  converted:   "bg-emerald-50 text-emerald-700 border-emerald-300",
  no_response: "bg-rose-50 text-rose-700 border-rose-300",
  opt_out:     "bg-slate-100 text-slate-700 border-slate-300",
};

const STATUS_LABEL: Record<Target["contact_status"], string> = {
  pending:     "Sin contactar",
  contacted:   "Contactado",
  responded:   "Respondio",
  converted:   "Convirtio",
  no_response: "Sin respuesta",
  opt_out:     "Opt-out",
};

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
}

function renderTemplate(tpl: string, t: Target): string {
  const primer = (t.nombre || "").split(/\s+/)[0] || "";
  const sub = (re: RegExp, val: string | number | null | undefined) =>
    (m: string) => (val == null || val === "" ? "" : String(val));
  return tpl
    .replace(/\{\{\s*nombre\s*\}\}/gi, t.nombre || "")
    .replace(/\{\{\s*primer_nombre\s*\}\}/gi, primer)
    .replace(/\{\{\s*email\s*\}\}/gi, t.email || "")
    .replace(/\{\{\s*dni\s*\}\}/gi, t.dni || "")
    .replace(/\{\{\s*ciudad\s*\}\}/gi, t.ciudad || "")
    .replace(/\{\{\s*ultima_compra\s*\}\}/gi, t.ultima_compra || "")
    .replace(/\{\{\s*dias_desde_ultima\s*\}\}/gi, t.dias_desde_ultima != null ? String(t.dias_desde_ultima) : "")
    .replace(/\{\{\s*monto_ultima\s*\}\}/gi, t.monto_ultima ? fmtMoney(t.monto_ultima) : "")
    .replace(/\{\{\s*ticket_promedio\s*\}\}/gi, t.ticket_promedio ? fmtMoney(t.ticket_promedio) : "")
    .replace(/\{\{\s*lifetime_total\s*\}\}/gi, t.lifetime_total ? fmtMoney(t.lifetime_total) : "")
    .replace(/\{\{\s*ordenes_total\s*\}\}/gi, t.ordenes_total != null ? String(t.ordenes_total) : "")
    .replace(/\{\{\s*top_sku\s*\}\}/gi, t.top_sku || "")
    .replace(/\{\{\s*top_producto\s*\}\}/gi, t.top_producto || "");
}

export function CsBroadcastModal({
  actionId,
  actionTitle,
  unit,
  suggestedAction,
  onClose,
  onAfterMark,
}: {
  actionId: number;
  actionTitle: string;
  unit: "unistore" | "unidrop";
  suggestedAction: string;
  onClose: () => void;
  onAfterMark?: () => void;
}) {
  const [data, setData] = useState<TargetsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [template, setTemplate] = useState<string>(() => defaultTemplate(suggestedAction, unit));
  const [openedSet, setOpenedSet] = useState<Set<number>>(new Set());
  const [templates, setTemplates] = useState<CsTemplate[]>([]);
  const [selectedTplId, setSelectedTplId] = useState<number | null>(null);
  const [savingTpl, setSavingTpl] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api<TargetsResp>(`/api/cs-actions/${actionId}/targets`);
      setData(res);
    } catch (e: any) {
      setErr(e?.message || "Error cargando targets");
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await api<{ items: CsTemplate[] }>(`/api/cs-templates?unit=${unit}`);
      setTemplates(res.items || []);
    } catch {
      // silencioso
    }
  };

  useEffect(() => { load(); loadTemplates(); }, [actionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const targetsWithPhone = (data?.items ?? []).filter((t) => waLink(t.phone));
  const targetsWithoutPhone = (data?.items ?? []).length - targetsWithPhone.length;

  const setStatus = async (target_id: number, status: Target["contact_status"]) => {
    try {
      await api(`/api/cs-actions/${actionId}/targets/${target_id}/status`, {
        method: "POST",
        body: JSON.stringify({ contact_status: status, note: "" }),
      });
      await load();
      onAfterMark?.();
    } catch (e) {
      // Silencioso: si falla, dejamos que el usuario vea la card sin cambios
    }
  };

  const openWa = (t: Target) => {
    const wa = waLink(t.phone);
    if (!wa) return;
    const msg = renderTemplate(template, t);
    const url = `${wa}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener");
    setOpenedSet((s) => new Set(s).add(t.target_id));
    // Marcar como contactado automaticamente al abrir
    if (t.contact_status === "pending") {
      setStatus(t.target_id, "contacted");
    }
  };

  const downloadCsv = () => {
    if (!data) return;
    const headers = ["target_id", "nombre", "email", "telefono", "dni", "mensaje_personalizado", "wa_link", "status"];
    const rows = data.items.map((t) => {
      const wa = waLink(t.phone);
      const msg = renderTemplate(template, t);
      return [
        t.target_id,
        t.nombre,
        t.email,
        t.phone,
        t.dni || "",
        msg,
        wa ? `${wa}?text=${encodeURIComponent(msg)}` : "",
        t.contact_status,
      ];
    });
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cs_blast_accion_${actionId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const applyTemplate = async (id: number) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTemplate(t.body);
    setSelectedTplId(id);
    try {
      await api(`/api/cs-templates/attach/${actionId}`, {
        method: "POST",
        body: JSON.stringify({ template_id: id }),
      });
    } catch { /* silencioso */ }
  };

  const saveAsTemplate = async () => {
    const name = window.prompt("Nombre del template:");
    if (!name) return;
    setSavingTpl(true);
    try {
      const res = await api<CsTemplate>(`/api/cs-templates`, {
        method: "POST",
        body: JSON.stringify({ name, body: template, unit }),
      });
      await loadTemplates();
      setSelectedTplId(res.id);
      await api(`/api/cs-templates/attach/${actionId}`, {
        method: "POST",
        body: JSON.stringify({ template_id: res.id }),
      });
    } catch (e: any) {
      alert(e?.message || "Error guardando template");
    } finally {
      setSavingTpl(false);
    }
  };

  const markAllContacted = async () => {
    if (!data) return;
    const pendings = data.items.filter((t) => t.contact_status === "pending" && waLink(t.phone));
    if (!pendings.length) return;
    if (!confirm(`Marcar ${pendings.length} targets como 'contactado'?`)) return;
    await Promise.all(pendings.map((t) =>
      api(`/api/cs-actions/${actionId}/targets/${t.target_id}/status`, {
        method: "POST",
        body: JSON.stringify({ contact_status: "contacted", note: "" }),
      })
    ));
    await load();
    onAfterMark?.();
  };

  const stats = data?.stats;

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 animate-in fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border-2 border-emerald-300 w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3 bg-gradient-to-r from-emerald-50 to-transparent">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow">
                <Send size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-base font-extrabold text-text">Difusion WhatsApp · Accion #{actionId}</div>
                <div className="text-xs text-text-muted truncate">{actionTitle}</div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X size={18} />
          </button>
        </div>

        {/* Stats bar */}
        {stats && stats.total > 0 && (
          <div className="px-5 py-2 border-b border-border bg-soft/40 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
            <StatPill label="Total" value={stats.total} color="text-text" />
            <StatPill label="Pendientes" value={stats.pending} color="text-zinc-700" />
            <StatPill label="Contactados" value={stats.contacted + stats.responded + stats.converted} color="text-blue-700" />
            <StatPill label="Respondieron" value={stats.responded + stats.converted} color="text-amber-700" />
            <StatPill label={`Convirtieron · ${stats.conversion_rate}%`} value={stats.converted} color="text-emerald-700" />
          </div>
        )}

        {/* Template selector */}
        {templates.length > 0 && (
          <div className="px-5 py-2 border-b border-border bg-soft/30 flex items-center gap-2 flex-wrap">
            <label className="text-[10px] uppercase tracking-wider font-bold text-text-muted">Templates probados</label>
            <select
              value={selectedTplId ?? ""}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                if (v) applyTemplate(v); else setSelectedTplId(null);
              }}
              className="text-xs px-2 py-1 rounded-lg border border-border bg-surface flex-1 min-w-[260px]"
            >
              <option value="">— Usar template existente —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.conversion_rate > 0 ? `${t.conversion_rate}% conv · ` : ""}
                  {t.times_used > 0 ? `${t.times_used}x · ` : ""}
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={saveAsTemplate}
              disabled={savingTpl || !template.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-40 transition"
            >
              <BookmarkPlus size={12} /> Guardar como template
            </button>
          </div>
        )}

        {/* Template editor */}
        <div className="px-5 py-3 border-b border-border bg-surface space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <label className="text-[10px] uppercase tracking-wider font-bold text-text-muted">Mensaje de difusion</label>
            <div className="text-[10px] text-text-muted max-w-[60%] text-right leading-relaxed">
              <strong>Variables:</strong>{" "}
              {["{{primer_nombre}}", "{{nombre}}", "{{ciudad}}", "{{ultima_compra}}", "{{dias_desde_ultima}}", "{{monto_ultima}}", "{{ticket_promedio}}", "{{lifetime_total}}", "{{ordenes_total}}", "{{top_producto}}", "{{top_sku}}", "{{email}}", "{{dni}}"].map((v, i) => (
                <code key={i} className="bg-soft px-1 rounded mr-1 inline-block">{v}</code>
              ))}
            </div>
          </div>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={4}
            className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-bg outline-none focus:border-primary resize-y font-sans"
            placeholder="Hola {{primer_nombre}}, te escribimos desde..."
          />
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="text-[11px] text-text-muted">
              {targetsWithPhone.length} con telefono valido
              {targetsWithoutPhone > 0 && <span className="text-amber-700"> · {targetsWithoutPhone} sin telefono</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={markAllContacted}
                disabled={!stats || stats.pending === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface hover:bg-soft disabled:opacity-40 transition"
              >
                <CheckCircle2 size={12} /> Marcar pendientes como contactados
              </button>
              <button
                onClick={downloadCsv}
                disabled={!data || data.items.length === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface hover:bg-soft disabled:opacity-40 transition"
              >
                <Download size={12} /> CSV (telefonos + mensajes)
              </button>
            </div>
          </div>
        </div>

        {/* Body: lista de targets */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-text-muted text-sm inline-flex items-center gap-2 w-full justify-center">
              <Loader2 size={14} className="animate-spin" /> Cargando targets...
            </div>
          )}
          {err && (
            <div className="m-4 bg-red-50 border border-red-200 text-error rounded-lg px-4 py-3 text-sm inline-flex items-center gap-2">
              <AlertTriangle size={14} /> {err}
            </div>
          )}
          {!loading && data && data.items.length === 0 && (
            <div className="p-12 text-center text-text-muted text-sm">Sin targets en esta accion.</div>
          )}
          {data && data.items.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">{unit === "unidrop" ? "Dropshipper" : "Cliente"}</th>
                  <th className="text-left px-2 py-2">Telefono</th>
                  <th className="text-left px-2 py-2">Status</th>
                  <th className="text-left px-2 py-2 w-[200px]">Accion</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => {
                  const wa = waLink(t.phone);
                  const opened = openedSet.has(t.target_id);
                  return (
                    <tr key={t.target_id} className="border-t border-border hover:bg-soft/40">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-text truncate max-w-[280px]">{t.nombre}</div>
                        {t.email && <div className="text-[10px] text-text-muted font-mono truncate max-w-[280px]">{t.email}</div>}
                      </td>
                      <td className="px-2 py-2 text-[11px]">
                        {t.phone ? (
                          <span className="font-mono">{t.phone}</span>
                        ) : (
                          <span className="text-text-muted italic">sin telefono</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={t.contact_status}
                          onChange={(e) => setStatus(t.target_id, e.target.value as Target["contact_status"])}
                          className={`text-[10px] px-2 py-1 rounded-full border font-bold cursor-pointer ${STATUS_COLORS[t.contact_status]}`}
                        >
                          {(Object.keys(STATUS_LABEL) as Target["contact_status"][]).map((k) => (
                            <option key={k} value={k}>{STATUS_LABEL[k]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        {wa ? (
                          <button
                            onClick={() => openWa(t)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg ${opened ? "bg-emerald-100 text-emerald-700 border border-emerald-300" : "bg-emerald-500 text-white hover:bg-emerald-600"} transition`}
                          >
                            {opened ? <CheckCircle2 size={12} /> : <Send size={12} />}
                            {opened ? "Abierto" : "Abrir WhatsApp"}
                            <ExternalLink size={10} className="opacity-70" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-text-muted italic">Sin telefono</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-soft/30 text-[10px] text-text-muted">
          Click "Abrir WhatsApp" abre wa.me con el mensaje pre-cargado · al abrir, el target queda marcado como 'contactado' automaticamente.
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-2 py-1 text-center">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-sm font-extrabold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function defaultTemplate(suggested: string, unit: "unistore" | "unidrop"): string {
  const saludo = unit === "unidrop"
    ? "Hola {{primer_nombre}}, te escribimos desde Unidrop."
    : "Hola {{primer_nombre}}, te escribimos desde Unistore.";
  return `${saludo}\n\n${suggested.split("\n")[0] || ""}\n\nCualquier cosa respondes a este mismo numero.\nGracias!`;
}
