"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { Loader2, Save, Trash2 } from "lucide-react";

type Unit = "unistore" | "unidrop";
type Direction = "lower_is_better" | "higher_is_better";

type Target = {
  unit: string;
  kpi_key: string;
  target_value: number;
  direction: Direction;
  note: string | null;
  updated_by_email: string | null;
  updated_at: string | null;
};

type ListResp = { unit: string; items: Target[] };

// KPIs operativos comunes que las queries del service de logistica buscan
const KNOWN_KPIS: { key: string; label: string; default_direction: Direction; hint: string }[] = [
  { key: "lead_time_days", label: "Lead time avg (dias)", default_direction: "lower_is_better", hint: "Pedido -> despacho" },
  { key: "stuck_orders_max", label: "Pedidos atascados (max)", default_direction: "lower_is_better", hint: ">5d sin fulfillment" },
  { key: "pending_orders_max", label: "Pendientes (max)", default_direction: "lower_is_better", hint: "snapshot" },
  { key: "in_prep_max", label: "En preparacion (max)", default_direction: "lower_is_better", hint: "snapshot" },
  { key: "dispatched_target", label: "Despachados / periodo (target)", default_direction: "higher_is_better", hint: "Unistore" },
  { key: "completed_target", label: "Completados / periodo (target)", default_direction: "higher_is_better", hint: "Unidrop" },
  { key: "cancelled_max", label: "Eliminados / periodo (max)", default_direction: "lower_is_better", hint: "Unidrop" },
];

export default function TargetsPage() {
  const [unit, setUnit] = useState<Unit>("unistore");
  const qc = useQueryClient();

  const listQ = useQuery<ListResp>({
    queryKey: ["logistics-targets", unit],
    queryFn: () => api<ListResp>(`/api/logistics-targets/${unit}`),
  });

  const upsertMut = useMutation({
    mutationFn: async (body: { kpi_key: string; target_value: number; direction: Direction; note?: string }) =>
      api<Target>(`/api/logistics-targets/${unit}/${body.kpi_key}`, {
        method: "PATCH",
        body: JSON.stringify({
          target_value: body.target_value,
          direction: body.direction,
          note: body.note ?? null,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logistics-targets", unit] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (kpi_key: string) =>
      api(`/api/logistics-targets/${unit}/${kpi_key}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["logistics-targets", unit] }),
  });

  const itemsByKey = new Map<string, Target>(
    (listQ.data?.items ?? []).map((t) => [t.kpi_key, t]),
  );

  return (
    <>
      <Topbar
        title="Targets de Logistica"
        subtitle="3ra baseline · objetivos operativos que renderan en las cards del dashboard"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="mb-4">
          <Segmented<Unit>
            value={unit}
            onChange={setUnit}
            options={[
              { value: "unistore", label: "Unistore" },
              { value: "unidrop", label: "Unidrop" },
            ]}
          />
        </div>

        <div className="bg-surface border border-border rounded-xl p-5 max-w-3xl">
          <p className="text-xs text-text-muted mb-4">
            Configura un valor objetivo por KPI. El dashboard muestra arriba del valor real un
            indicador {`"+X% vs target"`}. Si no hay target para un KPI, simplemente no se renderiza.
          </p>

          <div className="space-y-3">
            {KNOWN_KPIS.map((k) => {
              const existing = itemsByKey.get(k.key);
              return (
                <TargetRow
                  key={k.key}
                  kpi={k}
                  existing={existing}
                  saving={upsertMut.isPending}
                  deleting={deleteMut.isPending}
                  onSave={(val, dir, note) =>
                    upsertMut.mutate({ kpi_key: k.key, target_value: val, direction: dir, note })
                  }
                  onDelete={() => deleteMut.mutate(k.key)}
                />
              );
            })}
          </div>

          {upsertMut.isError && (
            <div className="mt-3 text-[11px] text-error">
              Error: {(upsertMut.error as Error).message}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TargetRow({
  kpi,
  existing,
  saving,
  deleting,
  onSave,
  onDelete,
}: {
  kpi: { key: string; label: string; default_direction: Direction; hint: string };
  existing: Target | undefined;
  saving: boolean;
  deleting: boolean;
  onSave: (val: number, dir: Direction, note?: string) => void;
  onDelete: () => void;
}) {
  const [val, setVal] = useState<string>(existing ? String(existing.target_value) : "");
  const [dir, setDir] = useState<Direction>(existing?.direction ?? kpi.default_direction);
  const [note, setNote] = useState<string>(existing?.note ?? "");

  const dirty =
    val !== (existing ? String(existing.target_value) : "") ||
    dir !== (existing?.direction ?? kpi.default_direction) ||
    note !== (existing?.note ?? "");

  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <div className="text-sm font-bold text-text font-mono">{kpi.key}</div>
          <div className="text-[11px] text-text-muted">
            {kpi.label} · {kpi.hint}
          </div>
        </div>
        {existing && (
          <div className="text-[10px] text-text-muted text-right">
            ult. {existing.updated_by_email} · {existing.updated_at?.slice(0, 10)}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
        <input
          type="number"
          step="any"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="valor"
          className="md:col-span-2 px-2 py-1.5 text-sm rounded border border-border bg-bg outline-none focus:border-primary"
        />
        <select
          value={dir}
          onChange={(e) => setDir(e.target.value as Direction)}
          className="md:col-span-3 px-2 py-1.5 text-xs rounded border border-border bg-bg outline-none focus:border-primary"
        >
          <option value="lower_is_better">menor es mejor</option>
          <option value="higher_is_better">mayor es mejor</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="nota (opcional)"
          className="md:col-span-5 px-2 py-1.5 text-xs rounded border border-border bg-bg outline-none focus:border-primary"
        />
        <div className="md:col-span-2 flex items-center gap-1 justify-end">
          <button
            onClick={() => {
              const n = parseFloat(val);
              if (!isNaN(n)) onSave(n, dir, note || undefined);
            }}
            disabled={!dirty || saving || !val.trim()}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-bold rounded bg-primary text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Guardar
          </button>
          {existing && (
            <button
              onClick={onDelete}
              disabled={deleting}
              title="Borrar target"
              className="inline-flex items-center px-2 py-1.5 rounded border border-border hover:border-error hover:text-error disabled:opacity-50"
            >
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
