"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Image as ImageIcon, FileType, Trash2 } from "lucide-react";
import { api, getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type PersonalFile = {
  id: number;
  user_id: number;
  kind: "documento" | "recibo" | "contrato";
  doc_kind: string;
  title: string;
  period_year: number | null;
  period_month: number | null;
  mime: string;
  size_bytes: number;
  filename: string;
  notes: string;
  uploaded_by: number;
  created_at: string;
};

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function mimeIcon(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime === "application/pdf") return FileText;
  return FileType;
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

export function PersonalFileList({
  kind,
  emptyTitle,
  emptyHint,
}: {
  kind: "documento" | "recibo" | "contrato";
  emptyTitle: string;
  emptyHint: string;
}) {
  const queryKey = ["personal-files", kind] as const;
  const { data, isLoading } = useQuery<{ items: PersonalFile[] }>({
    queryKey,
    queryFn: () => api(`/api/personal/files?kind=${kind}`),
    staleTime: 10_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {isLoading && (
        <div className="text-center py-10 text-text-muted text-sm">Cargando...</div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="text-center py-12 px-4">
          <FileText size={36} className="mx-auto text-text-muted mb-2 opacity-50" />
          <div className="text-sm font-semibold mb-1">{emptyTitle}</div>
          <div className="text-xs text-text-muted">{emptyHint}</div>
        </div>
      )}

      {items.map((f, idx) => (
        <FileRow key={f.id} file={f} last={idx === items.length - 1} />
      ))}
    </div>
  );
}

function FileRow({ file, last }: { file: PersonalFile; last: boolean }) {
  const qc = useQueryClient();
  const Icon = mimeIcon(file.mime);

  const downloadUrl = `${API_URL}/api/personal/files/${file.id}/download`;

  const deleteMut = useMutation({
    mutationFn: () => api(`/api/personal/files/${file.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal-files"] });
      qc.invalidateQueries({ queryKey: ["personal-legajo"] });
    },
  });

  async function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    // Bajar con auth header
    const token = getToken();
    const res = await fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const periodLabel =
    file.kind === "recibo" && file.period_year && file.period_month
      ? `${MESES[file.period_month - 1]} ${file.period_year}`
      : null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 hover:bg-bg-muted/50 transition",
        !last && "border-b border-border",
      )}
    >
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold truncate">{file.title}</div>
          {file.doc_kind && (
            <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-bg-muted rounded">
              {file.doc_kind}
            </span>
          )}
          {periodLabel && (
            <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 bg-primary/10 text-primary rounded">
              {periodLabel}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-muted mt-0.5">
          {humanSize(file.size_bytes)} · subido {fmtDate(file.created_at)}
          {file.filename && ` · ${file.filename}`}
        </div>
        {file.notes && (
          <div className="text-[11px] text-text-muted italic mt-1 line-clamp-2">
            {file.notes}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={downloadUrl}
          onClick={handleDownload}
          className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition"
          title="Descargar"
        >
          <Download size={14} />
        </a>
        <button
          onClick={() => {
            if (confirm(`Eliminar "${file.title}"? No se puede deshacer.`)) {
              deleteMut.mutate();
            }
          }}
          className="p-1.5 rounded-lg text-text-muted hover:text-error hover:bg-error/10 transition"
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
