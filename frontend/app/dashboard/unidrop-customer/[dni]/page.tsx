"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, User, Mail, Phone, MapPin, ShoppingBag, TrendingUp, Calendar, Crown } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { WhatsAppPhone } from "@/components/whatsapp-phone";

type Consumer = {
  dni: string;
  nombre: string;
  email: string;
  telefono: string;
  provincia: string;
  ciudad: string;
};
type Totals = {
  ordenes_totales: number;
  ordenes_pagas: number;
  ordenes_pendientes: number;
  ordenes_canceladas: number;
  ltv: number;
  ticket_promedio: number;
  max_order: number;
  primera_compra: string | null;
  ultima_compra: string | null;
  dropshippers_distintos: number;
};
type Drill = { category: string; value: number; extra?: Record<string, any> };
type Orden = {
  id: number | null;
  numero: string;
  fecha: string;
  total: number;
  payment_status: string;
  status: string;
  user_id: number;
  dropshipper: string;
  provincia: string;
};
type Detail =
  | { found: false; dni: string }
  | {
      found: true;
      consumer: Consumer;
      totals: Totals;
      dropshippers: Drill[];
      ordenes: Orden[];
      provincias: Drill[];
      generated_at: string;
    };

export default function UnidropCustomerPage() {
  const params = useParams<{ dni: string }>();
  const dni = decodeURIComponent(params.dni || "");
  const router = useRouter();

  const { data, isLoading } = useQuery<Detail>({
    queryKey: ["unidrop-end-consumer", dni],
    queryFn: () => api<Detail>(`/api/dashboards/unidrop/end-consumer/${encodeURIComponent(dni)}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <>
        <Topbar title="Cliente Unidrop" subtitle="Cargando..." />
        <div className="flex-1 px-8 py-6 overflow-y-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-32 bg-soft rounded-xl" />
            <div className="h-64 bg-soft rounded-xl" />
          </div>
        </div>
      </>
    );
  }

  if (!data || data.found === false) {
    return (
      <>
        <Topbar title="Cliente Unidrop" subtitle={`DNI ${dni}`} hidePeriod />
        <div className="flex-1 px-8 py-6 overflow-y-auto">
          <button onClick={() => router.back()} className="text-sm text-text-muted hover:text-text mb-4 inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Volver
          </button>
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-6 text-sm">
            No se encontraron compras para el DNI <strong>{dni}</strong> en TN Unidrop.
          </div>
        </div>
      </>
    );
  }

  const { consumer, totals, dropshippers, ordenes, provincias } = data;

  const isVip = totals.ticket_promedio >= 300_000;

  return (
    <>
      <Topbar
        title={consumer.nombre || `DNI ${dni}`}
        subtitle={`Cliente final Unidrop · DNI ${dni} · compra en ${totals.dropshippers_distintos} dropshipper(s)`}
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        <button onClick={() => router.back()} className="text-sm text-text-muted hover:text-text mb-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Volver
        </button>

        {/* Identidad */}
        <div className="bg-surface border border-border rounded-xl p-5 mb-4">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center shadow-md flex-shrink-0">
              <User size={24} />
            </div>
            <div className="flex-1 min-w-[260px]">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Cliente final Unidrop</div>
              <h2 className="text-xl font-extrabold text-text mt-0.5">{consumer.nombre || "(sin nombre)"}</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1"><span className="font-semibold text-text">DNI</span> {consumer.dni}</span>
                {consumer.email && <span className="inline-flex items-center gap-1"><Mail size={11} /> {consumer.email}</span>}
                {consumer.telefono && <WhatsAppPhone phone={consumer.telefono} size={11} showBadge />}
                {(consumer.provincia || consumer.ciudad) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} /> {[consumer.ciudad, consumer.provincia].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
            {isVip && (
              <div className="bg-gradient-to-br from-amber-400 to-yellow-500 text-white rounded-xl px-4 py-2 shadow-md text-center">
                <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wider font-bold">
                  <Crown size={12} /> VIP
                </div>
                <div className="text-sm font-bold mt-0.5">Ticket promedio ≥ $300k</div>
              </div>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KpiCard
            icon={<TrendingUp size={16} />}
            label="LTV"
            value={formatCurrency(totals.ltv)}
            hint={`${totals.ordenes_pagas} órdenes pagas`}
          />
          <KpiCard
            icon={<ShoppingBag size={16} />}
            label="Ticket promedio"
            value={formatCurrency(totals.ticket_promedio)}
            hint={`Max orden ${formatCurrency(totals.max_order)}`}
          />
          <KpiCard
            icon={<Calendar size={16} />}
            label="Primera compra"
            value={totals.primera_compra ? totals.primera_compra.slice(0, 10) : "—"}
            hint={totals.ultima_compra ? `Última ${totals.ultima_compra.slice(0, 10)}` : ""}
          />
          <KpiCard
            icon={<User size={16} />}
            label="Dropshippers distintos"
            value={String(totals.dropshippers_distintos)}
            hint={`${totals.ordenes_canceladas} canceladas · ${totals.ordenes_pendientes} pendientes`}
          />
        </div>

        {/* Dropshippers a los que les compro */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          <CategoryTable
            caption="Dropshippers a los que le compro"
            subtitle="Click para abrir el dropshipper · ordenado por revenue"
            data={dropshippers}
            formatter="currency"
            extraColumns={[
              { key: "ordenes", label: "Ord", format: "number" },
              { key: "ultima_compra", label: "Última", format: "raw" },
            ]}
            onRowClick={(r) => {
              const uid = r.extra?.user_id;
              if (uid) router.push(`/dashboard/dropshipper/${uid}`);
            }}
          />
          <CategoryTable
            caption="Distribución por provincia"
            subtitle="Direcciones de envío diferentes en su historial"
            data={provincias}
            formatter="currency"
            extraColumns={[
              { key: "ordenes", label: "Ord", format: "number" },
            ]}
            showProgress={true}
          />
        </div>

        {/* Ordenes */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <div className="text-sm font-bold text-text">Historial de órdenes</div>
            <div className="text-xs text-text-muted mt-0.5">Últimas {ordenes.length} órdenes (TN Unidrop)</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted bg-soft">
                  <th className="px-4 py-2">Orden</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Dropshipper</th>
                  <th className="px-4 py-2">Provincia</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2">Pago</th>
                  <th className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o, i) => (
                  <tr key={`${o.id}-${i}`} className="border-t border-border hover:bg-soft transition">
                    <td className="px-4 py-2 font-mono font-semibold text-xs">{o.numero}</td>
                    <td className="px-4 py-2 text-text-muted text-xs">{o.fecha}</td>
                    <td className="px-4 py-2">
                      <Link href={`/dashboard/dropshipper/${o.user_id}`} className="text-primary hover:underline">
                        {o.dropshipper}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-muted">{o.provincia || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCurrency(o.total)}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className={
                        "px-2 py-0.5 rounded-full text-[10px] font-semibold " +
                        (o.payment_status === "paid"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800")
                      }>
                        {o.payment_status || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span className={
                        "px-2 py-0.5 rounded-full text-[10px] font-semibold " +
                        (o.status === "cancelled"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-blue-100 text-blue-800")
                      }>
                        {o.status || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
                {ordenes.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-text-muted text-sm">
                      Sin órdenes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function KpiCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted font-bold">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="text-xl font-extrabold text-text mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
