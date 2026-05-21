"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Lightbulb, Loader2, Plus, X } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs, fmtDate } from "../_components/helpers";

type Sugerencia = {
  descripcion: string; proveedor_id: number | null; proveedor_nombre: string | null;
  ocurrencias: number; primer_pago: string; ultimo_pago: string;
  monto_promedio: number; monto_min: number; monto_max: number;
  varianza_pct: number; intervalo_medio_dias: number; frecuencia_sugerida: string;
};

const FREQ_COLOR: Record<string, string> = {
  semanal: "bg-blue-100 text-blue-700",
  quincenal: "bg-indigo-100 text-indigo-700",
  mensual: "bg-emerald-100 text-emerald-700",
  trimestral: "bg-amber-100 text-amber-700",
  anual: "bg-purple-100 text-purple-700",
  custom: "bg-slate-100 text-slate-700",
};

export default function SugerenciasPage() {
  const q = useQuery<{ items: Sugerencia[]; count: number }>({
    queryKey: ["ff", "sugerencias"],
    queryFn: () => api("/api/flujo-fondos/sugerencias"),
  });

  const [crearFor, setCrearFor] = useState<Sugerencia | null>(null);

  return (
    <PageWrapper>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
        <Lightbulb size={18} className="text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          El detector busca <strong>pagos repetidos 3+ veces</strong> al mismo proveedor con la misma descripcion, varianza de monto &lt; 40%. Sugiere frecuencia automaticamente segun el intervalo medio entre pagos.
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? (
        <EmptyState label="No se detectaron patrones repetidos en los ultimos 12 meses ✓" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {q.data?.items.map((s, i) => (
            <div key={`${s.descripcion}-${s.proveedor_id}-${i}`} className="rounded-xl border border-border bg-surface p-4 hover:border-primary/40 transition">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-text truncate" title={s.descripcion}>{s.descripcion}</div>
                  {s.proveedor_nombre && <div className="text-xs text-text-muted mt-0.5">→ {s.proveedor_nombre}</div>}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${FREQ_COLOR[s.frecuencia_sugerida] ?? FREQ_COLOR.custom}`}>{s.frecuencia_sugerida}</span>
                  <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">{s.ocurrencias} pagos</span>
                </div>
              </div>

              <button onClick={() => setCrearFor(s)} className="mb-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-md hover:opacity-90"><Plus size={12} /> Crear recurrencia</button>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-soft rounded p-2">
                  <div className="text-[10px] uppercase font-bold text-text-muted">Monto promedio</div>
                  <div className="font-bold text-text mt-0.5">{fmtArs(s.monto_promedio)}</div>
                  <div className="text-[10px] text-text-muted">±{s.varianza_pct}% varianza</div>
                </div>
                <div className="bg-soft rounded p-2">
                  <div className="text-[10px] uppercase font-bold text-text-muted">Intervalo medio</div>
                  <div className="font-bold text-text mt-0.5">{s.intervalo_medio_dias} dias</div>
                  <div className="text-[10px] text-text-muted">{s.frecuencia_sugerida}</div>
                </div>
                <div className="bg-soft rounded p-2">
                  <div className="text-[10px] uppercase font-bold text-text-muted">Primer pago</div>
                  <div className="font-bold text-text mt-0.5">{fmtDate(s.primer_pago)}</div>
                </div>
                <div className="bg-soft rounded p-2">
                  <div className="text-[10px] uppercase font-bold text-text-muted">Ultimo pago</div>
                  <div className="font-bold text-text mt-0.5">{fmtDate(s.ultimo_pago)}</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-text-muted">
                Rango montos: {fmtArs(s.monto_min)} → {fmtArs(s.monto_max)}
              </div>
            </div>
          ))}
        </div>
      )}

      {crearFor && <CrearRecurrenciaModal sugerencia={crearFor} onClose={() => setCrearFor(null)} />}
    </PageWrapper>
  );
}

function CrearRecurrenciaModal({ sugerencia, onClose }: { sugerencia: Sugerencia; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    descripcion: sugerencia.descripcion,
    monto_base: sugerencia.monto_promedio.toString(),
    frecuencia: sugerencia.frecuencia_sugerida === "custom" ? "mensual" : sugerencia.frecuencia_sugerida,
    fecha_inicio: new Date().toISOString().slice(0, 10),
    proveedor_id: sugerencia.proveedor_id?.toString() ?? "",
  });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/flujo-fondos/recurrencias", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ff", "recurrencias"] });
      qc.invalidateQueries({ queryKey: ["ff", "sugerencias"] });
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold">Crear recurrencia desde sugerencia</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {
            descripcion: form.descripcion.trim(),
            monto_base: Number(form.monto_base),
            frecuencia: form.frecuencia,
            fecha_inicio: form.fecha_inicio,
            activa: true,
          };
          if (form.proveedor_id) body.proveedor_id = Number(form.proveedor_id);
          m.mutate(body);
        }} className="p-5 space-y-3">
          <div className="text-xs text-text-muted bg-soft p-2 rounded">
            ℹ️ Despues de crear la recurrencia, podes "Generar 90 dias" para crear las erogaciones futuras automaticamente.
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Descripcion *</label><input required value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Monto base *</label><input required type="number" step="0.01" value={form.monto_base} onChange={(e) => setForm({ ...form, monto_base: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
            <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Frecuencia *</label><select value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">
              <option value="semanal">semanal</option>
              <option value="quincenal">quincenal</option>
              <option value="mensual">mensual</option>
              <option value="trimestral">trimestral</option>
              <option value="anual">anual</option>
              <option value="custom">custom</option>
            </select></div>
          </div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha inicio *</label><input required type="date" value={form.fecha_inicio} onChange={(e) => setForm({ ...form, fecha_inicio: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">{m.isPending && <Loader2 size={12} className="animate-spin" />}Crear recurrencia</button>
          </div>
        </form>
      </div>
    </div>
  );
}
