"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type AvatarProps = {
  name: string | null | undefined;
  url?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  ringColor?: string;
  /** Si hay url y expandable=true, click abre un lightbox fullscreen con la foto grande. */
  expandable?: boolean;
};

const SIZE_MAP: Record<NonNullable<AvatarProps["size"]>, string> = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
  xl: "w-20 h-20 text-2xl",
};

function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const palette = [
    "#7a3eae", "#06b6d4", "#10b981", "#f59e0b", "#ec4899",
    "#ef4444", "#8b5cf6", "#0ea5e9", "#84cc16", "#6366f1",
  ];
  return palette[h % palette.length];
}

export function Avatar({ name, url, size = "md", className, ringColor, expandable }: AvatarProps) {
  const [open, setOpen] = useState(false);
  const initials = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
  const bg = colorForName(name ?? "??");
  const canExpand = !!(expandable && url);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const visual = url ? (
    <img
      src={url}
      alt={name ?? "avatar"}
      className={cn(
        SIZE_MAP[size],
        "rounded-full object-cover shrink-0",
        ringColor && "ring-2",
        canExpand && "cursor-zoom-in hover:opacity-90 transition",
        className,
      )}
      style={ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : undefined}
    />
  ) : (
    <span
      className={cn(
        SIZE_MAP[size],
        "rounded-full flex items-center justify-center font-bold text-white shrink-0 select-none",
        className,
      )}
      style={{
        background: bg,
        ...(ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : {}),
      }}
      title={name ?? undefined}
    >
      {initials || "?"}
    </span>
  );

  if (!canExpand) return visual;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-0 border-0 bg-transparent inline-flex"
        aria-label={`Ampliar foto de ${name ?? "usuario"}`}
      >
        {visual}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl leading-none flex items-center justify-center"
            aria-label="Cerrar"
          >
            ×
          </button>
          <img
            src={url!}
            alt={name ?? "avatar"}
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain"
          />
        </div>
      )}
    </>
  );
}
