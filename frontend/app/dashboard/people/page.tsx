"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Award, Users, Network, ChevronRight, Cake, Trophy } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { PostCard } from "@/components/people/post-card";
import { PostComposer } from "@/components/people/post-composer";
import { Avatar } from "@/components/people/avatar";
import type { FeedPost, FeedResponse, LeaderboardResponse } from "@/components/people/types";

type Story = {
  user_id: number;
  name: string;
  day: number;
  month: number;
  age_turning: number | null;
  area_slug: string | null;
  area_name: string | null;
  area_color: string;
};
type Aniv = {
  user_id: number;
  name: string;
  joined_day: number;
  joined_month: number;
  years: number;
  area_slug: string | null;
  area_name: string | null;
  area_color: string;
};
type StoriesResp = {
  month: number;
  today: string;
  cumples_hoy: Story[];
  cumples_mes: Story[];
  aniversarios_mes: Aniv[];
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

  const feedQ = useInfiniteQuery<FeedResponse>({
    queryKey: ["people-feed"],
    queryFn: ({ pageParam }) =>
      api<FeedResponse>(
        `/api/people/feed?limit=20${pageParam ? `&before_id=${pageParam}` : ""}`,
      ),
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

  return (
    <>
      <Topbar title="People" subtitle="El feed de Unistore · novedades, cumples, kudos" />
      <div className="flex-1 px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 max-w-6xl mx-auto">
          {/* Main column */}
          <div className="space-y-4 min-w-0">
            <PostComposer canPin={canManage} />

            {feedQ.isLoading && (
              <div className="text-center py-16 text-text-muted text-sm">Cargando feed...</div>
            )}

            {!feedQ.isLoading && posts.length === 0 && (
              <div className="bg-surface border border-border rounded-xl py-16 text-center">
                <div className="text-4xl mb-2">📭</div>
                <div className="text-sm font-semibold">Todavia no hay posts</div>
                <div className="text-xs text-text-muted mt-1">
                  Se el primero en escribir o dar kudos a un companero
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

          {/* Sidebar */}
          <aside className="space-y-4">
            {/* Quick nav */}
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3">
                Modulos
              </div>
              <div className="space-y-1">
                <SideLink href="/dashboard/people/directory" icon={<Users size={14} />} label="Directorio" />
                <SideLink href="/dashboard/people/org-chart" icon={<Network size={14} />} label="Org Chart" />
                <SideLink href="/dashboard/people/kudos" icon={<Award size={14} />} label="Kudos" />
                {canManage && (
                  <SideLink
                    href="/dashboard/people/admin/values"
                    icon={<Trophy size={14} />}
                    label="Valores (admin)"
                  />
                )}
              </div>
            </div>

            {/* Stories */}
            {storiesQ.data && (storiesQ.data.cumples_hoy.length + storiesQ.data.cumples_mes.length + storiesQ.data.aniversarios_mes.length) > 0 && (
              <StoriesCard data={storiesQ.data} />
            )}

            {/* Leaderboard */}
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

function SideLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-bg-muted transition"
    >
      <span className="text-text-muted">{icon}</span>
      <span className="text-text">{label}</span>
      <ChevronRight size={12} className="ml-auto text-text-muted" />
    </Link>
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
