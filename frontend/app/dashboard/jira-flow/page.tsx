"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import type { SprintDashboardResp } from "./types";
import { Kanban, Wand2, Ticket, Shapes, BookOpen, FileText, Cog, RefreshCw } from "lucide-react";

const NAV = [
  { href: "/dashboard/jira-flow/crear",      label: "Crear desde contexto", icon: Wand2,    desc: "Pegá una transcripción · Gemini propone los ITDEV" },
  { href: "/dashboard/jira-flow/triage",     label: "Triage SITU → ITDEV",  icon: Ticket,   desc: "SITU abiertos · proponé y creá ITDEV vinculado" },
  { href: "/dashboard/jira-flow/subtareas",  label: "Subtareas a ITDEV",    icon: Shapes,   desc: "Descomponé tickets en sub-tasks con Gemini" },
  { href: "/dashboard/jira-flow/confluence", label: "Confluence",           icon: BookOpen, desc: "Spaces · búsqueda · páginas recientes" },
  { href: "/dashboard/jira-flow/auto-docs",  label: "Auto Docs",            icon: FileText, desc: "Polling ITDEV cerrados → genera docs" },
  { href: "/dashboard/jira-flow/config",     label: "Config",               icon: Cog,      desc: "Test Jira · test Gemini · variables env" },
];

export default function JiraFlowPage() {
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");

  const { data, isLoading, error, refetch, isFetching } = useQuery<SprintDashboardResp>({
    queryKey: ["jira-flow", "sprint-dashboard"],
    queryFn: () => api("/api/jira-flow/sprint-dashboard"),
    staleTime: 60_000,
  });

  const issues = data?.issues ?? [];
  const filtered = useMemo(() => issues.filter((i) =>
    (!filterAssignee || i.assignee === filterAssignee) &&
    (!filterStatus || i.status === filterStatus) &&
    (!filterType || i.type === filterType)
  ), [issues, filterAssignee, filterStatus, filterType]);

  return (
    <>
      <Topbar title="Jira Flow" subtitle="Dashboard del sprint ITDEV · SITU intake · navegación" hidePeriod />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
        {/* Nav cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {NAV.map((n) => {
            const I = n.icon;
            return (
              <Link key={n.href} href={n.href} className="border border-border rounded-xl p-4 bg-white hover:bg-soft transition group">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition">
                    <I size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold">{n.label}</div>
                    <div className="text-xs text-muted mt-0.5 line-clamp-2">{n.desc}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Sprint info */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2"><Kanban size={18} /> Sprint activo</h2>
          <button onClick={() => refetch()} className="text-xs flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-soft">
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refrescar
          </button>
        </div>

        {error && <div className="text-red-600 text-sm">{(error as Error).message}</div>}
        {isLoading && <div className="text-muted text-sm">Cargando...</div>}

        {data?.sprint && (
          <>
            <div className="border border-border rounded-xl p-5 bg-white">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <div className="text-xl font-extrabold text-primary">{data.sprint.name}</div>
                <div className="text-xs text-muted">{data.sprint.startDate} → {data.sprint.endDate}</div>
              </div>
              <div className="text-sm text-muted mt-1">🎯 {data.sprint.goal || "(sin objetivo)"}</div>
              <div className="text-xs text-muted mt-1">{data.sprint.days_left == null ? "—" : data.sprint.days_left >= 0 ? `${data.sprint.days_left} días restantes` : `⚠️ Vencido hace ${-data.sprint.days_left} días`}</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
                <Metric label="Total" value={data.counters.total} />
                <Metric label="Por hacer" value={data.counters.todo} />
                <Metric label="En curso" value={data.counters.in_progress} />
                <Metric label="Finalizado" value={data.counters.done} />
                <Metric label="Avance" value={`${(data.counters.progress_pct * 100).toFixed(0)}%`} />
              </div>
              <div className="mt-3 w-full bg-soft h-2 rounded">
                <div className="bg-primary h-2 rounded" style={{ width: `${(data.counters.progress_pct * 100).toFixed(0)}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <CounterBlock title="Por estado"   counter={data.counters.by_status} />
              <CounterBlock title="Por tipo"     counter={data.counters.by_type} />
              <CounterBlock title="Por assignee" counter={data.counters.by_assignee} limit={8} />
            </div>
            <CounterBlock title="Por EPIC" counter={data.counters.by_epic} cols={2} />

            {/* SITU intake */}
            <div className="border border-border rounded-xl p-5 bg-white">
              <div className="font-semibold mb-3">📨 SITU intake</div>
              <div className="grid grid-cols-3 gap-3">
                <Metric label="SITU abiertos" value={data.situ.total} />
                <Metric label="Sin asignar" value={data.situ.unassigned} />
                <Metric label="Sin ITDEV vinculado" value={data.situ.no_itdev} />
              </div>
            </div>

            {/* Filtros + tabla */}
            <div className="border border-border rounded-xl p-5 bg-white">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">📋 Issues del Sprint</div>
                <div className="text-xs text-muted">{filtered.length} de {issues.length}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                <select className="border border-border rounded px-2 py-1 text-sm" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
                  <option value="">Todos los assignees</option>
                  {Object.keys(data.counters.by_assignee).sort().map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <select className="border border-border rounded px-2 py-1 text-sm" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">Todos los estados</option>
                  {Object.keys(data.counters.by_status).sort().map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <select className="border border-border rounded px-2 py-1 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                  <option value="">Todos los tipos</option>
                  {Object.keys(data.counters.by_type).sort().map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted bg-soft">
                    <tr><th className="text-left p-2">Key</th><th className="text-left p-2">Tipo</th><th className="text-left p-2">Título</th><th className="text-left p-2">EPIC</th><th className="text-left p-2">Estado</th><th className="text-left p-2">Asignado</th><th className="text-left p-2">Prioridad</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.key} className="border-t border-border hover:bg-soft">
                        <td className="p-2"><a className="text-primary underline" href={r.url} target="_blank" rel="noreferrer">{r.key}</a></td>
                        <td className="p-2">{r.type}</td>
                        <td className="p-2 max-w-md truncate">{r.summary}</td>
                        <td className="p-2 text-xs text-muted">{r.epic}</td>
                        <td className="p-2"><span className="text-xs px-2 py-0.5 rounded bg-soft border border-border">{r.status}</span></td>
                        <td className="p-2 text-xs">{r.assignee}</td>
                        <td className="p-2 text-xs">{r.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!isLoading && !data?.sprint && <div className="text-muted text-sm">No hay sprint activo en ITDEV.</div>}
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-soft">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-bold text-primary">{value}</div>
    </div>
  );
}

function CounterBlock({ title, counter, limit, cols = 1 }: { title: string; counter: Record<string, number>; limit?: number; cols?: 1 | 2 }) {
  const entries = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, limit ?? 999);
  return (
    <div className="border border-border rounded-xl p-5 bg-white">
      <div className="font-semibold mb-2">{title}</div>
      <div className={`grid gap-1 ${cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"} text-sm`}>
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-muted truncate pr-2">{k}</span>
            <span className="font-bold">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
