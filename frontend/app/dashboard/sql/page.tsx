"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { DashboardHeader } from "@/components/dashboard-header";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Play, Download, Trash2, History } from "lucide-react";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] flex items-center justify-center text-text-muted text-sm">
      Cargando editor...
    </div>
  ),
});

type Unit = "unistore" | "unidrop";

type RunResult = {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  row_count: number;
};

const HISTORY_KEY = "unidata.sql_history";
const SAVED_KEY = "unidata.sql_saved";

function loadHistory(): { sql: string; ts: string; unit: string }[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function pushHistory(unit: string, sql: string) {
  const list = loadHistory();
  list.unshift({ sql, ts: new Date().toISOString(), unit });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
}

function downloadCsv(filename: string, cols: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SqlPage() {
  const [unit, setUnit] = useState<Unit>("unistore");
  const [sql, setSql] = useState<string>("SELECT current_database(), current_user, version();");
  const [maxRows, setMaxRows] = useState(5000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ sql: string; ts: string; unit: string }[]>([]);

  useEffect(() => setHistory(loadHistory()), []);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await api<RunResult>(`/api/queries/${unit}/run`, {
        method: "POST",
        body: JSON.stringify({ sql, max_rows: maxRows }),
      });
      setResult(res);
      pushHistory(unit, sql);
      setHistory(loadHistory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }

  return (
    <>
      <Topbar
        title="SQL libre"
        subtitle="Workbench de consultas · solo lectura · timeout 30s"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          filters={
            <Segmented<Unit>
              value={unit}
              onChange={setUnit}
              options={[
                { value: "unistore", label: "Unistore" },
                { value: "unidrop", label: "Unidrop" },
              ]}
            />
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-9 space-y-4">
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-soft border-b border-border flex items-center justify-between text-xs">
                <span className="font-semibold text-text-muted">Editor SQL</span>
                <span className="text-text-muted">Solo SELECT / WITH / EXPLAIN / SHOW</span>
              </div>
              <Editor
                height="260px"
                defaultLanguage="sql"
                value={sql}
                onChange={(v) => setSql(v ?? "")}
                theme="vs"
                options={{
                  fontSize: 13,
                  fontFamily: "ui-monospace, Menlo, monospace",
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  automaticLayout: true,
                }}
              />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                disabled={running || !sql.trim()}
                onClick={run}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm shadow-md shadow-primary/30 hover:shadow-lg hover:shadow-primary/40 transition disabled:opacity-50"
              >
                <Play size={14} />
                {running ? "Ejecutando..." : "Ejecutar (Ctrl+Enter)"}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Max filas</span>
                <input
                  type="number"
                  min={100}
                  max={50000}
                  step={500}
                  value={maxRows}
                  onChange={(e) => setMaxRows(Math.max(100, Math.min(50000, Number(e.target.value) || 5000)))}
                  className="w-24 px-2 py-1 text-sm rounded border border-border outline-none focus:border-primary"
                />
              </div>
              {result && (
                <button
                  onClick={() => downloadCsv(`${unit}_query.csv`, result.columns, result.rows)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border hover:border-primary hover:text-primary transition"
                >
                  <Download size={12} /> Exportar CSV
                </button>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}

            {result && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="text-xs text-text-muted mb-2">
                  {formatNumber(result.row_count)} filas · {result.columns.length} columnas
                  {result.truncated && (
                    <span className="ml-2 text-warn font-semibold">truncado a {formatNumber(maxRows)}</span>
                  )}
                </div>
                <div className="overflow-auto max-h-[55vh] border border-border rounded-lg">
                  <table className="text-xs">
                    <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                      <tr>
                        {result.columns.map((c) => (
                          <th key={c} className="text-left px-2 py-1.5 whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-soft">
                          {r.map((v, j) => (
                            <td key={j} className="px-2 py-1 whitespace-nowrap font-mono text-[11px]">
                              {v === null ? <span className="text-text-muted italic">NULL</span> : String(v).slice(0, 120)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-3 space-y-3">
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-text flex items-center gap-2">
                  <History size={14} className="text-primary" /> Historial
                </div>
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-text-muted hover:text-error" title="Limpiar">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {history.length === 0 && (
                  <div className="text-xs text-text-muted text-center py-4">Sin historial</div>
                )}
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSql(h.sql);
                      setUnit(h.unit as Unit);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-border hover:border-primary hover:bg-soft transition"
                  >
                    <div className="text-[10px] text-text-muted mb-1 flex justify-between">
                      <span className="font-bold uppercase">{h.unit}</span>
                      <span>{new Date(h.ts).toLocaleString("es-AR")}</span>
                    </div>
                    <div className="text-xs font-mono text-text line-clamp-2">{h.sql.slice(0, 120)}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
