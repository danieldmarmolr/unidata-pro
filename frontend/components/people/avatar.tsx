"use client";

import { cn } from "@/lib/utils";

type AvatarProps = {
  name: string | null | undefined;
  url?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  ringColor?: string;
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

export function Avatar({ name, url, size = "md", className, ringColor }: AvatarProps) {
  const initials = (name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
  const bg = colorForName(name ?? "??");

  if (url) {
    return (
      <img
        src={url}
        alt={name ?? "avatar"}
        className={cn(
          SIZE_MAP[size],
          "rounded-full object-cover shrink-0",
          ringColor && "ring-2",
          className,
        )}
        style={ringColor ? { boxShadow: `0 0 0 2px ${ringColor}` } : undefined}
      />
    );
  }

  return (
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
}
