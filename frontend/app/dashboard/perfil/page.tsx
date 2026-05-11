"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Cake, Briefcase, MapPin, Heart, User as UserIcon } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";

type Area = { id: number; slug: string; name: string; color: string; description: string };
type Me = {
  user: {
    id: number; email: string; name: string; role: string;
    area_id: number | null; area_name: string | null; area_color: string | null;
    birthday_month: number | null; birthday_day: number | null; birthday_year: number | null;
    joined_at: string | null; location_city: string | null; interests: string | null;
    profile_completed: boolean; created_at: string;
  };
  needs_onboarding: boolean;
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function PerfilPage() {
  const qc = useQueryClient();
  const meQ = useQuery<Me>({ queryKey: ["users-me"], queryFn: () => api<Me>("/api/users/me") });
  const areasQ = useQuery<{ areas: Area[] }>({
    queryKey: ["users-areas"],
    queryFn: () => api<{ areas: Area[] }>("/api/users/areas"),
    staleTime: 5 * 60_000,
  });

  const [areaId, setAreaId] = useState<number | null>(null);
  const [bd, setBd] = useState<number | null>(null);
  const [bm, setBm] = useState<number | null>(null);
  const [by, setBy] = useState<number | null>(null);
  const [joinedYM, setJoinedYM] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [interests, setInterests] = useState<string>("");

  useEffect(() => {
    if (meQ.data?.user) {
      const u = meQ.data.user;
      setAreaId(u.area_id);
      setBd(u.birthday_day);
      setBm(u.birthday_month);
      setBy(u.birthday_year);
      setJoinedYM(u.joined_at?.slice(0, 7) ?? "");
      setCity(u.location_city ?? "");
      setInterests(u.interests ?? "");
    }
  }, [meQ.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/users/me/profile", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users-me"] }),
  });

  function onSave() {
    save.mutate({
      area_id: areaId,
      birthday_month: bm,
      birthday_day: bd,
      birthday_year: by || null,
      joined_at: joinedYM || null,
      location_city: city || null,
      interests: interests || null,
      mark_completed: true,
    });
  }

  const u = meQ.data?.user;

  return (
    <>
      <Topbar title="Mi perfil" subtitle="Tus datos en UNIDATA · usado para asignacion de area y para Stories internas" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {!u && <div className="bg-surface border border-border rounded-xl h-[200px] animate-pulse" />}

        {u && (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Identidad */}
            <div className="bg-gradient-to-br from-primary/10 to-accent/5 border border-primary/30 rounded-2xl p-5 flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center font-extrabold text-2xl shadow-lg">
                {u.name.charAt(0).toUpperCase() || u.email.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-extrabold text-text truncate">{u.name || u.email}</div>
                <div className="text-xs text-text-muted">{u.email} · Rol: <span className="font-semibold text-text">{u.role}</span></div>
                {u.area_name && (
                  <div className="mt-1 inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full" style={{ background: `${u.area_color ?? "#7a3eae"}20`, color: u.area_color ?? "#7a3eae", border: `1px solid ${u.area_color ?? "#7a3eae"}40` }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: u.area_color ?? "#7a3eae" }} />
                    {u.area_name}
                  </div>
                )}
              </div>
            </div>

            {/* Area */}
            <Section icon={UserIcon} title="Area" subtitle="Defina los dashboards que ves por defecto">
              <select
                value={areaId ?? ""}
                onChange={(e) => setAreaId(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
              >
                <option value="">— Sin asignar —</option>
                {areasQ.data?.areas.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Section>

            {/* Cumple */}
            <Section icon={Cake} title="Cumpleanos" subtitle="Dia y mes para festejarlo. Year opcional.">
              <div className="grid grid-cols-3 gap-2">
                <select value={bd ?? ""} onChange={(e) => setBd(e.target.value ? parseInt(e.target.value, 10) : null)} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm">
                  <option value="">Dia</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={bm ?? ""} onChange={(e) => setBm(e.target.value ? parseInt(e.target.value, 10) : null)} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm">
                  <option value="">Mes</option>
                  {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select value={by ?? ""} onChange={(e) => setBy(e.target.value ? parseInt(e.target.value, 10) : null)} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm">
                  <option value="">Year (opcional)</option>
                  {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </Section>

            {/* Aniversario */}
            <Section icon={Briefcase} title="Cuando entraste a Unistore" subtitle="Para festejar aniversarios">
              <input type="month" value={joinedYM} onChange={(e) => setJoinedYM(e.target.value)} max={new Date().toISOString().slice(0, 7)} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm w-full" />
            </Section>

            {/* Ciudad */}
            <Section icon={MapPin} title="Ciudad" subtitle="Donde trabajas">
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="ej. Buenos Aires, Tigre, Pilar..." maxLength={80} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm w-full" />
            </Section>

            {/* Intereses */}
            <Section icon={Heart} title="Hobbies / intereses" subtitle="Para encontrar similitudes con companeros">
              <textarea value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="ej. ciclismo, ajedrez, mate, asados, fotografia..." maxLength={500} rows={3} className="px-3 py-2 rounded-lg border border-border bg-surface text-sm w-full resize-none" />
            </Section>

            <div className="flex items-center justify-end gap-3">
              {save.isSuccess && <span className="text-xs text-emerald-700 font-semibold">Guardado!</span>}
              {save.isError && <span className="text-xs text-red-700">Error al guardar</span>}
              <button onClick={onSave} disabled={save.isPending} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-sm font-bold shadow-md disabled:opacity-50">
                <Save size={14} /> {save.isPending ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Section({ icon: Icon, title, subtitle, children }: { icon: any; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-primary" />
        <div>
          <div className="text-sm font-bold text-text">{title}</div>
          {subtitle && <div className="text-[11px] text-text-muted">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
