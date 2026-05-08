"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { Key, Link as LinkIcon, ChevronDown, ChevronUp, Table2 } from "lucide-react";
import { formatNumber } from "@/lib/utils";

// Color por schema/unit - bg para lane, border para box, text para header
const SCHEMA_COLORS: Record<string, { bg: string; border: string; text: string; lane: string }> = {
  // Unistore
  "unistore::tienda_nube": { bg: "#fef9c3", border: "#facc15", text: "#78350f", lane: "#fef9c3" },
  "unistore::meli":        { bg: "#fee2e2", border: "#fb7185", text: "#7f1d1d", lane: "#fee2e2" },
  "unistore::digip":       { bg: "#dcfce7", border: "#22c55e", text: "#14532d", lane: "#dcfce7" },
  "unistore::contabilium": { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a", lane: "#dbeafe" },
  "unistore::public":      { bg: "#f5f0fb", border: "#a259ff", text: "#21093a", lane: "#f5f0fb" },
  // Unidrop
  "unidrop::public":              { bg: "#ede9fe", border: "#7a3eae", text: "#21093a", lane: "#ede9fe" },
  "unidrop::mercado_libre_dev":   { bg: "#fed7d7", border: "#fb7185", text: "#7f1d1d", lane: "#fed7d7" },
  "unidrop::contabillium_dev":    { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a", lane: "#dbeafe" },
  "unidrop::cresium":             { bg: "#e0e7ff", border: "#6366f1", text: "#312e81", lane: "#e0e7ff" },
  // Unidev
  "unidev::public":        { bg: "#fce7f3", border: "#ec4899", text: "#831843", lane: "#fce7f3" },
};

const DEFAULT_COLORS = { bg: "#f5f0fb", border: "#a259ff", text: "#21093a", lane: "#f5f0fb" };

function colorFor(unit: string | undefined, schema: string) {
  if (unit) {
    const k = `${unit}::${schema}`;
    if (SCHEMA_COLORS[k]) return SCHEMA_COLORS[k];
  }
  return DEFAULT_COLORS;
}

export type ERColumn = {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  nullable: boolean;
  default?: string | null;
  description?: string;
  description_source?: "postgres_comment" | "heuristic";
  fk_target?: { to_table: string; to_column: string; type: "explicit" | "implicit" | "cross_db" };
};

export type ERNode = {
  id: string;
  schema: string;
  label: string;
  rows: number;
  size: string;
  description?: string;
  unit?: string;
  columns?: ERColumn[];
  tables?: number;
  edges_in?: number;
  edges_out?: number;
};

export type EREdge = {
  id: string;
  source: string;
  target: string;
  from_column: string;
  to_column: string;
  type: "explicit" | "implicit" | "cross_db";
  from_unit?: string;
  to_unit?: string;
  weight?: number;
};

function fmtCompact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

const COLLAPSED_HEIGHT = 42;
const EXPANDED_BASE_HEIGHT = 60;
const COL_HEIGHT = 18;
const NODE_WIDTH = 230;

// Schema lane (parent group) - rectangulo de fondo coloreado con label
function SchemaLane({ data }: NodeProps) {
  const d = data as { node: { id: string; unit: string; schema: string; tables: number; rows: number } };
  const n = d.node;
  const colors = colorFor(n.unit, n.schema);
  return (
    <div
      className="rounded-xl"
      style={{
        background: colors.lane,
        border: `2px dashed ${colors.border}`,
        width: "100%",
        height: "100%",
      }}
    >
      <div
        className="px-3 py-1.5 rounded-t-xl flex items-center justify-between gap-2"
        style={{ background: colors.bg, color: colors.text, borderBottom: `1px solid ${colors.border}40` }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-wider opacity-70 truncate">
            {n.unit}
          </div>
          <div className="text-xs font-extrabold truncate" title={n.schema}>{n.schema}</div>
        </div>
        <div className="text-[9px] font-bold opacity-70 whitespace-nowrap">
          {n.tables} tablas · {fmtCompact(n.rows)}
        </div>
      </div>
    </div>
  );
}

// Schema-level node (vista resumen): caja por schema con stats
function SchemaNode({ data }: NodeProps) {
  const d = data as { node: ERNode; onSelect?: (id: string) => void };
  const n = d.node;
  const colors = colorFor(n.unit, n.schema);
  return (
    <div
      className="border-2 rounded-xl shadow-md hover:shadow-xl transition cursor-pointer min-w-[230px] bg-white"
      style={{ borderColor: colors.border }}
      onClick={() => d.onSelect?.(n.id)}
    >
      <Handle type="target" position={Position.Left} style={{ background: colors.border }} />
      <Handle type="source" position={Position.Right} style={{ background: colors.border }} />
      <div
        className="px-4 py-2 rounded-t-lg"
        style={{ background: colors.bg, color: colors.text, borderBottom: `2px solid ${colors.border}` }}
      >
        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{n.unit}</div>
        <div className="text-base font-extrabold tracking-tight">{n.label}</div>
      </div>
      <div className="px-4 py-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[9px] uppercase text-gray-500">Tablas</div>
          <div className="text-lg font-bold text-gray-900">{formatNumber(n.tables ?? 0)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-gray-500">Filas</div>
          <div className="text-lg font-bold text-gray-900">{fmtCompact(n.rows)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-gray-500">In</div>
          <div className="text-sm font-semibold" style={{ color: colors.border }}>{n.edges_in ?? 0}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase text-gray-500">Out</div>
          <div className="text-sm font-semibold" style={{ color: colors.border }}>{n.edges_out ?? 0}</div>
        </div>
      </div>
    </div>
  );
}

// Table node con expand/collapse interno (default collapsed)
function TableNode({ data, id }: NodeProps) {
  const d = data as {
    node: ERNode;
    onSelect?: (id: string) => void;
    expanded?: boolean;
    onToggle?: (id: string, next: boolean) => void;
    onColumnClick?: (tableId: string, column: ERColumn) => void;
    activeColumn?: string | null;
  };
  const n = d.node;
  const colors = colorFor(n.unit, n.schema);
  const expanded = !!d.expanded;
  const cols = n.columns ?? [];
  const visible = expanded ? cols.slice(0, 25) : [];
  const hidden = expanded ? Math.max(0, cols.length - 25) : 0;

  return (
    <div
      className="border-2 rounded-md shadow-sm hover:shadow-md transition bg-white"
      style={{ borderColor: colors.border, minWidth: NODE_WIDTH, maxWidth: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} style={{ background: colors.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: colors.border, width: 8, height: 8 }} />

      {/* Header - clickable para expand/collapse */}
      <div
        className="px-2 py-1.5 rounded-t-md cursor-pointer flex items-center gap-1.5 select-none"
        style={{ background: colors.bg, color: colors.text, borderBottom: expanded ? `1px solid ${colors.border}40` : "none" }}
        onClick={(e) => {
          e.stopPropagation();
          d.onToggle?.(id, !expanded);
          d.onSelect?.(n.id);
        }}
        title="Click para expandir/colapsar"
      >
        <Table2 size={10} className="opacity-60 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold truncate leading-tight" title={n.label}>{n.label}</div>
          <div className="text-[8px] opacity-60 leading-tight">
            {fmtCompact(n.rows)} filas · {cols.length} cols
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={11} className="opacity-60 shrink-0" />
        ) : (
          <ChevronDown size={11} className="opacity-60 shrink-0" />
        )}
      </div>

      {/* Columnas (solo si expanded) */}
      {expanded && (
        <div className="text-[10px]">
          {visible.length === 0 && (
            <div className="px-2 py-1 text-gray-500 italic">Sin info de columnas</div>
          )}
          {visible.map((c) => {
            const isActive = d.activeColumn === c.name;
            return (
              <div
                key={c.name}
                onClick={(e) => {
                  e.stopPropagation();
                  d.onColumnClick?.(id, c);
                }}
                className={
                  "flex items-center gap-1 px-2 py-0.5 border-b border-gray-100 last:border-0 cursor-pointer transition " +
                  (isActive ? "bg-primary/15" : "hover:bg-soft")
                }
                title={c.description || c.name}
              >
                <div className="w-3 flex justify-center shrink-0">
                  {c.pk ? (
                    <Key size={9} className="text-amber-600" />
                  ) : c.fk ? (
                    <LinkIcon size={9} className="text-primary" />
                  ) : (
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                  )}
                </div>
                <span
                  className={
                    "font-mono truncate flex-1 " +
                    (c.pk ? "font-bold text-amber-700" : c.fk ? "font-semibold text-primary" : "text-gray-700")
                  }
                >
                  {c.name}
                </span>
                <span className="text-[8px] text-gray-400 truncate max-w-[70px]" title={c.type}>
                  {c.type.replace("character varying", "varchar").replace("timestamp without time zone", "timestamp").replace("double precision", "float")}
                </span>
              </div>
            );
          })}
          {hidden > 0 && (
            <div className="px-2 py-0.5 text-[9px] text-gray-500 italic text-center bg-gray-50">
              +{hidden} columnas mas
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES = { table: TableNode, schema: SchemaNode, schemaLane: SchemaLane };

// Layout: para cada schema, dagre interno; despues posiciona schemas en gran columna por unit
function applyDagreLayoutWithLanes(
  rawNodes: ERNode[],
  rawEdges: EREdge[],
  expandedSet: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  // Agrupar tablas por (unit, schema)
  const groups: Record<string, ERNode[]> = {};
  rawNodes.forEach((n) => {
    const key = `${n.unit ?? "?"}::${n.schema}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  });

  const PAD_TOP = 36; // espacio para el header del lane
  const PAD = 18;
  const NODE_SEP = 18;
  const RANK_SEP = 60;

  // Layout interno por grupo
  const groupLayouts: Record<string, {
    width: number;
    height: number;
    positions: Record<string, { x: number; y: number; h: number }>;
  }> = {};

  Object.entries(groups).forEach(([key, tables]) => {
    const innerG = new dagre.graphlib.Graph();
    innerG.setDefaultEdgeLabel(() => ({}));
    innerG.setGraph({ rankdir: "TB", nodesep: NODE_SEP, ranksep: 28, marginx: 0, marginy: 0 });
    tables.forEach((t) => {
      const exp = expandedSet.has(t.id);
      const colsCount = t.columns?.length ?? 0;
      const visible = Math.min(colsCount, 25);
      const extra = colsCount > 25 ? 1 : 0;
      const h = exp ? EXPANDED_BASE_HEIGHT + visible * COL_HEIGHT + extra * 14 : COLLAPSED_HEIGHT;
      innerG.setNode(t.id, { width: NODE_WIDTH, height: h });
    });
    // Edges intra-group para el layout
    const ids = new Set(tables.map((t) => t.id));
    rawEdges.forEach((e) => {
      if (ids.has(e.source) && ids.has(e.target)) {
        innerG.setEdge(e.source, e.target);
      }
    });
    dagre.layout(innerG);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const positions: Record<string, { x: number; y: number; h: number }> = {};
    tables.forEach((t) => {
      const p = innerG.node(t.id);
      const x = p.x - NODE_WIDTH / 2;
      const y = p.y - p.height / 2;
      positions[t.id] = { x, y, h: p.height };
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + p.height);
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = NODE_WIDTH; maxY = COLLAPSED_HEIGHT; }
    // Normalizar a (PAD, PAD_TOP)
    const offsetX = PAD - minX;
    const offsetY = PAD_TOP - minY;
    Object.values(positions).forEach((p) => { p.x += offsetX; p.y += offsetY; });
    groupLayouts[key] = {
      width: maxX - minX + PAD * 2,
      height: maxY - minY + PAD_TOP + PAD,
      positions,
    };
  });

  // Layout entre grupos: dagre con cada group como un nodo
  const meta = new dagre.graphlib.Graph();
  meta.setDefaultEdgeLabel(() => ({}));
  meta.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100, marginx: 30, marginy: 30 });
  Object.entries(groupLayouts).forEach(([key, lay]) => {
    meta.setNode(key, { width: lay.width, height: lay.height });
  });
  // Edges entre grupos = group key del source y target
  const interGroup = new Set<string>();
  rawEdges.forEach((e) => {
    const findGroup = (nid: string) => {
      for (const [k, ts] of Object.entries(groups)) {
        if (ts.some((t) => t.id === nid)) return k;
      }
      return null;
    };
    const fg = findGroup(e.source);
    const tg = findGroup(e.target);
    if (fg && tg && fg !== tg) {
      const k = `${fg}->${tg}`;
      if (!interGroup.has(k)) {
        interGroup.add(k);
        meta.setEdge(fg, tg);
      }
    }
  });
  dagre.layout(meta);

  const groupPositions: Record<string, { x: number; y: number }> = {};
  Object.keys(groupLayouts).forEach((key) => {
    const p = meta.node(key);
    groupPositions[key] = { x: p.x - groupLayouts[key].width / 2, y: p.y - groupLayouts[key].height / 2 };
  });

  // Construir nodos finales
  const finalNodes: Node[] = [];

  // Lane nodes (grupos)
  Object.entries(groups).forEach(([key, tables]) => {
    const [unit, schema] = key.split("::");
    const lay = groupLayouts[key];
    const pos = groupPositions[key];
    const totalRows = tables.reduce((s, t) => s + Math.max(0, t.rows ?? 0), 0);
    finalNodes.push({
      id: `lane::${key}`,
      type: "schemaLane",
      position: pos,
      data: {
        node: {
          id: `lane::${key}`,
          unit, schema,
          tables: tables.length,
          rows: totalRows,
        },
      },
      style: { width: lay.width, height: lay.height, zIndex: -1 },
      selectable: false,
      draggable: true,
    });
  });

  // Table nodes (children) con parentNode + posicion relativa
  Object.entries(groups).forEach(([key, tables]) => {
    const lay = groupLayouts[key];
    tables.forEach((t) => {
      const p = lay.positions[t.id];
      finalNodes.push({
        id: t.id,
        type: "table",
        position: { x: p.x, y: p.y },
        parentId: `lane::${key}`,
        extent: "parent",
        data: { node: t, expanded: expandedSet.has(t.id) },
        draggable: true,
      });
    });
  });

  // Edges
  const edges: Edge[] = rawEdges.map((e) => {
    let stroke = "#a259ff";
    let dasharray: string | undefined;
    let label: string | undefined;
    const w = e.weight ?? 1;
    if (e.type === "implicit") {
      stroke = "#f59e0b";
      dasharray = "4 3";
    } else if (e.type === "cross_db") {
      stroke = "#fb2c36";
      dasharray = "6 4";
      label = "cross-db";
    }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      animated: e.type === "cross_db",
      label,
      labelStyle: { fontSize: 9, fill: stroke, fontWeight: 700 },
      labelBgStyle: { fill: "white", fillOpacity: 0.9 },
      labelBgPadding: [3, 2] as [number, number],
      style: { stroke, strokeWidth: 1.4 + Math.min(w * 0.2, 1), strokeDasharray: dasharray },
      type: "smoothstep",
    };
  });

  return { nodes: finalNodes, edges };
}

// Layout simple para "schema-level view" (sin lanes)
function applyDagreLayoutSchemaLevel(
  rawNodes: ERNode[],
  rawEdges: EREdge[],
  onSelect?: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 110, ranksep: 220, marginx: 30, marginy: 30 });
  const W = 240, H = 130;
  rawNodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
  rawEdges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  const nodes: Node[] = rawNodes.map((n) => {
    const p = g.node(n.id);
    return {
      id: n.id,
      type: "schema",
      position: { x: p.x - W / 2, y: p.y - H / 2 },
      data: { node: n, onSelect },
      draggable: true,
    };
  });
  const edges: Edge[] = rawEdges.map((e) => {
    let stroke = "#a259ff";
    let dasharray: string | undefined;
    let label: string | undefined;
    const w = e.weight ?? 1;
    const sw = Math.min(1 + w * 0.4, 6);
    if (e.type === "implicit") {
      stroke = "#f59e0b";
      dasharray = "4 3";
    } else if (e.type === "cross_db") {
      stroke = "#fb2c36";
      dasharray = "6 4";
      label = `${w} cross-db`;
    } else if (w > 1) {
      label = `${w}`;
    }
    return {
      id: e.id, source: e.source, target: e.target,
      animated: e.type === "cross_db",
      label,
      labelStyle: { fontSize: 10, fill: stroke, fontWeight: 700 },
      labelBgStyle: { fill: "white", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      style: { stroke, strokeWidth: sw, strokeDasharray: dasharray },
      type: "smoothstep",
    };
  });
  return { nodes, edges };
}

function ERFlow({
  rawNodes,
  rawEdges,
  onSelectTable,
  onColumnClick,
  activeColumn,
  highlight,
  nodeKind,
}: {
  rawNodes: ERNode[];
  rawEdges: EREdge[];
  onSelectTable?: (id: string) => void;
  onColumnClick?: (tableId: string, column: ERColumn) => void;
  activeColumn?: { tableId: string; name: string } | null;
  highlight?: string | null;
  nodeKind: "table" | "schema";
}) {
  const { fitView } = useReactFlow();
  const [expandedSet, setExpandedSet] = useState<Set<string>>(new Set());

  const onToggle = useCallback((id: string, next: boolean) => {
    setExpandedSet((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedSet(new Set(rawNodes.map((n) => n.id)));
  }, [rawNodes]);
  const collapseAll = useCallback(() => setExpandedSet(new Set()), []);

  const { nodes, edges } = useMemo(() => {
    if (nodeKind === "schema") {
      return applyDagreLayoutSchemaLevel(rawNodes, rawEdges, onSelectTable);
    }
    return applyDagreLayoutWithLanes(rawNodes, rawEdges, expandedSet);
  }, [rawNodes, rawEdges, expandedSet, nodeKind, onSelectTable]);

  // Inyectar handlers a nodos table
  const wiredNodes = useMemo(() => {
    if (nodeKind === "schema") return nodes;
    return nodes.map((n) =>
      n.type === "table"
        ? {
            ...n,
            data: {
              ...n.data,
              expanded: expandedSet.has(n.id),
              onToggle,
              onSelect: onSelectTable,
              onColumnClick,
              activeColumn: activeColumn?.tableId === n.id ? activeColumn.name : null,
            },
          }
        : n,
    );
  }, [nodes, expandedSet, onToggle, onSelectTable, onColumnClick, activeColumn, nodeKind]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.12, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [nodes, fitView]);

  // Highlight: atenuar el resto cuando hay seleccion
  const styledNodes = useMemo(() => {
    if (!highlight) return wiredNodes;
    const related = new Set<string>([highlight]);
    edges.forEach((e) => {
      if (e.source === highlight) related.add(e.target);
      if (e.target === highlight) related.add(e.source);
    });
    return wiredNodes.map((n) => {
      if (n.type === "schemaLane") return n;
      return { ...n, style: related.has(n.id) ? n.style : { ...(n.style || {}), opacity: 0.25 } };
    });
  }, [wiredNodes, edges, highlight]);

  const styledEdges = useMemo(() => {
    if (!highlight) return edges;
    return edges.map((e) =>
      e.source === highlight || e.target === highlight
        ? { ...e, style: { ...e.style, strokeWidth: 2.5 } }
        : { ...e, style: { ...e.style, opacity: 0.15 } },
    );
  }, [edges, highlight]);

  return (
    <>
      {nodeKind === "table" && (
        <div className="absolute top-2 right-2 z-10 flex gap-1 bg-white/90 backdrop-blur border border-border rounded-md shadow-sm p-1">
          <button
            onClick={expandAll}
            className="text-[11px] px-2 py-1 rounded hover:bg-soft text-text-muted hover:text-primary transition"
          >
            Expandir todas
          </button>
          <button
            onClick={collapseAll}
            className="text-[11px] px-2 py-1 rounded hover:bg-soft text-text-muted hover:text-primary transition"
          >
            Colapsar todas
          </button>
        </div>
      )}
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        nodeTypes={NODE_TYPES}
        proOptions={{ hideAttribution: true }}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e0cff3" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable zoomable
          nodeStrokeColor={(n) => {
            const node = (n.data as { node: ERNode }).node;
            return colorFor(node.unit, node.schema).border;
          }}
          nodeColor={(n) => {
            const node = (n.data as { node: ERNode }).node;
            return colorFor(node.unit, node.schema).bg;
          }}
          style={{ backgroundColor: "#fff", border: "1px solid #e0cff3" }}
        />
      </ReactFlow>
    </>
  );
}

export function ERDiagram({
  nodes,
  edges,
  onSelectTable,
  onColumnClick,
  activeColumn,
  highlight,
  height = 700,
  nodeKind = "table",
}: {
  nodes: ERNode[];
  edges: EREdge[];
  onSelectTable?: (id: string) => void;
  onColumnClick?: (tableId: string, column: ERColumn) => void;
  activeColumn?: { tableId: string; name: string } | null;
  highlight?: string | null;
  height?: number;
  nodeKind?: "table" | "schema";
}) {
  return (
    <div
      className="bg-surface border border-border rounded-xl overflow-hidden relative"
      style={{ height }}
    >
      <ReactFlowProvider>
        <ERFlow
          rawNodes={nodes} rawEdges={edges}
          onSelectTable={onSelectTable}
          onColumnClick={onColumnClick}
          activeColumn={activeColumn}
          highlight={highlight}
          nodeKind={nodeKind}
        />
      </ReactFlowProvider>
    </div>
  );
}
