"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, ClipboardPaste, X, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export type ProcessedFiles = {
  images: { name: string; mime: string; bytes_b64: string }[];
  pdfs: { name: string; mime: string; bytes_b64: string }[];
  texts: { name: string; text: string }[];
  all_attachments: { name: string; mime: string; bytes_b64: string }[];
};

type Props = {
  onProcessed: (resp: ProcessedFiles | null) => void;
  hint?: string;
};

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,.docx,.xlsx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type LocalFile = { name: string; size: number; mime: string; previewUrl?: string; file: File };

export function FileUploader({ onProcessed, hint }: Props) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback((newFiles: File[]) => {
    const mapped: LocalFile[] = newFiles.map((f) => ({
      name: f.name,
      size: f.size,
      mime: f.type || "application/octet-stream",
      previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      file: f,
    }));
    setFiles((prev) => [...prev, ...mapped]);
  }, []);

  const removeAt = useCallback((idx: number) => {
    setFiles((prev) => {
      const f = prev[idx];
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Paste imagen desde clipboard
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return;
      const newFiles: File[] = [];
      for (const it of Array.from(e.clipboardData.items)) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            const renamed = new File([f], `pegado_${Date.now()}.png`, { type: f.type });
            newFiles.push(renamed);
          }
        }
      }
      if (newFiles.length > 0) {
        e.preventDefault();
        addFiles(newFiles);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Drag & drop
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    function over(e: DragEvent) { e.preventDefault(); el!.classList.add("ring-2", "ring-primary"); }
    function leave() { el!.classList.remove("ring-2", "ring-primary"); }
    function drop(e: DragEvent) {
      e.preventDefault();
      el!.classList.remove("ring-2", "ring-primary");
      const dropped = Array.from(e.dataTransfer?.files || []);
      if (dropped.length > 0) addFiles(dropped);
    }
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  async function uploadAndProcess() {
    if (files.length === 0) { onProcessed(null); return; }
    setProcessing(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f.file, f.name);
      const token = typeof window !== "undefined" ? window.localStorage.getItem("unidata.token") : null;
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${apiBase}/api/jira-flow/files/process`, {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as ProcessedFiles;
      onProcessed(data);
    } catch (e) {
      setError((e as Error).message);
      onProcessed(null);
    } finally { setProcessing(false); }
  }

  return (
    <div className="space-y-2">
      <div
        ref={dropRef}
        className="border-2 border-dashed border-border rounded-lg p-3 bg-soft text-sm hover:bg-white transition cursor-pointer"
        onClick={() => inputRef.current?.click()}
      >
        <div className="flex items-center gap-2 justify-center text-muted">
          <Paperclip size={16} />
          <span>Arrastrá archivos · click para elegir · <ClipboardPaste size={14} className="inline" /> pegá imagen (Ctrl+V)</span>
        </div>
        {hint && <div className="text-xs text-muted text-center mt-1">{hint}</div>}
        <input
          ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ""; }}
        />
      </div>

      {files.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {files.map((f, idx) => (
              <div key={idx} className="border border-border rounded p-2 bg-white relative group">
                <button onClick={() => removeAt(idx)} className="absolute top-1 right-1 p-0.5 rounded bg-white border border-border opacity-80 hover:opacity-100">
                  <X size={10} />
                </button>
                {f.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.previewUrl} alt={f.name} className="w-full h-20 object-cover rounded" />
                ) : (
                  <div className="w-full h-20 flex flex-col items-center justify-center text-muted">
                    {f.mime === "application/pdf" ? <FileText size={20} /> : <ImageIcon size={20} />}
                  </div>
                )}
                <div className="text-xs mt-1 truncate" title={f.name}>{f.name}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted">{files.length} archivo(s)</div>
            <button onClick={uploadAndProcess} disabled={processing} className="px-3 py-1 rounded border border-border text-xs hover:bg-soft flex items-center gap-1 disabled:opacity-50">
              {processing ? <Loader2 size={12} className="animate-spin" /> : null}
              Procesar archivos
            </button>
          </div>
          {error && <div className="text-red-600 text-xs">{error}</div>}
        </>
      )}
    </div>
  );
}
