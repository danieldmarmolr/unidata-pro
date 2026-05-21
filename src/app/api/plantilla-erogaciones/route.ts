import { format } from 'date-fns';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hoy = format(new Date(), 'yyyy-MM-dd');

  const headers = [
    'fecha_pago',
    'descripcion',
    'monto',
    'empresa',
    'banco',
    'proveedor',
    'estado',
    'critico',
    'categoria',
    'notas',
  ];

  const ejemplos = [
    {
      fecha_pago: hoy,
      descripcion: 'Alquiler oficina enero',
      monto: 250000,
      empresa: 'UNISTORE',
      banco: 'GALICIA',
      proveedor: 'Inmobiliaria Centro',
      estado: 'pendiente',
      critico: 'si',
      categoria: 'alquiler',
      notas: 'Vence dia 5',
    },
    {
      fecha_pago: hoy,
      descripcion: 'Servicio luz oficina',
      monto: 45000,
      empresa: 'UNISTORE',
      banco: 'GALICIA',
      proveedor: 'Edenor',
      estado: 'pendiente',
      critico: '',
      categoria: 'servicios',
      notas: '',
    },
    {
      fecha_pago: hoy,
      descripcion: 'Pago proveedor mayorista',
      monto: 1200000,
      empresa: 'FOX ELECTRONICS',
      banco: 'SANTANDER',
      proveedor: '',
      estado: 'en_curso',
      critico: '',
      categoria: 'mercaderia',
      notas: '',
    },
  ];

  const wb = XLSX.utils.book_new();

  // Hoja Erogaciones (datos)
  const wsErog = XLSX.utils.json_to_sheet(ejemplos, { header: headers });
  // Ajustar anchos
  wsErog['!cols'] = [
    { wch: 12 }, // fecha
    { wch: 35 }, // descripcion
    { wch: 12 }, // monto
    { wch: 20 }, // empresa
    { wch: 18 }, // banco
    { wch: 22 }, // proveedor
    { wch: 12 }, // estado
    { wch: 8 }, // critico
    { wch: 15 }, // categoria
    { wch: 30 }, // notas
  ];
  XLSX.utils.book_append_sheet(wb, wsErog, 'Erogaciones');

  // Hoja Instrucciones
  const instrucciones = [
    ['Plantilla de carga masiva de erogaciones'],
    [''],
    ['Como usar:'],
    ['1. Reemplazá las 3 filas de ejemplo por tus propios datos.'],
    ['2. NO toques los nombres de las columnas (primera fila).'],
    ['3. Las columnas en blanco son opcionales — podés dejarlas vacías.'],
    ['4. Subí este archivo en /importar pestaña "Plantilla erogaciones".'],
    [''],
    ['Columnas:'],
    ['• fecha_pago       Formato YYYY-MM-DD (ej: 2026-05-14). Obligatoria.'],
    ['• descripcion      Texto libre. Obligatoria.'],
    ['• monto            Número positivo. Obligatorio.'],
    ['• empresa          Nombre exacto de la empresa (debe existir en la base). Obligatoria.'],
    ['• banco            Nombre exacto del banco (debe existir en la base). Obligatorio.'],
    ['• proveedor        Nombre exacto del proveedor. Opcional (si no existe se ignora).'],
    ['• estado           Uno de: pendiente / en_curso / pagado / cancelado / rechazado. Default: pendiente.'],
    ['• critico          si / no. Default: no.'],
    ['• categoria        Texto libre (ej: alquiler, servicios, sueldos). Opcional.'],
    ['• notas            Texto libre. Opcional.'],
    [''],
    ['Antes de importar asegurate de tener creadas:'],
    ['• Las empresas que vas a usar (en /empresas)'],
    ['• Los bancos que vas a usar (en /bancos)'],
    [''],
    ['Los proveedores que no existan en la base se ignorarán (el campo queda en blanco).'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
  wsInstr['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-erogaciones.xlsx"',
    },
  });
}
