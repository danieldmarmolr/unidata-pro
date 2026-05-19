"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { ProposalEditor } from "../_components/ProposalEditor";
import type { AssignableUser, ConfluencePage, ConfluenceSpace, Epic, ProposalWrapper, SituOpenItem, Sprint } from "../types";
import { Search, RefreshCw, UserPlus, Wand2, Loader2, FileText } from "lucide-react";

type IssueFull = {
  key: string;
  summary: string;
  description: string;
  comments: { author: string; created: string; body: string }[];
  attachments: { id: string; filename: string; size: number; mimeType: string; content: string }[];
};

export default function TriagePage() {
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [hideWithItdev, setHideWithItdev] = useState(true);

  const situList = useQuery<{ items: SituOpenItem[] }>({
    queryKey: ["jira-flow", "situ-open", onlyUnassigned],
    queryFn: () => {
      const p = new URLSearchParams({ only_unassigned: String(onlyUnassigned), limit: "100" });
      return api(`/api/jira-flow/situ/open?${p.toString()}`);
    },
    staleTime: 60_000,
  });

  const epics = useQuery<{ items: Epic[] }>({ queryKey: ["jira-flow", "epics"], queryFn: () => api("/api/jira-flow/epics"), staleTime: 5 * 60_000 });
  const users = useQuery<{ items: AssignableUser[] }>({ queryKey: ["jira-flow", "users"], queryFn: () => api("/api/jira-flow/users"), staleTime: 5 * 60_000 });
  const sprints = useQuery<{ items: Sprint[] }>({ queryKey: ["jira-flow", "sprints"], queryFn: () => api("/api/jira-flow/sprints"), staleTime: 5 * 60_000 });
  const spaces = useQuery<{ items: ConfluenceSpace[] }>({ queryKey: ["jira-flow", "spaces"], queryFn: () => api("/api/jira-flow/confluence/spaces"), staleTime: 10 * 60_000 });
  const labels = useQuery<{ items: string[] }>({ queryKey: ["jira-flow", "labels"], queryFn: () => api("/api/jira-flow/labels"), staleTime: 10 * 60_000 });

  const filtered = (situList.data?.items ?? [])
    .filter((s) => !hideWithItdev || s.linked_itdev.length === 0)
    .filter((s) => !searchQuery.trim() || s.key.toLowerCase().includes(searchQuery.toLowerCase()) || s.summary.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <>
      <Topbar title="Jira Flow · Triage SITU → ITDEV" subtitle="Listá SITU abiertos · proponé ITDEV con Gemini · creá vinculado" hidePeriod />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-4">
        <div className="border border-border rounded-xl p-4 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex items-center border border-border rounded px-2">
              <Search size={14} className="text-muted" />
              <input className="flex-1 px-2 py-1.5 text-sm outline-none" placeholder="Buscar SITU (número o título)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Solo sin asignar</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hideWithItdev} onChange={(e) => setHideWithItdev(e.target.checked)} /> Ocultar con ITDEV</label>
          </div>
          <div className="text-xs text-muted mt-2">{filtered.length} SITU para procesar</div>
        </div>

        {situList.isLoading && <div className="text-muted text-sm">Cargando SITU...</div>}
        {situList.error && <div className="text-red-600 text-sm">{(situList.error as Error).message}</div>}

        {filtered.map((s) => (
          <SituCard
            key={s.key}
            situ={s}
            epics={epics.data?.items ?? []}
            users={users.data?.items ?? []}
            sprints={sprints.data?.items ?? []}
            spaces={spaces.data?.items ?? []}
            labels={labels.data?.items ?? []}
            onAssigned={() => qc.invalidateQueries({ queryKey: ["jira-flow", "situ-open"] })}
          />
        ))}
      </div>
    </>
  );
}

function SituCard({ situ, epics, users, sprints, spaces, labels, onAssigned }: {
  situ: SituOpenItem;
  epics: Epic[]; users: AssignableUser[]; sprints: Sprint[]; spaces: ConfluenceSpace[]; labels: string[];
  onAssigned: () => void;
}) {
  const [loadedIssue, setLoadedIssue] = useState<IssueFull | null>(null);
  const [proposal, setProposal] = useState<ProposalWrapper | null>(null);
  const [created, setCreated] = useState<{ itdev_key: string; url: string } | null>(null);
  const [loadingIssue, setLoadingIssue] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraInst, setExtraInst] = useState("");
  const [cfQuery, setCfQuery] = useState("");
  const [cfResults, setCfResults] = useState<ConfluencePage[]>([]);
  const [selectedCfIds, setSelectedCfIds] = useState<Set<string>>(new Set());

  async function loadIssue() {
    setLoadingIssue(true); setError(null);
    try {
      const data = await api<IssueFull>(`/api/jira-flow/issue/${situ.key}`);
      setLoadedIssue(data);
      if (!cfQuery) setCfQuery(data.summary.slice(0, 80));
    } catch (e) { setError((e as Error).message); }
    finally { setLoadingIssue(false); }
  }

  async function assignToMe() {
    try {
      await api(`/api/jira-flow/issue/${situ.key}/assign`, { method: "POST", body: JSON.stringify({ account_id: await getDefaultTriagerId() }) });
      onAssigned();
    } catch (e) { setError((e as Error).message); }
  }

  async function searchConfluence() {
    if (!cfQuery.trim()) { setCfResults([]); return; }
    try {
      const resp = await api<{ items: ConfluencePage[] }>(`/api/jira-flow/confluence/search?q=${encodeURIComponent(cfQuery)}&limit=8`);
      setCfResults(resp.items);
    } catch (e) { setError((e as Error).message); }
  }

  async function propose() {
    setProposing(true); setError(null);
    try {
      const resp = await api<{ propuesta: any }>("/api/jira-flow/llm/propose-from-situ", {
        method: "POST",
        body: JSON.stringify({
          situ_key: situ.key,
          extra_instructions: extraInst,
          confluence_page_ids: Array.from(selectedCfIds),
        }),
      });
      setProposal({ itdev: resp.propuesta.itdev, razonamiento: resp.propuesta.razonamiento, situ_existente_key: situ.key, titulo_corto: resp.propuesta.titulo_corto });
    } catch (e) { setError((e as Error).message); }
    finally { setProposing(false); }
  }

  const selectedCfPages = cfResults.filter((p) => selectedCfIds.has(p.id));

  return (
    <div className="border border-border rounded-xl p-4 bg-white">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <a className="text-primary font-semibold underline" href={`#`}>{situ.key}</a>
          <span className="text-sm ml-2">{situ.summary}</span>
        </div>
        <div className="text-xs text-muted">📅 {situ.created} · ⚡ {situ.priority} · 👤 {situ.assignee} · 📊 {situ.status}</div>
      </div>

      {situ.linked_itdev.length > 0 && (
        <div className="mt-2 text-xs px-2 py-1 rounded bg-amber-100 text-amber-800">⚠️ Ya tiene ITDEV: {situ.linked_itdev.join(", ")}</div>
      )}

      {created && (
        <div className="mt-3 text-sm text-green-700">✅ ITDEV: <a className="underline" href={created.url} target="_blank" rel="noreferrer">{created.itdev_key}</a></div>
      )}

      {!created && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={loadIssue} disabled={loadingIssue} className="px-3 py-1.5 rounded border border-border text-sm hover:bg-soft flex items-center gap-1">
              {loadingIssue ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Cargar contenido
            </button>
            {situ.assignee === "Sin asignar" && (
              <button onClick={assignToMe} className="px-3 py-1.5 rounded border border-border text-sm hover:bg-soft flex items-center gap-1">
                <UserPlus size={12} /> Asignar a triager default
              </button>
            )}
          </div>

          {loadedIssue && (
            <>
              <details className="mt-3 text-sm border border-border rounded p-2 bg-soft">
                <summary className="cursor-pointer text-xs text-muted">📄 Contenido del SITU</summary>
                <div className="mt-2 text-xs whitespace-pre-wrap font-mono">{loadedIssue.description || "(vacía)"}</div>
              </details>
              {loadedIssue.comments.length > 0 && (
                <details className="mt-2 text-sm border border-border rounded p-2 bg-soft">
                  <summary className="cursor-pointer text-xs text-muted">💬 Comentarios ({loadedIssue.comments.length})</summary>
                  <div className="mt-2 space-y-1">
                    {loadedIssue.comments.map((c, i) => (
                      <div key={i} className="text-xs">
                        <span className="font-semibold">{c.author}</span> · <span className="text-muted">{c.created}</span>
                        <div className="whitespace-pre-wrap mt-0.5">{c.body}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="mt-3 border border-border rounded p-2 bg-soft">
                <div className="text-xs text-muted mb-1">📚 Páginas Confluence relacionadas</div>
                <div className="flex gap-2">
                  <input className="flex-1 border border-border rounded px-2 py-1 text-sm" placeholder="Búsqueda Confluence" value={cfQuery} onChange={(e) => setCfQuery(e.target.value)} />
                  <button onClick={searchConfluence} className="px-3 py-1 rounded border border-border text-sm hover:bg-white">Buscar</button>
                </div>
                {cfResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {cfResults.map((p) => (
                      <label key={p.id} className="flex items-start gap-2 text-xs">
                        <input type="checkbox" checked={selectedCfIds.has(p.id)} onChange={(e) => {
                          const s = new Set(selectedCfIds);
                          if (e.target.checked) s.add(p.id); else s.delete(p.id);
                          setSelectedCfIds(s);
                        }} />
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-primary underline">{p.title}</a>
                        <span className="text-muted">· {p.space}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <input className="mt-3 w-full border border-border rounded px-2 py-1.5 text-sm" placeholder="Instrucciones extra para Gemini (opcional)" value={extraInst} onChange={(e) => setExtraInst(e.target.value)} />
              <button onClick={propose} disabled={proposing} className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                {proposing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Proponer ITDEV
              </button>
            </>
          )}

          {error && <div className="mt-2 text-red-600 text-sm">{error}</div>}

          {proposal && (
            <div className="mt-4">
              <ProposalEditor
                initial={proposal}
                situKey={situ.key}
                attachmentsFromSitu={loadedIssue?.attachments?.map((a) => ({ ...a }))}
                confluencePageLinks={selectedCfPages}
                epics={epics}
                users={users}
                sprints={sprints}
                spaces={spaces}
                labels={labels}
                onCreated={(r) => setCreated({ itdev_key: r.itdev_key, url: r.url })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

async function getDefaultTriagerId(): Promise<string | null> {
  try {
    const h = await api<{ default_triager: string }>("/api/jira-flow/health");
    return h.default_triager || null;
  } catch { return null; }
}
