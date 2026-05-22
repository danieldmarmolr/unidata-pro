"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, ZoomIn, ZoomOut, Maximize2, Users as UsersIcon,
  ExternalLink, GitBranch,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";
import type { OrgChartItem } from "@/components/people/types";

type Node = OrgChartItem & { children: Node[] };

function buildTree(items: OrgChartItem[]): Node[] {
  const map = new Map<number, Node>();
  for (const it of items) map.set(it.id, { ...it, children: [] });
  const roots: Node[] = [];
  for (const it of items) {
    const node = map.get(it.id)!;
    if (it.manager_user_id && map.has(it.manager_user_id)) {
      map.get(it.manager_user_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  function sortRec(arr: Node[]) {
    arr.sort((a, b) => b.children.length - a.children.length || a.name.localeCompare(b.name));
    arr.forEach((n) => sortRec(n.children));
  }
  sortRec(roots);
  return roots;
}

function countDescendants(node: Node): number {
  let n = node.children.length;
  for (const c of node.children) n += countDescendants(c);
  return n;
}

function tenureShort(joinedAt: string | null): string | null {
  if (!joinedAt) return null;
  const d = new Date(joinedAt);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return "<1 mes";
  if (months < 12) return `${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "ano" : "anos"}`;
}

export default function OrgChartPage() {
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);

  const { data, isLoading } = useQuery<{ items: OrgChartItem[] }>({
    queryKey: ["people-org-chart"],
    queryFn: () => api("/api/people/org-chart"),
    staleTime: 5 * 60_000,
  });

  const tree = useMemo(() => (data ? buildTree(data.items) : []), [data]);

  const highlightSet = useMemo(() => {
    if (!search.trim() || !data) return null;
    const s = search.toLowerCase();
    return new Set(
      data.items
        .filter(
          (u) =>
            u.name.toLowerCase().includes(s) ||
            (u.job_title ?? "").toLowerCase().includes(s) ||
            (u.area_name ?? "").toLowerCase().includes(s) ||
            (u.email ?? "").toLowerCase().includes(s),
        )
        .map((u) => u.id),
    );
  }, [search, data]);

  // Cantidad total para mostrar en topbar
  const totalUsers = data?.items?.length ?? 0;
  const rootCount = tree.length;

  return (
    <>
      <Topbar
        title="Organigrama"
        subtitle={
          totalUsers > 0
            ? `${totalUsers} colaboradores · ${rootCount} top-level`
            : "Estructura jerarquica"
        }
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-6 py-2.5 border-b border-border bg-surface flex items-center gap-3 flex-wrap">
          <div className="relative w-full sm:w-72">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Resaltar por nombre, area, rol..."
              className="w-full bg-bg-muted border border-border rounded-lg pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:border-primary"
            />
          </div>

          {highlightSet && (
            <div className="text-[11px] text-text-muted">
              {highlightSet.size}{" "}
              {highlightSet.size === 1 ? "coincidencia" : "coincidencias"}
            </div>
          )}

          <div className="flex items-center gap-1 ml-auto text-xs text-text-muted">
            <span className="hidden sm:inline">Zoom</span>
            <button
              onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
              className="p-1 hover:bg-bg-muted rounded transition"
              title="Reducir"
            >
              <ZoomOut size={14} />
            </button>
            <span className="font-semibold tabular-nums w-10 text-center text-[11px]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))}
              className="p-1 hover:bg-bg-muted rounded transition"
              title="Aumentar"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => setZoom(1)}
              className="p-1 hover:bg-bg-muted rounded transition ml-1"
              title="Ajustar 100%"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-gradient-to-br from-bg-muted/40 via-bg-muted/20 to-bg-muted/40">
          <div className="min-w-fit min-h-full p-8 sm:p-12 flex justify-center items-start">
            {isLoading ? (
              <div className="text-center py-24 text-text-muted text-sm">Cargando organigrama...</div>
            ) : tree.length === 0 ? (
              <div className="text-center py-24 max-w-md">
                <GitBranch size={48} className="mx-auto text-text-muted mb-3" />
                <div className="text-sm font-semibold mb-1">Organigrama vacio</div>
                <div className="text-xs text-text-muted">
                  Asigna un <span className="font-semibold">manager</span> a cada
                  colaborador en{" "}
                  <Link href="/dashboard/admin/users" className="text-primary underline">
                    Admin / Usuarios
                  </Link>{" "}
                  para construir la jerarquia.
                </div>
              </div>
            ) : (
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top center",
                  transition: "transform 0.12s ease-out",
                }}
              >
                <div className="org-roots">
                  {tree.map((root) => (
                    <OrgNode key={root.id} node={root} highlight={highlightSet} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .org-roots {
          display: flex;
          gap: 48px;
          justify-content: center;
          align-items: flex-start;
        }
        .org-node {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .org-children {
          position: relative;
          display: flex;
          justify-content: center;
          gap: 16px;
          padding-top: 28px;
        }
        /* Drop-line from parent down into children area */
        .org-children::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          width: 2px;
          height: 14px;
          background: #cbd5e1;
          transform: translateX(-1px);
        }
        /* Multi-children: longer drop + horizontal connector */
        .org-children.is-multi {
          padding-top: 44px;
        }
        .org-children.is-multi::before {
          height: 22px;
        }
        .org-children.is-multi > .org-child::before {
          content: '';
          position: absolute;
          top: -22px;
          left: 50%;
          width: 2px;
          height: 22px;
          background: #cbd5e1;
          transform: translateX(-1px);
        }
        .org-children.is-multi > .org-child::after {
          content: '';
          position: absolute;
          top: -22px;
          height: 2px;
          background: #cbd5e1;
          left: 0;
          right: 0;
        }
        .org-children.is-multi > .org-child:first-child::after {
          left: 50%;
        }
        .org-children.is-multi > .org-child:last-child::after {
          right: 50%;
        }
        .org-child {
          position: relative;
        }
      `}</style>
    </>
  );
}

function OrgNode({
  node,
  highlight,
}: {
  node: Node;
  highlight: Set<number> | null;
}) {
  const totalUnder = useMemo(() => countDescendants(node), [node]);
  const reports = node.children.length;
  const isMulti = node.children.length > 1;

  return (
    <div className="org-node">
      <OrgCard
        node={node}
        reports={reports}
        totalUnder={totalUnder}
        highlight={highlight}
      />
      {node.children.length > 0 && (
        <div className={cn("org-children", isMulti && "is-multi")}>
          {node.children.map((c) => (
            <div key={c.id} className="org-child">
              <OrgNode node={c} highlight={highlight} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrgCard({
  node,
  reports,
  totalUnder,
  highlight,
}: {
  node: Node;
  reports: number;
  totalUnder: number;
  highlight: Set<number> | null;
}) {
  const isMatch = highlight ? highlight.has(node.id) : false;
  const dimmed = !!highlight && !isMatch;
  const accent = node.area_color ?? "#7a3eae";
  const tenure = tenureShort(node.joined_at);

  return (
    <Link
      href={`/dashboard/people/${node.id}`}
      className={cn(
        "group relative block bg-white border rounded-xl shadow-sm w-[210px] transition-all duration-150",
        "hover:shadow-lg hover:-translate-y-0.5",
        dimmed && "opacity-30 grayscale",
        isMatch && "ring-4 ring-primary/40 border-primary",
        !isMatch && "border-border",
      )}
      style={{
        borderTopColor: accent,
        borderTopWidth: "3px",
      }}
    >
      {/* Header: area + external icon */}
      <div className="flex items-start justify-between px-3 pt-2.5 pb-1 gap-2">
        <span
          className="text-[9px] font-bold uppercase tracking-wider leading-tight truncate"
          style={{ color: accent }}
          title={node.area_name ?? "Sin area"}
        >
          {node.area_name ?? "—"}
        </span>
        <ExternalLink
          size={11}
          className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
        />
      </div>

      {/* Avatar centered floating */}
      <div className="flex justify-center -mb-2 mt-1">
        <Avatar
          name={node.name}
          url={node.avatar_url}
          size="md"
          ringColor={accent}
        />
      </div>

      {/* Body: name + job */}
      <div className="px-3 pt-3 pb-2 text-center">
        <div className="text-sm font-bold text-text leading-tight truncate" title={node.name}>
          {node.name}
        </div>
        {node.job_title && (
          <div
            className="text-[11px] text-text-muted mt-0.5 leading-tight line-clamp-2"
            title={node.job_title}
          >
            {node.job_title}
          </div>
        )}
        {node.is_admin && (
          <span className="inline-block mt-1 text-[8px] font-bold uppercase tracking-wider text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full">
            Admin
          </span>
        )}
      </div>

      {/* Footer: reports + tenure */}
      <div className="border-t border-border px-3 py-1.5 flex items-center justify-between text-[10px]">
        {reports > 0 ? (
          <span
            className="inline-flex items-center gap-1 font-semibold text-text-muted"
            title={
              totalUnder > reports
                ? `${reports} directos · ${totalUnder} total`
                : `${reports} directos`
            }
          >
            <UsersIcon size={10} />
            <span className="tabular-nums">{reports}</span>
            {totalUnder > reports && (
              <span className="text-text-muted/60 tabular-nums">({totalUnder})</span>
            )}
          </span>
        ) : (
          <span className="text-text-muted/40">·</span>
        )}
        {tenure ? (
          <span className="bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded-md text-[9px]">
            {tenure}
          </span>
        ) : (
          <span />
        )}
      </div>
    </Link>
  );
}
