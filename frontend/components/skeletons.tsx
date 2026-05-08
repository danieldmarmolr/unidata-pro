"use client";

export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 h-[126px] ${className}`}>
      <div className="h-3 w-20 rounded skeleton-shimmer mb-3" />
      <div className="h-8 w-32 rounded skeleton-shimmer mb-3" />
      <div className="h-2.5 w-24 rounded skeleton-shimmer" />
    </div>
  );
}

export function ChartSkeleton({ height = 340, className = "" }: { height?: number; className?: string }) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl p-5 ${className}`}
      style={{ height }}
    >
      <div className="h-3 w-40 rounded skeleton-shimmer mb-2" />
      <div className="h-2 w-56 rounded skeleton-shimmer mb-6" />
      <div className="flex items-end gap-2 h-[calc(100%-60px)]">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="flex-1 rounded-t skeleton-shimmer" style={{ height: `${30 + ((i * 13) % 60)}%` }} />
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-xl p-5 ${className}`}>
      <div className="h-3 w-40 rounded skeleton-shimmer mb-4" />
      <div className="space-y-2">
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-2.5 w-6 rounded skeleton-shimmer" />
            <div className="h-3 flex-1 rounded skeleton-shimmer" />
            <div className="h-3 w-20 rounded skeleton-shimmer" />
            <div className="h-3 w-24 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsRow({ count = 5 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-${count} gap-4 mb-6`}>
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

export function EmptyState({
  title = "Sin datos",
  message = "No hay informacion para mostrar en este periodo o segmento.",
  icon,
}: {
  title?: string;
  message?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-dashed border-border rounded-xl p-10 text-center">
      {icon && <div className="text-text-muted mb-3 flex justify-center">{icon}</div>}
      <div className="text-sm font-bold text-text mb-1">{title}</div>
      <div className="text-xs text-text-muted max-w-md mx-auto">{message}</div>
    </div>
  );
}
