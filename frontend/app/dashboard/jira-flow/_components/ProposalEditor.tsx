"use client";

import { useMemo, useState } from "react";
import type { AssignableUser, Epic, Sprint, ConfluenceSpace, ConfluencePage, ProposalWrapper } from "../types";
import { type EditableProposal, type EditableChildSubtask, toEditable, fromEditable, toEditableChild, fromEditableChild, matchAssigneeIdByName } from "./helpers";
import { api } from "@/lib/api";
import { Loader2, Rocket } from "lucide-react";
import type { ProcessedFiles } from "./FileUploader";

type Props = {
  initial: ProposalWrapper;
  situKey?: string | null;
  attachmentsFromSitu?: { id: string; filename: string; mimeType: string; content: string; _skip?: boolean }[];
  confluencePageLinks?: ConfluencePage[];
  extraFiles?: ProcessedFiles | null;
  epics: Epic[];
  users: AssignableUser[];
  sprints: Sprint[];
  spaces: ConfluenceSpace[];
  labels: string[];
  onCreated: (resp: { itdev_key: string; url: string; warnings: string[]; subtasks: { key: string; summary: string }[]; confluence_url?: string | null; teams_notified?: boolean }) => void;
};

const TYPES: Array<"Story" | "Task" | "Bug"> = ["Story", "Task", "Bug"];
const PRIOS = ["Highest", "High", "Medium", "Low"];

export function ProposalEditor(p: Props) {
  const init = p.initial.itdev || ({} as any);
  const [editable, setEditable] = useState<EditableProposal>(toEditable(init));
  const [summary, setSummary] = useState(init.summary || "");
  const [epicKey, setEpicKey] = useState<string | null>(() => {
    const sugg = (init.epic_sugerida || "").toUpperCase();
    const match = p.epics.find((e) => e.summary.toUpperCase().includes(sugg) || e.key.toUpperCase().includes(sugg));
    return match?.key || null;
  });
  const [issueType, setIssueType] = useState<"Story" | "Task" | "Bug">(init.issue_type || "Story");
  const [priority, setPriority] = useState<string>(init.prioridad || "Medium");
  const [assigneeId, setAssigneeId] = useState<string | null>(() => matchAssigneeIdByName(p.users, init.assignee_sugerido));
  const [sprintId, setSprintId] = useState<number | null>(() => p.sprints.find((s) => s.state === "active")?.id ?? null);
  const [labelsSel, setLabelsSel] = useState<string[]>([]);
  const [newLabels, setNewLabels] = useState<string>("");
  const [createConfluence, setCreateConfluence] = useState(false);
  const [confluenceSpaceId, setConfluenceSpaceId] = useState<string | null>(null);
  const [linkType, setLinkType] = useState<string>(p.situKey ? "Relates" : "Relates");
  const [children, setChildren] = useState<EditableChildSubtask[]>(() => (init.subtareas_hijas || []).map((c: any) => ({
    ...toEditableChild(c),
    assignee_id: matchAssigneeIdByName(p.users, c.assignee_sugerido),
  })));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalLabels = useMemo(() => {
    const news = newLabels.split(",").map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean);
    return Array.from(new Set([...labelsSel, ...news]));
  }, [labelsSel, newLabels]);

  function up(patch: Partial<EditableProposal>) {
    setEditable((e) => ({ ...e, ...patch }));
  }
  function upChild(idx: number, patch: Partial<EditableChildSubtask>) {
    setChildren((arr) => arr.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  async function submit() {
    setSubmitting(true); setError(null);
    try {
      const itdev = { ...fromEditable(editable), issue_type: issueType };
      const subtasksClean = children
        .filter((c) => c.include && c.summary?.trim())
        .map((c) => fromEditableChild(c));

      const body = {
        summary,
        itdev,
        labels: finalLabels,
        assignee_account_id: assigneeId,
        epic_key: epicKey,
        priority,
        sprint_id: sprintId,
        link_to_situ: p.situKey || null,
        link_type: linkType,
        confluence_page_links: (p.confluencePageLinks || []).map((cp) => ({ url: cp.url, title: cp.title, space: cp.space })),
        create_confluence_page: createConfluence,
        confluence_space_id: confluenceSpaceId,
        subtasks: subtasksClean,
        copy_attachments_from_situ: (p.attachmentsFromSitu || []).filter((a) => !a._skip).map((a) => ({ filename: a.filename, mimeType: a.mimeType, content: a.content })),
        extra_attachments: p.extraFiles?.all_attachments ?? [],
        teams_notify_on_highest: true,
      };
      const resp = await api<{ itdev_key: string; url: string; warnings: string[]; subtasks: any[]; confluence_url?: string | null }>(
        "/api/jira-flow/itdev/create", { method: "POST", body: JSON.stringify(body) },
      );
      p.onCreated(resp);
    } catch (e) {
      setError((e as Error).message);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="border border-border rounded-xl p-4 bg-soft space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="font-semibold">🛠️ Propuesta ITDEV</h4>
        {p.initial.razonamiento && <div className="text-xs text-muted italic max-w-2xl">💭 {p.initial.razonamiento}</div>}
      </div>

      <input className="w-full border border-border rounded px-2 py-1.5 text-sm" placeholder="Título ITDEV" value={summary} onChange={(e) => setSummary(e.target.value)} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select value={epicKey ?? ""} onChange={(e) => setEpicKey(e.target.value || null)} className="border border-border rounded px-2 py-1.5 text-sm">
          <option value="">(sin EPIC)</option>
          {p.epics.map((e) => <option key={e.key} value={e.key}>{e.key} — {e.summary}</option>)}
        </select>
        <select value={issueType} onChange={(e) => setIssueType(e.target.value as any)} className="border border-border rounded px-2 py-1.5 text-sm">
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="border border-border rounded px-2 py-1.5 text-sm">
          {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select value={assigneeId ?? ""} onChange={(e) => setAssigneeId(e.target.value || null)} className="border border-border rounded px-2 py-1.5 text-sm">
          <option value="">(sin asignar)</option>
          {p.users.map((u) => <option key={u.accountId} value={u.accountId}>{u.displayName}</option>)}
        </select>
        <select value={sprintId ?? ""} onChange={(e) => setSprintId(e.target.value ? Number(e.target.value) : null)} className="border border-border rounded px-2 py-1.5 text-sm">
          <option value="">(Backlog — sin sprint)</option>
          {p.sprints.map((s) => <option key={s.id} value={s.id}>{s.name} [{s.state}]</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select multiple value={labelsSel} onChange={(e) => setLabelsSel(Array.from(e.target.selectedOptions).map((o) => o.value))} className="border border-border rounded px-2 py-1.5 text-sm h-20">
          {p.labels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input className="border border-border rounded px-2 py-1.5 text-sm" placeholder="Nuevas labels (separadas por coma)" value={newLabels} onChange={(e) => setNewLabels(e.target.value)} />
      </div>

      {/* Conditional body */}
      {issueType === "Story" && (
        <>
          <Field label="Historia de Usuario"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={3} value={editable.historia_usuario || ""} onChange={(e) => up({ historia_usuario: e.target.value })} /></Field>
          <Field label="📖 Contexto"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={4} value={editable.contexto || ""} onChange={(e) => up({ contexto: e.target.value })} /></Field>
          <Field label="✅ Criterios de Aceptación (## grupos, - items)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={8} value={editable._criteriosMd || ""} onChange={(e) => up({ _criteriosMd: e.target.value })} /></Field>
        </>
      )}
      {issueType === "Bug" && (
        <>
          <Field label="🐛 Comportamiento actual"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm" rows={3} value={editable.bug_comportamiento_actual || ""} onChange={(e) => up({ bug_comportamiento_actual: e.target.value })} /></Field>
          <Field label="✨ Comportamiento esperado"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm" rows={3} value={editable.bug_comportamiento_esperado || ""} onChange={(e) => up({ bug_comportamiento_esperado: e.target.value })} /></Field>
          <Field label="🔁 Pasos para reproducir (- uno por línea)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={4} value={editable._bugPasosMd || ""} onChange={(e) => up({ _bugPasosMd: e.target.value })} /></Field>
          <Field label="📍 Módulo / Pantalla afectada"><input className="w-full border border-border rounded px-2 py-1.5 text-sm" value={editable.bug_modulo_afectado || ""} onChange={(e) => up({ bug_modulo_afectado: e.target.value })} /></Field>
          <Field label="💡 Fix propuesto / Hipótesis técnica (opcional)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm" rows={3} value={editable.bug_fix_propuesto || ""} onChange={(e) => up({ bug_fix_propuesto: e.target.value })} /></Field>
        </>
      )}
      {issueType === "Task" && (
        <>
          <Field label="🎯 Objetivo"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm" rows={3} value={editable.task_objetivo || ""} onChange={(e) => up({ task_objetivo: e.target.value })} /></Field>
          <Field label="📋 Pasos a ejecutar (- uno por línea)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={4} value={editable._taskPasosMd || ""} onChange={(e) => up({ _taskPasosMd: e.target.value })} /></Field>
          <Field label="✅ Criterio de done (- uno por línea)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={3} value={editable._taskDoneMd || ""} onChange={(e) => up({ _taskDoneMd: e.target.value })} /></Field>
        </>
      )}

      <Field label="🔎 Referencias externas (formato: `Tipo | ID | contexto`)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={3} value={editable._refsMd || ""} onChange={(e) => up({ _refsMd: e.target.value })} /></Field>

      <Field label="🛠️ Subtareas por Rol técnico (## [Rol] · - items)"><textarea className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" rows={6} value={editable._subtareasRolMd || ""} onChange={(e) => up({ _subtareasRolMd: e.target.value })} /></Field>

      {/* Confluence */}
      <div className="border border-border rounded p-3 bg-white">
        <div className="font-semibold text-sm mb-2">📚 Confluence</div>
        {(p.confluencePageLinks?.length ?? 0) > 0 && (
          <div className="text-xs text-muted mb-2">🔗 Se vincularán {p.confluencePageLinks?.length} página(s) vía remote link.</div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createConfluence} onChange={(e) => setCreateConfluence(e.target.checked)} />
          📝 Crear página de docs en Confluence
        </label>
        {createConfluence && (
          <select value={confluenceSpaceId ?? ""} onChange={(e) => setConfluenceSpaceId(e.target.value || null)} className="mt-2 border border-border rounded px-2 py-1.5 text-sm w-full">
            <option value="">Elegir space...</option>
            {p.spaces.map((s) => <option key={s.id} value={s.id}>{s.key} — {s.name}</option>)}
          </select>
        )}
      </div>

      {/* Children */}
      {children.length > 0 && (
        <div className="border border-border rounded p-3 bg-white">
          <div className="font-semibold text-sm mb-2">📋 Subtareas hijas (se crearán como Jira Sub-tasks)</div>
          <div className="space-y-2">
            {children.map((c, idx) => (
              <div key={idx} className="border border-border rounded p-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={!!c.include} onChange={(e) => upChild(idx, { include: e.target.checked })} />
                  <input className="flex-1 border border-border rounded px-2 py-1 text-sm" value={c.summary} onChange={(e) => upChild(idx, { summary: e.target.value })} />
                  <select value={c.assignee_id ?? ""} onChange={(e) => upChild(idx, { assignee_id: e.target.value || null })} className="border border-border rounded px-2 py-1 text-sm">
                    <option value="">(igual al padre)</option>
                    {p.users.map((u) => <option key={u.accountId} value={u.accountId}>{u.displayName}</option>)}
                  </select>
                </div>
                <details className="mt-1">
                  <summary className="text-xs text-muted cursor-pointer">Editar descripción rica</summary>
                  <div className="mt-2 space-y-1">
                    <Field label="🎯 Objetivo"><textarea className="w-full border border-border rounded px-2 py-1 text-xs" rows={2} value={c.objetivo || ""} onChange={(e) => upChild(idx, { objetivo: e.target.value })} /></Field>
                    <Field label="📖 Contexto"><textarea className="w-full border border-border rounded px-2 py-1 text-xs" rows={2} value={c.contexto || ""} onChange={(e) => upChild(idx, { contexto: e.target.value })} /></Field>
                    <Field label="📋 Pasos"><textarea className="w-full border border-border rounded px-2 py-1 text-xs font-mono" rows={3} value={c._pasosMd || ""} onChange={(e) => upChild(idx, { _pasosMd: e.target.value })} /></Field>
                    <Field label="✅ Done"><textarea className="w-full border border-border rounded px-2 py-1 text-xs font-mono" rows={2} value={c._doneMd || ""} onChange={(e) => upChild(idx, { _doneMd: e.target.value })} /></Field>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="flex justify-end">
        <button disabled={submitting} onClick={submit} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
          {p.situKey ? `Crear ITDEV vinculado a ${p.situKey}` : "Crear ITDEV"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}
