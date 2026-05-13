"use client";

import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";
import { CheckCircle2, XCircle } from "lucide-react";

type Entry = {
  id: number;
  ts: string;
  user: string;
  unit: string;
  sql: string;
  rows: number | null;
  truncated: number;
  duration_ms: number | null;
  error: string | null;
};

export default function AuditPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<Entry[]>({
    queryKey: ["audit", "recent"],
    queryFn: () => api(`/api/queries/audit/recent?limit=200`),
    staleTime: 10_000,
  });

  return (
    <>
      <Topbar
        title="Audit log"
        subtitle="Historial de queries SQL ejecutadas en /sql · ultimas 200"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm text-text-muted">
            {data ? `${data.length} entradas` : "Cargando..."}
            {isFetching && " · refrescando..."}
          </div>
          <button
            onClick={() => refetch()}
            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:border-primary hover:text-primary transition"
          >
            Refrescar
          </button>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Fecha</th>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Unidad</th>
                  <th className="text-left px-3 py-2">SQL</th>
                  <th className="text-right px-3 py-2">Filas</th>
                  <th className="text-right px-3 py-2">ms</th>
                  <th className="text-center px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((e) => {
                  const ok = !e.error;
                  return (
                    <tr key={e.id} className="border-t border-border hover:bg-soft transition">
                      <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                        {fmtArDateTime(e.ts)}
                      </td>
                      <td className="px-3 py-2 font-semibold">{e.user}</td>
                      <td className="px-3 py-2 uppercase text-primary">{e.unit}</td>
                      <td className="px-3 py-2 font-mono text-[11px] max-w-[420px] truncate" title={e.sql}>
                        {e.sql}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {e.rows !== null ? formatNumber(e.rows) : "—"}
                        {e.truncated ? <span className="text-warn ml-1">*</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {e.duration_ms !== null ? formatNumber(e.duration_ms) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {ok ? (
                          <CheckCircle2 size={14} className="text-success inline" />
                        ) : (
                          <span title={e.error ?? ""}>
                            <XCircle size={14} className="text-error inline" />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && (!data || data.length === 0) && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-text-muted">
                      Sin queries ejecutadas todavia. Probá en /dashboard/sql.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
