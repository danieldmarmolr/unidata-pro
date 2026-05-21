import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { db } from '@/db';
import { empresas, unidadesNegocio } from '@/db/schema';

export const dynamic = 'force-dynamic';

export type FacturacionPlantilla = {
  filaExcel: number;
  fecha: string;
  unidadInput: string;
  monto: string;
  empresaInput: string;
  esEventoPuntual: boolean;
  unidadNegocioId: number | null;
  empresaId: number | null;
  errores: string[];
};

export type ParsePlantillaFactResult =
  | {
      ok: true;
      filas: FacturacionPlantilla[];
      totalFilas: number;
      filasValidas: number;
      filasConError: number;
      faltantes: { unidades: string[]; empresas: string[] };
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

function siNo(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'si' || s === 'sí' || s === 'yes' || s === 'true' || s === '1' || s === 'x';
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

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ParsePlantillaFactResult>> {
  console.log('[parsear-plantilla-facturacion] INICIO');
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    console.log(
      '[parsear-plantilla-facturacion] file recibido?',
      !!file,
      'tipo:',
      typeof file,
    );
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'No se recibio archivo' });
    }
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    console.log('[parsear-plantilla-facturacion] buffer size:', buffer.length);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    console.log('[parsear-plantilla-facturacion] hojas:', wb.SheetNames);

    const sheetName = wb.SheetNames.find(
      (n) => n.toLowerCase().replace(/[^a-z]/g, '') === 'facturacion',
    );
    if (!sheetName) {
      return NextResponse.json({
        ok: false,
        error:
          'No se encontro la hoja "Facturacion" en el archivo. Asegurate de usar la plantilla descargable.',
      });
    }
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'La hoja "Facturacion" esta vacia.',
      });
    }

    console.log('[parsear-plantilla-facturacion] filas leidas:', rows.length);
    if (rows.length > 0) {
      console.log(
        '[parsear-plantilla-facturacion] columnas detectadas:',
        Object.keys(rows[0]),
      );
    }

    let unidadesData: { id: number; nombre: string }[] = [];
    let empresasData: { id: number; nombre: string }[] = [];
    try {
      unidadesData = await db
        .select({ id: unidadesNegocio.id, nombre: unidadesNegocio.nombre })
        .from(unidadesNegocio);
      empresasData = await db
        .select({ id: empresas.id, nombre: empresas.nombre })
        .from(empresas);
    } catch (e) {
      console.error('[parsear-plantilla-facturacion] error en lookups:', e);
      return NextResponse.json({
        ok: false,
        error: `Error consultando base de datos: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    const unidadesMap = new Map<string, number>();
    for (const u of unidadesData) unidadesMap.set(u.nombre.trim().toUpperCase(), u.id);
    const empresasMap = new Map<string, number>();
    for (const e of empresasData) empresasMap.set(e.nombre.trim().toUpperCase(), e.id);

    const out: FacturacionPlantilla[] = [];
    const faltantesUnidades = new Set<string>();
    const faltantesEmpresas = new Set<string>();
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
        const unidadRaw =
          get('unidad_negocio') ?? get('unidadnegocio') ?? get('unidad');
        const unidadInput = String(unidadRaw ?? '').trim();
        const monto = aMonto(get('monto'));
        const empresaInput = String(get('empresa') ?? '').trim();
        const esEventoPuntual = siNo(get('evento_puntual') ?? get('eventopuntual'));

        if (!fecha && !unidadInput && !monto) return;

        if (!fecha) errores.push('fecha invalida o faltante');
        if (!unidadInput) errores.push('unidad_negocio vacia');
        if (!monto) errores.push('monto invalido');

        const unidadNegocioId = unidadInput
          ? unidadesMap.get(unidadInput.toUpperCase()) ?? null
          : null;
        const empresaId = empresaInput
          ? empresasMap.get(empresaInput.toUpperCase()) ?? null
          : null;

        if (unidadInput && !unidadNegocioId) {
          faltantesUnidades.add(unidadInput.toUpperCase());
          errores.push('unidad "' + unidadInput + '" no existe');
        }
        if (empresaInput && !empresaId)
          faltantesEmpresas.add(empresaInput.toUpperCase());

        out.push({
          filaExcel,
          fecha: fecha ?? '',
          unidadInput,
          monto: monto ?? '0',
          empresaInput,
          esEventoPuntual,
          unidadNegocioId,
          empresaId,
          errores,
        });
      } catch (errFila) {
        const msg = errFila instanceof Error ? errFila.message : String(errFila);
        console.error(
          '[parsear-plantilla-facturacion] error en fila',
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

    console.log(
      '[parsear-plantilla-facturacion] parseo OK:',
      out.length,
      'filas,',
      out.filter((f) => f.errores.length === 0).length,
      'validas',
    );

    return NextResponse.json({
      ok: true,
      filas: out,
      totalFilas: out.length,
      filasValidas: out.filter((f) => f.errores.length === 0).length,
      filasConError: out.filter((f) => f.errores.length > 0).length,
      faltantes: {
        unidades: Array.from(faltantesUnidades),
        empresas: Array.from(faltantesEmpresas),
      },
    });
  } catch (e) {
    console.error('[parsear-plantilla-facturacion] error global:', e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json({
      ok: false,
      error: `Error procesando archivo: ${msg}`,
    });
  }
}
