"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, User, Mail, Phone, MapPin, Crown, IdCard, Calendar, TrendingUp, Filter } from "lucide-react";
import { Topbar } from "@/components/topbar";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Unit = "unistore" | "unidrop";

type UnistoreRow = {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
  provincia: string;
  ciudad: string;
  lifetime_spent: number;
  ordenes_pagas_lifetime: number;
  ordenes_periodo: number;
  revenue_periodo: number;
  ultima_compra: string | null;
};

type UnidropRow = {
  id: number;
  nombre: string;
  fantasy_name: string;
  email: string;
  telefono: string;
  dni: string;
  cuit: string;
  fecha_alta: string | null;
  vence_suscripcion: string | null;
  tn_ordenes_periodo: number;
  tn_revenue_periodo: number;
  ml_ordenes_periodo: number;
};

type SearchResp<T> = {
  rows: T[];
  total: number;
  query: string;
  period_days: number;
  only_active_in_period: boolean;
};

export default function ClientesPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const qs = periodToQuery(period, customFrom, customTo);
  const router = useRouter();

  const [unit, setUnit] = useState<Unit>("unistore");
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  // Debounce simple: actualizamos el query "real" cada 350 ms
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = debounced.length >= 1;

  const unistore = useQuery<SearchResp<UnistoreRow>>({
    queryKey: ["search-unistore-customers", debounced, period, customFrom, customTo, onlyActive],
    queryFn: () => api(`/api/dashboards/search/unistore-customers?q=${encodeURIComponent(debounced)}&${qs}&only_active=${onlyActive}`),
    enabled: unit === "unistore" && enabled,
    staleTime: 30_000,
  });

  const unidrop = useQuery<SearchResp<UnidropRow>>({
    queryKey: ["search-unidrop-dropshippers", debounced, period, customFrom, customTo, onlyActive],
    queryFn: () => api(`/api/dashboards/search/unidrop-dropshippers?q=${encodeURIComponent(debounced)}&${qs}&only_active=${onlyActive}`),
    enabled: unit === "unidrop" && enabled,
    staleTime: 30_000,
  });

  const isLoading = (unit === "unistore" ? unistore.isFetching : unidrop.isFetching) && enabled;

  return (
    <>
      <Topbar
        title="Buscar clientes"
        subtitle="Unistore (compradores TN) · Unidrop (dropshippers de la plataforma) · El filtro de fechas restringe a 'activos en el periodo'"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto">
        {/* Tabs Unistore / Unidrop */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <Segmented<Unit>
            value={unit}
            onChange={setUnit}
            options={[
              { value: "unistore", label: "Unistore - Clientes" },
              { value: "unidrop", label: "Unidrop - Dropshippers" },
            ]}
          />
          <label className="inline-flex items-center gap-2 text-xs text-text-muted cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
              className="accent-primary"
            />
            <Filter size={12} />
            Solo con actividad en el periodo
          </label>
        </div>

        {/* Search box */}
        <div className="bg-surface border border-border rounded-xl p-4 mb-4">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1.5">
              {unit === "unistore" ? "Buscar por nombre, email, telefono o ID" : "Buscar por nombre, fantasy, email, DNI, CUIT o ID"}
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={unit === "unistore" ? "Ej: Pablo Amezcua, gmail.com, 11..." : "Ej: ORYX, dropshipper@..., 20-12345678-9..."}
                className="w-full pl-10 pr-3 py-2.5 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none"
                autoFocus
              />
            </div>
          </label>
        </div>

        {/* Resultados */}
        {!enabled && (
          <div className="bg-surface border border-border rounded-xl p-12 text-center text-text-muted text-sm">
            Escribi al menos 1 caracter para buscar.
          </div>
        )}

        {enabled && isLoading && (
          <div className="bg-surface border border-border rounded-xl p-12 text-center text-text-muted text-sm">
            Buscando...
          </div>
        )}

        {/* UNISTORE results */}
        {enabled && unit === "unistore" && unistore.data && !isLoading && (
          <UnistoreResults
            data={unistore.data}
            onOpen={(id) => router.push(`/dashboard/customer/${id}`)}
          />
        )}

        {/* UNIDROP results */}
        {enabled && unit === "unidrop" && unidrop.data && !isLoading && (
          <UnidropResults
            data={unidrop.data}
            onOpen={(id) => router.push(`/dashboard/dropshipper/${id}`)}
          />
        )}
      </div>
    </>
  );
}

function UnistoreResults({ data, onOpen }: { data: SearchResp<UnistoreRow>; onOpen: (id: number) => void }) {
  if (data.rows.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-6 text-sm">
        Sin resultados para <strong>"{data.query}"</strong>.
        {data.only_active_in_period && " Probá destildar 'Solo con actividad en el periodo' o ampliar el rango de fechas."}
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-bold text-text">{data.total} resultado{data.total === 1 ? "" : "s"}</div>
        <div className="text-[11px] text-text-muted">Click una fila para abrir Customer 360</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2">Cliente</th>
              <th className="text-left px-4 py-2">Contacto</th>
              <th className="text-left px-4 py-2">Ubicacion</th>
              <th className="text-right px-4 py-2">Ord. periodo</th>
              <th className="text-right px-4 py-2">Revenue periodo</th>
              <th className="text-right px-4 py-2">Lifetime</th>
              <th className="text-left px-4 py-2">Última compra</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const isVip = r.lifetime_spent >= 300_000 && r.ordenes_pagas_lifetime > 0
                && (r.lifetime_spent / r.ordenes_pagas_lifetime) >= 300_000;
              return (
                <tr key={r.id} onClick={() => onOpen(r.id)} className="border-t border-border hover:bg-soft transition cursor-pointer">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {isVip && <Crown size={14} className="text-amber-500" />}
                      <div>
                        <div className="font-semibold text-text">{r.nombre}</div>
                        <div className="text-[10px] text-text-muted font-mono">ID {r.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.email && <div className="text-text-muted inline-flex items-center gap-1"><Mail size={10} /> {r.email}</div>}
                    {r.telefono && <div className="text-text-muted inline-flex items-center gap-1 mt-0.5"><Phone size={10} /> {r.telefono}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">
                    {(r.ciudad || r.provincia) ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={10} /> {[r.ciudad, r.provincia].filter(Boolean).join(", ")}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.ordenes_periodo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-primary">{formatCurrency(r.revenue_periodo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">
                    {formatCurrency(r.lifetime_spent)}
                    <div className="text-[10px]">{r.ordenes_pagas_lifetime} órd. tot.</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">{r.ultima_compra || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnidropResults({ data, onOpen }: { data: SearchResp<UnidropRow>; onOpen: (id: number) => void }) {
  if (data.rows.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-6 text-sm">
        Sin resultados para <strong>"{data.query}"</strong>.
        {data.only_active_in_period && " Probá destildar 'Solo con actividad en el periodo' o ampliar el rango de fechas."}
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-bold text-text">{data.total} resultado{data.total === 1 ? "" : "s"}</div>
        <div className="text-[11px] text-text-muted">Click una fila para abrir Dropshipper 360</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-soft text-text-muted text-[10px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2">Dropshipper</th>
              <th className="text-left px-4 py-2">Contacto</th>
              <th className="text-left px-4 py-2">Identidad</th>
              <th className="text-right px-4 py-2">TN órd. periodo</th>
              <th className="text-right px-4 py-2">TN revenue periodo</th>
              <th className="text-right px-4 py-2">ML órd. periodo</th>
              <th className="text-left px-4 py-2">Suscripción</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const venceDate = r.vence_suscripcion ? new Date(r.vence_suscripcion) : null;
              const isExpired = venceDate ? venceDate.getTime() < Date.now() : false;
              return (
                <tr key={r.id} onClick={() => onOpen(r.id)} className="border-t border-border hover:bg-soft transition cursor-pointer">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-text">{r.nombre}</div>
                    <div className="text-[10px] text-text-muted font-mono">ID {r.id}{r.fantasy_name && r.fantasy_name !== r.nombre ? ` · ${r.fantasy_name}` : ""}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.email && <div className="text-text-muted inline-flex items-center gap-1"><Mail size={10} /> {r.email}</div>}
                    {r.telefono && <div className="text-text-muted inline-flex items-center gap-1 mt-0.5"><Phone size={10} /> {r.telefono}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">
                    {r.dni && <div className="inline-flex items-center gap-1"><IdCard size={10} /> DNI {r.dni}</div>}
                    {r.cuit && <div className="inline-flex items-center gap-1 mt-0.5 font-mono">{r.cuit}</div>}
                    {!r.dni && !r.cuit && "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.tn_ordenes_periodo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-primary">{formatCurrency(r.tn_revenue_periodo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(r.ml_ordenes_periodo)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.vence_suscripcion ? (
                      <span className={isExpired ? "text-rose-700 font-semibold" : "text-emerald-700"}>
                        {isExpired ? "Vencida " : "Vence "} {r.vence_suscripcion}
                      </span>
                    ) : (
                      <span className="text-text-muted">Sin suscripción</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
