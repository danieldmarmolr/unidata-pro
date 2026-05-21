import { format, subDays } from 'date-fns';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hoy = new Date();

  const headers = ['fecha', 'unidad_negocio', 'monto', 'empresa', 'evento_puntual'];

  const ejemplos = [
    {
      fecha: format(subDays(hoy, 2), 'yyyy-MM-dd'),
      unidad_negocio: 'Unistore Mayorista',
      monto: 850000,
      empresa: 'UNISTORE',
      evento_puntual: '',
    },
    {
      fecha: format(subDays(hoy, 2), 'yyyy-MM-dd'),
      unidad_negocio: 'Mercado Libre',
      monto: 420000,
      empresa: 'UNISTORE',
      evento_puntual: '',
    },
    {
      fecha: format(subDays(hoy, 1), 'yyyy-MM-dd'),
      unidad_negocio: 'Unistore Mayorista',
      monto: 920000,
      empresa: '',
      evento_puntual: '',
    },
    {
      fecha: format(subDays(hoy, 1), 'yyyy-MM-dd'),
      unidad_negocio: 'Unidrop',
      monto: 180000,
      empresa: '',
      evento_puntual: '',
    },
    {
      fecha: format(hoy, 'yyyy-MM-dd'),
      unidad_negocio: 'Unistore Mayorista',
      monto: 3200000,
      empresa: '',
      evento_puntual: 'si',
    },
  ];

  const wb = XLSX.utils.book_new();

  const wsFact = XLSX.utils.json_to_sheet(ejemplos, { header: headers });
  wsFact['!cols'] = [
    { wch: 12 }, // fecha
    { wch: 25 }, // unidad
    { wch: 12 }, // monto
    { wch: 20 }, // empresa
    { wch: 15 }, // evento_puntual
  ];
  XLSX.utils.book_append_sheet(wb, wsFact, 'Facturacion');

  const instrucciones = [
    ['Plantilla de carga masiva de facturacion diaria'],
    [''],
    ['Como usar:'],
    ['1. Reemplazá las filas de ejemplo por tus propios datos.'],
    ['2. NO toques los nombres de las columnas (primera fila).'],
    ['3. Subí este archivo en /importar pestaña "Plantilla facturacion".'],
    [''],
    ['Columnas:'],
    ['• fecha            Formato YYYY-MM-DD. Obligatoria.'],
    ['• unidad_negocio   Nombre exacto de la unidad (debe existir en la base). Obligatoria.'],
    ['• monto            Numero positivo. Obligatorio.'],
    ['• empresa          Nombre exacto. Opcional (se asocia a la unidad si se especifica).'],
    ['• evento_puntual   si / no. Default: no. Marcá "si" para Black Friday, eventos atipicos,'],
    ['                   cancelaciones, etc. — esos dias se excluyen del calculo de promedios.'],
    [''],
    ['Recomendaciones:'],
    ['• Cargá facturacion de al menos 8-12 semanas para que los promedios ponderados tengan datos suficientes.'],
    ['• Marcá como "evento_puntual = si" cualquier dia con comportamiento atipico que no se repita.'],
    ['  Esos dias se ven en el detalle pero no contaminan el modelo de proyeccion.'],
    [''],
    ['Antes de importar asegurate de tener creadas las unidades de negocio en /unidades-negocio.'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrucciones);
  wsInstr['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-facturacion.xlsx"',
    },
  });
}
