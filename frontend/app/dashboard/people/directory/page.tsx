"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, MapPin, Cake, Briefcase, Mail, Eye, EyeOff } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import type { DirectoryItem } from "@/components/people/types";

export default function PeopleDirectoryPage() {
  const me = getUser();
  const canManage =
    !!me?.is_admin ||
    me?.role === "admin" ||
    me?.role === "gerencia" ||
    me?.area_slug === "people";

  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ items: DirectoryItem[] }>({
    queryKey: ["people-directory"],
    queryFn: () => api("/api/people/directory"),
    staleTime: 5 * 60_000,
  });

  const toggleVisibility = useMutation({
    mutationFn: ({ id, hidden }: { id: number; hidden: boolean }) =>
      api(`/api/people/directory/${id}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ hidden }),
      }),
    onMutate: async ({ id, hidden }) => {
      await queryClient.cancelQueries({ queryKey: ["people-directory"] });
      const prev = queryClient.getQueryData<{ items: DirectoryItem[] }>(["people-directory"]);
      if (prev) {
        queryClient.setQueryData<{ items: DirectoryItem[] }>(["people-directory"], {
          ...prev,
          items: prev.items.map((u) =>
            u.id === id ? { ...u, hidden_from_directory: hidden } : u,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["people-directory"], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["people-directory"] });
    },
  });

  const visibleItems = useMemo(() => {
    if (!data?.items) return [];
    if (canManage && showHidden) return data.items;
    return data.items.filter((u) => !u.hidden_from_directory);
  }, [data, canManage, showHidden]);

  const hiddenCount = useMemo(
    () => (data?.items ?? []).filter((u) => u.hidden_from_directory).length,
    [data],
  );

  const areas = useMemo(() => {
    const seen = new Map<string, { slug: string; name: string; color: string; count: number }>();
    for (const u of visibleItems) {
      if (!u.area_slug) continue;
      const cur = seen.get(u.area_slug);
      if (cur) cur.count++;
      else seen.set(u.area_slug, {
        slug: u.area_slug,
        name: u.area_name ?? u.area_slug,
        color: u.area_color ?? "#7a3eae",
        count: 1,
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleItems]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return visibleItems.filter((u) => {
      if (areaFilter && u.area_slug !== areaFilter) return false;
      if (!s) return true;
      return (
        u.name.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.job_title ?? "").toLowerCase().includes(s) ||
        (u.area_name ?? "").toLowerCase().includes(s) ||
        (u.location_city ?? "").toLowerCase().includes(s) ||
        (u.interests ?? "").toLowerCase().includes(s)
      );
    });
  }, [visibleItems, search, areaFilter]);

  return (
    <>
      <Topbar
        title="Directorio"
        subtitle={
          canManage && hiddenCount > 0
            ? `${visibleItems.length} colaboradores activos · ${hiddenCount} oculto${hiddenCount === 1 ? "" : "s"}`
            : `${visibleItems.length} colaboradores activos`
        }
      />
      <div className="flex-1 px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {/* Filtros */}
          <div className="bg-surface border border-border rounded-xl p-4 mb-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, area, rol, ciudad, intereses..."
                  className="w-full bg-bg-muted border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setAreaFilter(null)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border ${
                    !areaFilter ? "bg-primary text-white border-primary" : "border-border hover:bg-bg-muted"
                  }`}
                >
                  Todas ({visibleItems.length})
                </button>
                {areas.map((a) => (
                  <button
                    key={a.slug}
                    onClick={() => setAreaFilter(a.slug)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 ${
                      areaFilter === a.slug ? "text-white border-transparent" : "border-border hover:bg-bg-muted"
                    }`}
                    style={areaFilter === a.slug ? { background: a.color } : undefined}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                    {a.name} ({a.count})
                  </button>
                ))}
                {canManage && hiddenCount > 0 && (
                  <button
                    onClick={() => setShowHidden((v) => !v)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 ${
                      showHidden
                        ? "bg-amber-500 text-white border-amber-500"
                        : "border-border hover:bg-bg-muted"
                    }`}
                    title={showHidden ? "Estas viendo los ocultos" : "Mostrar perfiles ocultos"}
                  >
                    {showHidden ? <Eye size={11} /> : <EyeOff size={11} />}
                    Ocultos ({hiddenCount})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Grid */}
          {isLoading && (
            <div className="text-center py-16 text-text-muted text-sm">Cargando...</div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-16 text-text-muted text-sm">
              No hay colaboradores que coincidan con esa busqueda.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((u) => (
              <div
                key={u.id}
                className={`relative bg-surface border border-border rounded-xl p-4 transition group ${
                  u.hidden_from_directory ? "opacity-60" : "hover:shadow-lg hover:border-primary/30"
                }`}
              >
                {canManage && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleVisibility.mutate({ id: u.id, hidden: !u.hidden_from_directory });
                    }}
                    disabled={toggleVisibility.isPending}
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-text-muted hover:bg-bg-muted hover:text-text transition"
                    title={
                      u.hidden_from_directory
                        ? "Mostrar este perfil en el directorio"
                        : "Ocultar este perfil del directorio"
                    }
                  >
                    {u.hidden_from_directory ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
                <Link
                  href={`/dashboard/people/${u.id}`}
                  className="block"
                >
                <div className="flex items-start gap-3">
                  <Avatar
                    name={u.name}
                    url={u.avatar_url}
                    size="lg"
                    ringColor={u.area_color ?? undefined}
                  />
                  <div className="flex-1 min-w-0 pr-7">
                    <div className="font-bold text-text truncate group-hover:text-primary transition">
                      {u.name}
                    </div>
                    {u.job_title && (
                      <div className="text-xs text-text-muted truncate inline-flex items-center gap-1">
                        <Briefcase size={10} /> {u.job_title}
                      </div>
                    )}
                    {u.hidden_from_directory && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                        <EyeOff size={9} /> Oculto
                      </div>
                    )}
                  </div>
                </div>

                {u.area_name && (
                  <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{
                      background: `${u.area_color}15`,
                      color: u.area_color ?? "#666",
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: u.area_color ?? "#666" }} />
                    {u.area_name}
                  </div>
                )}

                <div className="mt-3 space-y-1 text-[11px] text-text-muted">
                  {u.manager_name && (
                    <div className="inline-flex items-center gap-1 truncate w-full">
                      <span className="font-semibold">↳ Reporta a</span>{" "}
                      <span className="truncate">{u.manager_name}</span>
                    </div>
                  )}
                  {u.location_city && (
                    <div className="inline-flex items-center gap-1 truncate w-full">
                      <MapPin size={10} />
                      <span className="truncate">{u.location_city}</span>
                    </div>
                  )}
                  {u.birthday_month && u.birthday_day && (
                    <div className="inline-flex items-center gap-1">
                      <Cake size={10} />
                      <span>
                        {String(u.birthday_day).padStart(2, "0")}/
                        {String(u.birthday_month).padStart(2, "0")}
                      </span>
                    </div>
                  )}
                  <div className="inline-flex items-center gap-1 truncate w-full">
                    <Mail size={10} />
                    <span className="truncate">{u.email}</span>
                  </div>
                </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
