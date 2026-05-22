"use client";

import { useEffect } from "react";

/**
 * Error boundary que cubre toda la rama /dashboard/*.
 * Si una page o nested layout tira un error de runtime (ej: useQuery falla,
 * un componente recibe data inesperada), aca lo capturamos y mostramos un
 * fallback que permite reintentar sin perder la sesion.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] runtime error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-rose-900">Algo salio mal</h2>
        <p className="mt-2 text-sm text-rose-700">
          {error?.message || "Ocurrio un error inesperado al cargar esta pantalla."}
        </p>
        {error?.digest ? (
          <p className="mt-1 text-xs text-rose-500">ref: {error.digest}</p>
        ) : null}
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Reintentar
          </button>
          <button
            type="button"
            onClick={() => (window.location.href = "/dashboard")}
            className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
