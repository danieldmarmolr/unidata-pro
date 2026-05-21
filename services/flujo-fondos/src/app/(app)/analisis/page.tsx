import { endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns';
import { and, asc, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  erogaciones,
  proveedores,
} from '@/db/schema';
import { AnalisisClient } from './analisis-client';
import {
  analisisFiltrosSchema,
  type AnalisisFiltros,
  type Periodo,
} from './schema';

export const dynamic = 'force-dynamic';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangoPeriodo(periodo: Periodo): { desde: string | null; hasta: string | null } {
  const hoy = new Date();
  switch (periodo) {
    case 'este_mes':
      return {
        desde: isoDate(startOfMonth(hoy)),
        hasta: isoDate(endOfMonth(hoy)),
      };
    case 'mes_pasado': {
      const inicio = startOfMonth(subMonths(hoy, 1));
      const fin = endOfMonth(subMonths(hoy, 1));
      return { desde: isoDate(inicio), hasta: isoDate(fin) };
    }
    case 'ultimos_30':
      return { desde: isoDate(subDays(hoy, 30)), hasta: isoDate(hoy) };
    case 'ultimos_90':
      return { desde: isoDate(subDays(hoy, 90)), hasta: isoDate(hoy) };
    case 'ultimos_365':
      return { desde: isoDate(subDays(hoy, 365)), hasta: isoDate(hoy) };
    case 'todo':
      return { desde: null, hasta: null };
  }
}

function estadosArr(estado: AnalisisFiltros['estado']): Array<
  'pendiente' | 'en_curso' | 'pagado' | 'cancelado' | 'rechazado'
> | null {
  switch (estado) {
    case 'pagado':
      return ['pagado'];
    case 'pendiente_curso':
      return ['pendiente', 'en_curso'];
    case 'todos':
      return ['pendiente', 'en_curso', 'pagado'];
  }
}

export default async function AnalisisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtros = analisisFiltrosSchema.parse({
    periodo: sp.periodo,
    estado: sp.estado,
  });

  const { desde, hasta } = rangoPeriodo(filtros.periodo);
  const estados = estadosArr(filtros.estado);

  const conds = [];
  if (desde) conds.push(gte(erogaciones.fechaPago, desde));
  if (hasta) conds.push(lte(erogaciones.fechaPago, hasta));
  if (estados) conds.push(inArray(erogaciones.estado, estados));

  // Agrupacion por empresa
  const porEmpresa = await db
    .select({
      empresaId: erogaciones.empresaId,
      empresaNombre: empresas.nombre,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .leftJoin(empresas, eq(empresas.id, erogaciones.empresaId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(erogaciones.empresaId, empresas.nombre);

  // Agrupacion por banco
  const porBanco = await db
    .select({
      bancoId: erogaciones.bancoId,
      bancoNombre: bancosMediosPago.nombre,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .leftJoin(bancosMediosPago, eq(bancosMediosPago.id, erogaciones.bancoId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(erogaciones.bancoId, bancosMediosPago.nombre);

  // Agrupacion por proveedor (top 15)
  const porProveedor = await db
    .select({
      proveedorId: erogaciones.proveedorId,
      proveedorNombre: proveedores.nombre,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .leftJoin(proveedores, eq(proveedores.id, erogaciones.proveedorId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(erogaciones.proveedorId, proveedores.nombre)
    .orderBy(sql`SUM(${erogaciones.monto}::numeric) DESC`)
    .limit(15);

  // Agrupacion por categoria
  const porCategoria = await db
    .select({
      categoria: erogaciones.categoria,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
      cantidad: count(),
    })
    .from(erogaciones)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(erogaciones.categoria);

  // Serie temporal: gastos por mes (para grafico)
  const porMes = await db
    .select({
      mes: sql<string>`to_char(${erogaciones.fechaPago}, 'YYYY-MM')`,
      total: sql<string>`COALESCE(SUM(${erogaciones.monto}::numeric), 0)::text`,
    })
    .from(erogaciones)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(sql`to_char(${erogaciones.fechaPago}, 'YYYY-MM')`)
    .orderBy(asc(sql`to_char(${erogaciones.fechaPago}, 'YYYY-MM')`));

  const totalGeneral = porEmpresa.reduce((a, e) => a + Number(e.total), 0);
  const cantidadGeneral = porEmpresa.reduce((a, e) => a + e.cantidad, 0);

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Analisis de gastos
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Donde se va la plata. Distribucion de erogaciones por empresa, banco,
          proveedor y categoria en el periodo elegido. Util para entender la
          composicion del flujo y detectar concentracion de gastos.
        </p>
      </div>

      <AnalisisClient
        filtros={filtros}
        porEmpresa={porEmpresa}
        porBanco={porBanco}
        porProveedor={porProveedor}
        porCategoria={porCategoria}
        porMes={porMes}
        totalGeneral={totalGeneral}
        cantidadGeneral={cantidadGeneral}
        rangoLabel={
          desde && hasta
            ? `${desde} → ${hasta}`
            : 'Todo el historial'
        }
      />
    </div>
  );
}
