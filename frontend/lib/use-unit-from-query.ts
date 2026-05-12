"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export type Unit = "unistore" | "unidrop";

/**
 * Hook compartido para pantallas con toggle Unistore/Unidrop.
 *
 * Si la URL trae `?unit=unistore` o `?unit=unidrop`, ese valor:
 *   - Es el inicial del estado
 *   - Bloquea el toggle (locked = true) para que cuando el user entra desde
 *     el grupo UNISTORE o UNIDROP del sidebar, no pueda cambiar la fuente.
 *
 * Si la URL no trae `?unit=`, devuelve el toggle libre (locked = false) con
 * el default que se le pase (ej: "unistore"). Es el caso cuando se entra
 * desde el grupo CROSS.
 *
 * Uso:
 *   const [unit, setUnit, locked] = useUnitFromQuery("unistore");
 *   <Segmented value={unit} onChange={setUnit} disabled={locked} ... />
 */
export function useUnitFromQuery(defaultUnit: Unit = "unistore"): [Unit, (u: Unit) => void, boolean] {
  const sp = useSearchParams();
  const urlUnit = sp?.get("unit");
  const locked = urlUnit === "unistore" || urlUnit === "unidrop";
  const initial: Unit = locked ? (urlUnit as Unit) : defaultUnit;
  const [unit, setUnitState] = useState<Unit>(initial);

  // Si la URL cambia (por nav del sidebar entre items), reflejarlo en el state
  useEffect(() => {
    if (urlUnit === "unistore" || urlUnit === "unidrop") {
      setUnitState(urlUnit as Unit);
    }
  }, [urlUnit]);

  const setUnit = (u: Unit) => {
    if (locked) return; // no permitido cambiar cuando viene forzado por URL
    setUnitState(u);
  };

  return [unit, setUnit, locked];
}
