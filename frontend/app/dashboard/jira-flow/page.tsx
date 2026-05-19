"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SprintDashboardResp } from "./types";
import { Kanban, RefreshCw } from "lucide-react";

export default function JiraFlowSprintPage() {
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
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2 text-primary">
          <Kanban size={18} /> Sprint activo
        </h2>
        <button onClick={() => refetch()} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-soft transition">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refrescar
        </button>
      </div>

      {error && <div className="text-red-600 text-sm">{(error as Error).message}</div>}
      {isLoading && <div className="text-muted text-sm">Cargando...</div>}

      {data?.sprint && (
        <>
          <div className="rounded-2xl bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border border-primary/20 p-5">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="text-2xl font-extrabold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">{data.sprint.name}</div>
              <div className="text-xs text-muted font-medium">{data.sprint.startDate} → {data.sprint.endDate}</div>
            </div>
            <div className="text-sm mt-2 italic">🎯 {data.sprint.goal || "(sin objetivo)"}</div>
            <div className="text-xs text-muted mt-1">{data.sprint.days_left == null ? "—" : data.sprint.days_left >= 0 ? `⏳ ${data.sprint.days_left} días restantes` : `⚠️ Vencido hace ${-data.sprint.days_left} días`}</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5">
              <Metric label="Total" value={data.counters.total} />
              <Metric label="Por hacer" value={data.counters.todo} />
              <Metric label="En curso" value={data.counters.in_progress} accent />
              <Metric label="Finalizado" value={data.counters.done} success />
              <Metric label="Avance" value={`${(data.counters.progress_pct * 100).toFixed(0)}%`} primary />
            </div>
            <div className="mt-4 w-full bg-white h-2.5 rounded-full overflow-hidden">
              <div className="bg-gradient-to-r from-accent to-primary h-2.5 transition-all" style={{ width: `${(data.counters.progress_pct * 100).toFixed(0)}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <CounterBlock title="Por estado"   counter={data.counters.by_status} />
            <CounterBlock title="Por tipo"     counter={data.counters.by_type} />
            <CounterBlock title="Por assignee" counter={data.counters.by_assignee} limit={8} />
          </div>
          <CounterBlock title="Por EPIC" counter={data.counters.by_epic} cols={2} />

          <div className="rounded-xl border border-border bg-white p-5">
            <div className="font-semibold mb-3 flex items-center gap-2">📨 SITU intake</div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="SITU abiertos" value={data.situ.total} />
              <Metric label="Sin asignar" value={data.situ.unassigned} accent />
              <Metric label="Sin ITDEV vinculado" value={data.situ.no_itdev} primary />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">📋 Issues del Sprint</div>
              <div className="text-xs text-muted">{filtered.length} de {issues.length}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <select className="border border-border rounded-lg px-2 py-1.5 text-sm bg-soft" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
                <option value="">Todos los assignees</option>
                {Object.keys(data.counters.by_assignee).sort().map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select className="border border-border rounded-lg px-2 py-1.5 text-sm bg-soft" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">Todos los estados</option>
                {Object.keys(data.counters.by_status).sort().map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select className="border border-border rounded-lg px-2 py-1.5 text-sm bg-soft" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">Todos los tipos</option>
                {Object.keys(data.counters.by_type).sort().map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted bg-soft">
                  <tr>
                    <th className="text-left p-2">Key</th><th className="text-left p-2">Tipo</th><th className="text-left p-2">Título</th>
                    <th className="text-left p-2">EPIC</th><th className="text-left p-2">Estado</th><th className="text-left p-2">Asignado</th><th className="text-left p-2">Prioridad</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.key} className="border-t border-border hover:bg-soft transition">
                      <td className="p-2"><a className="text-primary underline font-medium" href={r.url} target="_blank" rel="noreferrer">{r.key}</a></td>
                      <td className="p-2"><span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{r.type}</span></td>
                      <td className="p-2 max-w-md truncate">{r.summary}</td>
                      <td className="p-2 text-xs text-muted truncate max-w-[120px]">{r.epic}</td>
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
  );
}

function Metric({ label, value, accent = false, success = false, primary = false }: { label: string; value: number | string; accent?: boolean; success?: boolean; primary?: boolean }) {
  const valueColor = primary ? "text-primary" : accent ? "text-fuchsia-600" : success ? "text-emerald-600" : "text-foreground";
  return (
    <div className="border border-border rounded-xl p-3 bg-white">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-extrabold ${valueColor}`}>{value}</div>
    </div>
  );
}

function CounterBlock({ title, counter, limit, cols = 1 }: { title: string; counter: Record<string, number>; limit?: number; cols?: 1 | 2 }) {
  const entries = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, limit ?? 999);
  return (
    <div className="rounded-xl border border-border bg-white p-5">
      <div className="font-semibold mb-2">{title}</div>
      <div className={`grid gap-1 ${cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"} text-sm`}>
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-muted truncate pr-2">{k}</span>
            <span className="font-bold text-primary">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
