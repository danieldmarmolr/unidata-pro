"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { LoadingState, ErrorState, Tile } from "../../_components/PageWrapper";
import { fmtArs, fmtDate, ESTADO_LABEL, ESTADO_COLOR } from "../../_components/helpers";

type Ficha = {
  proveedor: { id: number; nombre: string; cuit: string | null; prioridad: string; saldo_pendiente: number | string; notas: string | null; tags: string[]; contacto: Record<string, unknown> };
  stats: { count_pagado: number; monto_promedio: number; lead_time_dias: number | null };
  por_estado: Record<string, { count: number; total: number }>;
  acuerdos_por_estado: Record<string, number>;
  tasa_cumplimiento: number | null;
  erogaciones: { id: number; fecha_pago: string; monto: number; descripcion: string; estado: string; empresa_nombre?: string }[];
  acuerdos: { id: number; tipo: string; compromiso: string; fecha_compromiso: string | null; monto_compromiso: number | null; estado: string; contexto: string | null }[];
};

const PRIORIDAD_COLOR: Record<string, string> = { alta: "bg-rose-100 text-rose-700", media: "bg-amber-100 text-amber-700", baja: "bg-slate-100 text-slate-600" };
const ESTADO_ACUERDO_COLOR: Record<string, string> = { pendiente: "bg-amber-100 text-amber-700", cumplido: "bg-emerald-100 text-emerald-700", incumplido: "bg-rose-100 text-rose-700" };

export default function FichaProveedorPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [tab, setTab] = useState<"general" | "erogaciones" | "acuerdos">("general");

  const q = useQuery<Ficha>({
    queryKey: ["ff", "proveedor-ficha", id],
    queryFn: () => api(`/api/flujo-fondos/proveedores/${id}/ficha`),
    enabled: !Number.isNaN(id),
  });

  if (q.isLoading) return <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6"><LoadingState /></div>;
  if (q.error) return <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6"><ErrorState message={(q.error as Error).message} /></div>;
  if (!q.data) return null;

  const f = q.data;
  const pendiente = f.por_estado.pendiente ?? { count: 0, total: 0 };
  const enCurso = f.por_estado.en_curso ?? { count: 0, total: 0 };
  const pagado = f.por_estado.pagado ?? { count: 0, total: 0 };
  const totalPendiente = pendiente.total + enCurso.total;
  const totalPendienteCount = pendiente.count + enCurso.count;
  const contacto = f.proveedor.contacto as { nombre?: string; email?: string; telefono?: string };

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Proveedor</div>
        <h1 className="text-2xl font-bold text-text">{f.proveedor.nombre}</h1>
        <div className="text-xs text-text-muted">{f.proveedor.cuit ?? "Sin CUIT"}</div>
      </div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-soft text-text-muted">
            <ArrowLeft size={12} /> Volver
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${PRIORIDAD_COLOR[f.proveedor.prioridad] ?? ""}`}>Prioridad {f.proveedor.prioridad}</span>
            {f.proveedor.tags?.map((t) => <span key={t} className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">{t}</span>)}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Total pagado" value={fmtArs(pagado.total)} sub={`${pagado.count} pagos`} color="text-emerald-700" />
          <Tile label="Pendiente / En curso" value={fmtArs(totalPendiente)} sub={`${totalPendienteCount} pagos`} color="text-amber-700" highlight />
          <Tile label="Lead time medio" value={f.stats.lead_time_dias != null ? `${f.stats.lead_time_dias.toFixed(1)} dias` : "—"} sub={`Pago promedio: ${fmtArs(f.stats.monto_promedio)}`} />
          <Tile label="Tasa cumplimiento" value={f.tasa_cumplimiento != null ? `${f.tasa_cumplimiento.toFixed(0)}%` : "—"} sub={`${f.acuerdos_por_estado.cumplido ?? 0} cumplidos / ${(f.acuerdos_por_estado.incumplido ?? 0)} incumplidos`} />
        </div>

        {/* Tabs */}
        <div className="border-b border-border flex gap-1">
          {(["general", "erogaciones", "acuerdos"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 transition capitalize ${tab === t ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}>
              {t} {t === "erogaciones" ? `(${f.erogaciones.length})` : t === "acuerdos" ? `(${f.acuerdos.length})` : ""}
            </button>
          ))}
          <div className="ml-auto flex items-center">
            <Link href={`/dashboard/finanzas/flujo-fondos/acuerdos`} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-white font-semibold hover:opacity-90">
              <Plus size={12} /> Nuevo acuerdo
            </Link>
          </div>
        </div>

        {tab === "general" && (
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Contacto</div>
                {contacto?.nombre && <div className="text-sm text-text">{contacto.nombre}</div>}
                {contacto?.email && <div className="text-xs text-text-muted">{contacto.email}</div>}
                {contacto?.telefono && <div className="text-xs text-text-muted">{contacto.telefono}</div>}
                {!contacto?.nombre && !contacto?.email && !contacto?.telefono && <div className="text-xs text-text-muted">Sin contacto cargado</div>}
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Saldo pendiente declarado</div>
                <div className="text-lg font-bold text-text">{fmtArs(f.proveedor.saldo_pendiente)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-text-muted mb-1">Notas</div>
                <div className="text-xs text-text-muted whitespace-pre-wrap">{f.proveedor.notas ?? "—"}</div>
              </div>
            </div>
          </div>
        )}

        {tab === "erogaciones" && (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {f.erogaciones.length === 0 ? (
              <div className="p-10 text-center text-text-muted">Sin erogaciones cargadas</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
                  <tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Descripcion</th><th className="text-left px-3 py-2">Empresa</th><th className="text-right px-3 py-2">Monto</th><th className="text-left px-3 py-2">Estado</th></tr>
                </thead>
                <tbody>
                  {f.erogaciones.map((e) => (
                    <tr key={e.id} className="border-t border-border hover:bg-soft">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(e.fecha_pago)}</td>
                      <td className="px-3 py-2 max-w-md truncate">{e.descripcion}</td>
                      <td className="px-3 py-2 text-text-muted">{e.empresa_nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtArs(e.monto)}</td>
                      <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_COLOR[e.estado] ?? ""}`}>{ESTADO_LABEL[e.estado] ?? e.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "acuerdos" && (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {f.acuerdos.length === 0 ? (
              <div className="p-10 text-center text-text-muted">Sin acuerdos registrados</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
                  <tr><th className="text-left px-3 py-2">Compromiso</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Fecha</th><th className="text-right px-3 py-2">Monto</th><th className="text-left px-3 py-2">Estado</th></tr>
                </thead>
                <tbody>
                  {f.acuerdos.map((a) => (
                    <tr key={a.id} className="border-t border-border hover:bg-soft">
                      <td className="px-3 py-2 max-w-md truncate">{a.compromiso}</td>
                      <td className="px-3 py-2"><span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100">{a.tipo}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap text-text-muted">{a.fecha_compromiso ? fmtDate(a.fecha_compromiso) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold">{a.monto_compromiso != null ? fmtArs(a.monto_compromiso) : "—"}</td>
                      <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO_ACUERDO_COLOR[a.estado] ?? ""}`}>{a.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  );
}
