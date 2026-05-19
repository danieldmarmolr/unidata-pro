"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { ProposalEditor } from "../_components/ProposalEditor";
import type { AssignableUser, BatchProposalResp, ConfluenceSpace, Epic, ProposalWrapper, Sprint } from "../types";
import { Wand2, Loader2 } from "lucide-react";

export default function CrearPage() {
  const [contextText, setContextText] = useState("");
  const [extraInst, setExtraInst] = useState("");
  const [batch, setBatch] = useState<BatchProposalResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<number, { itdev_key: string; url: string }>>({});

  const epics = useQuery<{ items: Epic[] }>({ queryKey: ["jira-flow", "epics"], queryFn: () => api("/api/jira-flow/epics"), staleTime: 5 * 60_000 });
  const users = useQuery<{ items: AssignableUser[] }>({ queryKey: ["jira-flow", "users"], queryFn: () => api("/api/jira-flow/users"), staleTime: 5 * 60_000 });
  const sprints = useQuery<{ items: Sprint[] }>({ queryKey: ["jira-flow", "sprints"], queryFn: () => api("/api/jira-flow/sprints"), staleTime: 5 * 60_000 });
  const spaces = useQuery<{ items: ConfluenceSpace[] }>({ queryKey: ["jira-flow", "spaces"], queryFn: () => api("/api/jira-flow/confluence/spaces"), staleTime: 10 * 60_000 });
  const labels = useQuery<{ items: string[] }>({ queryKey: ["jira-flow", "labels"], queryFn: () => api("/api/jira-flow/labels"), staleTime: 10 * 60_000 });

  async function propose() {
    if (!contextText.trim()) return;
    setLoading(true); setError(null); setBatch(null); setCreated({});
    try {
      const resp = await api<BatchProposalResp>("/api/jira-flow/llm/propose-batch", {
        method: "POST",
        body: JSON.stringify({ context: contextText, extra_instructions: extraInst, include_situ_open: true }),
      });
      setBatch(resp);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }

  const ready = epics.data && users.data && sprints.data && spaces.data && labels.data;

  return (
    <>
      <Topbar title="Jira Flow · Crear desde contexto" subtitle="Pegá una transcripción · Gemini detecta tareas · creás ITDEVs vinculados" hidePeriod />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
        <div className="border border-border rounded-xl p-5 bg-white space-y-3">
          <div className="font-semibold">1️⃣ Contexto</div>
          <textarea
            className="w-full border border-border rounded px-3 py-2 text-sm font-mono"
            rows={10}
            placeholder="Pegá la transcripción, los follow-ups, o la descripción libre..."
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
          />
          <input
            className="w-full border border-border rounded px-3 py-2 text-sm"
            placeholder="Instrucciones extra para Gemini (opcional)"
            value={extraInst}
            onChange={(e) => setExtraInst(e.target.value)}
          />
          <button onClick={propose} disabled={loading || !contextText.trim() || !ready} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            Proponer con Gemini
          </button>
          {error && <div className="text-red-600 text-sm">{error}</div>}
        </div>

        {batch && (
          <>
            {batch.resumen_global && (
              <div className="border border-border rounded-xl p-4 bg-soft text-sm">
                <span className="font-semibold">💬 Resumen: </span>{batch.resumen_global}
              </div>
            )}
            <div className="text-sm text-muted">{batch.propuestas.length} propuesta(s)</div>
            {batch.propuestas.map((prop: ProposalWrapper, idx) => {
              const c = created[idx];
              if (c) return (
                <div key={idx} className="border border-green-300 bg-green-50 rounded-xl p-4">
                  <div className="text-sm font-semibold text-green-800">✅ Creado: <a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.itdev_key}</a></div>
                </div>
              );
              if (prop.es_solo_coordinacion || prop.needs_itdev === false) {
                return (
                  <div key={idx} className="border border-border rounded-xl p-3 bg-soft text-sm text-muted">
                    🤝 <span className="font-semibold">Solo coordinación:</span> {prop.titulo_corto} — no requiere ITDEV.
                  </div>
                );
              }
              return (
                <details key={idx} open className="border border-border rounded-xl bg-white">
                  <summary className="px-4 py-3 cursor-pointer font-semibold text-sm">
                    {idx + 1}. {prop.titulo_corto || prop.itdev?.summary}
                    {prop.situ_existente_key && <span className="ml-2 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">↪ {prop.situ_existente_key}</span>}
                  </summary>
                  <div className="p-3">
                    <ProposalEditor
                      initial={prop}
                      situKey={prop.situ_existente_key || null}
                      epics={epics.data!.items}
                      users={users.data!.items}
                      sprints={sprints.data!.items}
                      spaces={spaces.data!.items}
                      labels={labels.data!.items}
                      onCreated={(resp) => setCreated((m) => ({ ...m, [idx]: resp }))}
                    />
                  </div>
                </details>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
