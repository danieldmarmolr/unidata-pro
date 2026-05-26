"use client";

import { Topbar } from "@/components/topbar";
import { PersonalFileUploader } from "@/components/personal/file-uploader";
import { PersonalFileList } from "@/components/personal/file-list";

const DOC_KINDS = [
  "DNI",
  "CV",
  "Titulo",
  "Certificado de estudios",
  "Comprobante AFIP",
  "Comprobante de domicilio",
  "Foto carnet",
  "CBU / alias",
  "Otro",
];

export default function DocumentosPage() {
  return (
    <>
      <Topbar
        title="Documentos personales"
        subtitle="DNI, CV, títulos, certificados, comprobantes — solo vos los ves"
      />
      <div className="flex-1 px-4 lg:px-6 py-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2 lg:order-2">
            <PersonalFileUploader
              kind="documento"
              invalidateKeys={[["personal-files", "documento"], ["personal-legajo"]]}
              extraFields={
                <select
                  name="doc_kind"
                  className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                >
                  <option value="">— Tipo de documento (opcional) —</option>
                  {DOC_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              }
            />
            <div className="text-[11px] text-text-muted mt-3 leading-relaxed">
              Tus documentos son <strong>privados</strong>. Solo vos podés verlos. El equipo de
              People y los admins también pueden subir documentos al legajo cuando hace falta
              (ej: certificado emitido por la empresa).
            </div>
          </div>

          <div className="lg:col-span-3 lg:order-1">
            <PersonalFileList
              kind="documento"
              emptyTitle="No tenés documentos cargados"
              emptyHint="Empezá subiendo tu DNI con el formulario de la derecha."
            />
          </div>
        </div>
      </div>
    </>
  );
}
