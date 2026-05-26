"use client";

import { Topbar } from "@/components/topbar";
import { PersonalFileUploader } from "@/components/personal/file-uploader";
import { PersonalFileList } from "@/components/personal/file-list";
import { getUser } from "@/lib/api";

const CONTRATO_TIPOS = [
  "Contrato indefinido",
  "Contrato a plazo fijo",
  "Pasantía",
  "Monotributo",
  "Addendum",
  "Acuerdo de confidencialidad",
  "Otro",
];

export default function ContratosPage() {
  const me = getUser();
  const canUpload =
    !!me?.is_admin ||
    me?.role === "admin" ||
    me?.role === "gerencia" ||
    me?.area_slug === "people";

  return (
    <>
      <Topbar
        title="Contratos"
        subtitle={
          canUpload
            ? "Contratos firmados, addendums, acuerdos — visibles solo para el colaborador y People"
            : "Acá vas a encontrar tu contrato firmado y addendums"
        }
      />
      <div className="flex-1 px-4 lg:px-6 py-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-5">
          {canUpload && (
            <div className="lg:col-span-2 lg:order-2">
              <PersonalFileUploader
                kind="contrato"
                invalidateKeys={[["personal-files", "contrato"], ["personal-legajo"]]}
                extraFields={
                  <select
                    name="doc_kind"
                    className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="">— Tipo de contrato (opcional) —</option>
                    {CONTRATO_TIPOS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                }
              />
              <div className="text-[11px] text-text-muted mt-3 leading-relaxed">
                Subí los contratos en <strong>PDF</strong> firmados por ambas partes. Es
                recomendable adjuntar el documento de identidad del firmante por separado en
                Documentos.
              </div>
            </div>
          )}

          <div className={canUpload ? "lg:col-span-3 lg:order-1" : "lg:col-span-5"}>
            <PersonalFileList
              kind="contrato"
              emptyTitle="Sin contratos cargados"
              emptyHint={
                canUpload
                  ? "Subí el primer contrato desde el formulario de la derecha."
                  : "Cuando People cargue tu contrato firmado, va a aparecer acá."
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
