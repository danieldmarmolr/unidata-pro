"use client";

import { useEffect } from "react";

/**
 * Error boundary de ultima instancia - se activa cuando un error escapa al
 * `error.tsx` de cada segmento (ej: error dentro del root layout o providers).
 * Debe definir su propio <html>/<body> porque reemplaza al root layout.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[global] root-layout error:", error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafafa" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              padding: "1.5rem",
              borderRadius: 16,
              background: "white",
              border: "1px solid #fecaca",
              boxShadow: "0 2px 6px rgba(0,0,0,.04)",
              textAlign: "center",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, color: "#7f1d1d" }}>UNIDATA - error critico</h2>
            <p style={{ marginTop: 8, fontSize: 14, color: "#9f1239" }}>
              {error?.message || "Algo se rompio en el shell de la aplicacion."}
            </p>
            {error?.digest ? (
              <p style={{ marginTop: 4, fontSize: 12, color: "#be123c" }}>ref: {error.digest}</p>
            ) : null}
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => unstable_retry()}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 8,
                  background: "#dc2626",
                  color: "white",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={() => (window.location.href = "/login")}
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: 8,
                  background: "white",
                  color: "#9f1239",
                  border: "1px solid #fca5a5",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Ir al login
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
