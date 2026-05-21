"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Download, Upload, Loader2, Check, AlertCircle, FileSpreadsheet } from "lucide-react";
import { PageWrapper } from "../_components/PageWrapper";
import { fmtArs, fmtDate } from "../_components/helpers";

type Kind = "erogaciones" | "ingresos" | "facturacion";

type ParsedItem = {
  row: number;
  errors: string[];
  [k: string]: unknown;
};

type ParseResp = { items: ParsedItem[]; warnings?: string[]; errors?: string[]; total: number };

const KIND_LABEL: Record<Kind, string> = {
  erogaciones: "Erogaciones (pagos a realizar)",
  ingresos: "Ingresos puntuales",
  facturacion: "Facturacion diaria",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function ImportarPage() {
  const [kind, setKind] = useState<Kind>("erogaciones");

  return (
    <PageWrapper>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-2">Tipo de plantilla</div>
        <div className="flex gap-1 flex-wrap">
          {(["erogaciones", "ingresos", "facturacion"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={`px-4 py-2 text-sm font-semibold rounded-md transition ${kind === k ? "bg-primary text-white" : "border border-border text-text-muted hover:bg-soft"}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <ImportarSection kind={kind} />
    </PageWrapper>
  );
}

function ImportarSection({ kind }: { kind: Kind }) {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParseResp | null>(null);
  const [applied, setApplied] = useState<{ insertadas: number; salteadas_duplicado?: number; salteadas_error: number } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  function downloadPlantilla() {
    // descarga via window.open con auth header → mejor fetch + blob
    const token = localStorage.getItem("unidata.token");
    fetch(`${API_URL}/api/flujo-fondos/importar/plantilla/${kind}`, {
      headers: { Authorization: token ? `Bearer ${token}` : "" },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plantilla-${kind}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch((e) => alert(`Error descargando: ${e.message}`));
  }

  async function onUpload(file: File) {
    setParsing(true);
    setParseError(null);
    setParsed(null);
    setApplied(null);
    try {
      const token = localStorage.getItem("unidata.token");
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API_URL}/api/flujo-fondos/importar/parsear/${kind}`, {
        method: "POST",
        headers: { Authorization: token ? `Bearer ${token}` : "" },
        body: fd,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      setParsed(data);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  const aplicar = useMutation({
    mutationFn: () => api<{ insertadas: number; salteadas_duplicado?: number; salteadas_error: number }>(
      `/api/flujo-fondos/importar/aplicar/${kind}`,
      { method: "POST", body: JSON.stringify({ items: parsed?.items ?? [] }) },
    ),
    onSuccess: (data) => {
      setApplied(data);
      qc.invalidateQueries({ queryKey: ["ff"] });
    },
  });

  const validos = parsed?.items.filter((i) => i.errors.length === 0).length ?? 0;
  const conErrores = parsed?.items.filter((i) => i.errors.length > 0).length ?? 0;

  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-bold text-text">Paso 1 · Descargar plantilla</h2>
        <p className="text-xs text-text-muted">
          Descarga el archivo Excel de muestra, llenalo con tus datos y subi la version completa en el paso 2.
          Los maestros (empresas, bancos, proveedores, unidades) tienen que existir antes de importar — si no, esas filas no se cargan.
        </p>
        <button onClick={downloadPlantilla} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg border border-border hover:bg-soft">
          <Download size={14} /> Descargar plantilla {kind}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-bold text-text">Paso 2 · Subir archivo</h2>
        <label className="flex flex-col items-center justify-center px-4 py-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-soft hover:border-primary/40 transition">
          {parsing ? (
            <><Loader2 size={24} className="text-text-muted animate-spin mb-2" /><span className="text-sm text-text-muted">Procesando archivo...</span></>
          ) : (
            <><Upload size={24} className="text-text-muted mb-2" /><span className="text-sm font-semibold text-text">Click para elegir archivo .xlsx</span><span className="text-xs text-text-muted mt-1">o arrastra y solta aqui</span></>
          )}
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
        </label>
        {parseError && <div className="text-sm text-rose-600 bg-rose-50 rounded p-3"><AlertCircle size={14} className="inline mr-1" /> {parseError}</div>}
      </div>

      {parsed && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
          <h2 className="text-sm font-bold text-text">Paso 3 · Revisar y aplicar</h2>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-soft p-3">
              <div className="text-[10px] uppercase font-bold text-text-muted">Total filas</div>
              <div className="text-2xl font-bold text-text">{parsed.total}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <div className="text-[10px] uppercase font-bold text-emerald-700">Validas</div>
              <div className="text-2xl font-bold text-emerald-700">{validos}</div>
            </div>
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
              <div className="text-[10px] uppercase font-bold text-rose-700">Con errores</div>
              <div className="text-2xl font-bold text-rose-700">{conErrores}</div>
            </div>
          </div>

          {parsed.warnings && parsed.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-1 text-xs text-amber-900">
              {parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {applied ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm">
              <div className="font-bold text-emerald-900 flex items-center gap-1.5"><Check size={16} /> Importacion aplicada</div>
              <div className="text-xs text-emerald-700 mt-1">
                Insertadas: <strong>{applied.insertadas}</strong>
                {applied.salteadas_duplicado != null && <> · Duplicados ignorados: <strong>{applied.salteadas_duplicado}</strong></>}
                {" · Con errores: "}<strong>{applied.salteadas_error}</strong>
              </div>
            </div>
          ) : (
            <button
              onClick={() => aplicar.mutate()}
              disabled={aplicar.isPending || validos === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50"
            >
              {aplicar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Aplicar {validos} fila(s) validas
            </button>
          )}

          {/* Tabla preview */}
          {parsed.items.length > 0 && (
            <div className="rounded-lg border border-border overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-soft border-b border-border text-[9px] uppercase tracking-wider text-text-muted sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5">Row</th>
                    {kind === "erogaciones" && <><th className="text-left px-2 py-1.5">Fecha</th><th className="text-left px-2 py-1.5">Desc</th><th className="text-right px-2 py-1.5">Monto</th><th className="text-left px-2 py-1.5">Empresa</th><th className="text-left px-2 py-1.5">Banco</th><th className="text-left px-2 py-1.5">Prov</th></>}
                    {kind === "ingresos" && <><th className="text-left px-2 py-1.5">Fecha</th><th className="text-left px-2 py-1.5">Desc</th><th className="text-right px-2 py-1.5">Monto</th><th className="text-left px-2 py-1.5">Empresa</th><th className="text-left px-2 py-1.5">Cat</th></>}
                    {kind === "facturacion" && <><th className="text-left px-2 py-1.5">Fecha</th><th className="text-left px-2 py-1.5">Unidad</th><th className="text-right px-2 py-1.5">Monto</th><th className="text-center px-2 py-1.5">Real</th><th className="text-center px-2 py-1.5">Puntual</th></>}
                    <th className="text-left px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.items.map((item) => {
                    const ok = item.errors.length === 0;
                    return (
                      <tr key={item.row} className={`border-t border-border ${ok ? "" : "bg-rose-50"}`}>
                        <td className="px-2 py-1 text-text-muted">#{item.row}</td>
                        {kind === "erogaciones" && (<>
                          <td className="px-2 py-1 whitespace-nowrap">{fmtDate(String(item.fecha_pago ?? ""))}</td>
                          <td className="px-2 py-1 max-w-xs truncate">{String(item.descripcion ?? "")}</td>
                          <td className="px-2 py-1 text-right font-semibold">{fmtArs(Number(item.monto ?? 0))}</td>
                          <td className="px-2 py-1">{String(item.empresa_str ?? "")}</td>
                          <td className="px-2 py-1">{String(item.banco_str ?? "")}</td>
                          <td className="px-2 py-1">{String(item.proveedor_str ?? "")}</td>
                        </>)}
                        {kind === "ingresos" && (<>
                          <td className="px-2 py-1 whitespace-nowrap">{fmtDate(String(item.fecha ?? ""))}</td>
                          <td className="px-2 py-1 max-w-xs truncate">{String(item.descripcion ?? "")}</td>
                          <td className="px-2 py-1 text-right font-semibold">{fmtArs(Number(item.monto ?? 0))}</td>
                          <td className="px-2 py-1">{String(item.empresa_str ?? "")}</td>
                          <td className="px-2 py-1">{String(item.categoria ?? "")}</td>
                        </>)}
                        {kind === "facturacion" && (<>
                          <td className="px-2 py-1 whitespace-nowrap">{fmtDate(String(item.fecha ?? ""))}</td>
                          <td className="px-2 py-1">{String(item.unidad_str ?? "")}</td>
                          <td className="px-2 py-1 text-right font-semibold">{fmtArs(Number(item.monto ?? 0))}</td>
                          <td className="px-2 py-1 text-center">{item.es_real ? "✓" : "—"}</td>
                          <td className="px-2 py-1 text-center">{item.es_evento_puntual ? "✓" : "—"}</td>
                        </>)}
                        <td className="px-2 py-1">
                          {ok ? <span className="text-emerald-700 text-[10px]">✓ OK</span> : <span className="text-rose-700 text-[10px]" title={item.errors.join(", ")}>✗ {item.errors[0]}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Info adicional */}
      <div className="rounded-xl border border-border bg-soft p-4 text-xs text-text-muted flex gap-2">
        <FileSpreadsheet size={14} className="flex-shrink-0 mt-0.5" />
        <div>
          <strong>Detección de duplicados</strong> (solo en Erogaciones): si ya existe una erogacion con la misma empresa + banco,
          monto similar (±5%) y fecha cercana (±2 dias), se saltea automaticamente para evitar cargas duplicadas.
        </div>
      </div>
    </>
  );
}
