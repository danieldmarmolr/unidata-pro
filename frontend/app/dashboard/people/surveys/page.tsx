"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Plus, X, Eye } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { api, getUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PulseSurvey, SurveyResults } from "@/components/people/hr-types";

export default function SurveysPage() {
  const me = getUser();
  const canManage = !!me?.is_admin || me?.role === "admin" || me?.role === "gerencia" || me?.area_slug === "people";
  const [createOpen, setCreateOpen] = useState(false);
  const [resultsFor, setResultsFor] = useState<number | null>(null);

  const activeQ = useQuery<{ items: PulseSurvey[] }>({
    queryKey: ["surveys-active"],
    queryFn: () => api("/api/people/surveys/active"),
    staleTime: 30_000,
  });

  const allQ = useQuery<{ items: PulseSurvey[] }>({
    queryKey: ["surveys-all"],
    queryFn: () => api("/api/people/surveys"),
    enabled: canManage,
    staleTime: 60_000,
  });

  return (
    <>
      <Topbar
        title="Encuestas"
        subtitle={canManage ? "Pulse + eNPS - crear, ver respuestas, cerrar" : "Tus encuestas pendientes"}
      />
      <div className="flex-1 px-4 lg:px-6 py-4 overflow-y-auto">
        <div className="max-w-3xl mx-auto space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <button
                onClick={() => setCreateOpen(true)}
                className="text-sm px-3 py-1.5 bg-primary text-white rounded-full hover:opacity-90 inline-flex items-center gap-1.5"
              >
                <Plus size={14} /> Nueva encuesta
              </button>
            </div>
          )}

          {/* Activas pendientes para mi */}
          <Section title={`Para responder (${(activeQ.data?.items ?? []).filter((s) => !s.has_responded).length})`}>
            {activeQ.data?.items?.filter((s) => !s.has_responded).map((s) => (
              <SurveyResponder key={s.id} survey={s} />
            ))}
            {(activeQ.data?.items?.filter((s) => !s.has_responded).length ?? 0) === 0 && (
              <div className="px-3 py-6 text-center text-text-muted text-xs">Nada pendiente. Todo al dia.</div>
            )}
          </Section>

          {/* Ya respondidas */}
          {(activeQ.data?.items?.filter((s) => s.has_responded).length ?? 0) > 0 && (
            <Section title="Ya respondidas">
              {activeQ.data!.items.filter((s) => s.has_responded).map((s) => (
                <div key={s.id} className="px-4 py-2.5 border-b border-border last:border-b-0 flex items-center gap-2 opacity-60">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  <span className="text-sm font-semibold flex-1 truncate">{s.question}</span>
                  <span className="text-[10px] text-text-muted">{s.kind}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Admin: todas las encuestas */}
          {canManage && allQ.data?.items && (
            <Section title={`Todas (admin) - ${allQ.data.items.length}`}>
              {allQ.data.items.map((s) => (
                <div key={s.id} className="px-4 py-3 border-b border-border last:border-b-0 flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: s.is_active ? "#10b98115" : "#94a3b815",
                      color: s.is_active ? "#10b981" : "#94a3b8",
                    }}
                  >
                    {s.is_active ? "Activa" : "Cerrada"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{s.question}</div>
                    <div className="text-[10px] text-text-muted">
                      {s.kind} · {s.scale} · {s.response_count ?? 0} respuestas
                    </div>
                  </div>
                  <button
                    onClick={() => setResultsFor(s.id)}
                    className="text-xs px-2 py-1 hover:bg-bg-muted rounded inline-flex items-center gap-1"
                  >
                    <Eye size={11} /> Ver
                  </button>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>

      {createOpen && <CreateSurveyModal onClose={() => setCreateOpen(false)} />}
      {resultsFor && <ResultsModal surveyId={resultsFor} onClose={() => setResultsFor(null)} />}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-bg-muted/50 border-b border-border text-[11px] uppercase tracking-wider font-bold text-text-muted">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SurveyResponder({ survey }: { survey: PulseSurvey }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<number | null>(null);
  const [textValue, setTextValue] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      api(`/api/people/surveys/${survey.id}/respond`, {
        method: "POST",
        body: JSON.stringify({ value, text_value: textValue, comment }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["surveys-active"] });
    },
  });

  const range = survey.scale === "1-5" ? [1, 2, 3, 4, 5]
              : survey.scale === "1-10" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
              : survey.scale === "nps" ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
              : null;

  return (
    <div className="px-4 py-4 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 size={14} className="text-primary" />
        <div className="text-sm font-bold flex-1">{survey.question}</div>
        {survey.anonymous && (
          <span className="text-[9px] uppercase tracking-wider font-bold text-text-muted bg-bg-muted px-2 py-0.5 rounded-full">
            Anonimo
          </span>
        )}
      </div>

      {range && (
        <div className="flex gap-1 flex-wrap mb-3">
          {range.map((n) => (
            <button
              key={n}
              onClick={() => setValue(n)}
              className={cn(
                "w-9 h-9 rounded-lg border-2 text-sm font-bold transition tabular-nums",
                value === n
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-text-muted",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {survey.scale === "yes_no" && (
        <div className="flex gap-2 mb-3">
          {["Si", "No"].map((opt) => (
            <button
              key={opt}
              onClick={() => setTextValue(opt)}
              className={cn(
                "px-4 py-2 rounded-lg border text-sm font-semibold transition",
                textValue === opt ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-bg-muted",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {survey.scale === "options" && survey.options.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {survey.options.map((opt) => (
            <button
              key={opt}
              onClick={() => setTextValue(opt)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg border text-sm transition",
                textValue === opt ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-bg-muted",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comentario (opcional)"
        rows={2}
        className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary resize-none mb-2"
      />

      <button
        onClick={() => mut.mutate()}
        disabled={
          mut.isPending ||
          (range && value === null) ||
          (!range && !textValue)
        }
        className="text-xs px-3 py-1.5 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
      >
        {mut.isPending ? "Enviando..." : "Enviar respuesta"}
      </button>
    </div>
  );
}

function CreateSurveyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<PulseSurvey["kind"]>("pulse");
  const [scale, setScale] = useState<PulseSurvey["scale"]>("1-5");
  const [question, setQuestion] = useState("");
  const [opts, setOpts] = useState<string[]>(["", ""]);
  const [anonymous, setAnonymous] = useState(true);

  const mut = useMutation({
    mutationFn: () =>
      api("/api/people/surveys", {
        method: "POST",
        body: JSON.stringify({
          kind, scale, question, anonymous,
          options: scale === "options" ? opts.filter((o) => o.trim()) : undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["surveys-active"] });
      qc.invalidateQueries({ queryKey: ["surveys-all"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface">
          <div className="text-sm font-bold">Nueva encuesta</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Tipo</div>
            <div className="flex gap-1">
              {(["pulse", "enps", "custom"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setKind(k);
                    if (k === "enps") setScale("nps");
                    if (k === "pulse") setScale("1-5");
                  }}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-full border",
                    kind === k ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border hover:bg-bg-muted",
                  )}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Pregunta</div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
              placeholder="Que tan satisfecho estas con tu rol esta semana?"
            />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Escala</div>
            <select
              value={scale}
              onChange={(e) => setScale(e.target.value as PulseSurvey["scale"])}
              className="w-full bg-bg-muted border border-border rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="nps">NPS (0-10)</option>
              <option value="1-5">1 a 5</option>
              <option value="1-10">1 a 10</option>
              <option value="yes_no">Si / No</option>
              <option value="options">Opciones custom</option>
            </select>
          </div>

          {scale === "options" && (
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">Opciones</div>
              {opts.map((o, i) => (
                <div key={i} className="flex gap-2 mb-1.5">
                  <input
                    value={o}
                    onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={`Opcion ${i + 1}`}
                    className="flex-1 bg-bg-muted border border-border rounded px-2 py-1.5 text-xs focus:outline-none"
                  />
                  {opts.length > 2 && (
                    <button onClick={() => setOpts(opts.filter((_, j) => j !== i))} className="text-text-muted">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={() => setOpts([...opts, ""])} className="text-xs text-primary font-semibold">
                <Plus size={11} className="inline" /> Agregar
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-text">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Respuestas anonimas
          </label>
        </div>
        <div className="px-6 py-3 border-t border-border bg-bg-muted/30 flex justify-end gap-2 sticky bottom-0">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-full hover:bg-bg-muted">Cancelar</button>
          <button
            onClick={() => mut.mutate()}
            disabled={!question.trim() || mut.isPending}
            className="text-sm px-4 py-1.5 bg-primary text-white rounded-full hover:opacity-90 disabled:opacity-40"
          >
            {mut.isPending ? "Creando..." : "Crear y publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultsModal({ surveyId, onClose }: { surveyId: number; onClose: () => void }) {
  const { data } = useQuery<SurveyResults>({
    queryKey: ["survey-results", surveyId],
    queryFn: () => api(`/api/people/surveys/${surveyId}/results`),
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface">
          <div className="text-sm font-bold">Resultados</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {!data ? (
          <div className="p-8 text-center text-text-muted text-sm">Cargando...</div>
        ) : (
          <div className="p-5 space-y-3">
            <div className="text-sm font-bold">{data.survey?.question}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Respuestas" value={data.response_count} />
              {data.average !== null && <Stat label="Promedio" value={data.average?.toFixed(1) ?? "—"} />}
              {data.enps !== null && <Stat label="eNPS" value={data.enps ?? "—"} />}
            </div>
            {Object.keys(data.distribution).length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">Distribucion</div>
                <div className="space-y-1.5">
                  {Object.entries(data.distribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => {
                      const pct = data.response_count > 0 ? Math.round((v / data.response_count) * 100) : 0;
                      return (
                        <div key={k} className="text-xs">
                          <div className="flex justify-between">
                            <span className="font-semibold">{k}</span>
                            <span className="text-text-muted tabular-nums">{v} · {pct}%</span>
                          </div>
                          <div className="h-1.5 bg-bg-muted rounded-full overflow-hidden mt-0.5">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
            {data.comments.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                  Comentarios ({data.comments.length})
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {data.comments.map((c, i) => (
                    <div key={i} className="text-xs italic bg-bg-muted/50 rounded p-2">
                      "{c}"
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-bg-muted/50 border border-border rounded-lg p-2">
      <div className="text-lg font-extrabold text-primary">{value}</div>
      <div className="text-[10px] text-text-muted uppercase font-semibold">{label}</div>
    </div>
  );
}
