import { and, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { db } from '@/db';
import { bancosMediosPago, empresas, ingresosPuntuales } from '@/db/schema';
import {
  CATEGORIAS_INGRESO_PUNTUAL,
  type CategoriaIngresoPuntual,
} from '@/app/(app)/ingresos-puntuales/schema';

export const dynamic = 'force-dynamic';

export type IngresoPuntualPlantilla = {
  filaExcel: number;
  fecha: string;
  descripcion: string;
  monto: string;
  empresaInput: string;
  bancoInput: string;
  categoriaInput: string;
  notas: string | null;
  empresaId: number | null;
  bancoId: number | null;
  categoria: CategoriaIngresoPuntual | null;
  errores: string[];
  yaExiste: boolean;
};

export type ParsePlantillaIngrPuntResult =
  | {
      ok: true;
      filas: IngresoPuntualPlantilla[];
      totalFilas: number;
      filasValidas: number;
      filasConError: number;
      filasDuplicadas: number;
      faltantes: { empresas: string[]; bancos: string[] };
    }
  | { ok: false; error: string };

function aFechaISOPlantilla(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

function aMonto(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    return v.toString();
  }
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/\./g, '').replace(',', '.');
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toString();
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse<ParsePlantillaIngrPuntResult>> {
  console.log('[parsear-ingresos-puntuales] INICIO');
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    console.log(
      '[parsear-ingresos-puntuales] file recibido?',
      !!file,
      'tipo:',
      typeof file,
    );
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'No se recibio archivo' });
    }
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    console.log('[parsear-ingresos-puntuales] buffer size:', buffer.length);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    console.log('[parsear-ingresos-puntuales] hojas:', wb.SheetNames);

    const sheetName = wb.SheetNames.find((n) => {
      const k = n.toLowerCase().replace(/[^a-z]/g, '');
      return k === 'ingresospuntuales' || k === 'ingresos';
    });
    if (!sheetName) {
      return NextResponse.json({
        ok: false,
        error:
          'No se encontro la hoja "IngresosPuntuales" en el archivo. Usa la plantilla descargable.',
      });
    }
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'La hoja esta vacia.' });
    }

    const empresasData = await db
      .select({ id: empresas.id, nombre: empresas.nombre })
      .from(empresas);
    const bancosData = await db
      .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
      .from(bancosMediosPago);

    const empresasMap = new Map<string, number>();
    for (const e of empresasData) empresasMap.set(e.nombre.trim().toUpperCase(), e.id);
    const bancosMap = new Map<string, number>();
    for (const b of bancosData) bancosMap.set(b.nombre.trim().toUpperCase(), b.id);

    console.log('[parsear-ingresos-puntuales] filas leidas:', rows.length);

    const out: IngresoPuntualPlantilla[] = [];
    const faltantesEmpresas = new Set<string>();
    const faltantesBancos = new Set<string>();
    const erroresParseo: string[] = [];

    rows.forEach((row, idx) => {
      try {
        const errores: string[] = [];
        const filaExcel = idx + 2;

        const get = (clave: string): unknown => {
          for (const k of Object.keys(row)) {
            if (k.toLowerCase().replace(/[^a-z_]/g, '') === clave) {
              return row[k];
            }
          }
          return null;
        };

        const fecha = aFechaISOPlantilla(get('fecha'));
        const descripcion = String(get('descripcion') ?? '').trim();
        const monto = aMonto(get('monto'));
        const empresaInput = String(get('empresa') ?? '').trim();
        const bancoInput = String(get('banco') ?? '').trim();
        const categoriaInput = String(get('categoria') ?? '').trim().toLowerCase();
        const notasRaw = get('notas');
        const notas = notasRaw ? String(notasRaw).trim() || null : null;

        if (!fecha && !descripcion && !monto && !empresaInput) return;

        if (!fecha) errores.push('fecha invalida o faltante');
        if (!descripcion) errores.push('descripcion vacia');
        if (!monto) errores.push('monto invalido o negativo');
        if (!empresaInput) errores.push('empresa vacia');

        const empresaId = empresaInput
          ? empresasMap.get(empresaInput.toUpperCase()) ?? null
          : null;
        const bancoId = bancoInput
          ? bancosMap.get(bancoInput.toUpperCase()) ?? null
          : null;

        if (empresaInput && !empresaId) {
          faltantesEmpresas.add(empresaInput.toUpperCase());
          errores.push(`empresa "${empresaInput}" no existe`);
        }
        if (bancoInput && !bancoId) {
          faltantesBancos.add(bancoInput.toUpperCase());
          errores.push(`banco "${bancoInput}" no existe`);
        }

        const categoria = (CATEGORIAS_INGRESO_PUNTUAL as readonly string[]).includes(
          categoriaInput,
        )
          ? (categoriaInput as CategoriaIngresoPuntual)
          : null;

        out.push({
          filaExcel,
          fecha: fecha ?? '',
          descripcion,
          monto: monto ?? '0',
          empresaInput,
          bancoInput,
          categoriaInput,
          notas,
          empresaId,
          bancoId,
          categoria,
          errores,
          yaExiste: false,
        });
      } catch (errFila) {
        const msg = errFila instanceof Error ? errFila.message : String(errFila);
        console.error(
          '[parsear-ingresos-puntuales] error en fila',
          idx + 2,
          msg,
          row,
        );
        erroresParseo.push(`fila ${idx + 2}: ${msg}`);
      }
    });

    if (out.length === 0 && erroresParseo.length > 0) {
      return NextResponse.json({
        ok: false,
        error: `Ninguna fila pudo procesarse. Detalle: ${erroresParseo.slice(0, 3).join(' | ')}`,
      });
    }

    // Duplicados
    const candidatas = out.filter((f) => f.errores.length === 0 && f.empresaId);
    if (candidatas.length > 0) {
      const fechas = Array.from(new Set(candidatas.map((c) => c.fecha)));
      const empresaIds = Array.from(new Set(candidatas.map((c) => c.empresaId!)));

      const existentes = await db
        .select({
          fecha: ingresosPuntuales.fecha,
          empresaId: ingresosPuntuales.empresaId,
          monto: ingresosPuntuales.monto,
          descripcion: ingresosPuntuales.descripcion,
        })
        .from(ingresosPuntuales)
        .where(
          and(
            inArray(ingresosPuntuales.fecha, fechas),
            inArray(ingresosPuntuales.empresaId, empresaIds),
          ),
        );

      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const claveDe = (
        fecha: string,
        empresaId: number,
        monto: string,
        descripcion: string,
      ) => `${fecha}|${empresaId}|${Number(monto).toFixed(2)}|${norm(descripcion)}`;

      const setExistentes = new Set(
        existentes.map((e) =>
          claveDe(e.fecha, e.empresaId, e.monto, e.descripcion),
        ),
      );

      for (const f of out) {
        if (f.errores.length > 0 || !f.empresaId) continue;
        const clave = claveDe(f.fecha, f.empresaId, f.monto, f.descripcion);
        if (setExistentes.has(clave)) f.yaExiste = true;
      }
    }

    const resultado: ParsePlantillaIngrPuntResult = {
      ok: true,
      filas: out,
      totalFilas: out.length,
      filasValidas: out.filter((f) => f.errores.length === 0 && !f.yaExiste).length,
      filasConError: out.filter((f) => f.errores.length > 0).length,
      filasDuplicadas: out.filter((f) => f.errores.length === 0 && f.yaExiste).length,
      faltantes: {
        empresas: Array.from(faltantesEmpresas),
        bancos: Array.from(faltantesBancos),
      },
    };
    console.log(
      '[parsear-ingresos-puntuales] OK:',
      resultado.totalFilas,
      'filas',
    );
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[parsear-ingresos-puntuales] error global:', e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json({
      ok: false,
      error: `Error procesando archivo: ${msg}`,
    });
  }
}
