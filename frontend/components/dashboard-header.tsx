"use client";

export function DashboardHeader({
  filters,
  generatedAt,
  isFetching,
}: {
  filters: React.ReactNode;
  generatedAt?: string | null;
  isFetching?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
      <div className="flex flex-wrap items-center gap-3">{filters}</div>
      {generatedAt && (
        <div className="text-xs text-text-muted">
          Datos al {new Date(generatedAt).toLocaleString("es-AR")}
          {isFetching && " · refrescando..."}
        </div>
      )}
    </div>
  );
}
