"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Coins, ScrollText, ChevronRight, Mail, Building2,
  CalendarCheck, Briefcase, User as UserIcon, MapPin,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";

type LegajoSummary = {
  user_id: number;
  summary: {
    documentos: number;
    recibos: number;
    contratos: number;
    last_recibo: { period_year: number; period_month: number; uploaded_at: string } | null;
    last_contrato_at: string | null;
  };
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

export default function LegajoPage() {
  const me = getUser();
  const { data, isLoading } = useQuery<LegajoSummary>({
    queryKey: ["personal-legajo"],
    queryFn: () => api("/api/personal/legajo"),
    staleTime: 30_000,
  });

  const { data: profile } = useQuery<{
    id: number;
    name: string;
    email: string;
    job_title: string | null;
    area_name: string | null;
    location_city: string | null;
    joined_at: string | null;
    manager_name: string | null;
    avatar_url: string | null;
  } | null>({
    queryKey: ["my-profile", me?.id],
    queryFn: () => (me?.id ? api(`/api/people/profile/${me.id}`) : Promise.resolve(null)),
    enabled: !!me?.id,
    staleTime: 60_000,
  });

  const sum = data?.summary;
  const last = sum?.last_recibo;

  return (
    <>
      <Topbar
        title="Mi legajo"
        subtitle="Datos personales + documentación, recibos y contratos"
      />
      <div className="flex-1 px-4 lg:px-6 py-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-5">
          {/* Datos del colaborador */}
          <div className="bg-surface border border-border rounded-xl p-5">
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3">
              Datos personales
            </div>
            <div className="flex items-center gap-4 mb-4">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="w-16 h-16 rounded-full object-cover border-2 border-border"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <UserIcon size={28} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-lg font-extrabold">{profile?.name ?? me?.name ?? "—"}</div>
                <div className="text-[12px] text-text-muted truncate">
                  {profile?.job_title ?? "Sin job title"}
                  {profile?.area_name && ` · ${profile.area_name}`}
                </div>
              </div>
              <Link
                href="/dashboard/perfil"
                className="text-[12px] font-semibold text-primary hover:underline shrink-0"
              >
                Editar perfil →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
              <DataRow icon={Mail} label="Email" value={profile?.email ?? me?.email ?? ""} />
              <DataRow icon={Briefcase} label="Manager" value={profile?.manager_name ?? "—"} />
              <DataRow icon={Building2} label="Area" value={profile?.area_name ?? "—"} />
              <DataRow icon={MapPin} label="Ciudad" value={profile?.location_city ?? "—"} />
              <DataRow
                icon={CalendarCheck}
                label="Fecha de ingreso"
                value={profile?.joined_at ? fmtDate(profile.joined_at) : "—"}
              />
            </div>
          </div>

          {/* Resumen del legajo */}
          {!isLoading && sum && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <LegajoCard
                href="/dashboard/people/documentos"
                icon={FileText}
                title="Documentos"
                count={sum.documentos}
                hint="DNI, CV, certificados, etc."
                color="#7a3eae"
              />
              <LegajoCard
                href="/dashboard/people/recibos"
                icon={Coins}
                title="Recibos de sueldo"
                count={sum.recibos}
                hint={
                  last
                    ? `Ultimo: ${MESES[last.period_month - 1]} ${last.period_year}`
                    : "Aun no hay recibos cargados"
                }
                color="#10b981"
              />
              <LegajoCard
                href="/dashboard/people/contratos"
                icon={ScrollText}
                title="Contratos"
                count={sum.contratos}
                hint={
                  sum.last_contrato_at
                    ? `Ultimo: ${fmtDate(sum.last_contrato_at)}`
                    : "Aun sin contratos cargados"
                }
                color="#f59e0b"
              />
            </div>
          )}

          {/* Hint para nuevos users */}
          {!isLoading && sum && sum.documentos === 0 && sum.recibos === 0 && sum.contratos === 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-[13px] text-amber-900 dark:text-amber-200">
              Tu legajo está vacío. Empezá subiendo tu <strong>DNI</strong> en Documentos. Los recibos y contratos los carga People periódicamente.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DataRow({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={14} className="text-text-muted mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">
          {label}
        </div>
        <div className="text-[13px] truncate">{value}</div>
      </div>
    </div>
  );
}

function LegajoCard({
  href, icon: Icon, title, count, hint, color,
}: {
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  count: number;
  hint: string;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="group bg-surface border border-border rounded-xl p-4 hover:shadow-md hover:border-primary/40 transition-all relative"
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
        style={{ background: `${color}20`, color }}
      >
        <Icon size={20} />
      </div>
      <div className="flex items-end justify-between gap-2 mb-1">
        <div className="text-sm font-bold">{title}</div>
        <div className="text-2xl font-extrabold tabular-nums" style={{ color }}>
          {count}
        </div>
      </div>
      <div className="text-[11px] text-text-muted line-clamp-2">{hint}</div>
      <div className="absolute top-3 right-3 text-text-muted group-hover:text-primary transition">
        <ChevronRight size={14} />
      </div>
    </Link>
  );
}
