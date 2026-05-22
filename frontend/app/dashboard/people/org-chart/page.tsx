"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Users as UsersIcon, Network } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
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
  // Sort each level by name
  function sortRec(arr: Node[]) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
    arr.forEach((n) => sortRec(n.children));
  }
  sortRec(roots);
  return roots;
}

function countDescendants(node: Node): number {
  let count = node.children.length;
  for (const c of node.children) count += countDescendants(c);
  return count;
}

export default function OrgChartPage() {
  const { data, isLoading } = useQuery<{ items: OrgChartItem[] }>({
    queryKey: ["people-org-chart"],
    queryFn: () => api("/api/people/org-chart"),
    staleTime: 5 * 60_000,
  });

  const tree = useMemo(() => (data ? buildTree(data.items) : []), [data]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Auto-expand all top-level managers on first render
  useMemo(() => {
    if (tree.length > 0 && expanded.size === 0) {
      const init = new Set<number>();
      for (const r of tree) init.add(r.id);
      setExpanded(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.length]);

  return (
    <>
      <Topbar title="Org Chart" subtitle="Estructura jerarquica · reportes directos" />
      <div className="flex-1 px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {isLoading && <div className="text-center py-16 text-text-muted text-sm">Cargando...</div>}

          {!isLoading && tree.length === 0 && (
            <div className="bg-surface border border-border rounded-xl p-12 text-center">
              <Network size={48} className="mx-auto text-text-muted mb-3" />
              <div className="text-sm font-semibold mb-1">Org chart vacio</div>
              <div className="text-xs text-text-muted max-w-md mx-auto">
                Para construir el organigrama, asigna un{" "}
                <span className="font-semibold">manager</span> a cada colaborador en
                Admin / Usuarios. La jerarquia se calcula automaticamente.
              </div>
            </div>
          )}

          {!isLoading && tree.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-6 space-y-2">
              {tree.map((n) => (
                <TreeNode
                  key={n.id}
                  node={n}
                  level={0}
                  expanded={expanded}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TreeNode({
  node,
  level,
  expanded,
  onToggle,
}: {
  node: Node;
  level: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const totalUnder = useMemo(() => countDescendants(node), [node]);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-bg-muted transition"
        style={{ paddingLeft: `${level * 28 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.id)}
            className="text-text-muted hover:text-text p-0.5"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5" />
        )}

        <Link href={`/dashboard/people/${node.id}`} className="flex items-center gap-2 flex-1 min-w-0">
          <Avatar
            name={node.name}
            url={node.avatar_url}
            size="sm"
            ringColor={node.area_color ?? undefined}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text truncate hover:text-primary">
              {node.name}
            </div>
            <div className="text-[11px] text-text-muted truncate">
              {node.job_title ?? ""}
              {node.job_title && node.area_name && " · "}
              {node.area_name ?? ""}
            </div>
          </div>
        </Link>

        {hasChildren && (
          <span className="text-[10px] font-semibold text-text-muted bg-bg-muted px-2 py-0.5 rounded-full inline-flex items-center gap-1">
            <UsersIcon size={10} />
            {totalUnder}
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
