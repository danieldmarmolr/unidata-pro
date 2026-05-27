"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Award, Briefcase, Cake, Calendar, Mail, MapPin,
  Sparkles, Users as UsersIcon, Heart,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { KudoModal } from "@/components/people/kudo-modal";
import type { PublicProfile } from "@/components/people/types";

const MESES_NOM = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function tenure(joinedAt: string | null): string | null {
  if (!joinedAt) return null;
  const d = new Date(joinedAt);
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 1) return "<1 mes";
  if (months < 12) return `${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years} ${years === 1 ? "ano" : "anos"}`;
  return `${years} ${years === 1 ? "ano" : "anos"} y ${rem} ${rem === 1 ? "mes" : "meses"}`;
}

export default function PublicProfilePage({
  params,
}: {
  params: Promise<{ user_id: string }>;
}) {
  const { user_id } = use(params);
  const me = getUser();
  const [kudoOpen, setKudoOpen] = useState(false);

  const { data, isLoading } = useQuery<PublicProfile>({
    queryKey: ["people-profile", user_id],
    queryFn: () => api(`/api/people/profile/${user_id}`),
    staleTime: 60_000,
  });

  const isSelf = me?.id === Number(user_id);
  const t = tenure(data?.joined_at ?? null);

  return (
    <>
      <Topbar title={data?.name ?? "Perfil"} subtitle={data?.job_title ?? "Colaborador"} />
      <div className="flex-1 px-6 lg:px-8 py-6 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <Link
            href="/dashboard/people/directory"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text mb-4"
          >
            <ArrowLeft size={12} /> Volver al directorio
          </Link>

          {isLoading && <div className="text-center py-16 text-text-muted text-sm">Cargando perfil...</div>}

          {data && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
              {/* Main column */}
              <div className="space-y-4 min-w-0">
                {/* Header card */}
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <div
                    className="h-24"
                    style={{
                      background: data.area_color
                        ? `linear-gradient(135deg, ${data.area_color}, ${data.area_color}80)`
                        : "linear-gradient(135deg, #7a3eae, #4e1e7a)",
                    }}
                  />
                  <div className="px-6 pb-6 -mt-12">
                    <div className="flex items-end justify-between flex-wrap gap-3">
                      <Avatar
                        name={data.name}
                        url={data.avatar_url}
                        size="xl"
                        ringColor="#fff"
                        expandable
                      />
                      {!isSelf && (
                        <button
                          onClick={() => setKudoOpen(true)}
                          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full font-semibold text-sm hover:opacity-90 transition inline-flex items-center gap-1.5"
                        >
                          <Award size={14} /> Dar kudos
                        </button>
                      )}
                      {isSelf && (
                        <Link
                          href="/dashboard/perfil"
                          className="px-4 py-2 bg-surface border border-border rounded-full font-semibold text-sm hover:bg-bg-muted transition"
                        >
                          Editar mi perfil
                        </Link>
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-2xl font-bold text-text">{data.name}</h1>
                        {data.role === "gerencia" && (
                          <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            Gerencia
                          </span>
                        )}
                        {data.is_admin && (
                          <span className="text-[10px] font-bold uppercase text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                            Admin
                          </span>
                        )}
                      </div>
                      {data.job_title && (
                        <div className="text-sm text-text-muted mt-0.5 inline-flex items-center gap-1.5">
                          <Briefcase size={12} /> {data.job_title}
                        </div>
                      )}
                      {data.area_name && (
                        <div
                          className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
                          style={{
                            background: `${data.area_color}15`,
                            color: data.area_color ?? "#666",
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: data.area_color ?? "#666" }}
                          />
                          {data.area_name}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bio */}
                {data.bio && (
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                      Sobre {data.name.split(" ")[0]}
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap">{data.bio}</div>
                  </div>
                )}

                {/* Interests */}
                {data.interests && (
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2 inline-flex items-center gap-1.5">
                      <Heart size={11} /> Intereses
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap">{data.interests}</div>
                  </div>
                )}

                {/* Reports */}
                {data.reports.length > 0 && (
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3 inline-flex items-center gap-1.5">
                      <UsersIcon size={11} /> Reportes directos · {data.reports.length}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {data.reports.map((r) => (
                        <Link
                          key={r.id}
                          href={`/dashboard/people/${r.id}`}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-muted transition"
                        >
                          <Avatar
                            name={r.name}
                            url={r.avatar_url}
                            size="sm"
                            ringColor={r.area_color ?? undefined}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{r.name}</div>
                            <div className="text-[11px] text-text-muted truncate">
                              {r.job_title ?? ""}
                              {r.job_title && r.area_name && " · "}
                              {r.area_name ?? ""}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent kudos */}
                {data.recent_kudos.length > 0 && (
                  <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3 inline-flex items-center gap-1.5">
                      <Award size={11} className="text-amber-600" /> Kudos recibidos · ultimos
                    </div>
                    <div className="space-y-3">
                      {data.recent_kudos.map((k) => (
                        <div
                          key={k.id}
                          className="rounded-lg p-3"
                          style={{
                            background: `linear-gradient(135deg, ${k.value_color}10, ${k.value_color}05)`,
                            border: `1px solid ${k.value_color}30`,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xl">{k.value_emoji}</span>
                            <Link
                              href={`/dashboard/people/${k.from_user_id}`}
                              className="text-xs font-semibold hover:underline"
                            >
                              {k.from_name}
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
                          </div>
                          {k.message && (
                            <div className="text-xs text-text italic">"{k.message}"</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <aside className="space-y-4">
                {/* Stats */}
                <div className="bg-surface border border-border rounded-xl p-4 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Kudos recibidos" value={data.kudos_received} accent="#f59e0b" />
                  <Stat label="Kudos dados" value={data.kudos_given} accent="#10b981" />
                  <Stat label="Posts" value={data.posts_count} accent="#7a3eae" />
                </div>

                {/* Contact */}
                <div className="bg-surface border border-border rounded-xl p-4 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">
                    Contacto y datos
                  </div>
                  <Row icon={<Mail size={12} />} value={data.email} />
                  {data.manager_id && (
                    <Row
                      icon={<UsersIcon size={12} />}
                      label="Reporta a"
                      value={
                        <Link
                          href={`/dashboard/people/${data.manager_id}`}
                          className="hover:underline text-primary"
                        >
                          {data.manager_name}
                        </Link>
                      }
                    />
                  )}
                  {data.location_city && (
                    <Row icon={<MapPin size={12} />} value={data.location_city} />
                  )}
                  {data.birthday_month && data.birthday_day && (
                    <Row
                      icon={<Cake size={12} />}
                      label="Cumple"
                      value={`${data.birthday_day} de ${MESES_NOM[(data.birthday_month - 1) % 12]}`}
                    />
                  )}
                  {data.joined_at && (
                    <Row
                      icon={<Calendar size={12} />}
                      label="En Unistore"
                      value={t ?? data.joined_at}
                    />
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>

      {kudoOpen && data && (
        <KudoModal onClose={() => setKudoOpen(false)} defaultRecipientId={data.id} />
      )}
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="py-2">
      <div className="text-2xl font-extrabold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mt-0.5">
        {label}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label?: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-text-muted pt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        {label && <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">{label}</div>}
        <div className="text-text truncate">{value}</div>
      </div>
    </div>
  );
}
