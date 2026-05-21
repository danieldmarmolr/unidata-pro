"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Plus, X, Loader2 } from "lucide-react";
import { PageWrapper, LoadingState, ErrorState, Tile } from "../_components/PageWrapper";
import { DataTable, type Column } from "../_components/DataTable";
import { fmtArs, fmtDate } from "../_components/helpers";

type Saldo = {
  id: number; fecha: string; banco_id: number; saldo: number | string; fuente: string;
  banco_nombre?: string; banco_tipo?: string;
};
type SaldoActual = { por_banco: { banco_id: number; fecha: string; saldo: number | string; nombre: string; tipo: string }[]; total: number };
type Banco = { id: number; nombre: string };

export default function SaldosPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const actual = useQuery<SaldoActual>({ queryKey: ["ff", "saldos-actual"], queryFn: () => api("/api/flujo-fondos/saldos/actual") });
  const history = useQuery<{ items: Saldo[]; count: number }>({ queryKey: ["ff", "saldos"], queryFn: () => api("/api/flujo-fondos/saldos") });
  const bancos = useQuery<{ items: Banco[] }>({ queryKey: ["ff", "bancos"], queryFn: () => api("/api/flujo-fondos/bancos"), staleTime: 5 * 60_000 });

  const columns: Column<Saldo>[] = [
    { key: "fecha", label: "Fecha", type: "date", getValue: (r) => r.fecha, render: (r) => <span className="whitespace-nowrap">{fmtDate(r.fecha)}</span> },
    { key: "banco_nombre", label: "Banco", getValue: (r) => r.banco_nombre ?? `#${r.banco_id}`, render: (r) => <span className="font-semibold">{r.banco_nombre ?? `#${r.banco_id}`}</span> },
    {
      key: "saldo", label: "Saldo", align: "right", type: "number",
      getValue: (r) => Number(r.saldo),
      render: (r) => <span className="font-semibold">{fmtArs(r.saldo)}</span>,
    },
    { key: "fuente", label: "Fuente", getValue: (r) => r.fuente, className: "text-text-muted text-xs" },
  ];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">Carga de saldos iniciales por banco. El motor de proyeccion usa el ultimo saldo de cada banco.</div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Cargar saldo</button>
      </div>

      {actual.isLoading ? <LoadingState /> : actual.data ? (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-bold mb-3">Saldo actual por banco</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {actual.data.por_banco.length === 0 ? <div className="text-text-muted text-sm">Sin saldos cargados</div> : actual.data.por_banco.map((b) => (
              <div key={b.banco_id} className="rounded-lg bg-soft p-3 border border-border">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-text">{b.nombre}</span>
                  <span className="text-text-muted">{fmtDate(b.fecha)}</span>
                </div>
                <div className="text-lg font-bold text-primary mt-1">{fmtArs(b.saldo)}</div>
                <div className="text-[10px] text-text-muted mt-0.5">{b.tipo}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <Tile label="Saldo total consolidado" value={fmtArs(actual.data.total)} highlight />
          </div>
        </div>
      ) : null}

      <div>
        <h2 className="text-sm font-bold mb-2 text-text">Historial de saldos cargados</h2>
        {history.isLoading ? <LoadingState /> : history.error ? <ErrorState message={(history.error as Error).message} /> : (
          <DataTable
            data={history.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            defaultSort={{ key: "fecha", dir: "desc" }}
            emptyLabel="Sin saldos en historial"
          />
        )}
      </div>

      {showCreate && <SaldoModal bancos={bancos.data?.items ?? []} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ["ff", "saldos"] }); qc.invalidateQueries({ queryKey: ["ff", "saldos-actual"] }); }} />}
    </PageWrapper>
  );
}

function SaldoModal({ bancos, onClose, onSaved }: { bancos: Banco[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), banco_id: bancos[0]?.id ?? 0, saldo: "", fuente: "manual" });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/flujo-fondos/saldos", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => onSaved(),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between"><h3 className="text-sm font-bold">Cargar saldo inicial</h3><button onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={(e) => { e.preventDefault(); m.mutate({ fecha: form.fecha, banco_id: Number(form.banco_id), saldo: Number(form.saldo), fuente: form.fuente }); }} className="p-5 space-y-3">
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fecha *</label><input required type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Banco *</label><select required value={form.banco_id} onChange={(e) => setForm({ ...form, banco_id: Number(e.target.value) })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface">{bancos.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Saldo *</label><input required type="number" step="0.01" value={form.saldo} onChange={(e) => setForm({ ...form, saldo: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm" /></div>
          <div><label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Fuente</label><select value={form.fuente} onChange={(e) => setForm({ ...form, fuente: e.target.value })} className="w-full px-2 py-1.5 border border-border rounded-md text-sm bg-surface"><option value="manual">manual</option><option value="api_banco">api_banco</option><option value="extracto_csv">extracto_csv</option></select></div>
          {m.error && <div className="text-rose-600 text-xs">{(m.error as Error).message}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-soft">Cancelar</button>
            <button type="submit" disabled={m.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-semibold flex items-center gap-1.5">{m.isPending && <Loader2 size={12} className="animate-spin" />}Cargar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
