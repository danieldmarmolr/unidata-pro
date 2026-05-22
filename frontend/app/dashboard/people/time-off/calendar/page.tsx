"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { Avatar } from "@/components/people/avatar";
import { cn } from "@/lib/utils";
import type { TimeOff } from "@/components/people/hr-types";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DOW = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

const KIND_COLOR: Record<TimeOff["kind"], string> = {
  vacaciones: "#0ea5e9",
  licencia: "#ef4444",
  home_office: "#10b981",
  viaje_work: "#8b5cf6",
  otro: "#7a3eae",
};

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1);
}
function endOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0);
}
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function TimeOffCalendarPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data } = useQuery<{ items: TimeOff[] }>({
    queryKey: ["time-off-calendar", month, year],
    queryFn: () => api(`/api/people/time-off/calendar?month=${month}&year=${year}`),
    staleTime: 60_000,
  });

  // Construir grilla de dias
  const grid = useMemo(() => {
    const first = startOfMonth(year, month);
    const last = endOfMonth(year, month);
    const startWeekday = (first.getDay() + 6) % 7; // L=0, D=6
    const days: { date: Date; current: boolean; key: string }[] = [];
    // Prev month tail
    for (let i = startWeekday; i > 0; i--) {
      const d = new Date(first);
      d.setDate(first.getDate() - i);
      days.push({ date: d, current: false, key: dayKey(d) });
    }
    // Current month
    for (let i = 1; i <= last.getDate(); i++) {
      const d = new Date(year, month - 1, i);
      days.push({ date: d, current: true, key: dayKey(d) });
    }
    // Tail to complete 6 weeks
    while (days.length % 7 !== 0 || days.length < 42) {
      const d = new Date(days[days.length - 1].date);
      d.setDate(d.getDate() + 1);
      days.push({ date: d, current: false, key: dayKey(d) });
      if (days.length >= 42) break;
    }
    return days;
  }, [month, year]);

  // Mapa de items por dia
  const itemsByDay = useMemo(() => {
    const map = new Map<string, TimeOff[]>();
    for (const t of data?.items ?? []) {
      const start = new Date(t.starts_on);
      const end = new Date(t.ends_on);
      const cur = new Date(start);
      while (cur <= end) {
        const k = dayKey(cur);
        const arr = map.get(k) ?? [];
        arr.push(t);
        map.set(k, arr);
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [data]);

  function prev() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function next() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  return (
    <>
      <Topbar title="Calendario del equipo" subtitle="Vacaciones + ausencias del mes" />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <Link
            href="/dashboard/people/time-off"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text mb-3"
          >
            <ArrowLeft size={12} /> Volver
          </Link>

          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-sm font-bold capitalize">
                {MESES[month - 1]} {year}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={prev} className="p-1 hover:bg-bg-muted rounded">
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => {
                    setMonth(now.getMonth() + 1);
                    setYear(now.getFullYear());
                  }}
                  className="text-[11px] px-2 py-1 hover:bg-bg-muted rounded font-semibold"
                >
                  Hoy
                </button>
                <button onClick={next} className="p-1 hover:bg-bg-muted rounded">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 border-b border-border">
              {DOW.map((d) => (
                <div
                  key={d}
                  className="px-2 py-1.5 text-[11px] font-bold text-text-muted text-center bg-bg-muted/40"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {grid.map((day, i) => {
                const items = itemsByDay.get(day.key) ?? [];
                const isToday = dayKey(now) === day.key;
                const isWeekend = [5, 6].includes((day.date.getDay() + 6) % 7);
                return (
                  <div
                    key={i}
                    className={cn(
                      "min-h-[80px] border-b border-r border-border p-1 last:border-r-0",
                      !day.current && "bg-bg-muted/30 opacity-50",
                      isWeekend && day.current && "bg-bg-muted/20",
                    )}
                  >
                    <div
                      className={cn(
                        "text-[10px] font-semibold mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full",
                        isToday && "bg-primary text-white",
                      )}
                    >
                      {day.date.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {items.slice(0, 3).map((t) => (
                        <div
                          key={`${t.id}-${day.key}`}
                          className="flex items-center gap-1 px-1 py-0.5 rounded text-[9px] truncate"
                          style={{
                            background: `${KIND_COLOR[t.kind]}15`,
                            color: KIND_COLOR[t.kind],
                          }}
                          title={`${t.user_name} · ${t.kind} (${t.status})`}
                        >
                          <Avatar name={t.user_name} url={t.user_avatar} size="xs" />
                          <span className="truncate font-semibold">{t.user_name.split(" ")[0]}</span>
                        </div>
                      ))}
                      {items.length > 3 && (
                        <div className="text-[9px] text-text-muted font-semibold pl-1">
                          +{items.length - 3} mas
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted">
            {Object.entries(KIND_COLOR).map(([k, c]) => (
              <div key={k} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: c }} />
                {k.replace("_", " ")}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
