"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { DashboardHeader } from "@/components/dashboard-header";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  const diffSec = (Date.now() - dt.getTime()) / 1000;
  if (diffSec < 60) return "hace segundos";
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `hace ${Math.floor(diffSec / 3600)} h`;
  if (diffSec < 86400 * 30) return `hace ${Math.floor(diffSec / 86400)} d`;
  return dt.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}
import { Download, Database, Search, X, Loader2, Pencil, Tag, BookOpen, Save, Sparkles, Wand2 } from "lucide-react";

type Unit = "unistore" | "unidrop";

type Me = {
  id: number;
  email: string;
  role: string;
  is_admin: boolean;
  area_slug: string | null;
};

type CatalogMetadataItem = {
  unit: string;
  schema_name: string;
  table_name: string;
  description: string | null;
  tags: string[];
  updated_by_email: string | null;
  updated_at: string | null;
  queries: number;
  last_used_at: string | null;
  last_user: string | null;
};

type CatalogMetadataResponse = {
  unit: string;
  items: CatalogMetadataItem[];
  tags: { tag: string; count: number }[];
};

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

type SamplesResponse = {
  samples: Record<string, { value: string; count: number }[]>;
  sampled_rows: number;
};

type SearchMatch = { column: string; count: number };
type SearchResult = { table: string; matches: SearchMatch[] };
type SearchResponse = {
  query: string;
  scanned: number;
  skipped: string[];
  results: SearchResult[];
};

type SearchScope = "local" | "global";

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
  const qc = useQueryClient();
  const [unit, setUnit] = useState<Unit>("unistore");
  const [schema, setSchema] = useState<string>("");
  const [table, setTable] = useState<string>("");
  const [previewN, setPreviewN] = useState<number>(100);
  const [searchDraft, setSearchDraft] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [searchScope, setSearchScope] = useState<SearchScope>("local");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  const [editDesc, setEditDesc] = useState<string>("");
  const [editTags, setEditTags] = useState<string>("");

  const meQ = useQuery<Me>({
    queryKey: ["users-me"],
    queryFn: () => api<Me>("/api/users/me"),
    staleTime: 5 * 60_000,
  });
  const canEdit = useMemo(() => {
    const u = meQ.data;
    if (!u) return false;
    if (u.is_admin) return true;
    const role = (u.role || "").toLowerCase();
    if (role === "admin" || role === "gerencia") return true;
    return (u.area_slug || "").toLowerCase() === "it_data";
  }, [meQ.data]);

  const metadataQ = useQuery<CatalogMetadataResponse>({
    queryKey: ["catalog-metadata", unit],
    queryFn: () => api(`/api/catalog-metadata/${unit}`),
    staleTime: 60_000,
  });

  // Indice schema.table -> metadata para lookup O(1)
  const metaByKey = useMemo(() => {
    const m = new Map<string, CatalogMetadataItem>();
    (metadataQ.data?.items ?? []).forEach((it) => {
      m.set(`${it.schema_name}.${it.table_name}`, it);
    });
    return m;
  }, [metadataQ.data]);

  const currentMeta = useMemo(() => {
    if (!schema || !table) return null;
    return metaByKey.get(`${schema}.${table}`) ?? null;
  }, [metaByKey, schema, table]);

  const saveMetaMut = useMutation({
    mutationFn: async (body: { description: string | null; tags: string[] }) =>
      api<CatalogMetadataItem>(
        `/api/catalog-metadata/${unit}/${schema}/${table}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog-metadata", unit] });
      setEditing(false);
    },
  });

  function openEditor() {
    setEditDesc(currentMeta?.description ?? "");
    setEditTags((currentMeta?.tags ?? []).join(", "));
    setEditing(true);
  }
  function saveMeta() {
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    saveMetaMut.mutate({
      description: editDesc.trim() || null,
      tags,
    });
  }

  // Auto-doc con Gemini - una tabla puntual
  const autoDocTableMut = useMutation({
    mutationFn: async (vars: { force: boolean }) =>
      api<{ status: string; ai?: { description: string; tags: string[] } }>(
        `/api/catalog-metadata/${unit}/${schema}/${table}/auto-doc?force=${vars.force}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog-metadata", unit] });
    },
  });

  // Auto-doc batch - todo el schema
  const autoDocSchemaMut = useMutation({
    mutationFn: async (vars: { force: boolean }) =>
      api<{
        unit: string;
        schema: string;
        duration_sec: number;
        total_tables: number;
        processed: { table: string; description: string; tags: string[] }[];
        skipped: { table: string; reason: string }[];
        errors: { table: string; error: string }[];
        more_pending: boolean;
      }>(
        `/api/catalog-metadata/${unit}/auto-doc?schema=${encodeURIComponent(schema)}&force=${vars.force}`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog-metadata", unit] });
    },
  });

  const [autoDocConfirm, setAutoDocConfirm] = useState<boolean>(false);
  const [autoDocForce, setAutoDocForce] = useState<boolean>(false);

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
    setTagFilter(null);
  }, [unit]);

  useEffect(() => {
    setEditing(false);
  }, [unit, schema, table]);

  const tablesQ = useQuery<TableInfo[]>({
    queryKey: ["sources", unit, "tables", schema],
    queryFn: () => api(`/api/sources/${unit}/schemas/${schema}/tables`),
    staleTime: 5 * 60_000,
    enabled: !!schema,
  });

  // Filtrado de tablas por tag (se aplica sobre tablesQ.data)
  const filteredTables = useMemo(() => {
    if (!tablesQ.data) return [];
    if (!tagFilter) return tablesQ.data;
    return tablesQ.data.filter((t) => {
      const meta = metaByKey.get(`${schema}.${t.table_name}`);
      return meta?.tags?.includes(tagFilter) ?? false;
    });
  }, [tablesQ.data, tagFilter, metaByKey, schema]);

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

  const samplesQ = useQuery<SamplesResponse>({
    queryKey: ["sources", unit, "samples", schema, table],
    queryFn: () =>
      api(`/api/sources/${unit}/schemas/${schema}/tables/${table}/samples`),
    enabled: !!table,
    staleTime: 10 * 60_000,
  });

  const globalSearchQ = useQuery<SearchResponse>({
    queryKey: ["sources", unit, "search", schema, searchTerm],
    queryFn: () =>
      api(
        `/api/sources/${unit}/schemas/${schema}/search?q=${encodeURIComponent(searchTerm)}`,
      ),
    enabled: searchScope === "global" && !!schema && searchTerm.length >= 2,
    staleTime: 60_000,
  });

  // Match local: filas/celdas que contienen el termino (case insensitive).
  const localMatches = useMemo(() => {
    if (searchScope !== "local" || !searchTerm || !previewQ.data) {
      return { rows: new Set<number>(), cells: new Set<string>(), cols: new Set<string>() };
    }
    const needle = searchTerm.toLowerCase();
    const rows = new Set<number>();
    const cells = new Set<string>();
    const cols = new Set<string>();
    previewQ.data.rows.forEach((r, ri) => {
      r.forEach((v, ci) => {
        if (v === null || v === undefined) return;
        if (String(v).toLowerCase().includes(needle)) {
          rows.add(ri);
          cells.add(`${ri}:${ci}`);
          cols.add(previewQ.data!.columns[ci]);
        }
      });
    });
    return { rows, cells, cols };
  }, [searchScope, searchTerm, previewQ.data]);

  function submitSearch() {
    const v = searchDraft.trim();
    setSearchTerm(v);
  }
  function clearSearch() {
    setSearchDraft("");
    setSearchTerm("");
  }

  return (
    <>
      <Topbar
        title="Explorador de fuentes (M0)"
        subtitle="Conexion directa a las BBDD operativas · solo lectura"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <DashboardHeader
          filters={
            <>
              <Segmented<Unit>
                value={unit}
                onChange={setUnit}
                options={[
                  { value: "unistore", label: "Unistore" },
                  { value: "unidrop", label: "Unidrop" },
                ]}
              />
              <Segmented<SearchScope>
                value={searchScope}
                onChange={setSearchScope}
                options={[
                  { value: "local", label: "Tabla" },
                  { value: "global", label: "Schema" },
                ]}
              />
              <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-2 py-1.5 min-w-[300px]">
                <Search size={14} className="text-text-muted shrink-0" />
                <input
                  type="text"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitSearch();
                    if (e.key === "Escape") clearSearch();
                  }}
                  placeholder={
                    searchScope === "local"
                      ? "Buscar en preview de la tabla..."
                      : `Buscar en todas las tablas de "${schema || "..."}"...`
                  }
                  className="flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted"
                />
                {searchTerm && (
                  <button
                    onClick={clearSearch}
                    className="text-text-muted hover:text-text"
                    title="Limpiar"
                  >
                    <X size={14} />
                  </button>
                )}
                <button
                  onClick={submitSearch}
                  disabled={searchDraft.trim().length < 2}
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary text-white disabled:opacity-40"
                >
                  Buscar
                </button>
              </div>
            </>
          }
        />

        {/* Panel de busqueda global */}
        {searchScope === "global" && searchTerm && (
          <div className="mb-4 bg-surface border border-primary/30 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="text-sm font-bold text-text flex items-center gap-2">
                <Search size={14} className="text-primary" />
                Busqueda global en <span className="font-mono">{schema}</span>:{" "}
                <span className="font-mono bg-soft px-2 py-0.5 rounded">{searchTerm}</span>
              </div>
              {globalSearchQ.data && (
                <div className="text-[11px] text-text-muted">
                  {globalSearchQ.data.results.length} tabla(s) con match ·{" "}
                  {globalSearchQ.data.scanned} escaneadas
                  {globalSearchQ.data.skipped.length > 0 && (
                    <> · {globalSearchQ.data.skipped.length} omitidas (timeout)</>
                  )}
                </div>
              )}
            </div>
            {globalSearchQ.isFetching && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 size={14} className="animate-spin" /> Escaneando tablas...
              </div>
            )}
            {globalSearchQ.data && globalSearchQ.data.results.length === 0 && !globalSearchQ.isFetching && (
              <div className="text-xs text-text-muted">
                Sin coincidencias en {globalSearchQ.data.scanned} tablas escaneadas.
              </div>
            )}
            {globalSearchQ.data && globalSearchQ.data.results.length > 0 && (
              <div className="max-h-[280px] overflow-y-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-soft text-[10px] uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="text-left px-3 py-2">Tabla</th>
                      <th className="text-left px-3 py-2">Columnas con match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalSearchQ.data.results.map((r) => (
                      <tr
                        key={r.table}
                        onClick={() => setTable(r.table)}
                        className={
                          "cursor-pointer border-t border-border hover:bg-soft transition " +
                          (table === r.table ? "bg-soft" : "")
                        }
                      >
                        <td className="px-3 py-1.5 font-mono font-semibold text-text">{r.table}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {r.matches.map((m) => (
                              <span
                                key={m.column}
                                className="text-[10px] font-mono bg-soft border border-border rounded px-1.5 py-0.5"
                              >
                                {m.column}{" "}
                                <span className="text-text-muted">· {formatNumber(m.count)}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Chips de tags - filtran la lista de tablas */}
        {(metadataQ.data?.tags?.length ?? 0) > 0 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <Tag size={12} className="text-text-muted" />
            <span className="text-[10px] uppercase tracking-wider text-text-muted">
              Filtrar por tag:
            </span>
            <button
              onClick={() => setTagFilter(null)}
              className={
                "text-[10px] font-bold px-2 py-0.5 rounded border transition " +
                (!tagFilter
                  ? "bg-primary text-white border-primary"
                  : "border-border text-text-muted hover:border-primary")
              }
            >
              Todos
            </button>
            {(metadataQ.data?.tags ?? []).map((t) => (
              <button
                key={t.tag}
                onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                className={
                  "text-[10px] font-bold px-2 py-0.5 rounded border transition " +
                  (tagFilter === t.tag
                    ? "bg-primary text-white border-primary"
                    : "border-border text-text hover:border-primary")
                }
                title={`${t.count} tabla(s)`}
              >
                {t.tag}
                <span className={"ml-1 " + (tagFilter === t.tag ? "text-white/70" : "text-text-muted")}>
                  ·{t.count}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Schemas + Tables */}
          <div className="lg:col-span-5 bg-surface border border-border rounded-xl p-4">
            <div className="text-sm font-bold text-text mb-3 flex items-center gap-2 flex-wrap">
              <Database size={14} className="text-primary" />
              <span>Tablas</span>
              {tagFilter && (
                <span className="ml-1 text-[10px] font-normal text-text-muted">
                  · filtradas por <span className="font-mono text-primary">#{tagFilter}</span>
                </span>
              )}
              {canEdit && schema && (
                <button
                  onClick={() => setAutoDocConfirm(true)}
                  disabled={autoDocSchemaMut.isPending}
                  className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-50"
                  title="Genera descripcion + tags con IA para todas las tablas sin metadata"
                >
                  {autoDocSchemaMut.isPending ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  Auto-doc schema
                </button>
              )}
            </div>

            {/* Modal confirmacion auto-doc schema */}
            {autoDocConfirm && (
              <div className="mb-3 bg-primary/5 border border-primary/30 rounded-lg p-3">
                <div className="text-[11px] font-bold text-text mb-1">
                  Auto-documentar schema <span className="font-mono">{schema}</span>?
                </div>
                <p className="text-[10px] text-text-muted mb-2">
                  Genera descripcion + tags con Gemini para cada tabla. Toma ~2s por tabla.
                  Por default salta las que ya tienen metadata.
                </p>
                <label className="flex items-center gap-1 text-[10px] text-text-muted mb-2">
                  <input
                    type="checkbox"
                    checked={autoDocForce}
                    onChange={(e) => setAutoDocForce(e.target.checked)}
                  />
                  Sobreescribir las que ya tienen metadata (force)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      autoDocSchemaMut.mutate({ force: autoDocForce });
                      setAutoDocConfirm(false);
                    }}
                    className="text-[10px] font-bold px-2 py-1 rounded bg-primary text-white"
                  >
                    Si, generar
                  </button>
                  <button
                    onClick={() => setAutoDocConfirm(false)}
                    className="text-[10px] px-2 py-1 rounded border border-border hover:border-primary"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Reporte post-batch */}
            {autoDocSchemaMut.data && !autoDocSchemaMut.isPending && (
              <div className="mb-3 bg-soft border border-border rounded-lg p-3 text-[11px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-text">
                    Auto-doc {autoDocSchemaMut.data.schema} ·{" "}
                    {autoDocSchemaMut.data.duration_sec}s
                  </span>
                  <button
                    onClick={() => autoDocSchemaMut.reset()}
                    className="text-text-muted hover:text-text"
                  >
                    <X size={11} />
                  </button>
                </div>
                <div className="text-text-muted">
                  <span className="text-success font-bold">
                    {autoDocSchemaMut.data.processed.length}
                  </span>{" "}
                  procesadas ·{" "}
                  <span className="text-text-muted">{autoDocSchemaMut.data.skipped.length}</span>{" "}
                  saltadas
                  {autoDocSchemaMut.data.errors.length > 0 && (
                    <>
                      {" "}·{" "}
                      <span className="text-error">{autoDocSchemaMut.data.errors.length}</span> con
                      error
                    </>
                  )}
                  {autoDocSchemaMut.data.more_pending && (
                    <span className="ml-1 text-warning">(quedan mas - corre de nuevo)</span>
                  )}
                </div>
              </div>
            )}
            {autoDocSchemaMut.isError && (
              <div className="mb-3 bg-error/5 border border-error/30 rounded-lg p-2 text-[11px] text-error">
                Error auto-doc: {(autoDocSchemaMut.error as Error).message}
              </div>
            )}
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
                  {filteredTables.map((t) => {
                    const meta = metaByKey.get(`${schema}.${t.table_name}`);
                    const hasDesc = !!meta?.description;
                    const tagsCount = meta?.tags?.length ?? 0;
                    return (
                      <tr
                        key={t.table_name}
                        onClick={() => setTable(t.table_name)}
                        className={
                          "cursor-pointer border-t border-border hover:bg-soft transition " +
                          (table === t.table_name ? "bg-soft" : "")
                        }
                      >
                        <td className="px-3 py-1.5 font-mono">
                          <span>{t.table_name}</span>
                          {(hasDesc || tagsCount > 0) && (
                            <span className="ml-2 inline-flex items-center gap-1 align-middle">
                              {hasDesc && (
                                <BookOpen
                                  size={11}
                                  className="text-primary"
                                />
                              )}
                              {tagsCount > 0 && (
                                <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 rounded">
                                  {tagsCount}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(t.approx_rows)}</td>
                        <td className="px-2 py-1.5 text-right text-text-muted">{t.size_pretty}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {tablesQ.isLoading && (
                <div className="p-4 text-center text-text-muted text-xs">Cargando...</div>
              )}
            </div>
          </div>

          {/* Columns + Preview */}
          <div className="lg:col-span-7 space-y-4">
            {/* Panel Metadata - descripcion + tags + stats de uso */}
            {table && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">
                      Metadata
                    </div>
                    <div className="text-sm font-bold text-text truncate font-mono">
                      {schema}.{table}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-text-muted shrink-0">
                    {currentMeta && currentMeta.queries > 0 && (
                      <div title="Queries en SQL libre">
                        <span className="font-mono font-bold text-text">
                          {formatNumber(currentMeta.queries)}
                        </span>{" "}
                        queries
                      </div>
                    )}
                    {currentMeta?.last_used_at && (
                      <div title={currentMeta.last_used_at}>
                        ult. uso {fmtRelative(currentMeta.last_used_at)}
                      </div>
                    )}
                    {canEdit && !editing && (
                      <>
                        <button
                          onClick={() => autoDocTableMut.mutate({ force: !!currentMeta?.description })}
                          disabled={autoDocTableMut.isPending}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                          title="Genera descripcion + tags con Gemini para esta tabla"
                        >
                          {autoDocTableMut.isPending ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Wand2 size={11} />
                          )}
                          {currentMeta?.description ? "Re-generar" : "Auto-doc"}
                        </button>
                        <button
                          onClick={openEditor}
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          <Pencil size={11} /> Editar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {!editing ? (
                  <>
                    {/* Vista read-only */}
                    {currentMeta?.description ? (
                      <p className="text-[13px] text-text whitespace-pre-wrap leading-relaxed mb-2">
                        {currentMeta.description}
                      </p>
                    ) : (
                      <p className="text-[12px] text-text-muted italic mb-2">
                        Sin descripcion.{" "}
                        {canEdit && (
                          <button
                            onClick={openEditor}
                            className="text-primary hover:underline not-italic"
                          >
                            Agregar
                          </button>
                        )}
                      </p>
                    )}
                    {(currentMeta?.tags?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {currentMeta!.tags.map((t) => (
                          <button
                            key={t}
                            onClick={() => setTagFilter(t)}
                            className="text-[10px] font-bold bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 rounded hover:bg-primary/20"
                          >
                            #{t}
                          </button>
                        ))}
                      </div>
                    )}
                    {currentMeta?.updated_by_email && currentMeta.updated_at && (
                      <div className="text-[10px] text-text-muted mt-2">
                        Anotado por {currentMeta.updated_by_email} ·{" "}
                        {fmtRelative(currentMeta.updated_at)}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Editor */}
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Que tabla es, para que sirve, ojo con esta columna, esta es la fuente cuando..."
                      rows={4}
                      className="w-full px-3 py-2 rounded border border-border bg-bg text-sm outline-none focus:border-primary mb-2"
                    />
                    <input
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="tags separados por coma (ej: ventas, ground-truth, lento)"
                      className="w-full px-3 py-2 rounded border border-border bg-bg text-sm outline-none focus:border-primary mb-2"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveMeta}
                        disabled={saveMetaMut.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded bg-primary text-white disabled:opacity-50"
                      >
                        {saveMetaMut.isPending ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Save size={12} />
                        )}
                        Guardar
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="px-3 py-1.5 text-xs rounded border border-border hover:border-primary"
                      >
                        Cancelar
                      </button>
                      {saveMetaMut.isError && (
                        <span className="text-[11px] text-error">
                          Error: {(saveMetaMut.error as Error).message}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-bold text-text mb-3">
                {table ? `${schema}.${table}` : "Selecciona una tabla"}
              </div>
              {table && colsQ.data && (
                <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Columna</th>
                        <th className="text-left px-3 py-2">Tipo</th>
                        <th className="text-left px-3 py-2">Null?</th>
                        <th className="text-left px-3 py-2">PK</th>
                        <th className="text-left px-3 py-2">
                          Ejemplos {samplesQ.isLoading && <Loader2 size={10} className="inline animate-spin" />}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {colsQ.data.map((c) => {
                        const isMatch = localMatches.cols.has(c.column_name);
                        const examples = samplesQ.data?.samples[c.column_name] ?? [];
                        return (
                          <tr
                            key={c.column_name}
                            className={
                              "border-t border-border hover:bg-soft " +
                              (isMatch ? "bg-primary/5" : "")
                            }
                          >
                            <td className="px-3 py-1.5 font-mono font-semibold text-text">
                              {c.column_name}
                              {isMatch && (
                                <span className="ml-2 text-[9px] font-bold text-primary bg-primary/10 px-1 rounded">
                                  MATCH
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-text-muted">{c.data_type}</td>
                            <td className="px-3 py-1.5 text-text-muted">{c.is_nullable}</td>
                            <td className="px-3 py-1.5">
                              {c.pk === "YES" && (
                                <span className="text-[10px] font-bold text-primary bg-soft border border-primary/20 px-1.5 py-0.5 rounded">
                                  PK
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              {examples.length === 0 ? (
                                <span className="text-text-muted italic text-[10px]">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {examples.map((ex, i) => (
                                    <span
                                      key={i}
                                      title={`${ex.count} fila(s)`}
                                      className="text-[10px] font-mono bg-soft border border-border rounded px-1.5 py-0.5 max-w-[200px] truncate"
                                    >
                                      {ex.value}
                                      <span className="text-text-muted ml-1">×{ex.count}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="text-sm font-bold text-text">
                  Preview de filas
                  {searchScope === "local" && searchTerm && previewQ.data && (
                    <span className="ml-2 text-[11px] font-normal text-text-muted">
                      · {localMatches.rows.size} fila(s) con match
                    </span>
                  )}
                </div>
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
                          <th
                            key={c}
                            className={
                              "text-left px-2 py-1.5 whitespace-nowrap " +
                              (localMatches.cols.has(c) ? "text-primary font-bold" : "")
                            }
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewQ.data.rows.map((r, i) => {
                        const rowHasMatch = localMatches.rows.has(i);
                        const hideRow =
                          searchScope === "local" && searchTerm && !rowHasMatch;
                        if (hideRow) return null;
                        return (
                          <tr
                            key={i}
                            className={
                              "border-t border-border hover:bg-soft " +
                              (rowHasMatch ? "bg-primary/5" : "")
                            }
                          >
                            {r.map((v, j) => {
                              const cellMatch = localMatches.cells.has(`${i}:${j}`);
                              return (
                                <td
                                  key={j}
                                  className={
                                    "px-2 py-1 whitespace-nowrap font-mono text-[11px] " +
                                    (cellMatch ? "bg-primary/15 font-bold text-primary" : "")
                                  }
                                >
                                  {v === null ? (
                                    <span className="text-text-muted italic">NULL</span>
                                  ) : (
                                    String(v).slice(0, 80)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
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
