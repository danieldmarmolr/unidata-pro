"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Lightbulb } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
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

  // El array no tiene id natural; usamos descripcion + proveedor_id como key
  const rows = (q.data?.items ?? []).map((s, idx) => ({ ...s, _key: `${s.descripcion}-${s.proveedor_id ?? "null"}-${idx}` }));
  type Row = Sugerencia & { _key: string };

  const columns: Column<Row>[] = [
    { key: "descripcion", label: "Descripcion", getValue: (r) => r.descripcion, render: (r) => <span className="font-semibold block max-w-md truncate" title={r.descripcion}>{r.descripcion}</span> },
    {
      key: "ocurrencias", label: "Ocurrencias", align: "center", type: "number",
      getValue: (r) => r.ocurrencias,
      render: (r) => <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">{r.ocurrencias}</span>,
    },
    { key: "primer_pago", label: "Primer pago", type: "date", getValue: (r) => r.primer_pago, render: (r) => <span className="whitespace-nowrap text-text-muted">{fmtDate(r.primer_pago)}</span> },
    { key: "ultimo_pago", label: "Ultimo pago", type: "date", getValue: (r) => r.ultimo_pago, render: (r) => <span className="whitespace-nowrap text-text-muted">{fmtDate(r.ultimo_pago)}</span> },
    {
      key: "monto_promedio", label: "Monto promedio", align: "right", type: "number",
      getValue: (r) => r.monto_promedio,
      render: (r) => <span className="font-semibold">{fmtArs(r.monto_promedio)}</span>,
    },
    {
      key: "monto_min", label: "Min", align: "right", type: "number",
      getValue: (r) => r.monto_min,
      render: (r) => <span className="text-xs text-text-muted whitespace-nowrap">{fmtArs(r.monto_min)}</span>,
    },
    {
      key: "monto_max", label: "Max", align: "right", type: "number",
      getValue: (r) => r.monto_max,
      render: (r) => <span className="text-xs text-text-muted whitespace-nowrap">{fmtArs(r.monto_max)}</span>,
    },
  ];

  return (
    <PageWrapper>
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start">
        <Lightbulb size={18} className="text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          El detector busca <strong>descripciones repetidas 3+ veces</strong> entre erogaciones no marcadas como recurrentes. Son candidatos a transformar en una recurrencia formal.
        </div>
      </div>

      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState message={(q.error as Error).message} /> : (
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r._key}
          defaultSort={{ key: "ocurrencias", dir: "desc" }}
          emptyLabel="No se detectaron patrones repetidos en los ultimos 12 meses ✓"
        />
      )}

      <div className="text-xs text-text-muted">
        Tip: si ves una sugerencia que es claramente una recurrencia (ej. "Pago alquiler oficina" repitiendo cada 1 mes), creala desde la solapa <strong>Recurrencias</strong>.
      </div>
    </PageWrapper>
  );
}
