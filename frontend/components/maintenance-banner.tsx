"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

// Banner de aviso de mantenimiento durante el cutover Railway -> AWS.
// Editar MAINTENANCE_START y MAINTENANCE_END con las fechas exactas
// (ISO 8601 con timezone). Fuera de la ventana, el componente no renderiza nada.
//
// Para activar:
//   1. Editar las constantes de abajo con la ventana real
//   2. Importar en frontend/app/dashboard/layout.tsx:
//        import { MaintenanceBanner } from "@/components/maintenance-banner";
//   3. Renderizar arriba del <main>:
//        <MaintenanceBanner />
//   4. git commit + push (deploya en ~3 min vía Amplify CI/CD)
//
// Despues del cutover: simplemente quitar el import del layout. El componente
// queda en el repo por si necesitamos otra ventana de mantenimiento.

const MAINTENANCE_START = "2026-05-28T22:00:00-03:00"; // ART
const MAINTENANCE_END   = "2026-05-28T23:00:00-03:00"; // ART

export function MaintenanceBanner() {
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => {
      const current = new Date();
      const start = new Date(MAINTENANCE_START);
      const end = new Date(MAINTENANCE_END);
      setNow(current);
      setVisible(current >= start && current <= end);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  if (!visible || !now) return null;

  const end = new Date(MAINTENANCE_END);
  const minutesRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 60000));

  return (
    <div className="bg-amber-500/20 border-b border-amber-500/40 text-amber-200 px-4 py-2 flex items-center gap-2 text-sm">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">Mantenimiento en curso</span>
        {" — "}
        Estamos migrando UNIDATA a una nueva infraestructura. Puede haber breve interrupcion de servicio. Tiempo estimado restante: <span className="font-semibold">{minutesRemaining} min</span>.
      </span>
    </div>
  );
}
