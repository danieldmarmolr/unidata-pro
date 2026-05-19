/**
 * Utilidad de fechas siempre en horario Argentina (UTC-3).
 *
 * El backend devuelve timestamps de Postgres (`timestamp without time zone`)
 * como strings tipo "2026-05-08 08:48:31.123" o "2026-05-08T08:48:31.123Z".
 * Postgres en RDS guarda en UTC, asi que para mostrar en AR convertimos.
 */

const AR_TZ = "America/Argentina/Buenos_Aires";

function parseToDate(s: string): Date | null {
  if (!s) return null;
  // Si la string no trae offset ni Z, lo tratamos como UTC explicitamente.
  // Postgres timestamp sin TZ = UTC en RDS de Unistore.
  let iso = s.trim().replace(" ", "T");
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso)) iso = iso + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Devuelve "08/05/2026 05:48" (DD/MM/YYYY HH:mm en AR, formato 24h). */
export function fmtArDateTime(s: string | null | undefined, opts?: { withSeconds?: boolean }): string {
  if (!s) return "—";
  const d = parseToDate(s);
  if (!d) return s;
  const fmt: Intl.DateTimeFormatOptions = {
    timeZone: AR_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (opts?.withSeconds) fmt.second = "2-digit";
  return d.toLocaleString("es-AR", fmt).replace(",", "");
}

/** Devuelve "YYYY-MM-DD" de hoy en AR (no el UTC del server). Usar para max/default de date pickers. */
export function todayArIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: AR_TZ });
}

/** Devuelve solo "08/05/2026" en AR. */
export function fmtArDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseToDate(s);
  if (!d) return s;
  return d.toLocaleDateString("es-AR", {
    timeZone: AR_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Devuelve "8 may 05:48" estilo TN admin. */
export function fmtArShort(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseToDate(s);
  if (!d) return s;
  // Day + month abreviado + hora
  const dayMonth = d.toLocaleDateString("es-AR", {
    timeZone: AR_TZ,
    day: "numeric",
    month: "short",
  }).replace(".", "");
  const time = d.toLocaleTimeString("es-AR", {
    timeZone: AR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${dayMonth} ${time}`;
}

/**
 * Construye la URL de TN admin para una orden.
 * Usa el subdominio configurable (defecto: unistore8 según las preferencias del usuario).
 */
export function tnAdminUrl(orderId: number | string, subdomain: string = "unistore8"): string {
  return `https://${subdomain}.mitiendanube.com/admin/orders/${orderId}`;
}

/** Heuristica para detectar si una col es un order_id (numerico grande de TN). */
export function looksLikeTnOrderId(col: string, value: unknown): boolean {
  if (typeof value !== "number" && typeof value !== "string") return false;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return false;
  // Order IDs de TN son enteros >= 1.000.000.000 (10 digits +)
  if (num < 1_000_000_000) return false;
  // y la columna debe llamarse algo como id, order_id, tienda_nube_id...
  return /^(id|order_id|tienda_nube_id|orderid|tn_id)$/i.test(col);
}
