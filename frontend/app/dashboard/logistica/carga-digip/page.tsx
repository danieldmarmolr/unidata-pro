"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtArDateTime } from "@/lib/dates";
import { Topbar } from "@/components/topbar";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type Fuente = "TN" | "TN_UNI" | "MELI_DB" | "MELI_API";

type MeliDbModoLote =
  | "TODOS"
  | "SOLO_INDIVIDUALES"
  | "SOLO_LOTES"
  | "SOLO_LOTES_FLEX"
  | "SOLO_LOTES_PR";

interface RunConfig {
  fuentes: Fuente[];
  dry_run: boolean;
  pedido_tipo: "TODOS" | "LOTE" | "INDIV";
  tipo_envio: "TODOS" | "FLEX" | "PR";
  fecha_meli: string;
  fecha_desde: string;
  tn_uni_despacho: ("RETIRA" | "OTROS")[];
  meli_db_modo_lote: MeliDbModoLote;
}

interface Run {
  id: number;
  run_id: string;
  fuentes: string[];
  pedido_tipo: string;
  tipo_envio: string;
  dry_run: boolean;
  status: "running" | "done" | "error";
  creados: number;
  ya_existian: number;
  omitidos: number;
  errores: number;
  duracion_seg: number | null;
  logs: string;
  started_at: string;
  finished_at: string | null;
  started_by_email: string | null;
  is_active?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const FUENTES: { key: Fuente; label: string; desc: string }[] = [
  { key: "TN",       label: "TN DB",   desc: "TiendaNube Unidrop (RDS)" },
  { key: "TN_UNI",  label: "TN UNI",  desc: "TiendaNube Unistore (API)" },
  { key: "MELI_DB", label: "MELI DB", desc: "Mercado Libre Unidrop (RDS)" },
  { key: "MELI_API",label: "MELI API",desc: "Mercado Libre Fox (API directa)" },
];

const FUENTE_CHIP: Record<Fuente, string> = {
  TN:       "bg-blue-50 text-blue-700 border-blue-200",
  TN_UNI:   "bg-cyan-50 text-cyan-700 border-cyan-200",
  MELI_DB:  "bg-yellow-50 text-yellow-700 border-yellow-200",
  MELI_API: "bg-orange-50 text-orange-700 border-orange-200",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
      {children}
    </p>
  );
}

function StatusBadge({ status }: { status: Run["status"] }) {
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        <Loader2 size={10} className="animate-spin" /> Ejecutando
      </span>
    );
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
        <CheckCircle2 size={10} /> Completado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
      <XCircle size={10} /> Error
    </span>
  );
}

function DryBadge({ dry_run }: { dry_run: boolean }) {
  return dry_run ? (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
      DRY
    </span>
  ) : (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
      PROD
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────

export default function CargaDigipPage() {
  const [config, setConfig] = useState<RunConfig>({
    fuentes:           ["TN_UNI"],
    dry_run:           true,
    pedido_tipo:       "TODOS",
    tipo_envio:        "TODOS",
    fecha_meli:        "",
    fecha_desde:       "",
    tn_uni_despacho:   [],
    meli_db_modo_lote: "TODOS",
  });
  const [runs,          setRuns]          = useState<Run[]>([]);
  const [activeRunId,   setActiveRunId]   = useState<string | null>(null);
  const [activeRun,     setActiveRun]     = useState<Run | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [showAdvanced,  setShowAdvanced]  = useState(false);
  const [showMeliDbAdv, setShowMeliDbAdv] = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

  const hasMeli = config.fuentes.some((f) => f === "MELI_DB" || f === "MELI_API");

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: Run[]; active_run_id: string | null }>(
        "/api/logistica/carga/runs"
      );
      setRuns(data.items);
      if (data.active_run_id) setActiveRunId(data.active_run_id);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando historial");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!activeRunId) return;
    const interval = setInterval(async () => {
      try {
        const run = await api<Run>(`/api/logistica/carga/runs/${activeRunId}`);
        setActiveRun(run);
        if (run.status !== "running") {
          setActiveRunId(null);
          setSubmitting(false);
          setRuns((prev) => [run, ...prev.filter((r) => r.run_id !== run.run_id)]);
        }
      } catch {
        // silenciar errores de polling
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeRunId]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [activeRun?.logs]);

  async function triggerRun(forceDryRun?: boolean) {
    setError(null);
    if (config.fuentes.length === 0) {
      setError("Seleccioná al menos una fuente.");
      return;
    }
    setSubmitting(true);
    setActiveRun(null);
    try {
      const body: any = {
        fuentes:     config.fuentes,
        dry_run:     forceDryRun !== undefined ? forceDryRun : config.dry_run,
        pedido_tipo: config.pedido_tipo,
        tipo_envio:  config.tipo_envio,
      };
      if (config.fecha_meli)             body.fecha_meli        = config.fecha_meli;
      if (config.fecha_desde)            body.fecha_desde       = config.fecha_desde;
      if (config.tn_uni_despacho?.length) body.tn_uni_despacho  = config.tn_uni_despacho;
      if (config.meli_db_modo_lote && config.meli_db_modo_lote !== "TODOS") {
        body.meli_db_modo_lote = config.meli_db_modo_lote;
      }

      const res = await api<{ run_id: string; status: string }>(
        "/api/logistica/carga/run",
        { method: "POST", body: JSON.stringify(body) }
      );
      setActiveRunId(res.run_id);
    } catch (e: any) {
      setError(e?.message ?? "Error al iniciar el run");
      setSubmitting(false);
    }
  }

  function toggleFuente(f: Fuente) {
    setConfig((c) => ({
      ...c,
      fuentes: c.fuentes.includes(f) ? c.fuentes.filter((x) => x !== f) : [...c.fuentes, f],
    }));
  }

  const isRunning = submitting || !!activeRunId;

  return (
    <>
      <Topbar
        title="Carga DigiP"
        subtitle="Carga unificada de pedidos hacia DigiPWMS — TN · TN_UNI · MELI_DB · MELI_API"
        hidePeriod
      />

      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="max-w-4xl space-y-5">

          {/* Error global */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-error text-sm">
              <AlertTriangle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {/* ── Panel de configuración ─────────────────────────────── */}
          <div className="bg-surface border border-border rounded-xl p-6 space-y-6">

            {/* Fuentes */}
            <div>
              <SectionLabel>Fuentes de datos</SectionLabel>
              <div className="space-y-2">
                {FUENTES.map(({ key, label, desc }) => {
                  const checked = config.fuentes.includes(key);
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition select-none",
                        checked
                          ? FUENTE_CHIP[key]
                          : "border-border text-text-muted hover:bg-soft",
                        isRunning && "opacity-50 pointer-events-none"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => !isRunning && toggleFuente(key)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="font-semibold text-sm w-20 shrink-0">{label}</span>
                      <span className="text-sm">{desc}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Opciones MELI (solo si hay fuente ML seleccionada) */}
            {hasMeli && (
              <div>
                <SectionLabel>Opciones MELI</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">Tipo de envío</label>
                    <div className="flex gap-2">
                      {(["TODOS", "FLEX", "PR"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => !isRunning && setConfig((c) => ({ ...c, tipo_envio: v }))}
                          disabled={isRunning}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition",
                            config.tipo_envio === v
                              ? "bg-primary/10 text-primary border-primary/30"
                              : "border-border text-text-muted hover:bg-soft",
                            isRunning && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">Fecha MELI</label>
                    <input
                      type="date"
                      value={config.fecha_meli}
                      onChange={(e) => setConfig((c) => ({ ...c, fecha_meli: e.target.value }))}
                      disabled={isRunning}
                      className="w-full px-3 py-2 rounded-lg text-sm border border-border text-text bg-surface disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">Fecha desde (MELI_DB)</label>
                    <input
                      type="date"
                      value={config.fecha_desde}
                      onChange={(e) => setConfig((c) => ({ ...c, fecha_desde: e.target.value }))}
                      disabled={isRunning}
                      className="w-full px-3 py-2 rounded-lg text-sm border border-border text-text bg-surface disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Qué cargar */}
            <div>
              <SectionLabel>Qué cargar</SectionLabel>
              <div className="flex gap-2">
                {(["TODOS", "LOTE", "INDIV"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => !isRunning && setConfig((c) => ({ ...c, pedido_tipo: v }))}
                    disabled={isRunning}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-semibold border transition",
                      config.pedido_tipo === v
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "border-border text-text-muted hover:bg-soft",
                      isRunning && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* DRY-RUN toggle */}
            <div>
              <SectionLabel>Modo de ejecución</SectionLabel>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => !isRunning && setConfig((c) => ({ ...c, dry_run: !c.dry_run }))}
                  disabled={isRunning}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-colors border-2",
                    config.dry_run
                      ? "bg-amber-100 border-amber-300"
                      : "bg-red-100 border-red-300",
                    isRunning && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform shadow-sm",
                      config.dry_run ? "translate-x-0 bg-amber-500" : "translate-x-5 bg-red-500"
                    )}
                  />
                </button>
                <span className={cn(
                  "text-sm font-semibold",
                  config.dry_run ? "text-amber-600" : "text-red-600"
                )}>
                  {config.dry_run ? "DRY-RUN activado" : "PRODUCCIÓN"}
                </span>
              </div>
              {!config.dry_run && (
                <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  Los pedidos se enviarán realmente a DigiPWMS. No se puede deshacer.
                </div>
              )}
            </div>

            {/* Opciones avanzadas */}
            {config.fuentes.includes("TN_UNI") && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition"
                >
                  {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Opciones TN_UNI
                </button>
                {showAdvanced && (
                  <div className="mt-3">
                    <label className="text-xs text-text-muted mb-2 block">Tipo de despacho</label>
                    <div className="flex gap-2">
                      {(["RETIRA", "OTROS"] as const).map((d) => {
                        const active = config.tn_uni_despacho.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() =>
                              !isRunning &&
                              setConfig((c) => ({
                                ...c,
                                tn_uni_despacho: active
                                  ? c.tn_uni_despacho.filter((x) => x !== d)
                                  : [...c.tn_uni_despacho, d],
                              }))
                            }
                            disabled={isRunning}
                            className={cn(
                              "px-3 py-2 rounded-lg text-xs font-semibold border transition",
                              active
                                ? "bg-primary/10 text-primary border-primary/30"
                                : "border-border text-text-muted hover:bg-soft",
                              isRunning && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Opciones MELI_DB */}
            {config.fuentes.includes("MELI_DB") && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowMeliDbAdv((v) => !v)}
                  className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition"
                >
                  {showMeliDbAdv ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Opciones MELI_DB
                </button>
                {showMeliDbAdv && (
                  <div className="mt-3">
                    <label className="text-xs text-text-muted mb-2 block">Modo de carga</label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { v: "TODOS",              l: "Todos" },
                          { v: "SOLO_INDIVIDUALES",  l: "Solo individuales" },
                          { v: "SOLO_LOTES",         l: "Solo lotes" },
                          { v: "SOLO_LOTES_FLEX",    l: "Solo lotes FLEX" },
                          { v: "SOLO_LOTES_PR",      l: "Solo lotes PR" },
                        ] as { v: MeliDbModoLote; l: string }[]
                      ).map(({ v, l }) => {
                        const active = config.meli_db_modo_lote === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() =>
                              !isRunning && setConfig((c) => ({ ...c, meli_db_modo_lote: v }))
                            }
                            disabled={isRunning}
                            className={cn(
                              "px-3 py-2 rounded-lg text-xs font-semibold border transition",
                              active
                                ? "bg-primary/10 text-primary border-primary/30"
                                : "border-border text-text-muted hover:bg-soft",
                              isRunning && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            {l}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-text-muted mt-2">
                      Filtra qué armar antes de mandar a DigiP. El loteado siempre usa{" "}
                      <code>UDMELI&#123;DDMM&#125;&#123;TIPO&#125;&#123;N&#125;</code> con contador secuencial.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Botones de acción ──────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => triggerRun(true)}
              disabled={isRunning}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold border transition",
                "border-border text-text-muted bg-surface hover:bg-soft",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Ver pendientes
            </button>

            <button
              type="button"
              onClick={() => triggerRun(config.dry_run)}
              disabled={isRunning}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold transition",
                config.dry_run
                  ? "bg-amber-500 hover:bg-amber-400 text-white"
                  : "bg-red-600 hover:bg-red-500 text-white",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              {isRunning ? (
                <><Loader2 size={14} className="animate-spin" /> Ejecutando...</>
              ) : (
                <><Play size={14} /> {config.dry_run ? "DRY-RUN" : "Cargar ahora"}</>
              )}
            </button>
          </div>

          {/* ── Run activo / resultado ─────────────────────────────── */}
          {(isRunning || activeRun) && (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-soft">
                <div className="flex items-center gap-3">
                  <Terminal size={14} className="text-text-muted" />
                  <span className="text-sm font-semibold text-text">
                    {activeRunId ? "Run en progreso..." : "Resultado"}
                  </span>
                  {activeRun && <StatusBadge status={activeRun.status} />}
                  {activeRun && <DryBadge dry_run={activeRun.dry_run} />}
                </div>
                {activeRun && !activeRunId && (
                  <div className="flex gap-4 text-xs text-text-muted">
                    <span className="font-semibold text-green-600">{activeRun.creados} creados</span>
                    <span>{activeRun.ya_existian} ya existían</span>
                    <span className="text-amber-600">{activeRun.omitidos} omitidos</span>
                    {activeRun.errores > 0 && (
                      <span className="font-semibold text-red-600">{activeRun.errores} errores</span>
                    )}
                    {activeRun.duracion_seg && (
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {activeRun.duracion_seg.toFixed(1)}s
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4">
                {activeRunId && !activeRun?.logs && (
                  <div className="flex items-center gap-2 text-text-muted text-xs py-6 justify-center">
                    <Loader2 size={14} className="animate-spin" />
                    Esperando logs...
                  </div>
                )}
                {activeRun?.logs && (
                  <pre
                    ref={logsRef}
                    className="bg-neutral-950 rounded-lg p-4 text-xs font-mono text-green-400 overflow-auto max-h-80 whitespace-pre-wrap leading-5"
                  >
                    {activeRun.logs}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* ── Historial ─────────────────────────────────────────── */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="text-sm font-semibold text-text">Historial de runs</span>
              <button
                onClick={loadRuns}
                disabled={loading}
                className="text-text-muted hover:text-text transition"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>
            </div>

            {runs.length === 0 ? (
              <p className="text-center text-text-muted text-sm py-10">Sin runs registrados</p>
            ) : (
              <div className="divide-y divide-border">
                {runs.map((run) => {
                  const expanded = expandedRunId === run.run_id;
                  return (
                    <div key={run.run_id}>
                      <button
                        type="button"
                        onClick={() => setExpandedRunId(expanded ? null : run.run_id)}
                        className="w-full text-left px-5 py-3 hover:bg-soft transition"
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <ChevronDown
                            size={12}
                            className={cn(
                              "shrink-0 text-text-muted transition-transform",
                              !expanded && "-rotate-90"
                            )}
                          />
                          <StatusBadge status={run.status} />
                          <DryBadge dry_run={run.dry_run} />
                          <div className="flex gap-1 flex-wrap">
                            {run.fuentes.map((f) => (
                              <span
                                key={f}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-semibold border",
                                  FUENTE_CHIP[f as Fuente] ?? "bg-soft text-text-muted border-border"
                                )}
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                          <span className="text-text-muted text-xs ml-auto">
                            {run.started_at ? fmtArDateTime(run.started_at) : "—"}
                          </span>
                          <div className="flex gap-3 text-xs">
                            <span className="text-green-600 font-semibold">{run.creados}↑</span>
                            <span className="text-text-muted">{run.ya_existian}=</span>
                            {run.errores > 0 && (
                              <span className="text-red-600 font-semibold">{run.errores}!</span>
                            )}
                            {run.duracion_seg != null && (
                              <span className="text-text-muted">{run.duracion_seg.toFixed(0)}s</span>
                            )}
                          </div>
                        </div>
                      </button>
                      {expanded && run.logs && (
                        <div className="px-5 pb-4">
                          <pre className="bg-neutral-950 rounded-lg p-4 text-xs font-mono text-green-400 overflow-auto max-h-64 whitespace-pre-wrap leading-5">
                            {run.logs}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
