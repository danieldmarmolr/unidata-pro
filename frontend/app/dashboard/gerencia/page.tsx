"use client";

/**
 * Esta ruta quedo unificada con /dashboard. Redirect transparente para que los
 * bookmarks/links externos sigan funcionando.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GerenciaRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-text-muted">
      Redirigiendo a /dashboard…
    </div>
  );
}
