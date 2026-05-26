"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink, GraduationCap,
} from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LessonMarkdown } from "@/components/aprende/markdown";

type Lesson = {
  id: number;
  slug: string;
  area_slug: string;
  title: string;
  description: string;
  content_md: string;
  link: string | null;
  sort_order: number;
  completed_at: string | null;
};

const AREA_LABELS: Record<string, string> = {
  general: "General · UNIDATA 101",
  administracion: "Administración",
  compras: "Compras / Producto",
  finanzas: "Finanzas",
  ventas: "Ventas",
  logistica: "Logística",
  cs: "Customer Success",
  marketing: "Marketing",
  people: "People",
  it_data: "IT / Data",
  unistore: "Unistore",
  unidrop: "Unidrop",
  unidev: "Unidev",
};

export default function AprendeAreaPage({
  params,
}: {
  params: Promise<{ area: string }>;
}) {
  const { area } = use(params);
  const { data, isLoading } = useQuery<{ items: Lesson[] }>({
    queryKey: ["aprende-lessons", area],
    queryFn: () => api(`/api/aprende/lessons/${area}`),
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const done = items.filter((l) => l.completed_at).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const areaLabel = AREA_LABELS[area] ?? area;

  return (
    <>
      <Topbar
        title={`Aprende · ${areaLabel}`}
        subtitle={total > 0 ? `${done} de ${total} lecciones completadas` : undefined}
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Link
              href="/dashboard/people/aprende"
              className="text-[13px] text-text-muted hover:text-text inline-flex items-center gap-1.5"
            >
              <ArrowLeft size={14} /> Volver al hub
            </Link>
            {total > 0 && (
              <div className="text-[12px] font-semibold text-text-muted">
                {pct}% completado
              </div>
            )}
          </div>

          {total > 0 && (
            <div className="h-2 bg-bg-muted rounded-full overflow-hidden mb-5">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-12 text-text-muted text-sm">Cargando...</div>
          ) : total === 0 ? (
            <div className="text-center py-16 bg-surface border border-border rounded-xl">
              <GraduationCap size={40} className="mx-auto text-text-muted mb-2 opacity-50" />
              <div className="text-sm font-semibold mb-1">Sin lecciones todavía</div>
              <div className="text-xs text-text-muted">
                El contenido de esta área aún no está cargado.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((lesson, idx) => (
                <LessonCard key={lesson.id} lesson={lesson} area={area} index={idx + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LessonCard({
  lesson, area, index,
}: {
  lesson: Lesson;
  area: string;
  index: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const isDone = !!lesson.completed_at;

  const markMut = useMutation({
    mutationFn: () =>
      api("/api/aprende/progress", {
        method: "POST",
        body: JSON.stringify({ lesson_slug: lesson.slug, done: !isDone }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aprende-lessons", area] });
      qc.invalidateQueries({ queryKey: ["aprende-areas"] });
    },
  });

  return (
    <div
      className={cn(
        "bg-surface border rounded-xl overflow-hidden transition",
        isDone ? "border-emerald-200" : "border-border",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-bg-muted/50 transition"
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            markMut.mutate();
          }}
          role="button"
          aria-label={isDone ? "Marcar como pendiente" : "Marcar como completada"}
          className={cn(
            "mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition shrink-0 cursor-pointer",
            isDone
              ? "bg-emerald-500 border-emerald-500"
              : "border-border hover:border-primary bg-surface",
          )}
        >
          {isDone ? (
            <Check size={14} className="text-white" />
          ) : (
            <span className="text-[10px] font-bold text-text-muted">{index}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "text-sm font-bold",
              isDone ? "text-text-muted line-through" : "text-text",
            )}
          >
            {lesson.title}
          </div>
          {lesson.description && (
            <div className="text-[12px] text-text-muted mt-0.5 line-clamp-2">
              {lesson.description}
            </div>
          )}
        </div>
        {open ? (
          <ChevronDown size={16} className="text-text-muted shrink-0 mt-1" />
        ) : (
          <ChevronRight size={16} className="text-text-muted shrink-0 mt-1" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border bg-bg-muted/20">
          <LessonMarkdown content={lesson.content_md} />
          <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
            {lesson.link && (
              <Link
                href={lesson.link}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline"
              >
                Abrir dashboard <ExternalLink size={11} />
              </Link>
            )}
            <button
              onClick={() => markMut.mutate()}
              disabled={markMut.isPending}
              className={cn(
                "ml-auto text-[12px] font-semibold rounded-full px-3 py-1.5 inline-flex items-center gap-1.5 transition",
                isDone
                  ? "bg-bg-muted hover:bg-bg-muted/80 text-text"
                  : "bg-primary text-white hover:opacity-90",
              )}
            >
              {isDone ? "Marcar como pendiente" : (
                <>
                  <Check size={12} /> Marcar como completada
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
