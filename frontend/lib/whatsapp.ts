/**
 * Normaliza un telefono argentino (o ya internacional) al formato wa.me.
 * - Devuelve null si no hay digitos.
 * - "549..." -> deja como esta (ya tiene 549 = 9 movil arg)
 * - "54..." sin 9 -> agrega 9 para movil (wa.me requiere 549 en Argentina)
 * - "0..." (prefijo 0 area) -> reemplaza por 549
 * - 10 digitos sin prefijo -> asume Arg, agrega 549
 * - Cualquier otro caso con digitos -> wa.me como esta (numeros del exterior)
 */
export function normalizeArPhoneDigits(phone: string | null | undefined): string | null {
  const d = (phone || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("549")) return d;
  if (d.startsWith("54")) return "549" + d.slice(2);
  if (d.startsWith("0")) return "549" + d.slice(1);
  if (d.length === 10) return "549" + d;
  return d;
}

export function waLink(phone: string | null | undefined): string | null {
  const digits = normalizeArPhoneDigits(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}
