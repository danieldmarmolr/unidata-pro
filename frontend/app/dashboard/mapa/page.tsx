"use client";

import { useEffect, useMemo, useState } from "react";
// (useMemo se usa tambien en ArgentinaMap mas abajo)
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { CategoryTable } from "@/components/generic-table";
import { Segmented } from "@/components/segmented";
import { api } from "@/lib/api";
import { useGlobalFilters, periodToQuery } from "@/lib/store";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { geoMercator, geoPath } from "d3-geo";
import { X } from "lucide-react";
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
              <ArgentinaMap
                geoData={geoData!}
                valueByProvince={valueByProvince}
                maxValue={maxValue}
                selectedProvince={selectedProvince}
                onSelect={setSelectedProvince}
                hoverProvince={hoverProvince}
                onHover={(h) => setHoverProvince(h)}
                metric={metric}
                fmtMetric={fmtMetric}
              />
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

// ============================================================
// ArgentinaMap: SVG renderizado manualmente con d3-geo + fitSize.
// Garantiza que el contorno completo del pais llene el canvas, sin
// depender de scale/center magicos de react-simple-maps que estaban
// dando problemas en Next 16 / Turbopack.
// ============================================================
type Hover = { name: string; value: number; x: number; y: number } | null;

function ArgentinaMap({
  geoData,
  valueByProvince,
  maxValue,
  selectedProvince,
  onSelect,
  hoverProvince,
  onHover,
  metric,
  fmtMetric,
}: {
  geoData: GeoCollection;
  valueByProvince: Map<string, number>;
  maxValue: number;
  selectedProvince: string | null;
  onSelect: (n: string) => void;
  hoverProvince: Hover;
  onHover: (h: Hover) => void;
  metric: Metric;
  fmtMetric: (v: number) => string;
}) {
  // Canvas. Argentina es alta (~33 grados de latitud) y angosta (~20 lon).
  const W = 600;
  const H = 820;

  // Proyeccion calculada de forma EXPLICITA - no usamos fitSize() porque
  // en build de produccion de Next 16 / Turbopack el resultado colapsaba a
  // un solo rectangulo. Calculamos bounds proyectados con scale=1 y
  // derivamos scale + translate manualmente.
  const { pathGen, fc } = useMemo(() => {
    // Filtramos features con geometria valida para evitar NaN en bounds
    const fc = {
      type: "FeatureCollection" as const,
      features: geoData.features.filter((f) => !!f.geometry),
    };
    const baseProj = geoMercator()
      .scale(1)
      .translate([0, 0])
      .center([0, 0]);
    const basePath = geoPath(baseProj);
    const [[x0, y0], [x1, y1]] = basePath.bounds(fc as any);
    const dx = x1 - x0;
    const dy = y1 - y0;
    // 0.96 deja un pequeno margen interno
    const scale = (0.96 * Math.min(W / dx, H / dy)) || 1;
    const tx = (W - scale * (x1 + x0)) / 2;
    const ty = (H - scale * (y1 + y0)) / 2;
    const proj = geoMercator().scale(scale).translate([tx, ty]).center([0, 0]);
    const path = geoPath(proj);
    return { pathGen: path, fc };
  }, [geoData]);

  return (
    <div
      className="relative rounded-lg overflow-hidden border border-border"
      style={{
        background: "linear-gradient(180deg, #f0f7ff 0%, #d8e8f5 100%)",
      }}
      onMouseLeave={() => onHover(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "auto",
          maxHeight: "calc(100vh - 220px)",
          display: "block",
        }}
      >
        {/* Provincias */}
        <g>
          {fc.features.map((f, i) => {
            const name = f.properties?.NAME_1 ?? "";
            const value = valueByProvince.get(name) ?? 0;
            const isSelected = selectedProvince === name;
            const isHover = hoverProvince?.name === name;
            const d = pathGen(f as any);
            if (!d) return null;
            const fill = isHover
              ? "#a259ff"
              : isSelected
                ? "#5d2d8e"
                : colorScale(value, maxValue);
            const stroke = isSelected ? "#5d2d8e" : "#7a8aa1";
            return (
              <path
                key={`prov-${i}`}
                d={d}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 1.8 : 0.6}
                strokeLinejoin="round"
                style={{ cursor: "pointer", transition: "fill 150ms ease" }}
                onClick={() => onSelect(name)}
                onMouseEnter={(e) =>
                  onHover({ name, value, x: e.clientX, y: e.clientY })
                }
                onMouseMove={(e) =>
                  onHover({ name, value, x: e.clientX, y: e.clientY })
                }
              />
            );
          })}
        </g>

        {/* Labels: solo provincias grandes */}
        <g pointerEvents="none">
          {fc.features.map((f, i) => {
            const name = f.properties?.NAME_1 ?? "";
            const value = valueByProvince.get(name) ?? 0;
            const bounds = pathGen.bounds(f as any);
            const w = bounds[1][0] - bounds[0][0];
            const h = bounds[1][1] - bounds[0][1];
            if (!Number.isFinite(w) || !Number.isFinite(h) || w < 32 || h < 32) return null;
            const c = pathGen.centroid(f as any);
            if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
            const isDark = value > 0 && value / Math.max(maxValue, 1) > 0.4;
            const fontSize = Math.min(11, Math.max(8, Math.min(w, h) / 6));
            return (
              <text
                key={`lbl-${i}`}
                x={c[0]}
                y={c[1]}
                textAnchor="middle"
                style={{
                  fontFamily: "Inter, system-ui, sans-serif",
                  fontSize,
                  fontWeight: 700,
                  fill: isDark ? "#fff" : "#1f1235",
                  paintOrder: "stroke",
                  stroke: isDark ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.85)",
                  strokeWidth: 2.4,
                  strokeLinejoin: "round",
                }}
              >
                {name}
              </text>
            );
          })}
        </g>
      </svg>

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

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-[10px] shadow-sm">
        <div className="font-semibold mb-1 text-text-muted uppercase tracking-wider">{metric}</div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">0</span>
          <div
            className="w-32 h-2 rounded-full"
            style={{ background: `linear-gradient(to right, ${SCALE_COLORS[0]}, ${SCALE_COLORS[2]}, ${SCALE_COLORS[4]})` }}
          />
          <span className="text-text font-semibold">{maxValue ? fmtMetric(maxValue) : "—"}</span>
        </div>
      </div>

      {!selectedProvince && (
        <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-[10px] text-text-muted shadow-sm">
          Click en una provincia para ver el detalle
        </div>
      )}
    </div>
  );
}
