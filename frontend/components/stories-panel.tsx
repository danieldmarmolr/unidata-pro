"use client";

import { useQuery } from "@tanstack/react-query";
import { Cake, Trophy, PartyPopper } from "lucide-react";
import { api } from "@/lib/api";

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

const MESES_NOM = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function StoriesPanel() {
  const { data } = useQuery<StoriesResp>({
    queryKey: ["users-stories"],
    queryFn: () => api<StoriesResp>("/api/users/stories"),
    staleTime: 30 * 60_000,
  });

  if (!data) return null;
  const noContent =
    data.cumples_hoy.length === 0 &&
    data.cumples_mes.length === 0 &&
    data.aniversarios_mes.length === 0;
  if (noContent) return null;

  const mesNombre = MESES_NOM[(data.month - 1) % 12];

  return (
    <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-pink-50 border border-amber-200 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <PartyPopper size={16} className="text-amber-700" />
        <div className="text-sm font-bold text-amber-900">Vida en Unistore · {mesNombre}</div>
      </div>

      {/* Cumples HOY - banner destacado */}
      {data.cumples_hoy.length > 0 && (
        <div className="bg-white/70 border border-amber-300 rounded-lg p-3 mb-3">
          <div className="text-[11px] uppercase tracking-wider font-bold text-amber-700 mb-1.5 inline-flex items-center gap-1">
            <Cake size={12} /> Hoy es cumple de
          </div>
          <div className="flex flex-wrap gap-2">
            {data.cumples_hoy.map((c) => (
              <PersonChip key={c.user_id} name={c.name} area={c.area_name} color={c.area_color} hint={c.age_turning ? `cumple ${c.age_turning}` : undefined} />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Cumples del mes */}
        {data.cumples_mes.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-amber-800 mb-2 inline-flex items-center gap-1">
              <Cake size={12} /> Cumples de {mesNombre}
            </div>
            <div className="space-y-1.5">
              {data.cumples_mes.map((c) => (
                <div key={c.user_id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c.area_color }} />
                    <span className="font-semibold text-text truncate">{c.name}</span>
                    {c.area_name && <span className="text-text-muted text-[10px]">· {c.area_name}</span>}
                  </div>
                  <span className="text-amber-800 font-bold tabular-nums shrink-0">
                    {String(c.day).padStart(2, "0")}/{String(c.month).padStart(2, "0")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Aniversarios del mes */}
        {data.aniversarios_mes.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-orange-800 mb-2 inline-flex items-center gap-1">
              <Trophy size={12} /> Aniversarios en {mesNombre}
            </div>
            <div className="space-y-1.5">
              {data.aniversarios_mes.map((a) => (
                <div key={a.user_id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.area_color }} />
                    <span className="font-semibold text-text truncate">{a.name}</span>
                    {a.area_name && <span className="text-text-muted text-[10px]">· {a.area_name}</span>}
                  </div>
                  <span className="text-orange-800 font-bold tabular-nums shrink-0">
                    {a.years} {a.years === 1 ? "ano" : "anos"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PersonChip({ name, area, color, hint }: { name: string; area: string | null; color: string; hint?: string }) {
  return (
    <div className="inline-flex items-center gap-2 bg-white border border-amber-300 rounded-full pl-2 pr-3 py-1">
      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: color }}>
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="text-xs font-bold text-text">{name}</span>
      {area && <span className="text-[10px] text-text-muted">· {area}</span>}
      {hint && <span className="text-[10px] text-amber-700 font-semibold">· {hint}</span>}
    </div>
  );
}
