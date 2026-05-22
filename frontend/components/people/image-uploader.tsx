"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon, X, Loader2, AlertCircle } from "lucide-react";
import { getToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/**
 * Componente para upload de imagen (drag&drop + click).
 * Mantiene `value` (URL) externo: si esta seteado, muestra preview;
 * sino, muestra el dropzone. Llama `onChange(url | null)`.
 */
export function ImageUploader({
  value,
  onChange,
  label = "Imagen",
  compact = false,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File) {
    setErr(null);
    if (!ALLOWED.includes(file.type)) {
      setErr(`Tipo no permitido: ${file.type}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr(`Archivo muy grande (max 5MB)`);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch(`${API_URL}/api/people/uploads`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.detail || `HTTP ${res.status}`);
      }
      const data: { url: string } = await res.json();
      // url devuelta es relativa: /api/people/uploads/{id}; le agregamos host del backend
      const fullUrl = data.url.startsWith("http") ? data.url : `${API_URL}${data.url}`;
      onChange(fullUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error subiendo");
    } finally {
      setBusy(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    upload(files[0]);
  }

  if (value) {
    return (
      <div className="mt-2 relative inline-block">
        <img
          src={value}
          alt=""
          className={cn(
            "rounded-lg border border-border object-cover",
            compact ? "max-h-32" : "max-h-48",
          )}
        />
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 hover:bg-black"
          title="Quitar imagen"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition",
          drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-bg-muted",
          busy && "opacity-50 pointer-events-none",
        )}
      >
        {busy ? (
          <div className="text-xs text-text-muted inline-flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin" /> Subiendo...
          </div>
        ) : (
          <div className="text-xs text-text-muted inline-flex items-center gap-1.5">
            <ImageIcon size={14} /> Agregar {label.toLowerCase()} (drag & drop o click) · max 5MB
          </div>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept={ALLOWED.join(",")}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      {err && (
        <div className="mt-1 text-[11px] text-error inline-flex items-center gap-1">
          <AlertCircle size={11} /> {err}
        </div>
      )}
    </div>
  );
}
