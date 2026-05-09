"use client";

import { formatCurrency, formatNumber } from "@/lib/utils";

type Row = {
  category: string;
  value: number;
  extra?: Record<string, number | string | null> | null;
};

export function CategoryTable({
  data,
  caption,
  subtitle,
  formatter = "currency",
  extraColumns = [],
  showProgress = true,
  onRowClick,
}: {
  data: Row[];
  caption?: string;
  subtitle?: string;
  formatter?: "currency" | "number" | "raw";
  extraColumns?: { key: string; label: string; format?: "currency" | "number" | "raw" }[];
  showProgress?: boolean;
  onRowClick?: (r: Row) => void;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const fmt = (v: number, f?: string) => {
    const ff = f ?? formatter;
    if (ff === "currency") return formatCurrency(v);
    if (ff === "number") return formatNumber(v);
    return String(v);
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4 sm:p-5">
      {(caption || subtitle) && (
        <div className="mb-3">
          {caption && <div className="text-sm font-bold text-text">{caption}</div>}
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
      )}

      {/* Mobile: cards */}
      <div className="lg:hidden space-y-2">
        {data.map((r, i) => {
          const pct = max > 0 ? (r.value / max) * 100 : 0;
          return (
            <div
              key={`m-${r.category}-${i}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={
                "border border-border rounded-lg p-3 bg-soft/30 " +
                (onRowClick ? "cursor-pointer hover:bg-soft active:bg-soft transition" : "")
              }
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-baseline gap-2 min-w-0 flex-1">
                  <span className="text-[10px] font-mono text-text-muted shrink-0">#{i + 1}</span>
                  <span className="font-medium text-text text-sm truncate" title={r.category}>{r.category}</span>
                </div>
                <span className="font-bold text-text text-sm tabular-nums shrink-0">{fmt(r.value)}</span>
              </div>
              {showProgress && (
                <div className="h-1 bg-soft rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {extraColumns.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1">
                  {extraColumns.map((c) => {
                    const raw = r.extra?.[c.key];
                    return (
                      <div key={c.key} className="flex justify-between text-[11px]">
                        <span className="text-text-muted">{c.label}</span>
                        <span className="tabular-nums font-semibold text-text">
                          {raw === null || raw === undefined
                            ? "—"
                            : typeof raw === "number"
                              ? fmt(raw, c.format)
                              : String(raw)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {data.length === 0 && (
          <div className="py-8 text-center text-text-muted text-sm">Sin datos.</div>
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="overflow-x-auto hidden lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <th className="pl-2 py-2 w-8">#</th>
              <th className="py-2">Categoria</th>
              {extraColumns.map((c) => (
                <th key={c.key} className="py-2 text-right pr-3">{c.label}</th>
              ))}
              <th className="py-2 text-right pr-2 min-w-[160px]">Valor</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
              const pct = max > 0 ? (r.value / max) * 100 : 0;
              return (
                <tr
                  key={`${r.category}-${i}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={
                    "border-t border-border hover:bg-soft transition " +
                    (onRowClick ? "cursor-pointer" : "")
                  }
                >
                  <td className="pl-2 py-2 text-text-muted text-xs font-mono">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium text-text truncate max-w-[280px]" title={r.category}>
                    {r.category}
                  </td>
                  {extraColumns.map((c) => {
                    const raw = r.extra?.[c.key];
                    return (
                      <td key={c.key} className="py-2 pr-3 text-right tabular-nums text-text-muted text-xs">
                        {raw === null || raw === undefined
                          ? "—"
                          : typeof raw === "number"
                            ? fmt(raw, c.format)
                            : String(raw)}
                      </td>
                    );
                  })}
                  <td className="py-2 pr-2 text-right tabular-nums">
                    <div className="font-semibold text-text">{fmt(r.value)}</div>
                    {showProgress && (
                      <div className="h-1 bg-soft rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={2 + extraColumns.length} className="py-8 text-center text-text-muted text-sm">
                  Sin datos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
