import { format } from 'date-fns';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hoy = format(new Date(), 'yyyy-MM-dd');

  const headers = [
    'fecha',
    'descripcion',
    'monto',
    'empresa',
    'banco',
    'categoria',
    'notas',
  ];

  const ejemplos = [
    {
      fecha: hoy,
      descripcion: 'Cobro ECHEQ Gocuotas',
      monto: 13498130,
      empresa: 'FOX ELECTRONICS',
      banco: 'SUPERVIELLE',
      categoria: 'cobro_cheque',
      notas: '',
    },
    {
      fecha: hoy,
      descripcion: 'Solicitud Prestamo Nacion',
      monto: 16000000,
      empresa: 'FOX ELECTRONICS',
      banco: 'NACION',
      categoria: 'prestamo',
      notas: 'A 90 dias',
    },
    {
      fecha: hoy,
      descripcion: 'Aporte de capital',
      monto: 5000000,
      empresa: 'UNISTORE',
      banco: '',
      categoria: 'aporte_socio',
      notas: '',
    },
  ];

  const wb = XLSX.utils.book_new();

  const wsIngr = XLSX.utils.json_to_sheet(ejemplos, { header: headers });
  wsIngr['!cols'] = [
    { wch: 12 }, // fecha
    { wch: 35 }, // descripcion
    { wch: 14 }, // monto
    { wch: 20 }, // empresa
    { wch: 18 }, // banco
    { wch: 16 }, // categoria
    { wch: 30 }, // notas
  ];
  XLSX.utils.book_append_sheet(wb, wsIngr, 'IngresosPuntuales');

  const instrucciones = [
    ['Plantilla de carga masiva de ingresos puntuales'],
    [''],
    ['Que son?'],
    ['Plata que ENTRA al flujo de forma extraordinaria, distinta a la facturacion'],
    ['recurrente: cobros de cheques, prestamos, devoluciones, aportes de socios,'],
    ['ventas de activos, etc. En la proyeccion se suman al saldo del dia.'],
    [''],
    ['Como usar:'],
    ['1. Reemplazá las 3 filas de ejemplo por tus propios datos.'],
    ['2. NO toques los nombres de las columnas (primera fila).'],
    ['3. Subí este archivo en /importar pestaña "Plantilla ingresos puntuales".'],
    [''],
    ['Columnas:'],
    ['• fecha         YYYY-MM-DD (ej: 2026-05-14). Cuando entra la plata. Obligatoria.'],
    ['• descripcion   Texto libre. Obligatoria.'],
    ['• monto         Número POSITIVO. Es ingreso (no usar negativos). Obligatorio.'],
    ['• empresa       Nombre exacto (debe existir en /empresas). Obligatoria.'],
    ['• banco         Nombre exacto (debe existir en /bancos). Opcional.'],
    ['• categoria     cobro_cheque / prestamo / devolucion / aporte_socio / venta_activo / otro. Opcional.'],
    ['• notas         Texto libre. Opcional.'],
    [''],
    ['IMPORTANTE: no usar acá pagos / egresos. Para esos usar la plantilla de erogaciones.'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
  wsInstr['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="plantilla-ingresos-puntuales.xlsx"',
    },
  });
}
