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
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { geoCentroid } from "d3-geo";
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useSkuEnrichment } from "@/lib/use-sku-enrichment";
import { SkuRow } from "@/components/sku-row";

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
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [hoverProvince, setHoverProvince] = useState<{ name: string; value: number; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mapCenter, setMapCenter] = useState<[number, number]>([-65, -38]);

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
              <div
                className="relative rounded-lg overflow-hidden border border-border"
                style={{
                  // Fondo estilo gubernamental: celeste muy suave con vignette
                  background: "radial-gradient(ellipse at center, #f0f7ff 0%, #e0ecf7 100%)",
                  minHeight: 500,
                }}
                onMouseLeave={() => setHoverProvince(null)}
              >
                <ComposableMap
                  projection="geoMercator"
                  // Argentina: lat -22 a -55 (33° de span), lon -73 a -53 (20°).
                  // Centro [-65, -38]. Mercator a -38° lat: scale ~1500 llena 900px alto.
                  projectionConfig={{ center: mapCenter, scale: 1500 }}
                  width={550}
                  height={900}
                  style={{ width: "100%", height: "auto", maxHeight: "calc(100vh - 220px)", display: "block" }}
                >
                  <ZoomableGroup
                    zoom={zoom}
                    center={mapCenter}
                    onMoveEnd={({ coordinates, zoom: z }: any) => {
                      setMapCenter(coordinates as [number, number]);
                      setZoom(z);
                    }}
                    minZoom={1}
                    maxZoom={6}
                  >
                    <Geographies geography={geoData!}>
                      {({ geographies }: { geographies: any[] }) => (
                        <>
                          {/* Halo del país: outline general en azul oscuro */}
                          {geographies.map((geo) => (
                            <Geography
                              key={`halo-${geo.rsmKey}`}
                              geography={geo}
                              style={{
                                default: { fill: "transparent", stroke: "#1e3a5f", strokeWidth: 1.4, outline: "none" },
                                hover: { fill: "transparent", stroke: "#1e3a5f", strokeWidth: 1.4, outline: "none" },
                                pressed: { fill: "transparent", outline: "none" },
                              }}
                            />
                          ))}
                          {/* Provincias coloreadas */}
                          {geographies.map((geo) => {
                            const name = geo.properties?.NAME_1 ?? "";
                            const value = valueByProvince.get(name) ?? 0;
                            const isSelected = selectedProvince === name;
                            return (
                              <Geography
                                key={geo.rsmKey}
                                geography={geo}
                                onClick={() => setSelectedProvince(name)}
                                onMouseEnter={(e: any) => {
                                  setHoverProvince({
                                    name,
                                    value,
                                    x: e.clientX,
                                    y: e.clientY,
                                  });
                                }}
                                onMouseMove={(e: any) => {
                                  setHoverProvince((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
                                }}
                                onMouseLeave={() => setHoverProvince(null)}
                                style={{
                                  default: {
                                    fill: colorScale(value, maxValue),
                                    stroke: isSelected ? "#5d2d8e" : "#7a8aa1",
                                    strokeWidth: isSelected ? 2 : 0.5,
                                    outline: "none",
                                    cursor: "pointer",
                                    transition: "fill 150ms ease",
                                  },
                                  hover: {
                                    fill: "#a259ff",
                                    stroke: "#5d2d8e",
                                    strokeWidth: 1.5,
                                    outline: "none",
                                    cursor: "pointer",
                                    filter: "drop-shadow(0 0 4px rgba(122, 62, 174, 0.5))",
                                  },
                                  pressed: {
                                    fill: "#5d2d8e",
                                    outline: "none",
                                  },
                                }}
                              />
                            );
                          })}
                          {/* Labels solo cuando zoom > 1 o si la provincia es grande */}
                          {zoom >= 1.2 && geographies.map((geo) => {
                            const name = geo.properties?.NAME_1 ?? "";
                            const value = valueByProvince.get(name) ?? 0;
                            let centroid: [number, number];
                            try { centroid = geoCentroid(geo) as [number, number]; } catch { return null; }
                            if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) return null;
                            const isDark = value > 0 && (value / Math.max(maxValue, 1)) > 0.4;
                            const fontSize = (name.length > 14 ? 7 : name.length > 10 ? 8 : 9) / Math.max(zoom * 0.7, 1);
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
                                    textShadow: isDark ? "none" : "0 0 3px rgba(255,255,255,0.9)",
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
                  </ZoomableGroup>
                </ComposableMap>

                {/* Tooltip flotante */}
                {hoverProvince && (
                  <div
                    className="fixed z-50 pointer-events-none bg-zinc-900/95 text-white px-3 py-2 rounded-lg shadow-xl text-xs"
                    style={{
                      left: hoverProvince.x + 12,
                      top: hoverProvince.y + 12,
                      maxWidth: 240,
                    }}
                  >
                    <div className="font-bold text-sm">{hoverProvince.name}</div>
                    <div className="text-[10px] uppercase tracking-wider opacity-70 mt-0.5">{metric}</div>
                    <div className="font-bold text-emerald-400">{fmtMetric(hoverProvince.value)}</div>
                    <div className="text-[10px] opacity-60 mt-1">Click para abrir detalle</div>
                  </div>
                )}

                {/* Controles de zoom */}
                <div className="absolute top-3 right-3 flex flex-col gap-1 bg-white/90 backdrop-blur-sm border border-border rounded-lg shadow-md overflow-hidden">
                  <button
                    onClick={() => setZoom((z) => Math.min(z * 1.5, 6))}
                    className="p-2 hover:bg-soft transition"
                    title="Acercar"
                  >
                    <ZoomIn size={14} />
                  </button>
                  <button
                    onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}
                    className="p-2 hover:bg-soft transition border-t border-border"
                    title="Alejar"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <button
                    onClick={() => { setZoom(1); setMapCenter([-65, -38]); }}
                    className="p-2 hover:bg-soft transition border-t border-border"
                    title="Restablecer vista"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>

                {/* Legend */}
                <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-[10px] shadow-sm">
                  <div className="font-semibold mb-1 text-text-muted uppercase tracking-wider">{metric}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">0</span>
                    <div className="w-32 h-2 rounded-full" style={{
                      background: `linear-gradient(to right, ${SCALE_COLORS[0]}, ${SCALE_COLORS[2]}, ${SCALE_COLORS[4]})`,
                    }} />
                    <span className="text-text font-semibold">{maxValue ? fmtMetric(maxValue) : "—"}</span>
                  </div>
                </div>

                {/* Hint inicial - solo si no hay seleccion */}
                {!selectedProvince && (
                  <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-[10px] text-text-muted shadow-sm">
                    Click en una provincia · arrastrar y zoom con scroll
                  </div>
                )}
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
