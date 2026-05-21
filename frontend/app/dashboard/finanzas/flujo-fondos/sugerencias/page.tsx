"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Lightbulb } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, EmptyState } from "../_components/PageWrapper";
import { fmtArs, fmtDate } from "../_components/helpers";

type Sugerencia = {
  descripcion: string; proveedor_id: number | null; ocurrencias: number;
  primer_pago: string; ultimo_pago: string;
  monto_promedio: number; monto_min: number; monto_max: number;
};

export default function SugerenciasPage() {
  const q = useQuery<{ items: Sugerencia[]; count: number }>({
    queryKey: ["ff", "sugerencias"],
    queryFn: () => api("/api/flujo-fondos/sugerencias"),
  });

  return (
    <PageWrapper>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
        <Lightbulb size={18} className="text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          El detector busca <strong>descripciones repetidas 3+ veces</strong> entre erogaciones no marcadas como recurrentes. Son candidatos a transformar en una recurrencia formal (que despues genera erogaciones automaticamente).
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : q.data && q.data.items.length === 0 ? (
        <EmptyState label="No se detectaron patrones repetidos en los ultimos 12 meses ✓" />
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-soft border-b border-border text-[10px] uppercase tracking-wider text-text-muted">
              <tr><th className="text-left px-3 py-2">Descripcion</th><th className="text-center px-3 py-2">Ocurrencias</th><th className="text-left px-3 py-2">Primer pago</th><th className="text-left px-3 py-2">Ultimo pago</th><th className="text-right px-3 py-2">Monto promedio</th><th className="text-right px-3 py-2">Rango</th></tr>
            </thead>
            <tbody>
              {q.data?.items.map((s, i) => (
                <tr key={`${s.descripcion}-${i}`} className="border-t border-border hover:bg-soft">
                  <td className="px-3 py-2 max-w-md truncate font-semibold">{s.descripcion}</td>
                  <td className="px-3 py-2 text-center"><span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">{s.ocurrencias}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">{fmtDate(s.primer_pago)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">{fmtDate(s.ultimo_pago)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{fmtArs(s.monto_promedio)}</td>
                  <td className="px-3 py-2 text-right text-xs text-text-muted whitespace-nowrap">{fmtArs(s.monto_min)} - {fmtArs(s.monto_max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-text-muted">
        Tip: si ves una sugerencia que es claramente una recurrencia (ej. "Pago alquiler oficina" repitiendo cada 1 mes), creala desde la solapa <strong>Recurrencias</strong> y luego marca las erogaciones existentes con `recurrencia_id` desde Erogaciones.
      </div>
    </PageWrapper>
  );
}
