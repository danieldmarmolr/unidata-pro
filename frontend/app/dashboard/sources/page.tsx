"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { DashboardHeader } from "@/components/dashboard-header";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Download, Database } from "lucide-react";

type Unit = "unistore" | "unidrop";

type TableInfo = {
  schema: string;
  table_name: string;
  approx_rows: number;
  size_bytes: number;
  size_pretty: string;
};

type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  pk: string;
};

type Preview = { columns: string[]; rows: unknown[][]; row_count: number };

function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [columns.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SourcesPage() {
  const [unit, setUnit] = useState<Unit>("unistore");
  const [schema, setSchema] = useState<string>("");
  const [table, setTable] = useState<string>("");
  const [previewN, setPreviewN] = useState<number>(100);

  const schemasQ = useQuery<string[]>({
    queryKey: ["sources", unit, "schemas"],
    queryFn: () => api(`/api/sources/${unit}/schemas`),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (schemasQ.data && !schema) setSchema(schemasQ.data[0] ?? "");
  }, [schemasQ.data, schema]);

  useEffect(() => {
    setSchema("");
    setTable("");
  }, [unit]);

  const tablesQ = useQuery<TableInfo[]>({
    queryKey: ["sources", unit, "tables", schema],
    queryFn: () => api(`/api/sources/${unit}/schemas/${schema}/tables`),
    staleTime: 5 * 60_000,
    enabled: !!schema,
  });

  const colsQ = useQuery<ColumnInfo[]>({
    queryKey: ["sources", unit, "cols", schema, table],
    queryFn: () => api(`/api/sources/${unit}/schemas/${schema}/tables/${table}/columns`),
    enabled: !!table,
  });

  const previewQ = useQuery<Preview>({
    queryKey: ["sources", unit, "preview", schema, table, previewN],
    queryFn: () =>
      api(`/api/sources/${unit}/schemas/${schema}/tables/${table}/preview?n=${previewN}`),
    enabled: !!table,
  });

  return (
    <>
      <Topbar
        title="Explorador de fuentes (M0)"
        subtitle="Conexion directa a las BBDD operativas · solo lectura"
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
          {/* Schemas + Tables */}
          <div className="lg:col-span-5 bg-surface border border-border rounded-xl p-4">
            <div className="text-sm font-bold text-text mb-3 flex items-center gap-2">
              <Database size={14} className="text-primary" />
              Tablas
            </div>
            <div className="mb-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                Schema
              </label>
              <select
                value={schema}
                onChange={(e) => {
                  setSchema(e.target.value);
                  setTable("");
                }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm outline-none focus:border-primary"
              >
                {(schemasQ.data ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="overflow-y-auto max-h-[60vh] border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-soft text-[10px] uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="text-left px-3 py-2">Tabla</th>
                    <th className="text-right px-2 py-2">Filas</th>
                    <th className="text-right px-2 py-2">Tamano</th>
                  </tr>
                </thead>
                <tbody>
                  {(tablesQ.data ?? []).map((t) => (
                    <tr
                      key={t.table_name}
                      onClick={() => setTable(t.table_name)}
                      className={
                        "cursor-pointer border-t border-border hover:bg-soft transition " +
                        (table === t.table_name ? "bg-soft" : "")
                      }
                    >
                      <td className="px-3 py-1.5 font-mono">{t.table_name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(t.approx_rows)}</td>
                      <td className="px-2 py-1.5 text-right text-text-muted">{t.size_pretty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tablesQ.isLoading && (
                <div className="p-4 text-center text-text-muted text-xs">Cargando...</div>
              )}
            </div>
          </div>

          {/* Columns + Preview */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-bold text-text mb-3">
                {table ? `${schema}.${table}` : "Selecciona una tabla"}
              </div>
              {table && colsQ.data && (
                <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Columna</th>
                        <th className="text-left px-3 py-2">Tipo</th>
                        <th className="text-left px-3 py-2">Null?</th>
                        <th className="text-left px-3 py-2">PK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {colsQ.data.map((c) => (
                        <tr key={c.column_name} className="border-t border-border hover:bg-soft">
                          <td className="px-3 py-1.5 font-mono font-semibold text-text">{c.column_name}</td>
                          <td className="px-3 py-1.5 text-text-muted">{c.data_type}</td>
                          <td className="px-3 py-1.5 text-text-muted">{c.is_nullable}</td>
                          <td className="px-3 py-1.5">
                            {c.pk === "YES" && (
                              <span className="text-[10px] font-bold text-primary bg-soft border border-primary/20 px-1.5 py-0.5 rounded">
                                PK
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="text-sm font-bold text-text">Preview de filas</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={10}
                    value={previewN}
                    onChange={(e) => setPreviewN(Math.max(10, Math.min(1000, Number(e.target.value) || 100)))}
                    className="w-20 px-2 py-1 text-xs rounded border border-border outline-none focus:border-primary"
                  />
                  <button
                    disabled={!previewQ.data || !table}
                    onClick={() =>
                      previewQ.data &&
                      downloadCsv(
                        `${unit}_${schema}_${table}_preview.csv`,
                        previewQ.data.columns,
                        previewQ.data.rows,
                      )
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:border-primary hover:text-primary disabled:opacity-50"
                  >
                    <Download size={12} /> CSV
                  </button>
                </div>
              </div>
              <div className="overflow-auto max-h-[400px] border border-border rounded-lg">
                {previewQ.data && previewQ.data.rows.length > 0 ? (
                  <table className="text-xs">
                    <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                      <tr>
                        {previewQ.data.columns.map((c) => (
                          <th key={c} className="text-left px-2 py-1.5 whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewQ.data.rows.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-soft">
                          {r.map((v, j) => (
                            <td key={j} className="px-2 py-1 whitespace-nowrap font-mono text-[11px]">
                              {v === null ? <span className="text-text-muted italic">NULL</span> : String(v).slice(0, 80)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-6 text-center text-text-muted text-xs">
                    {table ? (previewQ.isLoading ? "Cargando filas..." : "Sin filas en preview") : "Elegi una tabla a la izquierda"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
