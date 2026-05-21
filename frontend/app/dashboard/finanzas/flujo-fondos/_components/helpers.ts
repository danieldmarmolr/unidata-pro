"use client";

export function fmtArs(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function fmtArsCompact(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return `$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$ ${(v / 1_000).toFixed(1)}k`;
  return `$ ${v.toFixed(0)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, dd] = d.split("-");
  if (!y || !m || !dd) return iso;
  return `${dd}/${m}/${y}`;
}

export const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  pagado: "Pagado",
  cancelado: "Cancelado",
  rechazado: "Rechazado",
};

export const ESTADO_COLOR: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-800 border-amber-200",
  en_curso: "bg-blue-100 text-blue-800 border-blue-200",
  pagado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelado: "bg-slate-200 text-slate-700 border-slate-300",
  rechazado: "bg-rose-100 text-rose-800 border-rose-200",
};
