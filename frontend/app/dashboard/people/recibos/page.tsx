"use client";

import { useMemo } from "react";
import { Topbar } from "@/components/topbar";
import { PersonalFileUploader } from "@/components/personal/file-uploader";
import { PersonalFileList } from "@/components/personal/file-list";
import { getUser } from "@/lib/api";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function RecibosPage() {
  const me = getUser();
  // Solo admin/gerencia/people pueden subir recibos (la propia persona NO los sube)
  const canUpload =
    !!me?.is_admin ||
    me?.role === "admin" ||
    me?.role === "gerencia" ||
    me?.area_slug === "people";

  const now = new Date();
  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y, y - 1, y - 2];
  }, [now]);

  return (
    <>
      <Topbar
        title="Recibos de sueldo"
        subtitle={
          canUpload
            ? "Subí los recibos del mes — visibles solo para el colaborador y People"
            : "Acá vas a encontrar tus recibos firmados por el área de People"
        }
      />
      <div className="flex-1 px-4 lg:px-6 py-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-5">
          {canUpload && (
            <div className="lg:col-span-2 lg:order-2">
              <PersonalFileUploader
                kind="recibo"
                invalidateKeys={[["personal-files", "recibo"], ["personal-legajo"]]}
                extraFields={
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      name="period_month"
                      required
                      defaultValue={now.getMonth() + 1}
                      className="bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      {MESES.map((m, i) => (
                        <option key={i} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      name="period_year"
                      required
                      defaultValue={now.getFullYear()}
                      className="bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              />
              <div className="text-[11px] text-text-muted mt-3 leading-relaxed">
                Tip: subí el recibo en <strong>PDF</strong> firmado. Si tenés un Excel del
                proveedor de nómina, también vale (xlsx).
              </div>
            </div>
          )}

          <div className={canUpload ? "lg:col-span-3 lg:order-1" : "lg:col-span-5"}>
            <PersonalFileList
              kind="recibo"
              emptyTitle="Sin recibos cargados todavía"
              emptyHint={
                canUpload
                  ? "Subí el primer recibo desde el formulario de la derecha."
                  : "Cuando People cargue tu primer recibo, va a aparecer acá."
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
