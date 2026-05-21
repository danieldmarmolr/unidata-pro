import { and, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  erogaciones,
  proveedores,
} from '@/db/schema';

export const dynamic = 'force-dynamic';

export type ErogacionPlantilla = {
  filaExcel: number;
  fechaPago: string;
  descripcion: string;
  monto: string;
  empresaInput: string;
  bancoInput: string;
  proveedorInput: string;
  estado: 'pendiente' | 'en_curso' | 'pagado' | 'cancelado' | 'rechazado';
  esCritico: boolean;
  categoria: string | null;
  notas: string | null;
  empresaId: number | null;
  bancoId: number | null;
  proveedorId: number | null;
  errores: string[];
  yaExiste: boolean;
};

export type ParsePlantillaErogResult =
  | {
      ok: true;
      filas: ErogacionPlantilla[];
      totalFilas: number;
      filasValidas: number;
      filasConError: number;
      filasDuplicadas: number;
      faltantes: { empresas: string[]; bancos: string[] };
    }
  | { ok: false; error: string };

const ESTADO_MAP_PLANTILLA: Record<string, ErogacionPlantilla['estado']> = {
  pendiente: 'pendiente',
  en_curso: 'en_curso',
  'en curso': 'en_curso',
  pagado: 'pagado',
  pagada: 'pagado',
  cancelado: 'cancelado',
  cancelada: 'cancelado',
  rechazado: 'rechazado',
  rechazada: 'rechazado',
};

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
  return (
    s === 'si' || s === 'sí' || s === 'yes' || s === 'true' || s === '1' || s === 'x'
  );
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
): Promise<NextResponse<ParsePlantillaErogResult>> {
  console.log('[parsear-plantilla-erogaciones] INICIO');
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    console.log(
      '[parsear-plantilla-erogaciones] file recibido?',
      !!file,
      'tipo:',
      typeof file,
    );
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'No se recibio archivo' });
    }
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    console.log('[parsear-plantilla-erogaciones] buffer size:', buffer.length);
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    console.log('[parsear-plantilla-erogaciones] hojas:', wb.SheetNames);

    const sheetName = wb.SheetNames.find(
      (n) => n.toLowerCase().replace(/[^a-z]/g, '') === 'erogaciones',
    );
    if (!sheetName) {
      return NextResponse.json({
        ok: false,
        error:
          'No se encontro la hoja "Erogaciones" en el archivo. Asegurate de usar la plantilla descargable.',
      });
    }
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    });

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'La hoja "Erogaciones" esta vacia.',
      });
    }

    const empresasData = await db
      .select({ id: empresas.id, nombre: empresas.nombre })
      .from(empresas);
    const bancosData = await db
      .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
      .from(bancosMediosPago);
    const proveedoresData = await db
      .select({ id: proveedores.id, nombre: proveedores.nombre })
      .from(proveedores);

    const empresasMap = new Map<string, number>();
    for (const e of empresasData) empresasMap.set(e.nombre.trim().toUpperCase(), e.id);
    const bancosMap = new Map<string, number>();
    for (const b of bancosData) bancosMap.set(b.nombre.trim().toUpperCase(), b.id);
    const proveedoresMap = new Map<string, number>();
    for (const p of proveedoresData)
      proveedoresMap.set(p.nombre.trim().toUpperCase(), p.id);

    console.log('[parsear-plantilla-erogaciones] filas leidas:', rows.length);
    if (rows.length > 0) {
      console.log(
        '[parsear-plantilla-erogaciones] columnas detectadas:',
        Object.keys(rows[0]),
      );
    }

    const out: ErogacionPlantilla[] = [];
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

        const fechaPago = aFechaISOPlantilla(get('fecha_pago') ?? get('fechapago'));
        const descripcion = String(get('descripcion') ?? '').trim();
        const monto = aMonto(get('monto'));
        const empresaInput = String(get('empresa') ?? '').trim();
        const bancoInput = String(get('banco') ?? '').trim();
        const proveedorInput = String(get('proveedor') ?? '').trim();
        const estadoRaw = String(get('estado') ?? 'pendiente')
          .trim()
          .toLowerCase();
        const estado = ESTADO_MAP_PLANTILLA[estadoRaw] ?? 'pendiente';
        const esCritico = siNo(get('critico'));
        const categoriaRaw = get('categoria');
        const categoria = categoriaRaw
          ? String(categoriaRaw).trim() || null
          : null;
        const notasRaw = get('notas');
        const notas = notasRaw ? String(notasRaw).trim() || null : null;

        if (!fechaPago && !descripcion && !monto && !empresaInput && !bancoInput)
          return;

        if (!fechaPago) errores.push('fecha_pago invalida o faltante');
        if (!descripcion) errores.push('descripcion vacia');
        if (!monto) errores.push('monto invalido');
        if (!empresaInput) errores.push('empresa vacia');
        if (!bancoInput) errores.push('banco vacio');

        const empresaId = empresaInput
          ? empresasMap.get(empresaInput.toUpperCase()) ?? null
          : null;
        const bancoId = bancoInput
          ? bancosMap.get(bancoInput.toUpperCase()) ?? null
          : null;
        const proveedorId = proveedorInput
          ? proveedoresMap.get(proveedorInput.toUpperCase()) ?? null
          : null;

        if (empresaInput && !empresaId) {
          faltantesEmpresas.add(empresaInput.toUpperCase());
          errores.push('empresa "' + empresaInput + '" no existe');
        }
        if (bancoInput && !bancoId) {
          faltantesBancos.add(bancoInput.toUpperCase());
          errores.push('banco "' + bancoInput + '" no existe');
        }

        out.push({
          filaExcel,
          fechaPago: fechaPago ?? '',
          descripcion,
          monto: monto ?? '0',
          empresaInput,
          bancoInput,
          proveedorInput,
          estado,
          esCritico,
          categoria,
          notas,
          empresaId,
          bancoId,
          proveedorId,
          errores,
          yaExiste: false,
        });
      } catch (errFila) {
        const msg = errFila instanceof Error ? errFila.message : String(errFila);
        console.error(
          '[parsear-plantilla-erogaciones] error en fila',
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
    const candidatas = out.filter(
      (f) => f.errores.length === 0 && f.empresaId && f.bancoId,
    );
    if (candidatas.length > 0) {
      const fechas = Array.from(new Set(candidatas.map((c) => c.fechaPago)));
      const empresaIds = Array.from(new Set(candidatas.map((c) => c.empresaId!)));
      const bancoIds = Array.from(new Set(candidatas.map((c) => c.bancoId!)));

      const existentes = await db
        .select({
          fechaPago: erogaciones.fechaPago,
          empresaId: erogaciones.empresaId,
          bancoId: erogaciones.bancoId,
          monto: erogaciones.monto,
          descripcion: erogaciones.descripcion,
        })
        .from(erogaciones)
        .where(
          and(
            inArray(erogaciones.fechaPago, fechas),
            inArray(erogaciones.empresaId, empresaIds),
            inArray(erogaciones.bancoId, bancoIds),
          ),
        );

      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const claveDe = (
        fecha: string,
        empresaId: number,
        bancoId: number,
        monto: string,
        descripcion: string,
      ) =>
        `${fecha}|${empresaId}|${bancoId}|${Number(monto).toFixed(2)}|${norm(descripcion)}`;

      const setExistentes = new Set(
        existentes.map((e) =>
          claveDe(e.fechaPago, e.empresaId, e.bancoId, e.monto, e.descripcion),
        ),
      );

      for (const f of out) {
        if (f.errores.length > 0 || !f.empresaId || !f.bancoId) continue;
        const clave = claveDe(
          f.fechaPago,
          f.empresaId,
          f.bancoId,
          f.monto,
          f.descripcion,
        );
        if (setExistentes.has(clave)) f.yaExiste = true;
      }
    }

    const resultado: ParsePlantillaErogResult = {
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
      '[parsear-plantilla-erogaciones] OK:',
      resultado.totalFilas,
      'filas',
    );
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[parsear-plantilla-erogaciones] error global:', e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return NextResponse.json({
      ok: false,
      error: `Error procesando archivo: ${msg}`,
    });
  }
}
