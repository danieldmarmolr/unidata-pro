"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { X } from "lucide-react";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";
import { SkuRow } from "@/components/sku-row";

// Nota: el mapa SVG fue removido temporalmente porque no rendiriza bien en
// produccion Next 16/Turbopack. La distribucion nacional se muestra como
// tabla ranking + side panel (Unistore drill). Se reactivara cuando este
// resuelto el render en dev.

type GeoOverview = {
  totals: { orders: number; revenue: number; customers: number; provinces_with_data: number };
  by_province: { province: string; orders: number; revenue: number; customers: number }[];
  sin_provincia: { province: string; orders: number; revenue: number; customers: number };
  generated_at: string;
};

type ProvinceDetail = {
  province: string;
  totals: { orders: number; revenue: number; customers: number };
  top_skus: { category: string; value: number; extra?: { sku?: string; units?: number; orders?: number } }[];
  top_customers: { category: string; value: number; extra?: { customer_id?: number; orders?: number; ciudad?: string } }[];
  top_cities: { category: string; value: number; extra?: { orders?: number; customers?: number } }[];
};

type Metric = "revenue" | "orders" | "customers";
type Unit = "unistore" | "unidrop" | "unidev";

// Discrete categorical buckets (5 levels) for clear contrast.
// El idx 0 ahora tiene mas contraste sobre fondo blanco para que las
// provincias sin datos sean visibles igualmente.
const SCALE_COLORS = [
  "#e8e5ee", // 0 - gris suave (provincia sin datos pero visible)
  "#dbc7eb", // low
  "#b48cd8", // mid
  "#8a52c4", // high
  "#5d2d8e", // very high
];
function colorScale(value: number, max: number): string {
  if (max <= 0 || value <= 0) return SCALE_COLORS[0];
  const t = value / max;
  // sqrt para suavizar concentracion
  const idx = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(t) * 4)));
  return SCALE_COLORS[idx];
}

export default function MapaPage() {
  const period = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const router = useRouter();
  const [metric, setMetric] = useState<Metric>("revenue");
  const [unit, setUnit] = useState<Unit>("unistore");
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);

  const qs = periodToQuery(period, customFrom, customTo);

  const { data, isLoading } = useQuery<GeoOverview>({
    queryKey: ["geo", period, customFrom, customTo, unit],
    queryFn: () => api(`/api/dashboards/geo?${qs}&unit=${unit}`),
    staleTime: 60_000,
  });

  // El drill provincia detail solo existe para Unistore (TN). Para unidrop/
  // unidev hoy no hay endpoint /geo/province/{p}?unit=... - la tabla ranking
  // por provincia es la vista principal igual.
  const { data: detail, isLoading: loadingDetail } = useQuery<ProvinceDetail>({
    queryKey: ["geo-province", selectedProvince, period, customFrom, customTo, unit],
    queryFn: () =>
      api(
        `/api/dashboards/geo/province/${encodeURIComponent(selectedProvince!)}?${qs}`,
      ),
    enabled: unit === "unistore" && !!selectedProvince,
    staleTime: 60_000,
  });

  // Map por provincia para colorear
  const valueByProvince = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const p of data.by_province) m.set(p.province, p[metric] as number);
    return m;
  }, [data, metric]);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const v of valueByProvince.values()) if (v > max) max = v;
    return max;
  }, [valueByProvince]);

  const fmtMetric = (v: number) =>
    metric === "revenue" ? formatCurrency(v) : formatNumber(v);

  // Enriquecer los top SKUs de la provincia seleccionada con foto + EAN
  const visibleSkus = useMemo(() => {
    return (detail?.top_skus ?? [])
      .slice(0, 8)
      .map((s) => s.extra?.sku)
      .filter((s): s is string => !!s);
  }, [detail]);
  const skuEnriched = useSkuEnrichment("unistore", visibleSkus);

  return (
    <>
      <Topbar
        title="Distribución por provincia"
        subtitle="Argentina · revenue / ordenes / clientes · ranking nacional por unidad de negocio"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {/* Filtros: Unidad + Metrica */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Segmented<Unit>
              value={unit}
              onChange={(u) => {
                setUnit(u);
                setSelectedProvince(null);
              }}
              options={[
                { value: "unistore", label: "Unistore (TN retail)" },
                { value: "unidrop", label: "Unidrop (dropshippers)" },
                { value: "unidev", label: "Unidev (devoluciones)" },
              ]}
            />
            <Segmented<Metric>
              value={metric}
              onChange={setMetric}
              options={[
                { value: "revenue", label: unit === "unidev" ? "Monto devuelto" : "Revenue" },
                { value: "orders", label: unit === "unidev" ? "Casos" : "Ordenes" },
                { value: "customers", label: "Clientes" },
              ]}
            />
          </div>
          {data && (
            <div className="text-xs text-text-muted">
              {data.totals.provinces_with_data} provincias con datos · {formatNumber(data.totals.orders)} {unit === "unidev" ? "casos" : "ordenes"} ·{" "}
              {formatCurrency(data.totals.revenue)} {unit === "unidev" ? "devuelto" : "revenue"}
            </div>
          )}
        </div>

        {/* Mapa SVG removido temporalmente - se reactiva cuando este resuelto en dev.
            Mientras tanto: la tabla de ranking + side panel cubren el caso de uso. */}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* RANKING POR PROVINCIA (vista principal) */}
          <div className="xl:col-span-2 bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <div className="text-sm font-bold text-text">Ranking por provincia</div>
              <div className="text-xs text-text-muted mt-0.5">
                {unit === "unistore" && "Click una fila para ver SKUs/clientes top de la provincia"}
                {unit === "unidrop" && "Ventas de dropshippers TN por provincia del comprador final"}
                {unit === "unidev" && "Casos de devolución abiertos por provincia"}
              </div>
            </div>
            {isLoading ? (
              <div className="p-12 text-center text-text-muted text-sm">Cargando...</div>
            ) : !data || data.by_province.length === 0 ? (
              <div className="p-12 text-center text-text-muted text-sm">
                Sin datos para este período/unidad.
              </div>
            ) : (
              <div className="p-3">
                <CategoryTable
                  caption=""
                  data={data.by_province.map((p) => ({
                    category: p.province,
                    value: p[metric] as number,
                    extra: { orders: p.orders, customers: p.customers, revenue: p.revenue },
                  }))}
                  formatter={metric === "revenue" ? "currency" : "number"}
                  extraColumns={[
                    { key: "orders", label: unit === "unidev" ? "Casos" : "Ord", format: "number" },
                    { key: "customers", label: "Clientes", format: "number" },
                    ...(metric !== "revenue"
                      ? [{ key: "revenue", label: unit === "unidev" ? "Monto" : "Revenue", format: "currency" as const }]
                      : []),
                  ]}
                  onRowClick={unit === "unistore" ? (r) => setSelectedProvince(r.category) : undefined}
                />
              </div>
            )}
          </div>

          {/* SIDE PANEL */}
          <div className="bg-surface border border-border rounded-xl p-5 max-h-[640px] overflow-y-auto">
            {unit !== "unistore" ? (
              <div className="text-center py-20 text-text-muted text-sm">
                <div className="text-3xl mb-3">{unit === "unidrop" ? "📦" : "↩️"}</div>
                <div className="font-semibold text-text mb-1">
                  {unit === "unidrop" ? "Dropshippers Unidrop" : "Devoluciones Unidev"}
                </div>
                <div className="px-4">
                  El drill por provincia está disponible solo para Unistore por
                  ahora. El ranking de la izquierda muestra el comportamiento
                  nacional completo del período seleccionado.
                </div>
              </div>
            ) : !selectedProvince ? (
              <div className="text-center py-20 text-text-muted text-sm">
                Click en una provincia<br />para ver el detalle
              </div>
            ) : loadingDetail || !detail ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-6 bg-soft rounded w-2/3" />
                <div className="h-32 bg-soft rounded" />
                <div className="h-32 bg-soft rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-base font-extrabold text-text">{detail.province}</div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {formatNumber(detail.totals.orders)} ordenes · {formatCurrency(detail.totals.revenue)} ·{" "}
                      {formatNumber(detail.totals.customers)} clientes
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedProvince(null)}
                    className="text-text-muted hover:text-text"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                      SKUs favoritos
                    </div>
                    <div className="divide-y divide-border/50">
                      {detail.top_skus.slice(0, 8).map((s, i) => {
                        const sku = s.extra?.sku;
                        return (
                          <SkuRow
                            key={i}
                            index={i + 1}
                            sku={sku || s.category}
                            name={s.category}
                            rightValue={formatCurrency(s.value)}
                            enrichment={sku ? skuEnriched.data?.[sku] : undefined}
                            onClick={
                              sku
                                ? () => router.push(`/dashboard/productos/${encodeURIComponent(sku)}`)
                                : undefined
                            }
                          />
                        );
                      })}
                      {detail.top_skus.length === 0 && (
                        <div className="text-xs text-text-muted text-center py-4">Sin datos</div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                      Top clientes
                    </div>
                    <div className="space-y-1">
                      {detail.top_customers.slice(0, 8).map((c, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            const id = c.extra?.customer_id;
                            if (id) router.push(`/dashboard/customer/${id}`);
                          }}
                          className="w-full flex justify-between items-center text-xs px-2 py-1.5 rounded hover:bg-soft transition text-left"
                        >
                          <span className="truncate flex-1 mr-2">
                            <span className="text-text-muted">{i + 1}.</span> {c.category}
                            {c.extra?.ciudad && c.extra.ciudad !== "-" && (
                              <span className="text-[10px] text-text-muted ml-1">· {c.extra.ciudad}</span>
                            )}
                          </span>
                          <span className="font-semibold tabular-nums text-text">{formatCurrency(c.value)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                      Top ciudades
                    </div>
                    <div className="space-y-1">
                      {detail.top_cities.slice(0, 12).map((c, i) => (
                        <div
                          key={i}
                          className="w-full flex justify-between items-center text-xs px-2 py-1"
                        >
                          <span className="truncate flex-1 mr-2">
                            <span className="text-text-muted">{i + 1}.</span> {c.category}
                            <span className="text-[10px] text-text-muted ml-1">· {c.extra?.orders ?? 0} ord</span>
                          </span>
                          <span className="font-semibold tabular-nums text-text">{formatCurrency(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Nota: el ranking principal vive en el bloque grid de arriba.
            La tabla duplicada que habia aca antes fue removida cuando se
            quito el mapa SVG roto. */}
      </div>
    </>
  );
}
