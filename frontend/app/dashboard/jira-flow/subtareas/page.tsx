"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AssignableUser, ChildSubtask, ITDEVIssueRow } from "../types";
import { type EditableChildSubtask, toEditableChild, fromEditableChild, matchAssigneeIdByName } from "../_components/helpers";
import { Wand2, Rocket, Loader2, Search } from "lucide-react";

export default function SubtareasPage() {
  const [source, setSource] = useState<"sprint" | "backlog" | "both">("sprint");
  const [search, setSearch] = useState("");
  const [hideWithSubs, setHideWithSubs] = useState(false);
  const [directKey, setDirectKey] = useState("");
  const [directExtra, setDirectExtra] = useState("");

  const sprint = useQuery<{ sprint: { id: number; name: string } | null; items: ITDEVIssueRow[] }>({
    queryKey: ["jira-flow", "itdev-sprint"],
    queryFn: () => api("/api/jira-flow/itdev/sprint"),
    staleTime: 60_000,
  });
  const backlog = useQuery<{ items: ITDEVIssueRow[] }>({
    queryKey: ["jira-flow", "itdev-backlog"],
    queryFn: () => api("/api/jira-flow/itdev/backlog"),
    staleTime: 60_000,
  });
  const users = useQuery<{ items: AssignableUser[] }>({ queryKey: ["jira-flow", "users"], queryFn: () => api("/api/jira-flow/users"), staleTime: 5 * 60_000 });

  let items: ITDEVIssueRow[] = [];
  if (source === "sprint" || source === "both") items = items.concat(sprint.data?.items ?? []);
  if (source === "backlog" || source === "both") items = items.concat(backlog.data?.items ?? []);

  const filtered = items
    .filter((i) => !hideWithSubs || i.subtask_count === 0)
    .filter((i) => !search.trim() || i.key.toLowerCase().includes(search.toLowerCase()) || i.summary.toLowerCase().includes(search.toLowerCase()));

  const [directProposals, setDirectProposals] = useState<ChildSubtask[] | null>(null);
  const [directIssue, setDirectIssue] = useState<{ key: string; summary: string } | null>(null);
  const [loadingDirect, setLoadingDirect] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  async function loadDirect() {
    if (!directKey.trim()) return;
    setLoadingDirect(true); setDirectError(null);
    const norm = directKey.toUpperCase().startsWith("ITDEV-") ? directKey.toUpperCase() : `ITDEV-${directKey.trim()}`;
    try {
      const resp = await api<{ propuestas: ChildSubtask[] }>("/api/jira-flow/llm/propose-subtasks", {
        method: "POST",
        body: JSON.stringify({ itdev_key: norm, extra_instructions: directExtra }),
      });
      const issue = await api<{ key: string; summary: string }>(`/api/jira-flow/issue/${norm}`);
      setDirectIssue(issue);
      setDirectProposals(resp.propuestas || []);
    } catch (e) { setDirectError((e as Error).message); }
    finally { setLoadingDirect(false); }
  }

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-5">
        <div className="border border-border rounded-xl p-5 bg-white space-y-2">
          <div className="font-semibold">🎯 Acceso directo</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input className="border border-border rounded px-2 py-1.5 text-sm" placeholder="Pasar ITDEV-XXX (ej: 377 o ITDEV-377)" value={directKey} onChange={(e) => setDirectKey(e.target.value)} />
            <input className="sm:col-span-2 border border-border rounded px-2 py-1.5 text-sm" placeholder="Instrucciones extra para Gemini (opcional)" value={directExtra} onChange={(e) => setDirectExtra(e.target.value)} />
          </div>
          <button onClick={loadDirect} disabled={loadingDirect || !directKey.trim()} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
            {loadingDirect ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Cargar ticket y proponer
          </button>
          {directError && <div className="text-red-600 text-sm">{directError}</div>}
          {directIssue && directProposals && (
            <DirectProposalsBlock parent={directIssue} initial={directProposals} users={users.data?.items ?? []} />
          )}
        </div>

        <div className="border border-border rounded-xl p-5 bg-white space-y-2">
          <div className="font-semibold">📋 Listado del tablero</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex items-center border border-border rounded px-2">
              <Search size={14} className="text-muted" />
              <input className="flex-1 px-2 py-1.5 text-sm outline-none" placeholder="Buscar (número o título)" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={source} onChange={(e) => setSource(e.target.value as any)} className="border border-border rounded px-2 py-1.5 text-sm">
              <option value="sprint">Sprint activo</option>
              <option value="backlog">Backlog</option>
              <option value="both">Ambos</option>
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hideWithSubs} onChange={(e) => setHideWithSubs(e.target.checked)} /> Ocultar con sub-tasks</label>
          </div>
          <div className="text-xs text-muted">{filtered.length} ITDEV{sprint.data?.sprint ? ` · Sprint: ${sprint.data.sprint.name}` : ""}</div>
        </div>

        {filtered.map((i) => (
          <ITDEVCard key={i.key} issue={i} users={users.data?.items ?? []} />
        ))}
    </div>
  );
}

function ITDEVCard({ issue, users }: { issue: ITDEVIssueRow; users: AssignableUser[] }) {
  const [proposals, setProposals] = useState<ChildSubtask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState("");

  async function propose() {
    setLoading(true); setError(null);
    try {
      const resp = await api<{ propuestas: ChildSubtask[] }>("/api/jira-flow/llm/propose-subtasks", {
        method: "POST",
        body: JSON.stringify({ itdev_key: issue.key, extra_instructions: extra }),
      });
      setProposals(resp.propuestas || []);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <a className="text-primary font-semibold underline" href={issue.url} target="_blank" rel="noreferrer">{issue.key}</a>
          <span className="text-sm ml-2">{issue.summary}</span>
        </div>
        <div className="text-xs text-muted">📊 {issue.status} · ⚡ {issue.priority} · 🏷️ {issue.type} · 👤 {issue.assignee} · 📋 {issue.subtask_count} sub-tasks</div>
      </div>
      <div className="mt-2 flex gap-2 items-center">
        <input className="flex-1 border border-border rounded px-2 py-1.5 text-sm" placeholder="Instrucciones extra para Gemini (opcional)" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <button onClick={propose} disabled={loading} className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Proponer sub-tasks
        </button>
      </div>
      {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
      {proposals && proposals.length === 0 && <div className="text-muted text-sm mt-2">Gemini no propuso sub-tasks.</div>}
      {proposals && proposals.length > 0 && (
        <SubtaskBatch parent={{ key: issue.key, summary: issue.summary }} initial={proposals} users={users} />
      )}
    </div>
  );
}

function DirectProposalsBlock(props: { parent: { key: string; summary: string }; initial: ChildSubtask[]; users: AssignableUser[] }) {
  return (
    <div className="mt-3 border border-primary/30 rounded-lg p-3 bg-primary/5">
      <div className="text-sm font-semibold mb-2">Ticket cargado: <span className="text-primary">{props.parent.key}</span> — {props.parent.summary}</div>
      <SubtaskBatch parent={props.parent} initial={props.initial} users={props.users} />
    </div>
  );
}

function SubtaskBatch({ parent, initial, users }: { parent: { key: string; summary: string }; initial: ChildSubtask[]; users: AssignableUser[] }) {
  const [items, setItems] = useState<EditableChildSubtask[]>(() => initial.map((c) => ({ ...toEditableChild(c), assignee_id: matchAssigneeIdByName(users, c.assignee_sugerido) })));
  const [created, setCreated] = useState<{ key: string; summary: string }[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function up(idx: number, patch: Partial<EditableChildSubtask>) {
    setItems((arr) => arr.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  async function createAll() {
    const toCreate = items.filter((c) => c.include && c.summary?.trim()).map(fromEditableChild);
    if (toCreate.length === 0) return;
    setCreating(true); setError(null);
    try {
      const resp = await api<{ created: { key: string; summary: string }[]; warnings: string[] }>("/api/jira-flow/itdev/subtasks", {
        method: "POST",
        body: JSON.stringify({ parent_key: parent.key, subtasks: toCreate }),
      });
      setCreated(resp.created);
    } catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  }

  if (created) {
    return (
      <div className="mt-3 text-sm text-green-700">
        ✅ Creadas: {created.map((c) => c.key).join(", ")}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {items.map((c, idx) => (
        <div key={idx} className="border border-border rounded p-2 bg-soft">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={!!c.include} onChange={(e) => up(idx, { include: e.target.checked })} />
            <input className="flex-1 border border-border rounded px-2 py-1 text-sm bg-white" value={c.summary} onChange={(e) => up(idx, { summary: e.target.value })} />
            <select value={c.assignee_id ?? ""} onChange={(e) => up(idx, { assignee_id: e.target.value || null })} className="border border-border rounded px-2 py-1 text-sm bg-white">
              <option value="">(heredar del padre)</option>
              {users.map((u) => <option key={u.accountId} value={u.accountId}>{u.displayName}</option>)}
            </select>
          </div>
          <details className="mt-1">
            <summary className="text-xs text-muted cursor-pointer">Editar descripción rica</summary>
            <div className="mt-2 space-y-1">
              <textarea className="w-full border border-border rounded px-2 py-1 text-xs bg-white" rows={2} placeholder="🎯 Objetivo" value={c.objetivo || ""} onChange={(e) => up(idx, { objetivo: e.target.value })} />
              <textarea className="w-full border border-border rounded px-2 py-1 text-xs bg-white" rows={2} placeholder="📖 Contexto" value={c.contexto || ""} onChange={(e) => up(idx, { contexto: e.target.value })} />
              <textarea className="w-full border border-border rounded px-2 py-1 text-xs font-mono bg-white" rows={3} placeholder="📋 Pasos (- uno por línea)" value={c._pasosMd || ""} onChange={(e) => up(idx, { _pasosMd: e.target.value })} />
              <textarea className="w-full border border-border rounded px-2 py-1 text-xs font-mono bg-white" rows={2} placeholder="✅ Done (- uno por línea)" value={c._doneMd || ""} onChange={(e) => up(idx, { _doneMd: e.target.value })} />
            </div>
          </details>
        </div>
      ))}
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <button onClick={createAll} disabled={creating} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
        {creating ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
        Crear sub-tasks en {parent.key}
      </button>
    </div>
  );
}
