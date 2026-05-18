"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn, fmtArDateTime } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  XCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

type Fuente = "TN" | "TN_UNI" | "MELI_DB" | "MELI_API";

interface RunConfig {
  fuentes: Fuente[];
  dry_run: boolean;
  pedido_tipo: "TODOS" | "LOTE" | "INDIV";
  tipo_envio: "TODOS" | "FLEX" | "PR";
  fecha_meli: string;
  fecha_desde: string;
  tn_uni_despacho: ("RETIRA" | "OTROS")[];
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

const FUENTE_LABELS: Record<Fuente, string> = {
  TN:       "TN (Unidrop RDS)",
  TN_UNI:   "TN UNI (Unistore API)",
  MELI_DB:  "MELI DB (Unidrop RDS)",
  MELI_API: "MELI API (Fox ML)",
};

const FUENTE_COLORS: Record<Fuente, string> = {
  TN:       "bg-blue-500/15 text-blue-300 border-blue-500/30",
  TN_UNI:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  MELI_DB:  "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  MELI_API: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

function StatusBadge({ status }: { status: Run["status"] }) {
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
        <Loader2 size={10} className="animate-spin" /> Ejecutando
      </span>
    );
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-300 border border-green-500/30">
        <CheckCircle2 size={10} /> Completado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30">
      <XCircle size={10} /> Error
    </span>
  );
}

function DryBadge({ dry_run }: { dry_run: boolean }) {
  return dry_run ? (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
      DRY
    </span>
  ) : (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">
      PROD
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────────

export default function CargaDigipPage() {
  const [config, setConfig] = useState<RunConfig>({
    fuentes:         ["TN_UNI"],
    dry_run:         true,
    pedido_tipo:     "TODOS",
    tipo_envio:      "TODOS",
    fecha_meli:      "",
    fecha_desde:     "",
    tn_uni_despacho: [],
  });
  const [runs,          setRuns]          = useState<Run[]>([]);
  const [activeRunId,   setActiveRunId]   = useState<string | null>(null);
  const [activeRun,     setActiveRun]     = useState<Run | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [showAdvanced,  setShowAdvanced]  = useState(false);
  const logsRef = useRef<HTMLPreElement>(null);

  // Cargar historial inicial
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

  // Polling del run activo
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
        // ignorar errores de polling
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeRunId]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [activeRun?.logs]);

  // Trigger run
  async function handleRun() {
    setError(null);
    if (config.fuentes.length === 0) {
      setError("Seleccioná al menos una fuente.");
      return;
    }
    setSubmitting(true);
    try {
      const body: any = {
        fuentes:     config.fuentes,
        dry_run:     config.dry_run,
        pedido_tipo: config.pedido_tipo,
        tipo_envio:  config.tipo_envio,
      };
      if (config.fecha_meli)        body.fecha_meli        = config.fecha_meli;
      if (config.fecha_desde)       body.fecha_desde       = config.fecha_desde;
      if (config.tn_uni_despacho?.length) body.tn_uni_despacho = config.tn_uni_despacho;

      const res = await api<{ run_id: string; status: string }>(
        "/api/logistica/carga/run",
        { method: "POST", body: JSON.stringify(body) }
      );
      setActiveRunId(res.run_id);
      setActiveRun(null);
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Carga DigiP</h1>
        <p className="text-white/50 text-sm mt-1">
          Carga unificada de pedidos hacia DigiPWMS — TN · TN_UNI · MELI_DB · MELI_API
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Panel de configuración */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2 text-white font-semibold">
          <Settings2 size={16} />
          Configuración del run
        </div>

        {/* Fuentes */}
        <div>
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">
            Fuentes
          </label>
          <div className="flex flex-wrap gap-2">
            {(["TN", "TN_UNI", "MELI_DB", "MELI_API"] as Fuente[]).map((f) => {
              const active = config.fuentes.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => !isRunning && toggleFuente(f)}
                  disabled={isRunning}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition",
                    active
                      ? FUENTE_COLORS[f]
                      : "bg-white/5 text-white/40 border-white/10 hover:bg-white/10",
                    isRunning && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        {/* Controles principales */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* DRY-RUN */}
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">
              Modo
            </label>
            <button
              type="button"
              onClick={() => !isRunning && setConfig((c) => ({ ...c, dry_run: !c.dry_run }))}
              disabled={isRunning}
              className={cn(
                "w-full px-3 py-2 rounded-lg text-sm font-semibold border transition",
                config.dry_run
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-red-500/15 text-red-300 border-red-500/30",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              {config.dry_run ? "DRY-RUN" : "PRODUCCIÓN"}
            </button>
          </div>

          {/* Tipo pedido */}
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">
              Tipo pedido
            </label>
            <select
              value={config.pedido_tipo}
              onChange={(e) =>
                setConfig((c) => ({ ...c, pedido_tipo: e.target.value as any }))
              }
              disabled={isRunning}
              className="w-full px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white disabled:opacity-50"
            >
              <option value="TODOS">TODOS</option>
              <option value="LOTE">LOTE</option>
              <option value="INDIV">INDIV</option>
            </select>
          </div>

          {/* Tipo envío */}
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2 block">
              Tipo envío
            </label>
            <select
              value={config.tipo_envio}
              onChange={(e) =>
                setConfig((c) => ({ ...c, tipo_envio: e.target.value as any }))
              }
              disabled={isRunning}
              className="w-full px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white disabled:opacity-50"
            >
              <option value="TODOS">TODOS</option>
              <option value="FLEX">FLEX</option>
              <option value="PR">PR</option>
            </select>
          </div>

          {/* Botón ejecutar */}
          <div className="flex flex-col justify-end">
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning}
              className={cn(
                "flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition",
                config.dry_run
                  ? "bg-amber-500 hover:bg-amber-400 text-black"
                  : "bg-red-600 hover:bg-red-500 text-white",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              {isRunning ? (
                <><Loader2 size={14} className="animate-spin" /> Ejecutando...</>
              ) : (
                <><Play size={14} /> {config.dry_run ? "DRY-RUN" : "EJECUTAR"}</>
              )}
            </button>
          </div>
        </div>

        {/* Opciones avanzadas */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition"
          >
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Opciones avanzadas
          </button>
          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-white/50 mb-1 block">
                  Fecha MELI (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  value={config.fecha_meli}
                  onChange={(e) => setConfig((c) => ({ ...c, fecha_meli: e.target.value }))}
                  disabled={isRunning}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">
                  Fecha desde MELI_DB
                </label>
                <input
                  type="date"
                  value={config.fecha_desde}
                  onChange={(e) => setConfig((c) => ({ ...c, fecha_desde: e.target.value }))}
                  disabled={isRunning}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-white disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs text-white/50 mb-1 block">
                  TN_UNI despachos
                </label>
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
                          "px-3 py-2 rounded-lg text-xs font-medium border transition",
                          active
                            ? "bg-purple-500/15 text-purple-300 border-purple-500/30"
                            : "bg-white/5 text-white/40 border-white/10"
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Run activo */}
      {(isRunning || activeRun) && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeRunId ? (
                <Loader2 size={16} className="animate-spin text-blue-400" />
              ) : (
                <CheckCircle2 size={16} className={activeRun?.status === "done" ? "text-green-400" : "text-red-400"} />
              )}
              <span className="font-semibold text-white text-sm">
                {activeRunId ? "Run en progreso..." : "Resultado del último run"}
              </span>
              {activeRun && <StatusBadge status={activeRun.status} />}
            </div>
            {activeRun && !activeRunId && (
              <div className="flex gap-4 text-sm">
                <span className="text-green-400 font-bold">{activeRun.creados} creados</span>
                <span className="text-white/40">{activeRun.ya_existian} ya existían</span>
                <span className="text-yellow-400">{activeRun.omitidos} omitidos</span>
                {activeRun.errores > 0 && (
                  <span className="text-red-400 font-bold">{activeRun.errores} errores</span>
                )}
              </div>
            )}
          </div>

          {activeRunId && !activeRun?.logs && (
            <p className="text-white/40 text-xs">Los logs aparecerán al finalizar el run...</p>
          )}

          {activeRun?.logs && (
            <pre
              ref={logsRef}
              className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-green-300 overflow-auto max-h-80 whitespace-pre-wrap leading-5"
            >
              {activeRun.logs}
            </pre>
          )}

          {activeRun?.duracion_seg && (
            <p className="text-white/30 text-xs flex items-center gap-1">
              <Clock size={10} />
              Duración: {activeRun.duracion_seg.toFixed(1)}s
            </p>
          )}
        </div>
      )}

      {/* Historial */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <span className="font-semibold text-white text-sm">Historial de runs</span>
          <button
            onClick={loadRuns}
            disabled={loading}
            className="text-white/40 hover:text-white/80 transition"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {runs.length === 0 ? (
          <p className="text-center text-white/30 text-sm py-10">Sin runs registrados</p>
        ) : (
          <div className="divide-y divide-white/5">
            {runs.map((run) => {
              const expanded = expandedRunId === run.run_id;
              return (
                <div key={run.run_id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRunId(expanded ? null : run.run_id)
                    }
                    className="w-full text-left px-5 py-3 hover:bg-white/5 transition"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <ChevronDown
                        size={12}
                        className={cn(
                          "shrink-0 text-white/40 transition-transform",
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
                              FUENTE_COLORS[f as Fuente] ?? "bg-white/10 text-white/50 border-white/10"
                            )}
                          >
                            {f}
                          </span>
                        ))}
                      </div>
                      <span className="text-white/30 text-xs ml-auto">
                        {run.started_at ? fmtArDateTime(run.started_at) : "—"}
                      </span>
                      <div className="flex gap-3 text-xs">
                        <span className="text-green-400 font-semibold">{run.creados}↑</span>
                        <span className="text-white/30">{run.ya_existian}=</span>
                        {run.errores > 0 && (
                          <span className="text-red-400 font-semibold">{run.errores}!</span>
                        )}
                        {run.duracion_seg && (
                          <span className="text-white/20">{run.duracion_seg.toFixed(0)}s</span>
                        )}
                      </div>
                    </div>
                  </button>
                  {expanded && run.logs && (
                    <div className="px-5 pb-4">
                      <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono text-green-300 overflow-auto max-h-64 whitespace-pre-wrap leading-5">
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
  );
}
