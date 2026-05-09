"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { KpiCard } from "@/components/kpi-card";
import { CategoryTable } from "@/components/generic-table";
import { DailyRevenueChart } from "@/components/sparkline";
import { api } from "@/lib/api";
import { ArrowLeft } from "lucide-react";
import type { KpiCard as KpiCardT, CategoryValue, TimeSeries } from "@/lib/types";

type CostInfo = {
  sku: string;
  lote: string | null;
  fecha_ingreso: string | null;
  cost_usd: number | null;
  cost_ars: number | null;
  usd_rate: number | null;
  margen_estimado_lifetime?: number;
  margen_pct?: number;
} | null;

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
  generated_at: string;
};

export default function ProductDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku: skuRaw } = use(params);
  const sku = decodeURIComponent(skuRaw);
  const router = useRouter();

  const { data, isLoading, error } = useQuery<Detail>({
    queryKey: ["product-detail", sku],
    queryFn: () => api(`/api/dashboards/products/sku/${encodeURIComponent(sku)}`),
    staleTime: 60_000,
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-text-muted">Marca</div>
                <div className="font-semibold">{data.product_info.brand || "—"}</div>
              </div>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          {isLoading || !data
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-surface border border-border rounded-xl p-5 h-[126px] animate-pulse" />
              ))
            : data.cards.map((c) => <KpiCard key={c.label} data={c} />)}
        </div>

        {data?.cost_info && data.cost_info.cost_ars && (
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/30 rounded-xl px-5 py-4 mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Lote vigente</div>
              <div className="font-mono font-semibold">{data.cost_info.lote}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Costo importacion (USD)</div>
              <div className="font-bold">US$ {data.cost_info.cost_usd?.toFixed(2) ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Costo en ARS</div>
              <div className="font-bold text-primary">$ {data.cost_info.cost_ars.toLocaleString("es-AR")}</div>
              {data.cost_info.usd_rate && (
                <div className="text-[10px] text-text-muted">@ USD venta $ {data.cost_info.usd_rate.toFixed(2)} BNA</div>
              )}
            </div>
            {typeof data.cost_info.margen_estimado_lifetime === "number" && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Margen estimado lifetime</div>
                <div className="font-bold text-emerald-700">
                  $ {data.cost_info.margen_estimado_lifetime.toLocaleString("es-AR")}
                  {typeof data.cost_info.margen_pct === "number" && (
                    <span className="text-xs text-text-muted ml-1">({data.cost_info.margen_pct}%)</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {data && !data.cost_info && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-6 text-sm">
            ⚠ Sin costo de importacion cargado para este SKU.{" "}
            <a href="/dashboard/costos" className="underline font-semibold">Ir a Costos</a> para subir el lote.
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            </>
          ) : (
            <>
              <DailyRevenueChart
                points={data.monthly_revenue.points}
                caption="Revenue mensual (12m)"
                subtitle="Ordenes pagas en TN"
              />
              <DailyRevenueChart
                points={data.monthly_units.points}
                caption="Unidades mensuales (12m)"
                subtitle="Cantidad vendida"
              />
            </>
          )}
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {isLoading || !data ? (
            <>
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
              <div className="bg-surface border border-border rounded-xl p-5 h-[340px] animate-pulse" />
            </>
          ) : (
            <>
              <CategoryTable
                caption="Stock por area (Digip)"
                subtitle="Suma de unidades + ubicaciones"
                data={data.stock_by_area}
                formatter="number"
                extraColumns={[{ key: "ubicaciones", label: "Ubic", format: "number" }]}
              />
              <CategoryTable
                caption="Devoluciones (Unidev)"
                subtitle={data.devoluciones.length === 0 ? "Sin devoluciones registradas" : "Ultimas 20"}
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
