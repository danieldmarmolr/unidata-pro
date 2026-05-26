"use client";

import { useState } from "react";
import { Boxes, Barcode, ChevronDown, ChevronRight, Database, CheckCircle2, XCircle, Copy, Hash } from "lucide-react";

export type DigipCodigo = {
  id?: number | null;
  Codigo?: string | null;
  codigo?: string | null;
  unidadMedidaId?: number | null;
  ean_kind?: string | null;
  [k: string]: unknown;
};

export type DigipUnidadMedida = {
  id?: number | null;
  codigos?: DigipCodigo[];
  [k: string]: unknown;
};

export type DigipArticuloInfo = {
  sku: string;
  available: boolean;
  articulo: Record<string, unknown> | null;
  articulo_columns: string[];
  unidades_medida: DigipUnidadMedida[];
  unidad_medida_columns: string[];
  codigo_columns: string[];
  ean_principal: string | null;
  ean_principal_kind: string | null;
};

type Props = { data: DigipArticuloInfo | null | undefined; loading?: boolean };

// Columnas del articulo que mostramos en "vista pretty" — basadas en el schema
// real de digip.Articulo (descubierto via information_schema). El resto se
// muestra colapsable en "ver columnas tecnicas".
const ARTICULO_PRETTY_COLS: Array<{ key: string; label: string; kind?: "bool" | "date" | "number" }> = [
  { key: "Descripcion", label: "Descripcion" },
  { key: "ArticuloTipoRotacion", label: "Rotacion" },
  { key: "DiasVidaUtil", label: "Vida util (dias)", kind: "number" },
  { key: "PesoDeclaradoPromedio", label: "Peso promedio", kind: "number" },
  { key: "UsaLote", label: "Usa lote", kind: "bool" },
  { key: "UsaSerie", label: "Usa serie", kind: "bool" },
  { key: "UsaVencimiento", label: "Usa vencimiento", kind: "bool" },
  { key: "UsaPesoDeclarado", label: "Usa peso declarado", kind: "bool" },
  { key: "EsVirtual", label: "Es virtual", kind: "bool" },
  { key: "Activo", label: "Activo", kind: "bool" },
  { key: "createdAt", label: "Creado", kind: "date" },
  { key: "updatedAt", label: "Actualizado", kind: "date" },
];

function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

function fmtValue(v: unknown, kind?: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "Si" : "No";
  if (kind === "number" && typeof v === "number") {
    return v.toLocaleString("es-AR", { maximumFractionDigits: 4 });
  }
  if (typeof v === "number") return v.toLocaleString("es-AR");
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function eanKindTone(kind: string | null | undefined): string {
  switch (kind) {
    case "EAN-13":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "UPC-A":
      return "bg-blue-50 text-blue-800 border-blue-200";
    case "EAN-8":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "GTIN-14":
      return "bg-violet-50 text-violet-800 border-violet-200";
    default:
      return "bg-soft text-text-muted border-border";
  }
}

export function SkuDigipArticulo({ data, loading }: Props) {
  // Colapsado por default — la info maestra es contexto, no la prioridad de la
  // pagina. Daniel pidio que no robe la atencion del bloque "Stock vs Demanda".
  const [collapsed, setCollapsed] = useState(true);
  const [showAllArticulo, setShowAllArticulo] = useState(false);
  const [expandedUM, setExpandedUM] = useState<Set<number>>(new Set());

  if (loading) {
    return <div className="bg-surface border border-border rounded-xl p-5 h-[64px] animate-pulse mb-6" />;
  }
  if (!data || !data.available || !data.articulo) {
    return null;
  }

  const a = data.articulo;
  const totalCodigos = data.unidades_medida.reduce((acc, um) => acc + (um.codigos?.length ?? 0), 0);

  function toggleUM(id: number) {
    const next = new Set(expandedUM);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedUM(next);
  }

  const prettyRows = ARTICULO_PRETTY_COLS.map((c) => ({
    label: c.label,
    key: c.key,
    value: fmtValue(a[c.key], c.kind),
  })).filter((r) => r.value !== null);

  const otherCols = data.articulo_columns.filter(
    (c) => !ARTICULO_PRETTY_COLS.some((p) => p.key === c),
  );

  const activo = Boolean(a["Activo"]);
  const descripcion = (a["Descripcion"] as string) || "";

  return (
    <div className="bg-surface border border-border rounded-xl mb-6">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between flex-wrap gap-2 px-5 py-3 hover:bg-soft/30 transition rounded-xl"
      >
        <div className="flex items-center gap-3 text-left">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Database size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {collapsed ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
              <h3 className="text-sm font-bold text-text">Maestro DIGIP del articulo</h3>
            </div>
            <p className="text-[11px] text-text-muted truncate">
              {descripcion ? `${descripcion} · ` : ""}
              Fuente: digip.Articulo + UnidadMedida + Codigo · click para {collapsed ? "expandir" : "colapsar"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activo && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
              <CheckCircle2 size={9} /> activo
            </span>
          )}
          <span className="text-[11px] text-text-muted">
            <span className="font-extrabold text-text">{data.unidades_medida.length}</span> UM
          </span>
          <span className="text-[11px] text-text-muted">
            <span className="font-extrabold text-primary">{totalCodigos}</span> GS1
          </span>
          {data.ean_principal && (
            <span className="font-mono text-[11px] text-text-muted hidden md:inline">
              EAN <span className="font-bold text-text">{data.ean_principal}</span>
            </span>
          )}
        </div>
      </button>

      {!collapsed && (
      <div className="px-5 pb-5">

      {/* Pretty grid */}
      {prettyRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {prettyRows.map((r) => (
            <div key={r.key} className="bg-soft/30 border border-border rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold truncate" title={r.label}>
                {r.label}
              </div>
              <div className="text-sm font-semibold text-text mt-0.5 break-words">{r.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toggle: ver todas las columnas */}
      {otherCols.length > 0 && (
        <div className="mb-4">
          <button
            onClick={() => setShowAllArticulo((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
          >
            {showAllArticulo ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showAllArticulo ? "Ocultar" : "Ver"} columnas tecnicas ({otherCols.length})
          </button>
          {showAllArticulo && (
            <div className="mt-2 border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-soft/40 text-text-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wider text-[10px]">Columna</th>
                    <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wider text-[10px]">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {otherCols.map((c) => {
                    const v = fmtValue(a[c]);
                    return (
                      <tr key={c}>
                        <td className="px-3 py-1.5 font-mono text-text-muted">{c}</td>
                        <td className="px-3 py-1.5 break-words">{v ?? <span className="text-text-muted italic">(vacio)</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Unidades de medida + codigos */}
      {data.unidades_medida.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-soft/40 px-3 py-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted font-bold">
            <Boxes size={12} className="text-primary" />
            Unidades de medida ({data.unidades_medida.length}) y codigos GS1 ({totalCodigos})
          </div>
          <div className="divide-y divide-border">
            {data.unidades_medida.map((um) => {
              const id = (um.id as number | null) ?? 0;
              const isOpen = expandedUM.has(id);
              const codigos = um.codigos ?? [];

              // Etiqueta legible para la fila. digip usa flags booleanos en vez
              // de un campo "nombre" — los mapeamos a algo legible.
              const isMenor = Boolean(um["EsUnidadMenor"] ?? um["esUnidadMenor"]);
              const isVenta = Boolean(um["EsUnidadDeVenta"] ?? um["esUnidadDeVenta"]);
              const isConversion = Boolean(um["EsUnidadConversion"] ?? um["esUnidadConversion"]);
              const umId = um["UnidadMedida_Id"] ?? um["unidadMedidaId"] ?? um["UnidadMedidaId"];
              // digip.Unidades en UM = factor de conversion (1 unidad / N en una caja, etc)
              const factor = um["Unidades"] ?? um["factor"] ?? um["Factor"];

              // Etiqueta principal: descripcion textual si existe, sino "Unidad menor / caja x N"
              const labelKeys = ["descripcion", "Descripcion", "unidadMedida", "UnidadMedida", "nombre", "Nombre"];
              let label = "";
              for (const k of labelKeys) {
                const v = um[k];
                if (typeof v === "string" && v.trim()) {
                  label = v.trim();
                  break;
                }
              }
              if (!label) {
                if (isMenor) label = "Unidad menor";
                else if (typeof factor === "number" && factor > 1) label = `Caja x ${factor}`;
                else label = `Unidad de medida #${umId ?? "?"}`;
              }
              const isPrincipal = isMenor; // la "principal" es la unidad menor (unidad de venta basica)

              return (
                <div key={id}>
                  <button
                    onClick={() => toggleUM(id)}
                    className="w-full grid grid-cols-12 gap-2 items-center px-3 py-2.5 hover:bg-soft/30 transition text-sm"
                  >
                    <div className="col-span-6 inline-flex items-center gap-2 text-left flex-wrap">
                      {isOpen ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
                      <Boxes size={12} className="text-primary shrink-0" />
                      <span className="font-semibold truncate" title={label}>{label}</span>
                      {isPrincipal && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
                          <CheckCircle2 size={9} /> menor
                        </span>
                      )}
                      {isVenta && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-cyan-50 text-cyan-800 border-cyan-200">
                          venta
                        </span>
                      )}
                      {isConversion && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 text-violet-800 border-violet-200">
                          conversion
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-text-muted tabular-nums text-xs">
                      {factor !== null && factor !== undefined ? `x ${factor} u` : ""}
                    </div>
                    <div className="col-span-3 text-right">
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-text-muted">
                        <Hash size={10} /> id {id}
                      </span>
                    </div>
                    <div className="col-span-1 text-right font-bold tabular-nums text-primary">
                      {codigos.length}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="bg-soft/20 px-4 py-3 border-t border-border space-y-3">
                      {/* Detalle completo de la UM (todas las columnas con valor) */}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {data.unidad_medida_columns
                          .filter((c) => c !== "codigos" && c !== "id" && um[c] !== null && um[c] !== undefined && String(um[c]).trim() !== "")
                          .map((c) => (
                            <div key={c} className="bg-surface border border-border rounded px-2 py-1">
                              <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold truncate">{c}</div>
                              <div className="text-xs font-semibold text-text break-words">{fmtValue(um[c])}</div>
                            </div>
                          ))}
                      </div>

                      {/* Codigos */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold flex items-center gap-1 mb-2">
                          <Barcode size={11} /> Codigos escaneables
                        </div>
                        {codigos.length === 0 ? (
                          <div className="text-[11px] text-text-muted italic py-1">Sin codigos cargados en esta unidad de medida.</div>
                        ) : (
                          <div className="space-y-1.5">
                            {codigos.map((cod, i) => {
                              const codigo = (cod.Codigo ?? cod.codigo ?? "") as string;
                              const kind = cod.ean_kind ?? null;
                              return (
                                <div key={(cod.id as number | null) ?? i} className="flex items-center gap-2 flex-wrap text-xs bg-surface border border-border rounded px-2 py-1.5">
                                  <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${eanKindTone(kind)}`}>
                                    <Barcode size={9} /> {kind ?? "OTRO"}
                                  </span>
                                  <span className="font-mono font-extrabold tracking-wider text-text">{codigo || <span className="italic text-text-muted">(vacio)</span>}</span>
                                  {codigo && (
                                    <button
                                      onClick={() => copyToClipboard(codigo)}
                                      className="text-[10px] text-text-muted hover:text-primary inline-flex items-center gap-0.5"
                                      title="Copiar"
                                    >
                                      <Copy size={10} />
                                    </button>
                                  )}
                                  {/* Resto de columnas no vacias del codigo */}
                                  <div className="flex gap-2 flex-wrap text-[10px] text-text-muted ml-auto">
                                    {data.codigo_columns
                                      .filter((c) => c !== "Codigo" && c !== "codigo" && c !== "ean_kind" && c !== "id" && c !== "unidadMedidaId" && cod[c] !== null && cod[c] !== undefined && String(cod[c]).trim() !== "")
                                      .map((c) => (
                                        <span key={c}>
                                          <span className="font-bold text-text-muted">{c}:</span>{" "}
                                          <span className="text-text">{fmtValue(cod[c])}</span>
                                        </span>
                                      ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="py-3 text-center text-text-muted text-xs italic flex items-center justify-center gap-1.5">
          <XCircle size={12} /> Sin unidades de medida cargadas en DIGIP para este SKU.
        </div>
      )}

      {data.ean_principal && (
        <div className="mt-3 text-[11px] text-text-muted">
          EAN principal detectado:{" "}
          <span className="font-mono font-bold text-text">{data.ean_principal}</span>
          {data.ean_principal_kind && (
            <span className={`ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${eanKindTone(data.ean_principal_kind)}`}>
              {data.ean_principal_kind}
            </span>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
}
