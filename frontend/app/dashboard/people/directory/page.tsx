"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, MapPin, Cake, Briefcase, Mail } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import type { DirectoryItem } from "@/components/people/types";

export default function PeopleDirectoryPage() {
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ items: DirectoryItem[] }>({
    queryKey: ["people-directory"],
    queryFn: () => api("/api/people/directory"),
    staleTime: 5 * 60_000,
  });

  const areas = useMemo(() => {
    if (!data?.items) return [];
    const seen = new Map<string, { slug: string; name: string; color: string; count: number }>();
    for (const u of data.items) {
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
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    const s = search.trim().toLowerCase();
    return data.items.filter((u) => {
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
  }, [data, search, areaFilter]);

  return (
    <>
      <Topbar title="Directorio" subtitle={`${data?.items?.length ?? 0} colaboradores activos`} />
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
                  Todas ({data?.items?.length ?? 0})
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
              <Link
                key={u.id}
                href={`/dashboard/people/${u.id}`}
                className="bg-surface border border-border rounded-xl p-4 hover:shadow-lg hover:border-primary/30 transition group"
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    name={u.name}
                    url={u.avatar_url}
                    size="lg"
                    ringColor={u.area_color ?? undefined}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-text truncate group-hover:text-primary transition">
                      {u.name}
                    </div>
                    {u.job_title && (
                      <div className="text-xs text-text-muted truncate inline-flex items-center gap-1">
                        <Briefcase size={10} /> {u.job_title}
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
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
