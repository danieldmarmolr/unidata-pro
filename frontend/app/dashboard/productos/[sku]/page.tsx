"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { ExpandableOrderRow, type OrderRowData } from "@/components/expandable-order-row";
import { ExportButtons } from "@/components/export-buttons";
import { SkuOmnichannel, type UnidropPricingPayload } from "@/components/sku-omnichannel";
import { SkuStackedEvolution } from "@/components/sku-stacked-evolution";
import { SkuStockDetail } from "@/components/sku-stock-detail";
import { SkuLotesTimeline } from "@/components/sku-lotes-timeline";
import { SkuKpiStrip } from "@/components/sku-kpi-strip";
import { SkuDigipArticulo, type DigipArticuloInfo } from "@/components/sku-digip-articulo";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { ArrowLeft, Package } from "lucide-react";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type CostInfo = {
  sku: string;
  lote: string | null;
  fecha_ingreso: string | null;
  cantidad_lote?: number | null;
  cost_total_usd?: number | null;   // total del lote (informativo)
  cost_total_ars?: number | null;   // total del lote ARS
  cost_unit_usd?: number | null;    // per-unit USD landed
  cost_unit_ars?: number | null;    // per-unit ARS landed s/IVA
  cost_con_iva_unit_ars?: number | null; // per-unit ARS con IVA
  cost_usd: number | null;          // backwards-compat = per-unit USD
  cost_ars: number | null;          // backwards-compat = per-unit ARS s/IVA
  usd_rate: number | null;
  precio_ars_sugerido?: number | null;
  rentabilidad_ars_unit?: number | null;
  pct_rentabilidad?: number | null;
  rent_neta_lote_ars?: number | null;
  facturacion_lote_ars?: number | null;
  margen_estimado_lifetime?: number;
  margen_pct?: number;
  margen_warning?: string;
  legacy_lote?: boolean;
} | null;

type StockDetailPayload = {
  sku: string;
  total: number;
  total_ubicaciones: number;
  areas_count: number;
  areas: Array<{
    area: string;
    total: number;
    ubicaciones: Array<{ ubicacion: string; units: number }>;
    last_movement: string | null;
    movements_count: number;
  }>;
};

type ChannelForecast = {
  daily_velocity: number;
  trend_pct: number;
  forecast_30d: number;
  forecast_60d: number;
  revenue_forecast_30d?: number;
};

type ForecastPayload = {
  unistore_tn: ChannelForecast;
  unistore_meli: ChannelForecast;
  unidrop_tn: ChannelForecast;
  unidrop_meli: ChannelForecast;
  total: { forecast_30d: number; forecast_60d: number; revenue_forecast_30d: number };
};

type Lote = {
  lote: string | null;
  proveedor: string | null;
  fecha_ingreso: string | null;
  imported_at: string | null;
  cantidad: number | null;
  costo_unit_usd: number | null;
  costo_unit_ars: number | null;
  costo_con_iva_unit_ars: number | null;
  precio_ars: number | null;
  rentabilidad_ars: number | null;
  pct_rentabilidad: number | null;
  categoria?: string | null;
  ncm?: string | null;
};

type Detail = {
  sku: string;
  product_info: {
    sku: string;
    product_id: number;
    name: string;
    brand: string;
    published: boolean | null;
    price: number;
    barcode: string;
    images?: string[];
  } | null;
  images?: string[];
  cost_info: CostInfo;
  cards: KpiCardT[];
  monthly_revenue: TimeSeries;
  monthly_units: TimeSeries;
  top_customers: CategoryValue[];
  by_province: CategoryValue[];
  stock_by_area: CategoryValue[];
  devoluciones: CategoryValue[];
  first_sale: string | null;
  last_sale: string | null;
  recent_orders?: Array<{
    id: number | null;
    numero: string;
    fecha: string;
    payment: string;
    shipping: string;
    status: string;
    total: number;
    qty: number;
    precio_unit: number;
    subtotal: number;
    provincia: string;
    cliente: string;
    customer_id: number | null;
    empaquetada: boolean;
  }>;
  period?: string;
  window_label?: string;
  generated_at: string;
};

// Shape del endpoint /api/dashboards/sku-omnichannel/{sku}
type OmnichannelResp = {
  monthly_by_channel: Array<{
    mes: string;
    unistore_tn: number;
    unistore_meli: number;
    unidrop_tn: number;
    unidrop_meli: number;
    rev_unistore_tn: number;
    rev_unistore_meli: number;
    rev_unidrop_tn: number;
    rev_unidrop_meli: number;
  }>;
};

export default function ProductDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku: skuRaw } = use(params);
  const sku = decodeURIComponent(skuRaw);
  const router = useRouter();
  const searchParams = useSearchParams();

  // El filtro global del topbar manda. Si la URL trae ?period=today
  // (ej. cuando se hace click desde el blurb 'Lider TN Unistore hoy'),
  // ese valor pisa al filtro global mientras este en la URL.
  const globalPeriod = useGlobalFilters((s) => s.period);
  const customFrom = useGlobalFilters((s) => s.customFrom);
  const customTo = useGlobalFilters((s) => s.customTo);
  const urlPeriod = searchParams?.get("period");
  const effectivePeriod = (urlPeriod ?? globalPeriod) as typeof globalPeriod;
  const qs = periodToQuery(effectivePeriod, customFrom, customTo);

  const { data, isLoading, error } = useQuery<Detail>({
    queryKey: ["product-detail", sku, effectivePeriod, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}?${qs}`),
    staleTime: 60_000,
  });

  // Fetch del monthly_by_channel para el chart apilado. TanStack dedup el cache
  // con el de SkuOmnichannel por mismo queryKey - 1 sola request real.
  const { data: omni } = useQuery<OmnichannelResp>({
    queryKey: ["sku-omnichannel", sku],
    queryFn: () => api(`/api/dashboards/sku-omnichannel/${encodeURIComponent(sku)}`),
    staleTime: 5 * 60_000,
    enabled: !!sku,
  });

  // Las 4 vistas extras del SKU 360 V2 cargan en endpoints separados para que
  // la pagina renderice rapido. Cada bloque muestra skeleton hasta que llega.
  const { data: stockDetailData, isLoading: stockDetailLoading } = useQuery<StockDetailPayload>({
    queryKey: ["sku-stock-detail", sku],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}/stock-detail`),
    staleTime: 3 * 60_000,
    enabled: !!sku,
  });
  const { data: forecastData } = useQuery<ForecastPayload>({
    queryKey: ["sku-forecast", sku],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}/forecast`),
    staleTime: 3 * 60_000,
    enabled: !!sku,
  });
  const { data: unidropPricingData } = useQuery<UnidropPricingPayload>({
    queryKey: ["sku-unidrop-pricing", sku],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}/unidrop-pricing`),
    staleTime: 3 * 60_000,
    enabled: !!sku,
  });
  const { data: lotesData, isLoading: lotesLoading } = useQuery<{ lotes: Lote[] }>({
    queryKey: ["sku-lotes", sku],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}/lotes`),
    staleTime: 5 * 60_000,
    enabled: !!sku,
  });
  const { data: digipInfoData, isLoading: digipInfoLoading } = useQuery<DigipArticuloInfo>({
    queryKey: ["sku-digip-info", sku],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}/digip-info`),
    staleTime: 5 * 60_000,
    enabled: !!sku,
  });

  return (
    <>
      <Topbar
        title={data?.product_info?.name ?? `SKU ${sku}`}
        subtitle={`Producto 360 · SKU ${sku}${data?.product_info?.brand ? " · " + data.product_info.brand : ""}`}
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        <div className="mb-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text transition"
          >
            <ArrowLeft size={14} /> Volver
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-error rounded-xl px-4 py-3 text-sm">
            Error: {(error as Error).message}
          </div>
        )}

        {data?.images && data.images.length > 0 && (
          <div className="bg-surface border border-border rounded-xl p-4 mb-6">
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-3">
              Imagenes del producto ({data.images.length})
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {data.images.map((src, i) => (
                <a
                  key={src + i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 block w-32 h-32 rounded-lg border border-border overflow-hidden hover:border-primary hover:shadow-lg transition bg-soft"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`SKU ${sku} imagen ${i + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {data?.product_info && (
          <div className="bg-surface border border-border rounded-xl p-5 mb-6">
            {/* Identificacion oficial: SKU interno + EAN (codigo de barras del producto) */}
            <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b border-border">
              <div className="flex-1 min-w-[200px] bg-gradient-to-br from-primary/10 to-accent/5 border border-primary/30 rounded-xl px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider font-bold text-primary/70">Codigo interno (SKU)</div>
                <div className="font-mono font-extrabold text-lg text-text mt-0.5">{data.product_info.sku}</div>
              </div>
              <div className="flex-1 min-w-[240px] bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-300 rounded-xl px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800">
                  EAN · Codigo de barras oficial
                </div>
                {data.product_info.barcode ? (
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <div className="font-mono font-extrabold text-lg text-text tabular-nums tracking-wider">
                      {data.product_info.barcode}
                    </div>
                    <button
                      onClick={() => navigator.clipboard?.writeText(data.product_info!.barcode)}
                      className="text-[10px] text-amber-700 hover:text-amber-900 hover:underline"
                      title="Copiar EAN"
                    >
                      copiar
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-amber-700 mt-0.5">Sin EAN registrado</div>
                )}
                <div className="text-[10px] text-amber-700/80 mt-0.5">
                  Codigo escaneable identificador GS1 del producto
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {/* Marca oculta: la data esta rota (todos los productos vienen como '(sin marca)').
                  Cuando se corrija el sourcing en TN/digip se vuelve a habilitar. */}
              <div>
                <div className="text-xs text-text-muted">Precio actual</div>
                <div className="font-semibold">$ {data.product_info.price.toLocaleString("es-AR")}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Estado</div>
                <div className="font-semibold">
                  {data.product_info.published === true ? "Publicado" : data.product_info.published === false ? "Despublicado" : "—"}
                </div>
              </div>
              {data.first_sale && (
                <div>
                  <div className="text-xs text-text-muted">Primera venta</div>
                  <div className="font-semibold">{data.first_sale.slice(0, 10)}</div>
                </div>
              )}
              {data.last_sale && (
                <div>
                  <div className="text-xs text-text-muted">Ultima venta</div>
                  <div className="font-semibold">{data.last_sale.slice(0, 10)}</div>
                </div>
              )}
              {data.product_info.product_id > 0 && (
                <div>
                  <div className="text-xs text-text-muted">Product ID (TN)</div>
                  <div className="font-mono text-xs">{data.product_info.product_id}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Maestro DIGIP: vista espejo de digip.Articulo + UnidadMedida + Codigos */}
        <SkuDigipArticulo data={digipInfoData} loading={digipInfoLoading} />

        {isLoading || !data ? (
          <div className="bg-surface border border-border rounded-xl h-[68px] mb-6 animate-pulse" />
        ) : (
          <SkuKpiStrip cards={data.cards} />
        )}

        {/* Forecast hero: barras apiladas por canal + linea forecast 30d/60d */}
        {omni?.monthly_by_channel ? (
          <div className="mb-6">
            <SkuStackedEvolution
              monthly={omni.monthly_by_channel}
              forecast={forecastData ?? null}
            />
          </div>
        ) : (
          <div className="mb-6 bg-surface border border-border rounded-xl p-5 h-[440px] animate-pulse" />
        )}

        {/* Vista omnicanal del SKU: 4 fuentes (Unistore TN/MELI + Unidrop TN/MELI)
            + pricing mayorista enriquecido en las cards Unidrop */}
        <SkuOmnichannel sku={sku} unidropPricing={unidropPricingData} />

        {data?.cost_info && data.cost_info.cost_ars && (
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/30 rounded-xl px-5 py-4 mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Lote vigente</div>
              <div className="font-mono font-semibold">{data.cost_info.lote}</div>
              {data.cost_info.cantidad_lote && (
                <div className="text-[10px] text-text-muted">{data.cost_info.cantidad_lote.toLocaleString("es-AR")} unid. en lote</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Costo unitario (USD)</div>
              <div className="font-bold">US$ {(data.cost_info.cost_unit_usd ?? data.cost_info.cost_usd)?.toFixed(2) ?? "—"}</div>
              {data.cost_info.cost_total_usd && (
                <div className="text-[10px] text-text-muted">Lote: US$ {data.cost_info.cost_total_usd.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Costo unitario (ARS)</div>
              <div className="font-bold text-primary">$ {(data.cost_info.cost_unit_ars ?? data.cost_info.cost_ars).toLocaleString("es-AR")}</div>
              {data.cost_info.usd_rate && (
                <div className="text-[10px] text-text-muted">@ USD venta $ {data.cost_info.usd_rate.toFixed(2)} BNA</div>
              )}
            </div>
            {typeof data.cost_info.margen_estimado_lifetime === "number" ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Margen estimado lifetime</div>
                <div className={`font-bold ${data.cost_info.margen_estimado_lifetime >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  $ {data.cost_info.margen_estimado_lifetime.toLocaleString("es-AR")}
                  {typeof data.cost_info.margen_pct === "number" && (
                    <span className="text-xs text-text-muted ml-1">({data.cost_info.margen_pct}%)</span>
                  )}
                </div>
              </div>
            ) : data.cost_info.margen_warning ? (
              <div className="max-w-md">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">Margen lifetime</div>
                <div className="text-xs text-amber-700">{data.cost_info.margen_warning}</div>
              </div>
            ) : null}
          </div>
        )}

        {data && !data.cost_info && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-6 text-sm">
            ⚠ Sin costo de importacion cargado para este SKU.{" "}
            <a href="/dashboard/costos" className="underline font-semibold">Ir a Costos</a> para subir el lote.
          </div>
        )}

        {/* Stock DIGIP detallado: area -> ubicaciones expandible + edad de movimientos */}
        <div className="mb-6">
          {stockDetailLoading ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[280px] animate-pulse" />
          ) : stockDetailData ? (
            <SkuStockDetail data={stockDetailData} />
          ) : null}
        </div>

        {/* Historial de lotes con delta de costo vs lote previo */}
        <div className="mb-6">
          {lotesLoading ? (
            <div className="bg-surface border border-border rounded-xl p-5 h-[200px] animate-pulse" />
          ) : lotesData?.lotes && lotesData.lotes.length > 0 ? (
            <SkuLotesTimeline lotes={lotesData.lotes} loteVigente={data?.cost_info?.lote ?? null} />
          ) : null}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            </>
          ) : (
            <>
              <CategoryTable
                caption="Top 15 customers de este SKU"
                subtitle="Click para ver el customer 360"
                data={data.top_customers}
                formatter="currency"
                extraColumns={[
                  { key: "units", label: "Unid", format: "number" },
                  { key: "orders", label: "Ord", format: "number" },
                  { key: "provincia", label: "Provincia", format: "raw" },
                ]}
                onRowClick={(r) => {
                  const id = r.extra?.customer_id;
                  if (typeof id === "number" && id > 0) {
                    router.push(`/dashboard/customer/${id}`);
                  }
                }}
              />
              <CategoryTable
                caption="Distribucion por provincia"
                subtitle="Top 10"
                data={data.by_province}
                formatter="currency"
                extraColumns={[{ key: "units", label: "Unid", format: "number" }]}
              />
            </>
          )}
        </div>

        {/* Devoluciones (sola, sin stock simple — el stock detallado ya esta arriba) */}
        {data && data.devoluciones.length > 0 && (
          <div className="mb-6">
            <CategoryTable
              caption="Devoluciones (Unidev)"
              subtitle="Ultimas 20"
              data={data.devoluciones}
              formatter="currency"
              extraColumns={[
                { key: "fecha", label: "Fecha", format: "raw" },
                { key: "estado", label: "Estado", format: "raw" },
                { key: "resolucion", label: "Resol", format: "raw" },
                { key: "cantidad", label: "Cant", format: "number" },
              ]}
              showProgress={false}
            />
          </div>
        )}

        {/* Ordenes que incluyen este SKU (respeta el filtro de periodo) */}
        {data && data.recent_orders && (
          <div className="bg-surface border border-border rounded-xl p-5 mt-6">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Package size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">Órdenes con este SKU · {data.window_label || effectivePeriod}</h3>
                  <p className="text-[11px] text-text-muted">
                    {data.recent_orders.length} {data.recent_orders.length === 1 ? "orden" : "órdenes"} TN incluyen este SKU en el periodo seleccionado · click una fila para ver los items completos
                  </p>
                </div>
              </div>
              <ExportButtons
                filename={`ordenes_con_${sku}_${data.period || "30d"}`}
                columns={["#", "Numero", "Fecha", "Cliente", "Provincia", "Qty", "Precio unit", "Subtotal SKU", "Total orden", "Estado pago", "Estado envío"]}
                rows={data.recent_orders.map((o, i) => [
                  i + 1, o.numero, o.fecha, o.cliente, o.provincia,
                  o.qty, o.precio_unit, o.subtotal, o.total, o.payment, o.shipping,
                ])}
              />
            </div>
            {data.recent_orders.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">
                No hay órdenes con este SKU en el periodo seleccionado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Número</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Estado del pedido</th>
                      <th className="px-3 py-2 text-right">Total orden</th>
                      <th className="px-3 py-2 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_orders.map((o, i) => {
                      if (!o.id) return null;
                      const subtitleParts: string[] = [];
                      if (o.cliente) subtitleParts.push(o.cliente);
                      if (o.provincia) subtitleParts.push(o.provincia);
                      subtitleParts.push(`${o.qty}x · ${o.subtotal.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })} de este SKU`);
                      const orderRow: OrderRowData = {
                        id: o.id,
                        numero: o.numero,
                        fecha: o.fecha,
                        total: o.total,
                        payment: o.payment,
                        shipping: o.shipping,
                        status: o.status,
                        empaquetada: o.empaquetada,
                        canal: (o as { canal?: string }).canal,
                        subtitle: subtitleParts.join(" · "),
                      };
                      return (
                        <ExpandableOrderRow
                          key={i}
                          order={orderRow}
                          idx={i + 1}
                          cols={6}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
