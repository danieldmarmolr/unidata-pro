"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, Trophy, Sparkles } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { KudoModal } from "@/components/people/kudo-modal";
import type { KudoItem, LeaderboardResponse, PeopleValue } from "@/components/people/types";

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export default function KudosWallPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [period, setPeriod] = useState<30 | 90 | 365>(30);
  const [valueFilter, setValueFilter] = useState<string | null>(null);

  const { data: kudos } = useQuery<{ items: KudoItem[] }>({
    queryKey: ["people-kudos", valueFilter],
    queryFn: () =>
      api(`/api/people/kudos?limit=100${valueFilter ? `&value_slug=${valueFilter}` : ""}`),
    staleTime: 60_000,
  });

  const { data: leader } = useQuery<LeaderboardResponse>({
    queryKey: ["people-leaderboard-full", period],
    queryFn: () => api(`/api/people/kudos/leaderboard?since_days=${period}&limit=10`),
    staleTime: 60_000,
  });

  const { data: values } = useQuery<{ items: PeopleValue[] }>({
    queryKey: ["people-values"],
    queryFn: () => api("/api/people/values"),
    staleTime: 30 * 60_000,
  });

  return (
    <>
      <Topbar title="Muro de Kudos" subtitle="Reconocimientos entre el equipo" />
      <div className="flex-1 px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Wall */}
          <div className="min-w-0">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl p-5 mb-4 text-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Award size={20} />
                    <div className="text-base font-bold">Reconoce a un companero</div>
                  </div>
                  <div className="text-xs opacity-90">
                    El equipo crece cuando celebramos lo que cada uno aporta
                  </div>
                </div>
                <button
                  onClick={() => setModalOpen(true)}
                  className="px-4 py-2 bg-white text-orange-600 rounded-full font-semibold text-sm hover:opacity-90 transition inline-flex items-center gap-1.5"
                >
                  <Sparkles size={14} />
                  Dar kudos
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              <button
                onClick={() => setValueFilter(null)}
                className={`text-[11px] px-2.5 py-1 rounded-full border ${
                  !valueFilter ? "bg-primary text-white border-primary" : "border-border hover:bg-bg-muted"
                }`}
              >
                Todos
              </button>
              {values?.items?.map((v) => (
                <button
                  key={v.slug}
                  onClick={() => setValueFilter(v.slug)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 ${
                    valueFilter === v.slug ? "text-white border-transparent" : "border-border hover:bg-bg-muted"
                  }`}
                  style={valueFilter === v.slug ? { background: v.color } : undefined}
                >
                  <span>{v.emoji}</span>
                  {v.name}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {kudos?.items?.length === 0 && (
                <div className="bg-surface border border-border rounded-xl py-16 text-center">
                  <Award size={32} className="mx-auto text-text-muted mb-2" />
                  <div className="text-sm font-semibold">Sin kudos todavia</div>
                  <div className="text-xs text-text-muted mt-1">Se el primero</div>
                </div>
              )}

              {kudos?.items?.map((k) => (
                <div
                  key={k.id}
                  className="bg-surface border border-border rounded-xl p-4"
                  style={{
                    borderLeftWidth: "4px",
                    borderLeftColor: k.value_color ?? "#7a3eae",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-3xl">{k.value_emoji ?? "⭐"}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Link
                          href={`/dashboard/people/${k.from_user_id}`}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <Avatar name={k.from_name} url={k.from_avatar} size="xs" />
                          <span className="text-sm font-semibold">{k.from_name}</span>
                        </Link>
                        <span className="text-xs text-text-muted">le dio kudos a</span>
                        <Link
                          href={`/dashboard/people/${k.to_user_id}`}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <Avatar name={k.to_name} url={k.to_avatar} size="xs" />
                          <span className="text-sm font-semibold">{k.to_name}</span>
                        </Link>
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{
                            background: `${k.value_color}15`,
                            color: k.value_color ?? "#666",
                          }}
                        >
                          #{k.value_name ?? k.value_slug}
                        </span>
                        <span className="text-[10px] text-text-muted ml-auto">{timeAgo(k.created_at)}</span>
                      </div>
                      {k.message && (
                        <div className="text-sm text-text italic pl-2 border-l-2 border-border">"{k.message}"</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard */}
          <aside className="space-y-4">
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider font-bold text-text inline-flex items-center gap-1.5">
                  <Trophy size={12} className="text-amber-600" />
                  Leaderboard
                </div>
                <div className="flex gap-0.5 bg-bg-muted rounded-md p-0.5">
                  {[30, 90, 365].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPeriod(n as 30 | 90 | 365)}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        period === n ? "bg-white shadow-sm font-bold" : "text-text-muted"
                      }`}
                    >
                      {n === 365 ? "1a" : `${n}d`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3">
                <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">
                  Mas reconocidos
                </div>
                <div className="space-y-1.5">
                  {leader?.top_receivers?.slice(0, 5).map((r, i) => (
                    <Link
                      key={r.user_id}
                      href={`/dashboard/people/${r.user_id}`}
                      className="flex items-center gap-2 hover:bg-bg-muted -mx-1 px-1 py-0.5 rounded"
                    >
                      <span className="w-5 text-[11px] font-bold text-text-muted tabular-nums">
                        #{i + 1}
                      </span>
                      <Avatar name={r.name} url={r.avatar_url} size="xs" ringColor={r.area_color ?? undefined} />
                      <span className="text-xs font-semibold truncate flex-1">{r.name}</span>
                      <span className="text-xs font-bold text-amber-600 tabular-nums">{r.n}</span>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="px-3 pb-3 pt-1 border-t border-border">
                <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2 mt-2">
                  Mas dadores
                </div>
                <div className="space-y-1.5">
                  {leader?.top_givers?.slice(0, 5).map((r, i) => (
                    <Link
                      key={r.user_id}
                      href={`/dashboard/people/${r.user_id}`}
                      className="flex items-center gap-2 hover:bg-bg-muted -mx-1 px-1 py-0.5 rounded"
                    >
                      <span className="w-5 text-[11px] font-bold text-text-muted tabular-nums">
                        #{i + 1}
                      </span>
                      <Avatar name={r.name} url={r.avatar_url} size="xs" ringColor={r.area_color ?? undefined} />
                      <span className="text-xs font-semibold truncate flex-1">{r.name}</span>
                      <span className="text-xs font-bold text-emerald-600 tabular-nums">{r.n}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {leader?.by_value && leader.by_value.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="text-[11px] uppercase tracking-wider font-bold text-text mb-3">
                  Por valor
                </div>
                <div className="space-y-2">
                  {leader.by_value.map((v) => (
                    <div key={v.slug} className="flex items-center gap-2">
                      <span className="text-lg">{v.emoji}</span>
                      <span className="text-xs font-semibold flex-1 truncate">{v.name}</span>
                      <span className="text-xs font-bold tabular-nums" style={{ color: v.color }}>
                        {v.n}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {modalOpen && <KudoModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
