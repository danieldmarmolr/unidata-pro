'use server';

import { addDays, formatISO, parseISO, subDays } from 'date-fns';
import { and, between, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { erogaciones } from '@/db/schema';
import { erogacionFormSchema, type ErogacionInput, type EstadoErogacion } from './schema';

type ActionResult =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; error: string; duplicados: DuplicadoCandidato[] };

export type DuplicadoCandidato = {
  id: number;
  fechaPago: string;
  descripcion: string;
  monto: string;
};

function traducirError(msg: string): string {
  if (msg.includes('foreign key') || msg.includes('23503')) {
    return 'Empresa, banco, proveedor o recurrencia referenciada no existe';
  }
  return msg;
}

function ymd(d: Date): string {
  return formatISO(d, { representation: 'date' });
}

async function buscarDuplicados(input: ErogacionInput, excludeId?: number) {
  const fecha = parseISO(input.fechaPago);
  const desde = ymd(subDays(fecha, 3));
  const hasta = ymd(addDays(fecha, 3));
  const montoNum = Number(input.monto);
  const minMonto = montoNum * 0.95;
  const maxMonto = montoNum * 1.05;

  const conds = [
    between(erogaciones.fechaPago, desde, hasta),
    sql`${erogaciones.monto}::numeric BETWEEN ${minMonto} AND ${maxMonto}`,
    eq(erogaciones.empresaId, input.empresaId),
  ];
  if (input.proveedorId) {
    conds.push(eq(erogaciones.proveedorId, input.proveedorId));
  }
  if (excludeId) {
    conds.push(sql`${erogaciones.id} <> ${excludeId}`);
  }

  const rows = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
    })
    .from(erogaciones)
    .where(and(...conds))
    .limit(5);

  return rows;
}

export async function crearErogacion(
  input: ErogacionInput,
  options: { confirmarDuplicados?: boolean } = {},
): Promise<ActionResult> {
  const parsed = erogacionFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  const data = parsed.data;

  if (!options.confirmarDuplicados) {
    const dups = await buscarDuplicados(data);
    if (dups.length > 0) {
      return {
        ok: false,
        error: 'duplicate_candidates',
        duplicados: dups,
      };
    }
  }

  try {
    await db.insert(erogaciones).values({
      fechaPago: data.fechaPago,
      descripcion: data.descripcion,
      monto: data.monto,
      moneda: data.moneda,
      empresaId: data.empresaId,
      proveedorId: data.proveedorId ?? null,
      bancoId: data.bancoId,
      estado: data.estado,
      categoria: data.categoria || null,
      esCritico: data.esCritico,
      notas: data.notas || null,
      pagadoAt: data.estado === 'pagado' ? new Date() : null,
    });
    revalidatePath('/erogaciones');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function editarErogacion(
  id: number,
  input: ErogacionInput,
): Promise<ActionResult> {
  const parsed = erogacionFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('. ') };
  }
  const data = parsed.data;
  try {
    await db
      .update(erogaciones)
      .set({
        fechaPago: data.fechaPago,
        descripcion: data.descripcion,
        monto: data.monto,
        moneda: data.moneda,
        empresaId: data.empresaId,
        proveedorId: data.proveedorId ?? null,
        bancoId: data.bancoId,
        estado: data.estado,
        categoria: data.categoria || null,
        esCritico: data.esCritico,
        notas: data.notas || null,
        // Edicion manual: la tentativa se descarta porque el usuario tomo
        // control explicito de la fecha. Tambien sale del estado oculto:
        // editar implica que volvio a la realidad del escenario actual.
        fechaSugeridaTentativa: null,
        oculto: false,
        updatedAt: new Date(),
        pagadoAt:
          data.estado === 'pagado'
            ? sql`COALESCE(${erogaciones.pagadoAt}, now())`
            : null,
      })
      .where(eq(erogaciones.id, id));
    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function borrarErogacion(id: number): Promise<ActionResult> {
  try {
    await db.delete(erogaciones).where(eq(erogaciones.id, id));
    revalidatePath('/erogaciones');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function cambiarEstadoErogacion(
  id: number,
  nuevoEstado: EstadoErogacion,
): Promise<ActionResult> {
  try {
    const limpiaTentativa =
      nuevoEstado === 'pagado' ||
      nuevoEstado === 'cancelado' ||
      nuevoEstado === 'rechazado';
    // Marcar pagada saca del estado oculto: implica que volvio al
    // escenario real. Para cancelado/rechazado mantenemos oculto.
    const limpiaOculto = nuevoEstado === 'pagado';
    await db
      .update(erogaciones)
      .set({
        estado: nuevoEstado,
        updatedAt: new Date(),
        ...(limpiaTentativa ? { fechaSugeridaTentativa: null } : {}),
        ...(limpiaOculto ? { oculto: false } : {}),
        pagadoAt:
          nuevoEstado === 'pagado'
            ? sql`COALESCE(${erogaciones.pagadoAt}, now())`
            : nuevoEstado === 'pendiente' || nuevoEstado === 'cancelado'
            ? null
            : sql`${erogaciones.pagadoAt}`,
      })
      .where(eq(erogaciones.id, id));
    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function bulkCambiarEstado(
  ids: number[],
  nuevoEstado: EstadoErogacion,
): Promise<ActionResult> {
  if (ids.length === 0) return { ok: true };
  try {
    const limpiaTentativa =
      nuevoEstado === 'pagado' ||
      nuevoEstado === 'cancelado' ||
      nuevoEstado === 'rechazado';
    const limpiaOculto = nuevoEstado === 'pagado';
    await db
      .update(erogaciones)
      .set({
        estado: nuevoEstado,
        updatedAt: new Date(),
        ...(limpiaTentativa ? { fechaSugeridaTentativa: null } : {}),
        ...(limpiaOculto ? { oculto: false } : {}),
        pagadoAt:
          nuevoEstado === 'pagado'
            ? sql`COALESCE(${erogaciones.pagadoAt}, now())`
            : nuevoEstado === 'pendiente' || nuevoEstado === 'cancelado'
            ? null
            : sql`${erogaciones.pagadoAt}`,
      })
      .where(inArray(erogaciones.id, ids));
    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

export async function bulkCambiarFecha(
  ids: number[],
  nuevaFecha: string,
): Promise<ActionResult> {
  if (ids.length === 0) return { ok: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha)) {
    return { ok: false, error: 'Fecha invalida (formato YYYY-MM-DD)' };
  }
  try {
    // Cambio masivo manual de fecha: descarta la tentativa Y saca del
    // estado oculto porque el usuario tomo control explicito de la fecha.
    await db
      .update(erogaciones)
      .set({
        fechaPago: nuevaFecha,
        fechaSugeridaTentativa: null,
        oculto: false,
        updatedAt: new Date(),
      })
      .where(inArray(erogaciones.id, ids));
    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: traducirError(e instanceof Error ? e.message : String(e)),
    };
  }
}

export async function cambiarOculto(
  id: number,
  oculto: boolean,
): Promise<ActionResult> {
  try {
    await db
      .update(erogaciones)
      .set({ oculto, updatedAt: new Date() })
      .where(eq(erogaciones.id, id));
    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: traducirError(e instanceof Error ? e.message : String(e)),
    };
  }
}

export async function bulkOcultar(
  ids: number[],
  oculto: boolean,
): Promise<ActionResult> {
  if (ids.length === 0) return { ok: true };
  try {
    await db
      .update(erogaciones)
      .set({ oculto, updatedAt: new Date() })
      .where(inArray(erogaciones.id, ids));
    revalidatePath('/erogaciones');
    revalidatePath('/pagos-atrasados');
    revalidatePath('/proyeccion');
    revalidatePath('/calendario');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: traducirError(e instanceof Error ? e.message : String(e)),
    };
  }
}

export async function bulkBorrar(ids: number[]): Promise<ActionResult> {
  if (ids.length === 0) return { ok: true };
  try {
    await db.delete(erogaciones).where(inArray(erogaciones.id, ids));
    revalidatePath('/erogaciones');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: traducirError(e instanceof Error ? e.message : String(e)) };
  }
}

// Used by Cmd+K for live search across descripcion.
export async function buscarErogacionesQuick(query: string) {
  const q = query.trim();
  if (!q) return [];
  const rows = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      estado: erogaciones.estado,
    })
    .from(erogaciones)
    .where(sql`${erogaciones.descripcion} ILIKE ${`%${q}%`}`)
    .orderBy(sql`${erogaciones.fechaPago} DESC`)
    .limit(8);
  return rows;
}
