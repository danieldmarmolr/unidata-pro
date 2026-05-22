"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Award, Users, Network, ChevronRight, Cake, Trophy, Hash, Inbox,
  MessageSquare, Megaphone,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { PostCard } from "@/components/people/post-card";
import { PostComposer } from "@/components/people/post-composer";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";
import type {
  FeedPost, FeedResponse, LeaderboardResponse, Space,
} from "@/components/people/types";

type Story = {
  user_id: number; name: string; day: number; month: number;
  age_turning: number | null;
  area_slug: string | null; area_name: string | null; area_color: string;
};
type Aniv = {
  user_id: number; name: string; joined_day: number; joined_month: number;
  years: number;
  area_slug: string | null; area_name: string | null; area_color: string;
};
type StoriesResp = {
  month: number; today: string;
  cumples_hoy: Story[]; cumples_mes: Story[]; aniversarios_mes: Aniv[];
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export default function PeopleFeedPage() {
  const me = getUser();
  const canManage =
    !!me?.is_admin ||
    me?.role === "admin" ||
    me?.role === "gerencia" ||
    me?.area_slug === "people";

  // null = "Toda la actividad" (sin filtrar por space)
  const [activeSpaceId, setActiveSpaceId] = useState<number | null>(null);

  const { data: spacesData } = useQuery<{ items: Space[] }>({
    queryKey: ["people-spaces"],
    queryFn: () => api("/api/people/spaces"),
    staleTime: 60_000,
  });

  const feedQ = useInfiniteQuery<FeedResponse>({
    queryKey: ["people-feed", activeSpaceId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20" });
      if (pageParam) params.set("before_id", String(pageParam));
      if (activeSpaceId) params.set("space_id", String(activeSpaceId));
      return api<FeedResponse>(`/api/people/feed?${params}`);
    },
    getNextPageParam: (last) => last.next_before_id ?? undefined,
    initialPageParam: undefined as number | undefined,
    staleTime: 20_000,
  });

  const storiesQ = useQuery<StoriesResp>({
    queryKey: ["people-stories"],
    queryFn: () => api<StoriesResp>("/api/people/stories"),
    staleTime: 30 * 60_000,
  });

  const leaderQ = useQuery<LeaderboardResponse>({
    queryKey: ["people-leaderboard", 30],
    queryFn: () => api<LeaderboardResponse>("/api/people/kudos/leaderboard?since_days=30&limit=5"),
    staleTime: 5 * 60_000,
  });

  const posts: FeedPost[] = feedQ.data?.pages.flatMap((p) => p.items) ?? [];

  const activeSpace = useMemo(
    () => spacesData?.items.find((s) => s.id === activeSpaceId) ?? null,
    [spacesData, activeSpaceId],
  );

  const spaceGroups = useMemo(() => {
    const all = spacesData?.items ?? [];
    return {
      globales: all.filter((s) => s.kind === "global"),
      mias: all.filter((s) => s.kind === "area" && s.is_default_for_viewer),
      otras: all.filter((s) => s.kind === "area" && !s.is_default_for_viewer),
    };
  }, [spacesData]);

  return (
    <>
      <Topbar
        title="People"
        subtitle={
          activeSpace
            ? `Espacio ${activeSpace.emoji} ${activeSpace.name}`
            : "El feed completo del equipo · novedades, cumples, kudos"
        }
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_300px] gap-4 max-w-7xl mx-auto">
          {/* LEFT: Spaces sidebar */}
          <aside className="space-y-3">
            <div className="bg-surface border border-border rounded-xl p-3 sticky top-4">
              {/* Actions */}
              <div className="space-y-0.5 mb-2 pb-2 border-b border-border">
                <NavBtn
                  href="/dashboard/people"
                  icon={<Hash size={14} />}
                  label="Toda la actividad"
                  active={activeSpaceId === null}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveSpaceId(null);
                  }}
                />
                <Link
                  href="/dashboard/people/inbox"
                  className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-bg-muted transition"
                >
                  <Inbox size={14} className="text-text-muted" />
                  <span className="text-text">Inbox</span>
                </Link>
                <Link
                  href="/dashboard/people/dms"
                  className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-bg-muted transition"
                >
                  <MessageSquare size={14} className="text-text-muted" />
                  <span className="text-text">Mensajes directos</span>
                </Link>
              </div>

              {spaceGroups.globales.length > 0 && (
                <SpaceGroup
                  title="Globales"
                  spaces={spaceGroups.globales}
                  activeId={activeSpaceId}
                  onPick={setActiveSpaceId}
                />
              )}
              {spaceGroups.mias.length > 0 && (
                <SpaceGroup
                  title="Mis areas"
                  spaces={spaceGroups.mias}
                  activeId={activeSpaceId}
                  onPick={setActiveSpaceId}
                />
              )}
              {spaceGroups.otras.length > 0 && (
                <SpaceGroup
                  title="Otras areas"
                  spaces={spaceGroups.otras}
                  activeId={activeSpaceId}
                  onPick={setActiveSpaceId}
                />
              )}

              <div className="mt-3 pt-3 border-t border-border space-y-0.5">
                <Link
                  href="/dashboard/people/directory"
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-bg-muted transition text-text-muted"
                >
                  <Users size={12} /> Directorio
                </Link>
                <Link
                  href="/dashboard/people/org-chart"
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-bg-muted transition text-text-muted"
                >
                  <Network size={12} /> Org Chart
                </Link>
                <Link
                  href="/dashboard/people/kudos"
                  className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-bg-muted transition text-text-muted"
                >
                  <Award size={12} /> Muro de Kudos
                </Link>
                {canManage && (
                  <Link
                    href="/dashboard/people/admin/values"
                    className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-bg-muted transition text-text-muted"
                  >
                    <Trophy size={12} /> Valores (admin)
                  </Link>
                )}
              </div>
            </div>
          </aside>

          {/* CENTER: Feed */}
          <div className="space-y-4 min-w-0">
            {activeSpace && (
              <div
                className="rounded-xl px-5 py-4 border"
                style={{
                  background: `linear-gradient(135deg, ${activeSpace.color}15, ${activeSpace.color}05)`,
                  borderColor: `${activeSpace.color}40`,
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{activeSpace.emoji}</div>
                  <div>
                    <div className="text-base font-bold text-text">{activeSpace.name}</div>
                    <div className="text-xs text-text-muted">{activeSpace.description}</div>
                  </div>
                  {activeSpace.posting_policy === "admins_only" && (
                    <span className="ml-auto text-[10px] font-bold uppercase text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                      <Megaphone size={10} /> Solo admins postean
                    </span>
                  )}
                </div>
              </div>
            )}

            <PostComposer canPin={canManage} forceSpaceId={activeSpaceId ?? undefined} />

            {feedQ.isLoading && (
              <div className="text-center py-16 text-text-muted text-sm">Cargando feed...</div>
            )}

            {!feedQ.isLoading && posts.length === 0 && (
              <div className="bg-surface border border-border rounded-xl py-16 text-center">
                <div className="text-4xl mb-2">📭</div>
                <div className="text-sm font-semibold">
                  {activeSpace ? `Sin posts en ${activeSpace.name} todavia` : "Todavia no hay posts"}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {activeSpace?.posting_policy === "admins_only"
                    ? "Esperando comunicaciones oficiales"
                    : "Se el primero en escribir"}
                </div>
              </div>
            )}

            {posts.map((p) => (
              <PostCard key={p.id} post={p} canManage={canManage} />
            ))}

            {feedQ.hasNextPage && (
              <div className="text-center py-4">
                <button
                  onClick={() => feedQ.fetchNextPage()}
                  disabled={feedQ.isFetchingNextPage}
                  className="px-4 py-2 text-sm bg-surface border border-border rounded-full hover:bg-bg-muted transition disabled:opacity-50"
                >
                  {feedQ.isFetchingNextPage ? "Cargando..." : "Cargar mas"}
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: Stories + leaderboard */}
          <aside className="space-y-4">
            {storiesQ.data && (storiesQ.data.cumples_hoy.length + storiesQ.data.cumples_mes.length + storiesQ.data.aniversarios_mes.length) > 0 && (
              <StoriesCard data={storiesQ.data} />
            )}

            {leaderQ.data && leaderQ.data.top_receivers.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Award size={14} className="text-amber-600" />
                  <div className="text-[11px] uppercase tracking-wider font-bold text-text">
                    Mas reconocidos · 30d
                  </div>
                </div>
                <div className="space-y-2">
                  {leaderQ.data.top_receivers.map((r, i) => (
                    <Link
                      key={r.user_id}
                      href={`/dashboard/people/${r.user_id}`}
                      className="flex items-center gap-2 hover:bg-bg-muted rounded-lg p-1.5 -m-1.5 transition"
                    >
                      <span className="w-5 text-xs text-text-muted font-bold tabular-nums">
                        #{i + 1}
                      </span>
                      <Avatar
                        name={r.name}
                        url={r.avatar_url}
                        size="sm"
                        ringColor={r.area_color ?? undefined}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{r.name}</div>
                      </div>
                      <span className="text-xs font-bold text-amber-600 tabular-nums">{r.n}</span>
                    </Link>
                  ))}
                </div>
                <Link
                  href="/dashboard/people/kudos"
                  className="mt-2 text-[11px] text-primary font-semibold inline-flex items-center gap-1 hover:underline"
                >
                  Ver muro completo <ChevronRight size={11} />
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function NavBtn({
  href, icon, label, active, onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition",
        active
          ? "bg-primary/10 text-primary font-semibold"
          : "hover:bg-bg-muted text-text",
      )}
    >
      <span className={active ? "text-primary" : "text-text-muted"}>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function SpaceGroup({
  title, spaces, activeId, onPick,
}: {
  title: string;
  spaces: Space[];
  activeId: number | null;
  onPick: (id: number | null) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted px-2 mb-1">
        {title}
      </div>
      <div className="space-y-0.5">
        {spaces.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            className={cn(
              "w-full text-left flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition",
              activeId === s.id
                ? "bg-primary/10 text-primary font-semibold"
                : "hover:bg-bg-muted text-text",
            )}
          >
            <span>{s.emoji}</span>
            <span className="flex-1 truncate">{s.name}</span>
            {s.posts_count > 0 && (
              <span className="text-[10px] text-text-muted/70 tabular-nums">{s.posts_count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function StoriesCard({ data }: { data: StoriesResp }) {
  const mes = MESES[(data.month - 1) % 12];
  return (
    <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-pink-50 border border-amber-200 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wider font-bold text-amber-900 mb-3">
        Vida en Unistore · {mes}
      </div>

      {data.cumples_hoy.length > 0 && (
        <div className="bg-white/70 border border-amber-300 rounded-lg p-2.5 mb-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-1.5 inline-flex items-center gap-1">
            <Cake size={11} /> Hoy es cumple de
          </div>
          {data.cumples_hoy.map((c) => (
            <Link
              key={c.user_id}
              href={`/dashboard/people/${c.user_id}`}
              className="flex items-center gap-2 py-0.5 hover:bg-amber-50 rounded -mx-1 px-1"
            >
              <Avatar name={c.name} size="xs" ringColor={c.area_color} />
              <span className="text-xs font-bold">{c.name}</span>
              {c.age_turning && (
                <span className="text-[10px] text-amber-700 font-semibold ml-auto">
                  cumple {c.age_turning}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {data.cumples_mes.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800 mb-1.5 inline-flex items-center gap-1">
            <Cake size={11} /> Cumples del mes
          </div>
          <div className="space-y-0.5">
            {data.cumples_mes.map((c) => (
              <Link
                key={c.user_id}
                href={`/dashboard/people/${c.user_id}`}
                className="flex items-center justify-between text-xs hover:bg-amber-50 rounded -mx-1 px-1 py-0.5"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.area_color }} />
                  <span className="font-semibold truncate">{c.name}</span>
                </span>
                <span className="text-amber-800 font-bold tabular-nums shrink-0">
                  {String(c.day).padStart(2, "0")}/{String(c.month).padStart(2, "0")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.aniversarios_mes.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-bold text-orange-800 mb-1.5 inline-flex items-center gap-1">
            <Trophy size={11} /> Aniversarios
          </div>
          <div className="space-y-0.5">
            {data.aniversarios_mes.map((a) => (
              <Link
                key={a.user_id}
                href={`/dashboard/people/${a.user_id}`}
                className="flex items-center justify-between text-xs hover:bg-orange-50 rounded -mx-1 px-1 py-0.5"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.area_color }} />
                  <span className="font-semibold truncate">{a.name}</span>
                </span>
                <span className="text-orange-800 font-bold tabular-nums shrink-0">
                  {a.years} {a.years === 1 ? "ano" : "anos"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
