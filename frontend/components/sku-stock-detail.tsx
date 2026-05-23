"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MapPin, Boxes, Calendar } from "lucide-react";
import { formatNumber } from "@/lib/utils";

type Ubicacion = { ubicacion: string; units: number };

type AreaBlock = {
  area: string;
  total: number;
  ubicaciones: Ubicacion[];
  last_movement: string | null;
  movements_count: number;
};

type StockDetail = {
  sku: string;
  total: number;
  total_ubicaciones: number;
  areas_count: number;
  areas: AreaBlock[];
};

type Props = { data: StockDetail };

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    return Math.floor(diff);
  } catch {
    return null;
  }
}

function freshnessTone(days: number | null): { label: string; cls: string } {
  if (days === null) return { label: "Sin movimientos", cls: "bg-soft/60 text-text-muted border-border" };
  if (days <= 30) return { label: `Movido hace ${days}d`, cls: "bg-emerald-50 text-emerald-800 border-emerald-200" };
  if (days <= 90) return { label: `Movido hace ${days}d`, cls: "bg-amber-50 text-amber-800 border-amber-200" };
  return { label: `Sin mover ${days}d`, cls: "bg-rose-50 text-rose-800 border-rose-200" };
}

export function SkuStockDetail({ data }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(area: string) {
    const next = new Set(expanded);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    setExpanded(next);
  }

  if (!data || data.total === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-5">
        <div className="text-sm font-bold text-text mb-1">Stock DIGIP detallado</div>
        <div className="py-6 text-center text-text-muted text-sm">
          Sin stock registrado en DIGIP para este SKU.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Boxes size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text">Stock DIGIP detallado</h3>
            <p className="text-[11px] text-text-muted">
              Click una área para expandir ubicaciones · {data.areas_count} áreas · {data.total_ubicaciones} ubicaciones
            </p>
          </div>
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Total</div>
            <div className="text-xl font-extrabold text-text tabular-nums">{formatNumber(data.total)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Ubicaciones</div>
            <div className="text-xl font-extrabold text-primary tabular-nums">{data.total_ubicaciones}</div>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="bg-soft/60 px-3 py-2 grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-text-muted font-bold">
          <div className="col-span-5">Área</div>
          <div className="col-span-2 text-right">Unidades</div>
          <div className="col-span-1 text-right">Ubic.</div>
          <div className="col-span-3 text-center">% mix</div>
          <div className="col-span-1 text-right">Edad</div>
        </div>
        <div className="divide-y divide-border">
          {data.areas.map((a) => {
            const isOpen = expanded.has(a.area);
            const pct = data.total > 0 ? (a.total / data.total) * 100 : 0;
            const days = daysSince(a.last_movement);
            const tone = freshnessTone(days);
            return (
              <div key={a.area}>
                <button
                  onClick={() => toggle(a.area)}
                  className="w-full grid grid-cols-12 gap-2 items-center px-3 py-2.5 hover:bg-soft/40 transition text-sm"
                >
                  <div className="col-span-5 inline-flex items-center gap-1.5 text-left">
                    {isOpen ? (
                      <ChevronDown size={14} className="text-text-muted shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-text-muted shrink-0" />
                    )}
                    <MapPin size={12} className="text-primary shrink-0" />
                    <span className="font-semibold truncate">{a.area}</span>
                  </div>
                  <div className="col-span-2 text-right font-bold tabular-nums">{formatNumber(a.total)}</div>
                  <div className="col-span-1 text-right text-text-muted tabular-nums">
                    {a.ubicaciones.length}
                  </div>
                  <div className="col-span-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-soft rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct.toFixed(1)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted tabular-nums w-10 text-right">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="col-span-1 text-right">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${tone.cls}`}
                      title={a.last_movement ? `Último movimiento DIGIP: ${a.last_movement} · ${a.movements_count} ajustes` : "Sin ajustes registrados"}
                    >
                      <Calendar size={10} />
                      {days !== null ? `${days}d` : "—"}
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="bg-soft/30 px-4 py-2 border-t border-border">
                    {a.ubicaciones.length === 0 ? (
                      <div className="text-[11px] text-text-muted italic py-1">Sin ubicaciones desagregadas</div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {a.ubicaciones.map((u, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2 text-xs bg-surface border border-border rounded px-2 py-1.5"
                          >
                            <span className="font-mono text-[11px] truncate text-text" title={u.ubicacion}>
                              {u.ubicacion}
                            </span>
                            <span className="font-bold tabular-nums text-primary">{formatNumber(u.units)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {a.last_movement && (
                      <div className="text-[10px] text-text-muted mt-2">
                        Último ajuste registrado en DIGIP: <strong className="text-text">{a.last_movement}</strong>
                        {" · "}
                        <strong className="text-text">{a.movements_count}</strong> ajustes históricos
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
