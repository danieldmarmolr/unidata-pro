"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { TodayPanel } from "@/components/today-panel";
import { Segmented } from "@/components/segmented";
import { DashboardHeader } from "@/components/dashboard-header";
import { ERDiagram, type ERNode, type EREdge, type ERColumn } from "@/components/er-diagram";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { Search, Database, X, ArrowRight, ArrowLeftRight, Eye, EyeOff, Key, Link2 } from "lucide-react";

type View = "global" | "unistore" | "unidrop" | "unidev";
// Modo segun la vista
type GlobalMode = "schemas" | "cross_db" | "tables";
type UnitMode = "diagram" | "table";

type Graph = {
  unit?: string;
  level?: string;
  nodes: (ERNode & { tables?: number; edges_in?: number; edges_out?: number })[];
  edges: EREdge[];
  stats: { tables?: number; schemas?: number; edges: number; cross_db_edges?: number };
};

type SearchResult = {
  schema: string;
  table: string;
  column: string;
  data_type: string;
  is_nullable: string;
};

export default function CatalogPage() {
  const [view, setView] = useState<View>("global");
  const [globalMode, setGlobalMode] = useState<GlobalMode>("schemas");
  const [unitMode, setUnitMode] = useState<UnitMode>("diagram");
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<{ tableId: string; column: ERColumn } | null>(null);

  // Filtros (para vista de tablas en Global o por-unit-diagram)
  const [hideOrphans, setHideOrphans] = useState(true);
  const [minRows, setMinRows] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ.trim()), 250);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    setSelectedId(null);
    setActiveColumn(null);
  }, [view, globalMode]);

  // Endpoint y nodeKind segun la vista activa
  const endpoint = useMemo(() => {
    if (view === "global") {
      if (globalMode === "schemas") return "/api/catalog/global/schemas";
      if (globalMode === "cross_db") return "/api/catalog/global/cross-db";
      return "/api/catalog/global/graph";
    }
    return `/api/catalog/${view}/graph`;
  }, [view, globalMode]);

  const nodeKind: "table" | "schema" =
    view === "global" && globalMode === "schemas" ? "schema" : "table";

  const graphQ = useQuery<Graph>({
    queryKey: ["catalog", view, view === "global" ? globalMode : "unit", endpoint],
    queryFn: () => api(endpoint),
    staleTime: 5 * 60_000,
  });

  // Filtrado: aplica solo en vistas de tabla (no schemas)
  const { filteredNodes, filteredEdges } = useMemo(() => {
    const all = graphQ.data?.nodes ?? [];
    const allEdges = graphQ.data?.edges ?? [];
    const isSchemaView = view === "global" && globalMode === "schemas";
    if (isSchemaView) {
      return { filteredNodes: all, filteredEdges: allEdges };
    }
    let nodes = all;
    if (minRows > 0) nodes = nodes.filter((n) => (n.rows ?? 0) >= minRows);
    if (hideOrphans) {
      const connected = new Set<string>();
      allEdges.forEach((e) => { connected.add(e.source); connected.add(e.target); });
      nodes = nodes.filter((n) => connected.has(n.id));
    }
    const allowed = new Set(nodes.map((n) => n.id));
    const edges = allEdges.filter((e) => allowed.has(e.source) && allowed.has(e.target));
    return { filteredNodes: nodes, filteredEdges: edges };
  }, [graphQ.data, view, globalMode, minRows, hideOrphans]);

  const searchUnits = view === "global" ? (["unistore", "unidrop", "unidev"] as const) : ([view] as const);
  const searchResults = useQuery<{ unit: string; results: SearchResult[] }[]>({
    queryKey: ["catalog", "search", debouncedQ, view],
    queryFn: async () => {
      if (!debouncedQ) return [];
      return Promise.all(
        searchUnits.map(async (u) => ({
          unit: u,
          results: (await api<SearchResult[]>(`/api/catalog/${u}/search?q=${encodeURIComponent(debouncedQ)}&limit=50`)) ?? [],
        })),
      );
    },
    enabled: debouncedQ.length >= 1,
    staleTime: 60_000,
  });

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return graphQ.data?.nodes.find((n) => n.id === selectedId) ?? null;
  }, [selectedId, graphQ.data]);

  const relatedEdges = useMemo(() => {
    if (!selectedId || !graphQ.data) return { in: [], out: [] };
    return {
      out: graphQ.data.edges.filter((e) => e.source === selectedId),
      in: graphQ.data.edges.filter((e) => e.target === selectedId),
    };
  }, [selectedId, graphQ.data]);

  const grouped = useMemo(() => {
    const data = filteredNodes;
    const map: Record<string, ERNode[]> = {};
    data.forEach((n) => {
      const key = n.unit ? `${n.unit}::${n.schema}` : n.schema;
      if (!map[key]) map[key] = [];
      map[key].push(n);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => b.rows - a.rows));
    return map;
  }, [filteredNodes]);

  function pickFromSearch(unit: string, schema: string, table: string) {
    if (view === "global" && globalMode === "schemas") {
      // En vista schema, seleccionar el schema
      setSelectedId(`${unit}::${schema}`);
    } else {
      const id = view === "global" ? `${unit}::${schema}.${table}` : `${schema}.${table}`;
      setSelectedId(id);
    }
    setSearchQ("");
  }

  // Si seleccionas un schema en vista schema, ofrecer ir a vista tablas filtrada
  const drillFromSchema = view === "global" && globalMode === "schemas" && selectedId;

  return (
    <>
      <Topbar
        title="Data Catalog"
        subtitle="Estructura de las 3 BBDD · ER navegable · cross-database"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <TodayPanel unit="unistore" context="productos" title="HOY · Catalogo" />
        <DashboardHeader
          generatedAt={null}
          filters={
            <div className="flex flex-wrap items-center gap-3">
              <Segmented<View>
                value={view}
                onChange={(v) => setView(v)}
                options={[
                  { value: "global", label: "Global" },
                  { value: "unistore", label: "Unistore" },
                  { value: "unidrop", label: "Unidrop" },
                  { value: "unidev", label: "Unidev" },
                ]}
              />
              {view === "global" ? (
                <Segmented<GlobalMode>
                  value={globalMode}
                  onChange={setGlobalMode}
                  options={[
                    { value: "schemas", label: "Resumen (schemas)" },
                    { value: "cross_db", label: "Cross-DB" },
                    { value: "tables", label: "Tablas (todas)" },
                  ]}
                />
              ) : (
                <Segmented<UnitMode>
                  value={unitMode}
                  onChange={setUnitMode}
                  options={[
                    { value: "diagram", label: "Diagrama" },
                    { value: "table", label: "Tabular" },
                  ]}
                />
              )}
            </div>
          }
        />

        {/* Filtros para vistas de tabla */}
        {!(view === "global" && globalMode === "schemas") && (view !== "global" ? unitMode === "diagram" : true) && (
          <div className="bg-surface border border-border rounded-xl p-3 mb-4 flex flex-wrap items-center gap-4 text-xs">
            <button
              onClick={() => setHideOrphans((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition " +
                (hideOrphans ? "bg-soft border-primary text-primary" : "bg-surface border-border text-text-muted")
              }
            >
              {hideOrphans ? <Eye size={12} /> : <EyeOff size={12} />}
              Esconder tablas sin FKs
            </button>
            <span className="text-text-muted">Click en una tabla para expandirla · arrastrá para reorganizar</span>
            <div className="inline-flex items-center gap-2">
              <span className="text-text-muted">Min filas:</span>
              <input
                type="number"
                min={0}
                value={minRows}
                onChange={(e) => setMinRows(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 px-2 py-1 rounded border border-border bg-bg outline-none focus:border-primary"
                placeholder="0"
              />
            </div>
            <div className="ml-auto text-text-muted">
              Mostrando <strong>{filteredNodes.length}</strong> de {graphQ.data?.nodes.length ?? 0} tablas · {filteredEdges.length} relaciones
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {view === "global" && globalMode === "schemas" ? "Schemas" : "Tablas"}
            </div>
            <div className="mt-1 text-2xl font-extrabold text-text">
              {formatNumber(graphQ.data?.stats.schemas ?? graphQ.data?.stats.tables ?? 0)}
            </div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Relaciones</div>
            <div className="mt-1 text-2xl font-extrabold text-text">{formatNumber(graphQ.data?.stats.edges ?? 0)}</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Cross-DB</div>
            <div className="mt-1 text-2xl font-extrabold text-error">
              {formatNumber(graphQ.data?.stats.cross_db_edges ?? 0)}
            </div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Buscar</div>
            <div className="mt-1 relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Columna o tabla..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-bg text-xs outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Search results */}
        {debouncedQ && (
          <div className="bg-surface border border-border rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold text-text">Resultados para &quot;{debouncedQ}&quot;</div>
              <button onClick={() => setSearchQ("")} className="text-text-muted hover:text-text">
                <X size={14} />
              </button>
            </div>
            <div className="overflow-x-auto max-h-[30vh] overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">BBDD</th>
                    <th className="text-left px-3 py-2">Schema</th>
                    <th className="text-left px-3 py-2">Tabla</th>
                    <th className="text-left px-3 py-2">Columna</th>
                    <th className="text-left px-3 py-2">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {(searchResults.data ?? []).flatMap((g) =>
                    g.results.map((r, i) => (
                      <tr
                        key={`${g.unit}-${i}`}
                        onClick={() => pickFromSearch(g.unit, r.schema, r.table)}
                        className="cursor-pointer border-t border-border hover:bg-soft transition"
                      >
                        <td className="px-3 py-1.5 text-primary uppercase font-bold">{g.unit}</td>
                        <td className="px-3 py-1.5 text-text-muted">{r.schema}</td>
                        <td className="px-3 py-1.5 font-semibold">{r.table}</td>
                        <td className="px-3 py-1.5 font-mono text-primary">{r.column}</td>
                        <td className="px-3 py-1.5 text-text-muted">{r.data_type}</td>
                      </tr>
                    )),
                  )}
                  {!searchResults.isLoading && (searchResults.data ?? []).every((g) => g.results.length === 0) && (
                    <tr><td colSpan={5} className="py-6 text-center text-text-muted">Sin resultados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Helper bar de modo */}
        {view === "global" && globalMode === "schemas" && (
          <div className="mb-3 bg-soft border border-border rounded-lg px-4 py-2 text-xs text-text">
            <strong>Resumen por schema:</strong> 1 caja por schema con stats agregados. El grosor de la línea entre schemas indica cuántas FKs los conectan. <span className="text-error font-semibold">Líneas rojas</span> = relaciones cross-database. Click en un schema para ver detalle.
          </div>
        )}
        {view === "global" && globalMode === "cross_db" && (
          <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-error">
            <strong>Cross-DB Map:</strong> solo las tablas que participan en relaciones cross-database + sus vecinas inmediatas. Mucho más legible para entender qué une las 3 BBDD.
          </div>
        )}

        {/* Diagrama */}
        {graphQ.isLoading ? (
          <div className="bg-surface border border-border rounded-xl p-5 h-[700px] animate-pulse" />
        ) : (
          (view === "global" || unitMode === "diagram") ? (
            <>
              <div className="mb-3 flex items-center gap-4 text-xs text-text-muted flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5 bg-primary" /> FK explicita
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t border-dashed border-warn" /> FK implicita
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-4 border-t-2 border-dashed border-error" /> Cross-database
                </div>
                <div className="ml-auto text-text">
                  Click = resaltar · drag = mover · scroll = zoom
                </div>
              </div>
              <ERDiagram
                nodes={filteredNodes}
                edges={filteredEdges}
                onSelectTable={(id) => setSelectedId(id === selectedId ? null : id)}
                onColumnClick={(tableId, column) => {
                  if (activeColumn?.tableId === tableId && activeColumn.column.name === column.name) {
                    setActiveColumn(null);
                  } else {
                    setActiveColumn({ tableId, column });
                    setSelectedId(tableId);
                  }
                }}
                activeColumn={activeColumn ? { tableId: activeColumn.tableId, name: activeColumn.column.name } : null}
                highlight={selectedId}
                height={720}
                nodeKind={nodeKind}
              />
            </>
          ) : (
            // tabular para vista por unit
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 space-y-4">
                {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([schemaKey, tables]) => (
                  <div key={schemaKey} className="bg-surface border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Database size={14} className="text-primary" />
                      <div className="font-bold text-text">{schemaKey}</div>
                      <div className="text-xs text-text-muted">({tables.length})</div>
                    </div>
                    <div className="overflow-y-auto max-h-[35vh] border border-border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-soft text-[10px] uppercase tracking-wider text-text-muted sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-1.5">Tabla</th>
                            <th className="text-right px-2 py-1.5">Filas</th>
                            <th className="text-right px-2 py-1.5">Tamano</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tables.map((t) => (
                            <tr
                              key={t.id}
                              onClick={() => setSelectedId(t.id)}
                              className={
                                "cursor-pointer border-t border-border hover:bg-soft transition " +
                                (selectedId === t.id ? "bg-soft" : "")
                              }
                            >
                              <td className="px-3 py-1.5 font-mono">{t.label}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{formatNumber(t.rows)}</td>
                              <td className="px-2 py-1.5 text-right text-text-muted">{t.size}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lg:col-span-7 space-y-4">
                <SelectedPanel
                  selectedId={selectedId}
                  selectedNode={selectedNode}
                  relatedEdges={relatedEdges}
                  onJump={(id) => setSelectedId(id)}
                  isSchemaLevel={false}
                />
              </div>
            </div>
          )
        )}

        {/* Popover columna activa - flota arriba a la derecha */}
        {activeColumn && (
          <ColumnPopover
            tableId={activeColumn.tableId}
            column={activeColumn.column}
            onClose={() => setActiveColumn(null)}
            onJumpToTable={(id) => {
              setSelectedId(id);
              setActiveColumn(null);
            }}
          />
        )}

        {/* Detalle abajo del diagrama */}
        {(view === "global" || unitMode === "diagram") && selectedNode && (
          <div className="mt-4">
            {drillFromSchema && (
              <div className="mb-3 flex items-center gap-3">
                <button
                  onClick={() => setGlobalMode("tables")}
                  className="text-xs px-3 py-1.5 rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark transition"
                >
                  Ver tablas de este schema →
                </button>
                <span className="text-xs text-text-muted">o seguí explorando relaciones aqui</span>
              </div>
            )}
            <SelectedPanel
              selectedId={selectedId}
              selectedNode={selectedNode}
              relatedEdges={relatedEdges}
              onJump={(id) => setSelectedId(id)}
              isSchemaLevel={!!drillFromSchema}
            />
          </div>
        )}
      </div>
    </>
  );
}

function SelectedPanel({
  selectedId,
  selectedNode,
  relatedEdges,
  onJump,
  isSchemaLevel,
}: {
  selectedId: string | null;
  selectedNode: (ERNode & { tables?: number; edges_in?: number; edges_out?: number }) | null;
  relatedEdges: { in: EREdge[]; out: EREdge[] };
  onJump: (id: string) => void;
  isSchemaLevel: boolean;
}) {
  const cols = selectedNode?.columns ?? [];

  if (!selectedId || !selectedNode) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-text-muted text-sm">Selecciona un schema o tabla para ver detalle.</div>
      </div>
    );
  }

  if (isSchemaLevel) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="text-[11px] uppercase tracking-wider text-text-muted">{selectedNode.unit}</div>
        <div className="text-base font-bold text-text mb-3">Schema: {selectedNode.label}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Tablas" value={formatNumber(selectedNode.tables ?? 0)} />
          <Stat label="Filas totales" value={formatNumber(selectedNode.rows ?? 0)} />
          <Stat label="FKs entrantes" value={formatNumber(selectedNode.edges_in ?? 0)} />
          <Stat label="FKs salientes" value={formatNumber(selectedNode.edges_out ?? 0)} />
        </div>
        <div className="mt-4 text-xs text-text-muted">
          Click en &quot;Ver tablas de este schema&quot; arriba para entrar al detalle.
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-text-muted">
              {selectedNode.unit ? `${selectedNode.unit} · ${selectedNode.schema}` : selectedNode.schema}
            </div>
            <div className="text-base font-bold text-text">{selectedNode.label}</div>
          </div>
          <div className="text-xs text-text-muted text-right">
            {formatNumber(selectedNode.rows)} filas · {selectedNode.size}<br />
            {cols.length} columnas
          </div>
        </div>
        <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Columna</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Null?</th>
                <th className="text-left px-3 py-2">Marca</th>
              </tr>
            </thead>
            <tbody>
              {cols.map((c) => (
                <tr key={c.name} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-1.5 font-mono font-semibold text-text">{c.name}</td>
                  <td className="px-3 py-1.5 text-text-muted">{c.type}</td>
                  <td className="px-3 py-1.5 text-text-muted">{c.nullable ? "YES" : ""}</td>
                  <td className="px-3 py-1.5">
                    {c.pk && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded mr-1">PK</span>}
                    {c.fk && <span className="text-[10px] font-bold text-primary bg-soft border border-primary/20 px-1.5 py-0.5 rounded">FK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl p-4">
        <div className="text-sm font-bold text-text mb-3 flex items-center gap-2">
          <ArrowLeftRight size={14} className="text-primary" /> Relaciones
        </div>

        <div className="text-[11px] uppercase tracking-wider text-text-muted mt-2 mb-2">Apunta a:</div>
        {relatedEdges.out.length === 0 ? (
          <div className="text-xs text-text-muted">Sin FKs salientes.</div>
        ) : (
          <ul className="space-y-1">
            {relatedEdges.out.map((e) => (
              <li
                key={e.id}
                onClick={() => onJump(e.target)}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-soft px-2 py-1 rounded"
              >
                <span className="font-mono text-primary truncate">{e.from_column}</span>
                <ArrowRight size={11} className="text-text-muted shrink-0" />
                <span className="font-mono text-text truncate">{e.target.split("::").pop()}</span>
                <span className="text-[10px] text-text-muted">.{e.to_column}</span>
                <EdgeBadge type={e.type} />
              </li>
            ))}
          </ul>
        )}

        <div className="text-[11px] uppercase tracking-wider text-text-muted mt-4 mb-2">Apuntada desde:</div>
        {relatedEdges.in.length === 0 ? (
          <div className="text-xs text-text-muted">Ninguna.</div>
        ) : (
          <ul className="space-y-1">
            {relatedEdges.in.map((e) => (
              <li
                key={e.id}
                onClick={() => onJump(e.source)}
                className="flex items-center gap-2 text-xs cursor-pointer hover:bg-soft px-2 py-1 rounded"
              >
                <span className="font-mono text-text truncate">{e.source.split("::").pop()}</span>
                <span className="text-[10px] text-text-muted">.{e.from_column}</span>
                <ArrowRight size={11} className="text-text-muted shrink-0" />
                <span className="font-mono text-primary truncate">{e.to_column}</span>
                <EdgeBadge type={e.type} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-soft rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-base font-bold text-text mt-0.5">{value}</div>
    </div>
  );
}

function ColumnPopover({
  tableId,
  column,
  onClose,
  onJumpToTable,
}: {
  tableId: string;
  column: ERColumn;
  onClose: () => void;
  onJumpToTable: (id: string) => void;
}) {
  const sourceLabel = column.description_source === "postgres_comment" ? "Postgres comment" : column.description_source === "heuristic" ? "Heuristica del catalogo" : null;
  const niceType = column.type
    .replace("character varying", "varchar")
    .replace("timestamp without time zone", "timestamp")
    .replace("double precision", "float");
  return (
    <div className="fixed top-24 right-8 z-50 bg-white border border-primary/30 rounded-xl shadow-2xl shadow-primary/20 w-[360px] animate-in fade-in slide-in-from-right-4">
      <div className="bg-gradient-to-r from-primary to-accent text-white px-4 py-3 rounded-t-xl flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider opacity-80 truncate">
            {tableId.split("::").pop()}
          </div>
          <div className="text-base font-extrabold truncate flex items-center gap-1.5">
            {column.pk && <Key size={14} className="text-amber-300" />}
            {column.fk && !column.pk && <Link2 size={14} className="text-white" />}
            {column.name}
          </div>
        </div>
        <button onClick={onClose} className="text-white/80 hover:text-white shrink-0">
          <X size={16} />
        </button>
      </div>
      <div className="p-4 space-y-3 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono bg-soft text-primary border border-primary/20 px-2 py-0.5 rounded">{niceType}</span>
          {column.pk && <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">PRIMARY KEY</span>}
          {column.fk && <span className="text-[10px] font-bold text-primary bg-soft border border-primary/20 px-2 py-0.5 rounded">FOREIGN KEY</span>}
          {column.nullable ? (
            <span className="text-[10px] text-text-muted bg-bg border border-border px-2 py-0.5 rounded">nullable</span>
          ) : (
            <span className="text-[10px] text-text-muted bg-bg border border-border px-2 py-0.5 rounded">NOT NULL</span>
          )}
        </div>

        {column.description ? (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
              Que representa
              {sourceLabel && <span className="ml-2 text-[9px] italic opacity-70">({sourceLabel})</span>}
            </div>
            <div className="text-text leading-snug">{column.description}</div>
          </div>
        ) : (
          <div className="text-text-muted italic text-xs">Sin descripcion disponible para esta columna.</div>
        )}

        {column.fk_target && (
          <div className="bg-soft border border-primary/20 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Apunta a</div>
            <button
              onClick={() => onJumpToTable(column.fk_target!.to_table)}
              className="text-sm font-mono text-primary hover:underline flex items-center gap-1"
            >
              {column.fk_target.to_table.split("::").pop()}
              <span className="text-text-muted">.{column.fk_target.to_column}</span>
              <ArrowRight size={12} />
            </button>
            <div className="text-[10px] mt-1">
              Tipo: <span className="font-semibold text-text">{column.fk_target.type === "explicit" ? "FK declarada" : column.fk_target.type === "implicit" ? "Inferida por nombre" : "Cross-database"}</span>
            </div>
          </div>
        )}

        {column.default && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Default</div>
            <div className="text-xs font-mono text-text break-all">{column.default}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function EdgeBadge({ type }: { type: EREdge["type"] }) {
  if (type === "implicit") {
    return <span className="text-[9px] uppercase font-bold text-warn bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded ml-auto">implicita</span>;
  }
  if (type === "cross_db") {
    return <span className="text-[9px] uppercase font-bold text-error bg-red-50 border border-red-200 px-1.5 py-0.5 rounded ml-auto">cross-db</span>;
  }
  return null;
}
