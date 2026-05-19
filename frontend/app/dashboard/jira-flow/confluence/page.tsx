"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import type { ConfluencePage, ConfluenceSpace } from "../types";
import { Search, RefreshCw } from "lucide-react";

export default function ConfluenceTabPage() {
  const [spaceKey, setSpaceKey] = useState<string>("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);

  const spaces = useQuery<{ items: ConfluenceSpace[] }>({
    queryKey: ["jira-flow", "spaces"],
    queryFn: () => api("/api/jira-flow/confluence/spaces"),
    staleTime: 10 * 60_000,
  });

  const recent = useQuery<{ items: ConfluencePage[] }>({
    queryKey: ["jira-flow", "recent", spaceKey, limit],
    queryFn: () => {
      const p = new URLSearchParams();
      if (spaceKey) p.set("space_key", spaceKey);
      p.set("limit", String(limit));
      return api(`/api/jira-flow/confluence/recent?${p.toString()}`);
    },
    staleTime: 120_000,
  });

  const search = useQuery<{ items: ConfluencePage[] }>({
    queryKey: ["jira-flow", "search", spaceKey, query, limit],
    queryFn: () => {
      const p = new URLSearchParams({ q: query, limit: String(limit) });
      if (spaceKey) p.set("space_key", spaceKey);
      return api(`/api/jira-flow/confluence/search?${p.toString()}`);
    },
    enabled: query.trim().length > 0,
  });

  return (
    <>
      <Topbar title="Jira Flow · Confluence" subtitle="Spaces, búsqueda de páginas y actividad reciente" hidePeriod />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-5">
        <div className="border border-border rounded-xl p-5 bg-white space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} className="border border-border rounded px-2 py-1.5 text-sm">
              <option value="">(todos los spaces)</option>
              {spaces.data?.items.map((s) => <option key={s.key} value={s.key}>{s.key} — {s.name}</option>)}
            </select>
            <div className="flex items-center border border-border rounded px-2">
              <Search size={14} className="text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar texto (título o cuerpo)" className="flex-1 px-2 py-1.5 text-sm outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted">Límite</label>
              <input type="number" min={5} max={50} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-20 border border-border rounded px-2 py-1 text-sm" />
            </div>
          </div>
        </div>

        {query.trim() && (
          <Section title={`🔎 Resultados (${search.data?.items.length ?? 0})`}>
            {search.isLoading && <div className="text-muted text-sm">Buscando...</div>}
            {search.data?.items.map((p) => <PageCard key={p.id} page={p} />)}
          </Section>
        )}

        <Section title={`🕒 Páginas recientes${spaceKey ? ` en ${spaceKey}` : ""}`}>
          <button onClick={() => recent.refetch()} className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-soft mb-2">
            <RefreshCw size={12} className={recent.isFetching ? "animate-spin" : ""} /> Refrescar
          </button>
          {recent.isLoading && <div className="text-muted text-sm">Cargando...</div>}
          {recent.data?.items.map((p) => <PageCard key={p.id} page={p} compact />)}
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-xl p-5 bg-white">
      <div className="font-semibold mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PageCard({ page, compact = false }: { page: ConfluencePage; compact?: boolean }) {
  return (
    <div className="border border-border rounded p-2 hover:bg-soft">
      <a href={page.url} target="_blank" rel="noreferrer" className="text-primary font-medium text-sm underline">{page.title}</a>
      <div className="text-xs text-muted mt-0.5">📁 {page.space} · 📅 {(page.lastModified || "").slice(0, 10)}</div>
      {!compact && page.excerpt && <div className="text-xs text-muted mt-1" dangerouslySetInnerHTML={{ __html: page.excerpt }} />}
    </div>
  );
}
