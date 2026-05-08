"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { X } from "lucide-react";

const TOPO_URL = "/argentina-provinces.json";

// Tipos minimos para el geojson
type GeoFeature = {
  type: "Feature";
  geometry: any;
  properties: { NAME_1?: string; [k: string]: any };
};
type GeoCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

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

// Discrete categorical buckets (5 levels) for clear contrast
const SCALE_COLORS = [
  "#f8f5fb", // 0 (very pale)
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
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);

  // FIX: fetch manual del geojson en lugar de pasar la URL a Geographies.
  // En Next.js 16 + Turbopack, react-simple-maps no resuelve la URL por si solo.
  const [geoData, setGeoData] = useState<GeoCollection | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    fetch(TOPO_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: GeoCollection) => {
        if (!cancel) setGeoData(j);
      })
      .catch((e) => {
        if (!cancel) setGeoError(e.message ?? "fallo cargar mapa");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const qs = periodToQuery(period, customFrom, customTo);

  const { data, isLoading } = useQuery<GeoOverview>({
    queryKey: ["geo", period, customFrom, customTo],
    queryFn: () => api(`/api/dashboards/geo?${qs}`),
    staleTime: 60_000,
  });

  const { data: detail, isLoading: loadingDetail } = useQuery<ProvinceDetail>({
    queryKey: ["geo-province", selectedProvince, period, customFrom, customTo],
    queryFn: () =>
      api(
        `/api/dashboards/geo/province/${encodeURIComponent(selectedProvince!)}?${qs}`,
      ),
    enabled: !!selectedProvince,
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

  return (
    <>
      <Topbar
        title="Mapa de distribucion"
        subtitle="Argentina · revenue / ordenes / clientes por provincia · click para drill"
      />
      <div className="flex-1 px-8 py-6 overflow-y-auto">
        {/* Filtros */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <Segmented<Metric>
            value={metric}
            onChange={setMetric}
            options={[
              { value: "revenue", label: "Revenue" },
              { value: "orders", label: "Ordenes" },
              { value: "customers", label: "Clientes" },
            ]}
          />
          {data && (
            <div className="text-xs text-text-muted">
              Total {data.totals.provinces_with_data} provincias con datos · {formatNumber(data.totals.orders)} ordenes ·{" "}
              {formatCurrency(data.totals.revenue)} revenue
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* MAP */}
          <div className="xl:col-span-2 bg-surface border border-border rounded-xl p-3">
            {isLoading || (!geoData && !geoError) ? (
              <div className="h-[600px] animate-pulse bg-soft rounded" />
            ) : geoError ? (
              <div className="h-[600px] flex items-center justify-center text-error text-sm bg-soft rounded">
                Error cargando mapa: {geoError}
              </div>
            ) : (
              <div className="relative bg-white rounded-lg">
                <ComposableMap
                  projection="geoMercator"
                  projectionConfig={{ center: [-65, -40], scale: 700 }}
                  width={700}
                  height={900}
                  style={{ width: "100%", height: "auto", maxHeight: "calc(100vh - 280px)" }}
                >
                  <Geographies geography={geoData!}>
                    {({ geographies }: { geographies: any[] }) => (
                      <>
                        {geographies.map((geo) => {
                          const name = geo.properties?.NAME_1 ?? "";
                          const value = valueByProvince.get(name) ?? 0;
                          const isSelected = selectedProvince === name;
                          return (
                            <Geography
                              key={geo.rsmKey}
                              geography={geo}
                              onClick={() => setSelectedProvince(name)}
                              style={{
                                default: {
                                  fill: colorScale(value, maxValue),
                                  stroke: isSelected ? "#7a3eae" : "#ffffff",
                                  strokeWidth: isSelected ? 2.5 : 1,
                                  outline: "none",
                                  cursor: "pointer",
                                },
                                hover: {
                                  fill: "#a259ff",
                                  stroke: "#7a3eae",
                                  strokeWidth: 1.5,
                                  outline: "none",
                                  cursor: "pointer",
                                },
                                pressed: {
                                  fill: "#7a3eae",
                                  outline: "none",
                                },
                              }}
                            >
                              <title>
                                {name}: {fmtMetric(value)}
                              </title>
                            </Geography>
                          );
                        })}
                        {geographies.map((geo) => {
                          const name = geo.properties?.NAME_1 ?? "";
                          const value = valueByProvince.get(name) ?? 0;
                          let centroid: [number, number];
                          try { centroid = geoCentroid(geo) as [number, number]; } catch { return null; }
                          if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) return null;
                          // Color del label segun fondo
                          const isDark = value > 0 && (value / Math.max(maxValue, 1)) > 0.4;
                          const fontSize = name.length > 14 ? 8 : name.length > 10 ? 9 : 10;
                          return (
                            <Marker key={`label-${geo.rsmKey}`} coordinates={centroid}>
                              <text
                                textAnchor="middle"
                                style={{
                                  fontFamily: "Inter, system-ui, sans-serif",
                                  fontSize,
                                  fontWeight: 700,
                                  fill: isDark ? "#fff" : "#1f1235",
                                  pointerEvents: "none",
                                  textShadow: isDark ? "none" : "0 0 3px rgba(255,255,255,0.8)",
                                }}
                              >
                                {name}
                              </text>
                            </Marker>
                          );
                        })}
                      </>
                    )}
                  </Geographies>
                </ComposableMap>
                {/* Legend */}
                <div className="absolute bottom-2 right-2 bg-surface/90 border border-border rounded-lg px-3 py-2 text-[10px]">
                  <div className="font-semibold mb-1 text-text-muted uppercase tracking-wider">{metric}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">0</span>
                    <div className="w-32 h-2 rounded-full" style={{
                      background: "linear-gradient(to right, #f1eaf7, #7a3eae)",
                    }} />
                    <span className="text-text">{maxValue ? fmtMetric(maxValue) : "—"}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SIDE PANEL */}
          <div className="bg-surface border border-border rounded-xl p-5 max-h-[640px] overflow-y-auto">
            {!selectedProvince ? (
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
                    <div className="space-y-1">
                      {detail.top_skus.slice(0, 8).map((s, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            const sku = s.extra?.sku;
                            if (sku) router.push(`/dashboard/productos/${encodeURIComponent(sku)}`);
                          }}
                          className="w-full flex justify-between items-center text-xs px-2 py-1.5 rounded hover:bg-soft transition text-left"
                        >
                          <span className="truncate flex-1 mr-2">
                            <span className="text-text-muted">{i + 1}.</span> {s.category}
                          </span>
                          <span className="font-semibold tabular-nums text-text">{formatCurrency(s.value)}</span>
                        </button>
                      ))}
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

        {/* TABLE BELOW: ranking */}
        {data && (
          <div className="mt-6">
            <CategoryTable
              caption="Ranking por provincia"
              subtitle="Click para abrir el detalle"
              data={data.by_province.map((p) => ({
                category: p.province,
                value: p[metric] as number,
                extra: { orders: p.orders, customers: p.customers, revenue: p.revenue },
              }))}
              formatter={metric === "revenue" ? "currency" : "number"}
              extraColumns={[
                { key: "orders", label: "Ord", format: "number" },
                { key: "customers", label: "Clientes", format: "number" },
                ...(metric !== "revenue" ? [{ key: "revenue", label: "Revenue", format: "currency" as const }] : []),
              ]}
              onRowClick={(r) => setSelectedProvince(r.category)}
            />
          </div>
        )}
      </div>
    </>
  );
}
