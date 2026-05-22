"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cake, Briefcase, MapPin, Sparkles, ChevronRight, X } from "lucide-react";
import { api, getUser, setUser } from "@/lib/api";

type Area = { id: number; slug: string; name: string; color: string; description: string };
type AreasResp = { areas: Area[] };

type Me = {
  user: {
    id: number; email: string; name: string;
    area_id: number | null; area_name: string | null; area_color: string | null; area_slug: string | null;
    secondary_areas: { id: number; slug: string; name: string; color: string }[];
    birthday_month: number | null; birthday_day: number | null; birthday_year: number | null;
    joined_at: string | null; location_city: string | null; interests: string | null;
    profile_completed: boolean;
  };
  needs_onboarding: boolean;
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery<Me>({
    queryKey: ["users-me"],
    queryFn: () => api<Me>("/api/users/me"),
    staleTime: 30_000,
  });

  // Sincroniza area_slug del backend al localStorage user para que el sidebar
  // pueda hacer RBAC por area sin re-fetch.
  useEffect(() => {
    if (!data?.user) return;
    const current = getUser();
    if (!current) return;
    const fresh = { ...current, area_slug: data.user.area_slug ?? null };
    if (current.area_slug !== fresh.area_slug) {
      setUser(fresh);
      // Dispatch storage event para que el sidebar (que lee de localStorage) se re-render
      try { window.dispatchEvent(new Event("storage")); } catch {}
    }
  }, [data?.user?.area_slug]);

  if (isLoading) return <>{children}</>;
  if (data?.needs_onboarding) {
    return (
      <>
        {children}
        <OnboardingModal initial={data.user} />
      </>
    );
  }
  return <>{children}</>;
}

function OnboardingModal({ initial }: { initial: Me["user"] }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [areaId, setAreaId] = useState<number | null>(initial.area_id);
  const [secondaryIds, setSecondaryIds] = useState<number[]>(
    (initial.secondary_areas ?? []).map((a) => a.id),
  );
  const [birthMonth, setBirthMonth] = useState<number | null>(initial.birthday_month);
  const [birthDay, setBirthDay] = useState<number | null>(initial.birthday_day);
  const [birthYear, setBirthYear] = useState<number | null>(initial.birthday_year);
  const [joinedYM, setJoinedYM] = useState<string>(initial.joined_at?.slice(0, 7) ?? "");
  const [city, setCity] = useState<string>(initial.location_city ?? "");
  const [interests, setInterests] = useState<string>(initial.interests ?? "");

  const areasQ = useQuery<AreasResp>({
    queryKey: ["users-areas"],
    queryFn: () => api<AreasResp>("/api/users/areas"),
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/users/me/profile", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users-me"] });
      qc.invalidateQueries({ queryKey: ["users-stories"] });
    },
  });

  const canStep1 = areaId !== null;
  const canStep2 = birthMonth && birthDay;
  const canStep3 = joinedYM.match(/^\d{4}-\d{2}$/);

  function finish(markCompleted: boolean) {
    save.mutate({
      area_id: areaId,
      secondary_area_ids: secondaryIds.filter((x) => x !== areaId),
      birthday_month: birthMonth,
      birthday_day: birthDay,
      birthday_year: birthYear || null,
      joined_at: joinedYM || null,
      location_city: city || null,
      interests: interests || null,
      mark_completed: markCompleted,
    });
  }

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 80 }, (_, i) => now - i);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-[min(560px,92vw)] max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-primary to-accent text-white relative">
          <div className="flex items-center gap-2">
            <Sparkles size={18} />
            <div>
              <div className="text-sm font-bold opacity-90">Bienvenido a UNIDATA</div>
              <div className="text-lg font-extrabold">Contanos un poco sobre vos</div>
            </div>
          </div>
          <div className="text-[11px] opacity-80 mt-1">
            Hola {initial.name || initial.email.split("@")[0]} — 2 minutos para sumarte a la comunidad de Unistore
          </div>
          {/* Steps */}
          <div className="flex items-center gap-1.5 mt-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={
                  "h-1 rounded-full flex-1 transition " +
                  (i <= step ? "bg-white" : "bg-white/30")
                }
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 0: AREA */}
          {step === 0 && (
            <div>
              <div className="text-base font-bold text-text mb-1">¿En qué área colaborás?</div>
              <div className="text-xs text-text-muted mb-4">
                Elegí tu área <b>principal</b>. Si colaborás con más de una (ej. Admin + Finanzas), marcá las adicionales abajo.
              </div>
              <div className="grid grid-cols-2 gap-2">
                {areasQ.data?.areas.map((a) => {
                  const selected = areaId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAreaId(a.id);
                        setSecondaryIds((prev) => prev.filter((x) => x !== a.id));
                      }}
                      className={
                        "text-left p-3 rounded-lg border-2 transition " +
                        (selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")
                      }
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} />
                        <div className="font-bold text-sm text-text">{a.name}</div>
                      </div>
                      <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{a.description}</div>
                    </button>
                  );
                })}
              </div>

              {areaId !== null && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                    También colaborás en (opcional)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(areasQ.data?.areas ?? [])
                      .filter((a) => a.id !== areaId)
                      .map((a) => {
                        const checked = secondaryIds.includes(a.id);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() =>
                              setSecondaryIds((prev) =>
                                prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                              )
                            }
                            className={
                              "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border transition " +
                              (checked
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "border-border text-text-muted hover:border-primary/40")
                            }
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
                            {a.name}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 1: CUMPLEAÑOS */}
          {step === 1 && (
            <div>
              <div className="text-base font-bold text-text mb-1 inline-flex items-center gap-2">
                <Cake size={16} /> ¿Cuándo es tu cumple?
              </div>
              <div className="text-xs text-text-muted mb-4">
                Día y mes obligatorios para festejarte. El año es opcional — si lo agregás podemos calcular qué edad cumplís.
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={birthDay ?? ""}
                  onChange={(e) => setBirthDay(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="px-3 py-2 rounded-lg border border-border bg-surface text-sm"
                >
                  <option value="">Día</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select
                  value={birthMonth ?? ""}
                  onChange={(e) => setBirthMonth(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="px-3 py-2 rounded-lg border border-border bg-surface text-sm"
                >
                  <option value="">Mes</option>
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select
                  value={birthYear ?? ""}
                  onChange={(e) => setBirthYear(e.target.value ? parseInt(e.target.value, 10) : null)}
                  className="px-3 py-2 rounded-lg border border-border bg-surface text-sm"
                >
                  <option value="">Año (opcional)</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step 2: ANIVERSARIO */}
          {step === 2 && (
            <div>
              <div className="text-base font-bold text-text mb-1 inline-flex items-center gap-2">
                <Briefcase size={16} /> ¿Cuándo entraste a Unistore?
              </div>
              <div className="text-xs text-text-muted mb-4">
                Sirve para festejar tu aniversario en la empresa. Si no te acordás el día exacto, está bien — solo mes y año.
              </div>
              <input
                type="month"
                value={joinedYM}
                onChange={(e) => setJoinedYM(e.target.value)}
                className="px-3 py-2 rounded-lg border border-border bg-surface text-sm w-full"
                max={new Date().toISOString().slice(0, 7)}
              />
            </div>
          )}

          {/* Step 3: opcional */}
          {step === 3 && (
            <div>
              <div className="text-base font-bold text-text mb-1 inline-flex items-center gap-2">
                <MapPin size={16} /> Un poco más sobre vos (opcional)
              </div>
              <div className="text-xs text-text-muted mb-4">
                Estas dos cosas nos ayudan a encontrar similitudes entre compañeros. Las podés dejar en blanco y agregarlas después desde tu perfil.
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ciudad donde trabajás</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="ej. Buenos Aires, Tigre, Pilar..."
                    className="mt-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm w-full"
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Hobbies / intereses</label>
                  <textarea
                    value={interests}
                    onChange={(e) => setInterests(e.target.value)}
                    placeholder="ej. ciclismo, ajedrez, mate, asados, fotografía..."
                    className="mt-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm w-full resize-none"
                    rows={3}
                    maxLength={500}
                  />
                </div>
              </div>
            </div>
          )}

          {save.isError && (
            <div className="mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {(save.error as Error)?.message || "Error guardando — intentá de nuevo"}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-soft flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-xs text-text-muted hover:text-text disabled:opacity-30"
          >
            ← Atrás
          </button>
          <div className="flex items-center gap-2">
            {step === 3 && (
              <button
                type="button"
                onClick={() => finish(true)}
                disabled={save.isPending}
                className="px-3 py-2 rounded-lg border border-border text-xs text-text-muted hover:bg-soft"
              >
                Omitir y terminar
              </button>
            )}
            <button
              type="button"
              disabled={
                save.isPending ||
                (step === 0 && !canStep1) ||
                (step === 1 && !canStep2) ||
                (step === 2 && !canStep3)
              }
              onClick={() => {
                if (step < 3) {
                  setStep((s) => s + 1);
                } else {
                  finish(true);
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-accent text-white text-sm font-bold shadow-md disabled:opacity-40 hover:shadow-lg transition"
            >
              {step < 3 ? "Continuar" : "Listo, vamos!"}
              {step < 3 ? <ChevronRight size={14} /> : <CheckCircle2 size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
