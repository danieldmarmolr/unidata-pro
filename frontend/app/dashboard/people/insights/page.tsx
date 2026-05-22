"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, MessageCircle, ThumbsUp, Award, MessageSquare, Users as UsersIcon,
  AlertCircle, Activity, BarChart3,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";

type Insights = {
  since_days: number;
  totals: {
    posts: number;
    comments: number;
    reactions: number;
    kudos: number;
    dms: number;
    active_users: number;
    engaged_users: number;
    engagement_rate: number;
  };
  by_area: Array<{
    slug: string;
    name: string;
    color: string;
    posts: number;
    comments: number;
    users: number;
  }>;
  top_posters: Array<{ id: number; name: string; avatar_url: string | null; area_color: string | null; n: number }>;
  top_kudo_givers: Array<{ id: number; name: string; avatar_url: string | null; area_color: string | null; n: number }>;
  top_kudo_receivers: Array<{ id: number; name: string; avatar_url: string | null; area_color: string | null; n: number }>;
  silent_users: Array<{
    id: number;
    name: string;
    avatar_url: string | null;
    email: string;
    job_title: string | null;
    area_color: string | null;
    area_name: string | null;
  }>;
  posts_by_day: Array<{ day: string; count: number }>;
  enps_summary: null | {
    survey_id: number;
    question: string;
    responses: number;
    score: number;
    promoters_pct: number;
    detractors_pct: number;
  };
};

const PERIODS = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "1a" },
];

export default function PeopleInsightsPage() {
  const me = getUser();
  const canSee = !!me?.is_admin || me?.role === "admin" || me?.role === "gerencia" || me?.area_slug === "people";
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery<Insights>({
    queryKey: ["people-insights", days],
    queryFn: () => api(`/api/people/insights?since_days=${days}`),
    enabled: canSee,
    staleTime: 60_000,
  });

  if (!canSee) {
    return (
      <>
        <Topbar title="People Insights" subtitle="Solo admin/gerencia/People" />
        <div className="flex-1 px-6 py-6 overflow-y-auto">
          <div className="bg-surface border border-border rounded-xl p-12 text-center max-w-2xl mx-auto">
            <AlertCircle size={32} className="mx-auto text-text-muted mb-2" />
            <div className="text-sm font-semibold">Acceso restringido</div>
            <div className="text-xs text-text-muted">Las metricas de People estan reservadas a roles de gestion.</div>
          </div>
        </div>
      </>
    );
  }

  const maxPostsByDay = Math.max(...(data?.posts_by_day.map((d) => d.count) ?? [1]));

  return (
    <>
      <Topbar
        title="People Insights"
        subtitle="Engagement, eNPS y health del equipo"
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {/* Periodo */}
          <div className="bg-surface border border-border rounded-xl p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-text-muted">Periodo</div>
            <div className="flex gap-0.5 bg-bg-muted rounded-md p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => setDays(p.days)}
                  className={`text-xs px-3 py-1 rounded ${
                    days === p.days ? "bg-white shadow-sm font-bold" : "text-text-muted"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading && (
            <div className="text-center py-16 text-text-muted text-sm">Cargando metricas...</div>
          )}

          {data && (
            <div className="space-y-4">
              {/* KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <KPI label="Posts"      value={data.totals.posts}      icon={<MessageCircle size={14} />} color="#0ea5e9" />
                <KPI label="Comentarios" value={data.totals.comments} icon={<MessageSquare size={14} />} color="#8b5cf6" />
                <KPI label="Reacciones" value={data.totals.reactions} icon={<ThumbsUp size={14} />}    color="#f59e0b" />
                <KPI label="Kudos"      value={data.totals.kudos}      icon={<Award size={14} />}        color="#ec4899" />
                <KPI label="DMs"        value={data.totals.dms}        icon={<MessageSquare size={14} />} color="#10b981" />
                <KPI
                  label="Engagement"
                  value={`${data.totals.engagement_rate}%`}
                  icon={<Activity size={14} />}
                  color="#7a3eae"
                  sub={`${data.totals.engaged_users}/${data.totals.active_users} users activos`}
                />
              </div>

              {/* Posts serie temporal */}
              {data.posts_by_day.length > 0 && (
                <div className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp size={14} className="text-primary" />
                    <div className="text-sm font-bold">Posts por dia</div>
                  </div>
                  <div className="flex items-end gap-0.5 h-32">
                    {data.posts_by_day.map((d) => {
                      const h = Math.max(2, (d.count / maxPostsByDay) * 100);
                      return (
                        <div
                          key={d.day}
                          className="flex-1 bg-primary/30 hover:bg-primary/60 transition rounded-t"
                          style={{ height: `${h}%` }}
                          title={`${d.day}: ${d.count} posts`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-text-muted mt-1">
                    <span>{data.posts_by_day[0]?.day}</span>
                    <span>{data.posts_by_day[data.posts_by_day.length - 1]?.day}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* eNPS */}
                {data.enps_summary ? (
                  <Card title="eNPS reciente" icon={<Activity size={14} className="text-primary" />}>
                    <div className="text-[10px] text-text-muted mb-1 truncate">{data.enps_summary.question}</div>
                    <div className="flex items-baseline gap-1.5">
                      <div className="text-4xl font-extrabold tabular-nums text-primary">
                        {data.enps_summary.score > 0 ? `+${data.enps_summary.score}` : data.enps_summary.score}
                      </div>
                      <div className="text-[10px] text-text-muted">{data.enps_summary.responses} respuestas</div>
                    </div>
                    <div className="mt-2 flex h-2 rounded-full overflow-hidden bg-bg-muted">
                      <div className="bg-emerald-500" style={{ width: `${data.enps_summary.promoters_pct}%` }} />
                      <div className="bg-amber-400" style={{ width: `${100 - data.enps_summary.promoters_pct - data.enps_summary.detractors_pct}%` }} />
                      <div className="bg-red-500" style={{ width: `${data.enps_summary.detractors_pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] text-text-muted mt-1">
                      <span>P {data.enps_summary.promoters_pct}%</span>
                      <span>D {data.enps_summary.detractors_pct}%</span>
                    </div>
                  </Card>
                ) : (
                  <Card title="eNPS" icon={<Activity size={14} />}>
                    <div className="text-xs text-text-muted">Sin encuestas NPS con respuestas todavia.</div>
                    <Link
                      href="/dashboard/people/surveys"
                      className="text-[11px] text-primary font-semibold hover:underline inline-block mt-2"
                    >
                      Crear primera encuesta →
                    </Link>
                  </Card>
                )}

                {/* Top posters */}
                <Card title="Top posters" icon={<MessageCircle size={14} className="text-sky-500" />}>
                  <LeaderRows items={data.top_posters} accent="#0ea5e9" />
                </Card>

                {/* Top kudo givers */}
                <Card title="Top dadores kudos" icon={<Award size={14} className="text-emerald-600" />}>
                  <LeaderRows items={data.top_kudo_givers} accent="#10b981" />
                </Card>

                {/* Top kudo receivers */}
                <Card title="Top reconocidos" icon={<Award size={14} className="text-amber-600" />}>
                  <LeaderRows items={data.top_kudo_receivers} accent="#f59e0b" />
                </Card>

                {/* Actividad por area */}
                <Card title="Posts por area" icon={<BarChart3 size={14} className="text-violet-600" />}>
                  <div className="space-y-1.5">
                    {data.by_area.map((a) => {
                      const maxPosts = Math.max(1, ...data.by_area.map((x) => x.posts));
                      const pct = (a.posts / maxPosts) * 100;
                      return (
                        <div key={a.slug} className="text-xs">
                          <div className="flex justify-between mb-0.5">
                            <span className="font-semibold truncate">{a.name}</span>
                            <span className="text-text-muted tabular-nums">{a.posts}</span>
                          </div>
                          <div className="h-1.5 bg-bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full transition-all"
                              style={{ width: `${pct}%`, background: a.color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* Silent users */}
                <Card title={`Silent users (${data.silent_users.length})`} icon={<AlertCircle size={14} className="text-red-500" />}>
                  {data.silent_users.length === 0 ? (
                    <div className="text-xs text-text-muted">Todos participaron al menos una vez</div>
                  ) : (
                    <>
                      <div className="text-[10px] text-text-muted mb-2">
                        No postearon, comentaron, ni dieron kudos en {days}d
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto -mr-2 pr-2">
                        {data.silent_users.slice(0, 12).map((u) => (
                          <Link
                            key={u.id}
                            href={`/dashboard/people/${u.id}`}
                            className="flex items-center gap-2 p-1 hover:bg-bg-muted rounded text-xs"
                          >
                            <Avatar
                              name={u.name}
                              url={u.avatar_url}
                              size="xs"
                              ringColor={u.area_color ?? undefined}
                            />
                            <span className="font-semibold truncate flex-1">{u.name}</span>
                            <span className="text-[9px] text-text-muted truncate">{u.area_name ?? ""}</span>
                          </Link>
                        ))}
                        {data.silent_users.length > 12 && (
                          <div className="text-[10px] text-text-muted text-center pt-1">
                            +{data.silent_users.length - 12} mas
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function KPI({
  label, value, icon, color, sub,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold mb-1.5" style={{ color }}>
        {icon} {label}
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-1">{sub}</div>}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <div className="text-sm font-bold">{title}</div>
      </div>
      {children}
    </div>
  );
}

function LeaderRows({ items, accent }: { items: Insights["top_posters"]; accent: string }) {
  if (items.length === 0) {
    return <div className="text-xs text-text-muted">Sin datos en este periodo</div>;
  }
  return (
    <div className="space-y-1.5">
      {items.slice(0, 5).map((u, i) => (
        <Link
          key={u.id}
          href={`/dashboard/people/${u.id}`}
          className="flex items-center gap-2 hover:bg-bg-muted -mx-1 px-1 py-1 rounded"
        >
          <span className="w-4 text-[10px] font-bold text-text-muted tabular-nums">#{i + 1}</span>
          <Avatar name={u.name} url={u.avatar_url} size="xs" ringColor={u.area_color ?? undefined} />
          <span className="text-xs font-semibold truncate flex-1">{u.name}</span>
          <span className="text-xs font-bold tabular-nums" style={{ color: accent }}>{u.n}</span>
        </Link>
      ))}
    </div>
  );
}
