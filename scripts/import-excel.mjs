// Importador del Excel "Simulador_Flujo_-_Gastos_Proyectados".
//
// Uso:
//   node scripts/import-excel.mjs <ruta-al-xlsx>             # dry run
//   node scripts/import-excel.mjs <ruta-al-xlsx> --apply     # aplica
//
// Que hace:
//   - Lee las hojas Proveedores, Gastos y Facturacion.
//   - Reporta cantidades, ejemplos y problemas (bancos/empresas que
//     no existen en la base).
//   - Con --apply, inserta proveedores y erogaciones via Supabase.
//   - Facturacion NO se importa todavia: necesita asignar unidad de
//     negocio explicitamente (lo coordinamos cuando lo necesites).
//
// Pre-requisitos: tener cargadas en la base las empresas y bancos
// que se mencionan en el Excel.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

config({ path: '.env.local' });

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');

if (!filePath) {
  console.error('Uso: node scripts/import-excel.mjs <ruta-al-xlsx> [--apply]');
  process.exit(1);
}

const absPath = resolve(filePath);
console.log(`\n--- Importador del Excel ---`);
console.log(`Archivo: ${absPath}`);
console.log(`Modo:    ${apply ? 'APPLY (escribe en la base)' : 'DRY RUN (no escribe)'}\n`);

// ---------- Cliente Supabase con secret key ----------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local');
  process.exit(1);
}
const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- Lectura del Excel ----------
let workbook;
try {
  const buf = readFileSync(absPath);
  workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
} catch (e) {
  console.error(`Error leyendo el archivo: ${e.message}`);
  process.exit(1);
}

console.log('Hojas detectadas:', workbook.SheetNames);

function findSheet(...candidates) {
  for (const c of candidates) {
    const found = workbook.SheetNames.find(
      (n) => n.toLowerCase().replace(/[^a-z]/g, '') === c.toLowerCase().replace(/[^a-z]/g, ''),
    );
    if (found) return workbook.Sheets[found];
  }
  return null;
}

const hojaProveedores = findSheet('Proveedores');
const hojaGastos = findSheet('Gastos');
const hojaFacturacion = findSheet('Facturacion', 'Facturación');

// ---------- Lookups ----------
const { data: empresasData, error: errEmp } = await supabase
  .from('empresas')
  .select('id, nombre');
if (errEmp) {
  console.error('Error leyendo empresas:', errEmp.message);
  process.exit(1);
}
const { data: bancosData, error: errBan } = await supabase
  .from('bancos_medios_pago')
  .select('id, nombre');
if (errBan) {
  console.error('Error leyendo bancos:', errBan.message);
  process.exit(1);
}

const empresasMap = new Map();
for (const e of empresasData ?? []) empresasMap.set(e.nombre.trim().toUpperCase(), e.id);
const bancosMap = new Map();
for (const b of bancosData ?? []) bancosMap.set(b.nombre.trim().toUpperCase(), b.id);

console.log(`En base: ${empresasMap.size} empresas, ${bancosMap.size} bancos/medios.\n`);

// ---------- Parsers ----------
function parseProveedores() {
  if (!hojaProveedores) {
    console.log('[Proveedores] hoja no encontrada — salteando.');
    return [];
  }
  const rows = XLSX.utils.sheet_to_json(hojaProveedores, { header: 1, defval: null });
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const nombre = (r[0] ?? '').toString().trim();
    if (!nombre) continue;
    const saldoNum = typeof r[1] === 'number' ? r[1] : 0;
    const prioRaw = (r[2] ?? '').toString().trim().toLowerCase();
    const prioridad = ['alta', 'media', 'baja'].includes(prioRaw) ? prioRaw : 'media';
    const notas = r[3] ? r[3].toString().trim() : null;
    out.push({ nombre, saldo_pendiente: saldoNum.toString(), prioridad, notas });
  }
  return out;
}

const ESTADO_MAP = {
  pendiente: 'pendiente',
  'en curso': 'en_curso',
  encurso: 'en_curso',
  pagado: 'pagado',
  pagada: 'pagado',
  cancelado: 'cancelado',
  cancelada: 'cancelado',
  rechazado: 'rechazado',
};

function aFechaISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseGastos() {
  if (!hojaGastos) {
    console.log('[Gastos] hoja no encontrada — salteando.');
    return { rows: [], faltantes: { bancos: new Set(), empresas: new Set() } };
  }
  const raw = XLSX.utils.sheet_to_json(hojaGastos, { header: 1, defval: null });
  const out = [];
  const faltantes = { bancos: new Set(), empresas: new Set() };

  let dataStart = 0;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const c0 = (raw[i]?.[0] ?? '').toString().toLowerCase();
    if (c0 === 'fecha') {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !r[0]) continue;
    const fechaPago = aFechaISO(r[0]);
    const descripcion = (r[2] ?? '').toString().trim();
    const monto = typeof r[3] === 'number' ? r[3] : Number(r[3]) || 0;
    const bancoNombre = (r[4] ?? '').toString().trim().toUpperCase();
    const empresaNombre = (r[5] ?? '').toString().trim().toUpperCase();
    const estadoRaw = (r[6] ?? '').toString().trim().toLowerCase();
    const estado = ESTADO_MAP[estadoRaw] ?? 'pendiente';

    if (!fechaPago || !descripcion || !monto) continue;

    const empresa_id = empresasMap.get(empresaNombre);
    const banco_id = bancosMap.get(bancoNombre);

    if (!empresa_id) faltantes.empresas.add(empresaNombre || '(vacio)');
    if (!banco_id) faltantes.bancos.add(bancoNombre || '(vacio)');

    out.push({
      fecha_pago: fechaPago,
      descripcion,
      monto: monto.toString(),
      empresa_id,
      banco_id,
      estado,
      metadata: { origen: 'excel-import', archivo: filePath, fila: i + 1 },
    });
  }
  return { rows: out, faltantes };
}

function parseFacturacion() {
  if (!hojaFacturacion) {
    console.log('[Facturacion] hoja no encontrada — salteando.');
    return [];
  }
  const raw = XLSX.utils.sheet_to_json(hojaFacturacion, { header: 1, defval: null });
  const out = [];
  let dataStart = 0;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const c0 = (raw[i]?.[0] ?? '').toString().toLowerCase();
    if (c0 === 'fecha') {
      dataStart = i + 1;
      break;
    }
  }
  for (let i = dataStart; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !r[0]) continue;
    const fecha = aFechaISO(r[0]);
    const monto = typeof r[1] === 'number' ? r[1] : Number(r[1]) || 0;
    if (!fecha || !monto) continue;
    out.push({ fecha, monto: monto.toString() });
  }
  return out;
}

// ---------- Ejecucion ----------
const proveedoresExcel = parseProveedores();
const { rows: gastosExcel, faltantes } = parseGastos();
const facturacionExcel = parseFacturacion();

console.log('--- Resumen ---');
console.log(`Proveedores:        ${proveedoresExcel.length} filas`);
console.log(`Erogaciones:        ${gastosExcel.length} filas`);
console.log(`Facturacion:        ${facturacionExcel.length} filas (no se importa todavia)`);

if (faltantes.empresas.size > 0) {
  console.log(`\n[!] Empresas mencionadas en Gastos que NO existen en la base:`);
  for (const e of faltantes.empresas) console.log(`     - ${e}`);
}
if (faltantes.bancos.size > 0) {
  console.log(`\n[!] Bancos mencionados en Gastos que NO existen en la base:`);
  for (const b of faltantes.bancos) console.log(`     - ${b}`);
}

const gastosCompletos = gastosExcel.filter((g) => g.empresa_id && g.banco_id);
const gastosIncompletos = gastosExcel.length - gastosCompletos.length;
if (gastosIncompletos > 0) {
  console.log(
    `\n[!] ${gastosIncompletos} erogaciones tienen empresa o banco faltante — no se van a importar hasta que esos registros existan en la base.`,
  );
}

if (proveedoresExcel.length > 0) {
  console.log('\nEjemplo de proveedor:', JSON.stringify(proveedoresExcel[0], null, 2));
}
if (gastosCompletos.length > 0) {
  console.log('\nEjemplo de erogacion completa:', JSON.stringify(gastosCompletos[0], null, 2));
}

if (!apply) {
  console.log(`\n=== DRY RUN ===`);
  console.log(`Para aplicar realmente: agregar --apply al comando.`);
  console.log(`Facturacion NO se importa en esta primera version (necesita asignar`);
  console.log(`unidad de negocio explicitamente — coordinar aparte).\n`);
  process.exit(0);
}

// ---------- APPLY ----------
console.log(`\n=== APLICANDO CAMBIOS ===`);

// 1) Proveedores: upsert por nombre (no hay unique constraint en la base,
//    asi que hacemos lookup manual).
let insProv = 0;
let updProv = 0;
for (const p of proveedoresExcel) {
  const { data: existente } = await supabase
    .from('proveedores')
    .select('id')
    .eq('nombre', p.nombre)
    .limit(1);
  if (existente && existente.length > 0) {
    const { error } = await supabase
      .from('proveedores')
      .update({
        saldo_pendiente: p.saldo_pendiente,
        prioridad: p.prioridad,
        notas: p.notas,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existente[0].id);
    if (error) {
      console.error(`  Error actualizando proveedor "${p.nombre}":`, error.message);
    } else {
      updProv++;
    }
  } else {
    const { error } = await supabase.from('proveedores').insert({
      nombre: p.nombre,
      saldo_pendiente: p.saldo_pendiente,
      prioridad: p.prioridad,
      notas: p.notas,
    });
    if (error) {
      console.error(`  Error insertando proveedor "${p.nombre}":`, error.message);
    } else {
      insProv++;
    }
  }
}
console.log(`Proveedores: ${insProv} insertados, ${updProv} actualizados.`);

// 2) Erogaciones: insertar las completas. No deduplicamos.
if (gastosCompletos.length > 0) {
  // En batches para no exceder limites.
  const BATCH = 100;
  let total = 0;
  for (let i = 0; i < gastosCompletos.length; i += BATCH) {
    const batch = gastosCompletos.slice(i, i + BATCH);
    const { error } = await supabase.from('erogaciones').insert(batch);
    if (error) {
      console.error(`  Error en batch ${i}-${i + batch.length}:`, error.message);
      break;
    }
    total += batch.length;
  }
  console.log(`Erogaciones: ${total} insertadas.`);
}

console.log(`\nListo.\n`);
