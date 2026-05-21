'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import * as XLSX from 'xlsx';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  erogaciones,
  facturacionDiaria,
  proveedores,
  unidadesNegocio,
} from '@/db/schema';

export type ProveedorImport = {
  nombre: string;
  saldoPendiente: string;
  prioridad: 'alta' | 'media' | 'baja';
  notas: string | null;
};

export type ErogacionImport = {
  fechaPago: string;
  descripcion: string;
  monto: string;
  empresaNombre: string;
  bancoNombre: string;
  empresaId: number | null;
  bancoId: number | null;
  estado: 'pendiente' | 'en_curso' | 'pagado' | 'cancelado' | 'rechazado';
  fila: number;
};

export type FacturacionImport = {
  fecha: string;
  monto: string;
  fila: number;
};

export type ParseResult = {
  ok: true;
  hojasDetectadas: string[];
  proveedores: ProveedorImport[];
  erogaciones: ErogacionImport[];
  facturacion: FacturacionImport[];
  faltantes: {
    empresas: string[];
    bancos: string[];
  };
  totalErogaciones: number;
  erogacionesCompletas: number;
};

const ESTADO_MAP: Record<string, ErogacionImport['estado']> = {
  pendiente: 'pendiente',
  'en curso': 'en_curso',
  encurso: 'en_curso',
  pagado: 'pagado',
  pagada: 'pagado',
  cancelado: 'cancelado',
  cancelada: 'cancelado',
  rechazado: 'rechazado',
};

function aFechaISO(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

function findSheet(wb: XLSX.WorkBook, ...candidatos: string[]): XLSX.WorkSheet | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  for (const c of candidatos) {
    const found = wb.SheetNames.find((n) => norm(n) === norm(c));
    if (found) return wb.Sheets[found];
  }
  return null;
}

function parseProveedoresSheet(sheet: XLSX.WorkSheet): ProveedorImport[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const out: ProveedorImport[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    if (!r) continue;
    const nombre = (r[0] ?? '').toString().trim();
    if (!nombre) continue;
    const saldoNum = typeof r[1] === 'number' ? (r[1] as number) : 0;
    const prioRaw = (r[2] ?? '').toString().trim().toLowerCase();
    const prioridad: ProveedorImport['prioridad'] = (['alta', 'media', 'baja'] as const).includes(
      prioRaw as 'alta' | 'media' | 'baja',
    )
      ? (prioRaw as ProveedorImport['prioridad'])
      : 'media';
    const notas = r[3] ? r[3].toString().trim() : null;
    out.push({
      nombre,
      saldoPendiente: saldoNum.toString(),
      prioridad,
      notas,
    });
  }
  return out;
}

function parseErogacionesSheet(
  sheet: XLSX.WorkSheet,
  empresasMap: Map<string, number>,
  bancosMap: Map<string, number>,
): { rows: ErogacionImport[]; faltantes: { empresas: Set<string>; bancos: Set<string> } } {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const out: ErogacionImport[] = [];
  const faltantes = { empresas: new Set<string>(), bancos: new Set<string>() };

  let dataStart = 0;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const c0 = ((raw[i] as unknown[])?.[0] ?? '').toString().toLowerCase();
    if (c0 === 'fecha') {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || !r[0]) continue;
    const fechaPago = aFechaISO(r[0]);
    const descripcion = (r[2] ?? '').toString().trim();
    const monto = typeof r[3] === 'number' ? (r[3] as number) : Number(r[3]) || 0;
    const bancoNombre = (r[4] ?? '').toString().trim().toUpperCase();
    const empresaNombre = (r[5] ?? '').toString().trim().toUpperCase();
    const estadoRaw = (r[6] ?? '').toString().trim().toLowerCase();
    const estado = ESTADO_MAP[estadoRaw] ?? 'pendiente';

    if (!fechaPago || !descripcion || !monto) continue;

    const empresaId = empresasMap.get(empresaNombre) ?? null;
    const bancoId = bancosMap.get(bancoNombre) ?? null;

    if (!empresaId) faltantes.empresas.add(empresaNombre || '(vacio)');
    if (!bancoId) faltantes.bancos.add(bancoNombre || '(vacio)');

    out.push({
      fechaPago,
      descripcion,
      monto: monto.toString(),
      empresaNombre,
      bancoNombre,
      empresaId,
      bancoId,
      estado,
      fila: i + 1,
    });
  }
  return { rows: out, faltantes };
}

function parseFacturacionSheet(sheet: XLSX.WorkSheet): FacturacionImport[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const out: FacturacionImport[] = [];
  let dataStart = 0;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const c0 = ((raw[i] as unknown[])?.[0] ?? '').toString().toLowerCase();
    if (c0 === 'fecha') {
      dataStart = i + 1;
      break;
    }
  }
  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i] as unknown[];
    if (!r || !r[0]) continue;
    const fecha = aFechaISO(r[0]);
    const monto = typeof r[1] === 'number' ? (r[1] as number) : Number(r[1]) || 0;
    if (!fecha || !monto) continue;
    out.push({ fecha, monto: monto.toString(), fila: i + 1 });
  }
  return out;
}

export async function parsearExcel(formData: FormData): Promise<
  ParseResult | { ok: false; error: string }
> {
  try {
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return { ok: false, error: 'No se recibio archivo' };
    }
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    const hojaProv = findSheet(wb, 'Proveedores');
    const hojaGastos = findSheet(wb, 'Gastos');
    const hojaFact = findSheet(wb, 'Facturacion', 'Facturación');

    // Lookups
    const empresasData = await db.select({ id: empresas.id, nombre: empresas.nombre }).from(empresas);
    const bancosData = await db
      .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
      .from(bancosMediosPago);
    const empresasMap = new Map<string, number>();
    for (const e of empresasData) empresasMap.set(e.nombre.trim().toUpperCase(), e.id);
    const bancosMap = new Map<string, number>();
    for (const b of bancosData) bancosMap.set(b.nombre.trim().toUpperCase(), b.id);

    const provs = hojaProv ? parseProveedoresSheet(hojaProv) : [];
    const { rows: erogs, faltantes } = hojaGastos
      ? parseErogacionesSheet(hojaGastos, empresasMap, bancosMap)
      : { rows: [], faltantes: { empresas: new Set<string>(), bancos: new Set<string>() } };
    const fact = hojaFact ? parseFacturacionSheet(hojaFact) : [];

    return {
      ok: true,
      hojasDetectadas: wb.SheetNames,
      proveedores: provs,
      erogaciones: erogs,
      facturacion: fact,
      faltantes: {
        empresas: Array.from(faltantes.empresas),
        bancos: Array.from(faltantes.bancos),
      },
      totalErogaciones: erogs.length,
      erogacionesCompletas: erogs.filter((e) => e.empresaId && e.bancoId).length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type ApplyResult =
  | {
      ok: true;
      proveedoresInsertados: number;
      proveedoresActualizados: number;
      erogacionesInsertadas: number;
      erogacionesSalteadas: number;
    }
  | { ok: false; error: string };

export async function aplicarImport({
  proveedoresImport,
  erogacionesImport,
  importarProveedores,
  importarErogaciones,
}: {
  proveedoresImport: ProveedorImport[];
  erogacionesImport: ErogacionImport[];
  importarProveedores: boolean;
  importarErogaciones: boolean;
}): Promise<ApplyResult> {
  try {
    let provIns = 0;
    let provUpd = 0;
    let erogIns = 0;
    let erogSalt = 0;

    if (importarProveedores) {
      for (const p of proveedoresImport) {
        const existente = await db
          .select({ id: proveedores.id })
          .from(proveedores)
          .where(eq(proveedores.nombre, p.nombre))
          .limit(1);
        if (existente.length > 0) {
          await db
            .update(proveedores)
            .set({
              saldoPendiente: p.saldoPendiente,
              prioridad: p.prioridad,
              notas: p.notas,
              updatedAt: new Date(),
            })
            .where(eq(proveedores.id, existente[0].id));
          provUpd++;
        } else {
          await db.insert(proveedores).values({
            nombre: p.nombre,
            saldoPendiente: p.saldoPendiente,
            prioridad: p.prioridad,
            notas: p.notas,
          });
          provIns++;
        }
      }
    }

    if (importarErogaciones) {
      const completas = erogacionesImport.filter((e) => e.empresaId && e.bancoId);
      erogSalt = erogacionesImport.length - completas.length;
      const BATCH = 100;
      for (let i = 0; i < completas.length; i += BATCH) {
        const batch = completas.slice(i, i + BATCH);
        await db.insert(erogaciones).values(
          batch.map((e) => ({
            fechaPago: e.fechaPago,
            descripcion: e.descripcion,
            monto: e.monto,
            empresaId: e.empresaId!,
            bancoId: e.bancoId!,
            estado: e.estado,
            metadata: sql`${JSON.stringify({ origen: 'excel-import-ui', fila: e.fila })}::jsonb`,
          })),
        );
        erogIns += batch.length;
      }
    }

    revalidatePath('/proveedores');
    revalidatePath('/erogaciones');
    revalidatePath('/');
    revalidatePath('/calendario');
    revalidatePath('/proyeccion');

    return {
      ok: true,
      proveedoresInsertados: provIns,
      proveedoresActualizados: provUpd,
      erogacionesInsertadas: erogIns,
      erogacionesSalteadas: erogSalt,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
