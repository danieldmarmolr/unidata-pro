"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { ExpandableOrderRow, type OrderRowData } from "@/components/expandable-order-row";
import { OrderDetailModal } from "@/components/order-detail-modal";
import { useTableSort, SortHeader } from "@/lib/use-table-sort";
import { formatCurrency } from "@/lib/utils";
import { Search, X } from "lucide-react";

type RawRow = unknown[];

const COL = {
  id: 0, numero: 1, fecha: 2, payment: 3, shipping: 4, status: 5,
  total: 6, cliente: 7, provincia: 8, metodo_envio: 9, canal: 10, empaquetada: 11, customer_id: 12,
  metodo_pago: 13, ganancia: 14,
} as const;

const PAYMENT_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "paid", label: "Pagadas" },
  { value: "pending", label: "Pendientes" },
  { value: "voided", label: "Anuladas" },
  { value: "refunded", label: "Reembolsadas" },
];

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Abierta" },
  { value: "closed", label: "Cerrada" },
  { value: "cancelled", label: "Cancelada" },
];

function get(row: RawRow, col: number): string {
  return String(row[col] ?? "");
}

function rowToOrderData(row: RawRow): OrderRowData {
  const customerId = Number(row[COL.customer_id] ?? 0) || null;
  const gananciaRaw = row[COL.ganancia];
  return {
    id: Number(row[COL.id] ?? 0),
    numero: get(row, COL.numero),
    fecha: get(row, COL.fecha).slice(0, 10) || null,
    total: Number(row[COL.total] ?? 0),
    payment: get(row, COL.payment) || null,
    shipping: get(row, COL.shipping) || null,
    status: get(row, COL.status) || null,
    empaquetada: row[COL.empaquetada] === true || row[COL.empaquetada] === "true",
    canal: get(row, COL.canal) || null,
    subtitle: get(row, COL.cliente) || null,
    subtitleHref: customerId ? `/dashboard/customer/${customerId}` : null,
    metodo_pago: get(row, COL.metodo_pago) || null,
    ganancia: gananciaRaw != null && gananciaRaw !== "" ? Number(gananciaRaw) : null,
  };
}

export function UnistoreOrdersTable({ externalPayFilter }: { externalPayFilter?: string | null }) {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const qs = periodToQuery(period, customFrom, customTo);

  const [payFilter, setPayFilter] = useState("all");
  // when parent passes a filter (donut cross-filter), it overrides the internal one
  const effectivePayFilter = externalPayFilter != null ? externalPayFilter : payFilter;
  const [statusFilter, setStatusFilter] = useState("all");
  const [canalFilter, setCanalFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<{ columns: string[]; rows: RawRow[]; row_count: number }>({
    queryKey: ["unistore-orders-all", period, customFrom, customTo],
    queryFn: () => api(`/api/drilldowns/orders/all?${qs}`),
    staleTime: 60_000,
  });

  const canales = useMemo(() => {
    if (!data?.rows) return [];
    const set = new Set<string>();
    for (const r of data.rows) {
      const c = get(r, COL.canal);
      if (c) set.add(c);
    }
    return Array.from(set).sort();
  }, [data]);

  const { rows: sorted, sortBy: sortKey, sortDir, toggle } = useTableSort(
    useMemo(() => {
      if (!data?.rows) return [];
      return data.rows
        .filter((r) => {
          if (effectivePayFilter !== "all" && get(r, COL.payment) !== effectivePayFilter) return false;
          if (statusFilter !== "all" && get(r, COL.status) !== statusFilter) return false;
          if (canalFilter !== "all" && get(r, COL.canal) !== canalFilter) return false;
          if (search) {
            const q = search.toLowerCase();
            const haystack = [
              get(r, COL.numero), get(r, COL.cliente), get(r, COL.provincia), get(r, COL.canal),
            ].join(" ").toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        })
        .map((r) => ({
          _row: r,
          numero: get(r, COL.numero),
          fecha: get(r, COL.fecha),
          total: Number(r[COL.total] ?? 0),
          cliente: get(r, COL.cliente),
          payment: get(r, COL.payment),
        }));
    }, [data, payFilter, statusFilter, canalFilter, search]),
    "fecha",
    "desc",
  );

  const totalRevenue = useMemo(
    () => sorted.reduce((s, r) => s + r.total, 0),
    [sorted],
  );

  const COLS = 8;

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-sm font-bold text-text">Órdenes Unistore</div>
          <div className="text-xs text-text-muted mt-0.5">
            Todas las órdenes TN del período · hereda filtro de fechas del topbar
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          {!isLoading && data && (
            <>
              <span className="font-semibold text-text">{sorted.length}</span> de {data.row_count} ·
              <span className="font-bold text-primary">{formatCurrency(totalRevenue)}</span>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-5 py-3 border-b border-border bg-soft/30 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar número, cliente, provincia..."
            className="pl-7 pr-7 py-1 text-xs rounded border border-border bg-surface w-52 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text">
              <X size={11} />
            </button>
          )}
        </div>

        {/* Payment filter */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase font-bold text-text-muted">Pago:</span>
          {PAYMENT_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setPayFilter(f.value)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                effectivePayFilter === f.value
                  ? "bg-primary text-white border-primary"
                  : "bg-surface text-text-muted border-border hover:border-text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase font-bold text-text-muted">Estado:</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                statusFilter === f.value
                  ? "bg-primary text-white border-primary"
                  : "bg-surface text-text-muted border-border hover:border-text-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Canal filter */}
        {canales.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-text-muted">Envío:</span>
            <button
              onClick={() => setCanalFilter("all")}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                canalFilter === "all"
                  ? "bg-primary text-white border-primary"
                  : "bg-surface text-text-muted border-border hover:border-text-muted"
              }`}
            >
              Todos
            </button>
            {canales.map((c) => (
              <button
                key={c}
                onClick={() => setCanalFilter(c === canalFilter ? "all" : c)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-all ${
                  canalFilter === c
                    ? "bg-primary text-white border-primary"
                    : "bg-surface text-text-muted border-border hover:border-text-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {error && (
        <div className="px-5 py-4 text-sm text-error">Error: {(error as Error).message}</div>
      )}
      {isLoading ? (
        <div className="space-y-1 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 rounded bg-soft animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-5 py-8 text-center text-text-muted text-sm">
          No hay órdenes para los filtros seleccionados.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-soft/50 text-left">
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-text-muted w-8">#</th>
                <th className="px-3 py-2">
                  <SortHeader label="Número · Cliente" col="numero" sortBy={sortKey} sortDir={sortDir} onToggle={toggle} className="text-[10px] uppercase tracking-wider font-bold text-text-muted" />
                </th>
                <th className="px-3 py-2">
                  <SortHeader label="Fecha" col="fecha" sortBy={sortKey} sortDir={sortDir} onToggle={toggle} className="text-[10px] uppercase tracking-wider font-bold text-text-muted" />
                </th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-text-muted">Método pago</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-text-muted">Estado del pedido</th>
                <th className="px-3 py-2 text-right">
                  <SortHeader label="Total" col="total" sortBy={sortKey} sortDir={sortDir} onToggle={toggle} className="text-[10px] uppercase tracking-wider font-bold text-text-muted" />
                </th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-bold text-text-muted">Ganancia</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-text-muted">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <ExpandableOrderRow
                  key={get(r._row, COL.id)}
                  order={rowToOrderData(r._row)}
                  idx={i + 1}
                  cols={COLS}
                  onOpenDetail={(id) => setDetailId(id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailId && (
        <OrderDetailModal orderId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
