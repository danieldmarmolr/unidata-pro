"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Upload } from "lucide-react";
import { getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_BYTES = 10 * 1024 * 1024;

export type PersonalKind = "documento" | "recibo" | "contrato";

const KIND_LABEL: Record<PersonalKind, string> = {
  documento: "documento",
  recibo: "recibo de sueldo",
  contrato: "contrato",
};

export function PersonalFileUploader({
  kind,
  invalidateKeys,
  extraFields,
}: {
  kind: PersonalKind;
  /** Query keys a invalidar despues de subir. */
  invalidateKeys: (readonly unknown[])[];
  /** Campos extra del form (period_year/month para recibos, doc_kind para docs). */
  extraFields?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const form = e.currentTarget;
    const data = new FormData(form);

    const file = data.get("file") as File | null;
    if (!file || file.size === 0) {
      setErr("Tenes que adjuntar un archivo");
      return;
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      setErr(`Tipo no soportado: ${file.type}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr(`Archivo muy grande (max ${MAX_BYTES / 1024 / 1024}MB)`);
      return;
    }
    if (!data.get("title")) {
      setErr("Pone un titulo descriptivo");
      return;
    }

    data.set("kind", kind);
    setBusy(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/personal/files`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: data,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `HTTP ${res.status}`);
      }
      // Reset
      form.reset();
      setFilename(null);
      for (const key of invalidateKeys) {
        qc.invalidateQueries({ queryKey: key });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error subiendo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="bg-surface border border-border rounded-xl p-4 space-y-3"
    >
      <div className="text-sm font-bold inline-flex items-center gap-2">
        <Upload size={14} /> Subir nuevo {KIND_LABEL[kind]}
      </div>

      <input
        name="title"
        placeholder={
          kind === "recibo"
            ? "Titulo (ej: Recibo Marzo 2026)"
            : kind === "contrato"
              ? "Titulo (ej: Contrato indefinido firmado)"
              : "Titulo (ej: DNI frente y dorso)"
        }
        required
        className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
      />

      {extraFields}

      <textarea
        name="notes"
        placeholder="Notas (opcional)"
        rows={2}
        className="w-full bg-bg-muted border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary resize-none"
      />

      <label
        className={cn(
          "block border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition",
          "border-border hover:border-primary/40 hover:bg-bg-muted",
        )}
      >
        <input
          ref={fileRef}
          name="file"
          type="file"
          accept={ALLOWED_MIMES.join(",")}
          required
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
          className="hidden"
        />
        <div className="text-xs text-text-muted inline-flex items-center gap-1.5">
          <Upload size={14} />
          {filename ? (
            <span className="font-semibold text-text">{filename}</span>
          ) : (
            <>Adjuntar PDF / imagen / docx · max 10MB</>
          )}
        </div>
      </label>

      {err && (
        <div className="text-[11px] text-error inline-flex items-center gap-1">
          <AlertCircle size={11} /> {err}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="text-sm font-semibold bg-primary text-white rounded-full px-4 py-1.5 hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Subiendo...
            </>
          ) : (
            <>
              <Upload size={12} /> Subir
            </>
          )}
        </button>
      </div>
    </form>
  );
}
