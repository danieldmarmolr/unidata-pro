import { and, asc, eq, isNotNull, lt, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  bancosMediosPago,
  empresas,
  erogaciones,
  proveedores,
} from '@/db/schema';
import {
  calcularDiasAtraso,
  COLCHON_DEFAULT,
} from '@/lib/pagos-atrasados';
import { hoyISO } from '../erogaciones/utils';
import { PagosAtrasadosClient, type PagoAtrasadoRow } from './pagos-atrasados-client';

export const dynamic = 'force-dynamic';

export default async function PagosAtrasadosPage() {
  const hoy = new Date();
  const hoyStr = hoyISO();

  // Cargamos: atrasados (estado pendiente/en_curso + fecha_pago < hoy) +
  // todos los que tengan tentativa (aunque su fecha original ya sea pasada o
  // no, las tentativas son siempre futuras una vez aplicadas; pero pueden
  // seguir mostrandose acá si querés revertir).
  // Para que sea consistente: muestro los que esten en estado
  // pendiente/en_curso y cumplan: fecha_pago < hoy O tengan tentativa.
  const filas = await db
    .select({
      id: erogaciones.id,
      fechaPago: erogaciones.fechaPago,
      fechaSugeridaTentativa: erogaciones.fechaSugeridaTentativa,
      descripcion: erogaciones.descripcion,
      monto: erogaciones.monto,
      empresaId: erogaciones.empresaId,
      bancoId: erogaciones.bancoId,
      proveedorId: erogaciones.proveedorId,
      estado: erogaciones.estado,
      prioridadAtraso: erogaciones.prioridadAtraso,
      esCritico: erogaciones.esCritico,
    })
    .from(erogaciones)
    .where(
      and(
        ne(erogaciones.estado, 'pagado'),
        ne(erogaciones.estado, 'cancelado'),
        ne(erogaciones.estado, 'rechazado'),
        eq(erogaciones.oculto, false),
      ),
    )
    .orderBy(asc(erogaciones.fechaPago));

  // Filtrar en JS lo que cumple "atrasado" o "tiene tentativa" (drizzle no
  // expresa OR con tipos limpios sin orquestación extra).
  const atrasadosOTentativa = filas.filter(
    (f) => f.fechaPago < hoyStr || f.fechaSugeridaTentativa !== null,
  );

  const empresasList = await db
    .select({ id: empresas.id, nombre: empresas.nombre })
    .from(empresas);
  const bancosList = await db
    .select({ id: bancosMediosPago.id, nombre: bancosMediosPago.nombre })
    .from(bancosMediosPago);
  const proveedoresList = await db
    .select({ id: proveedores.id, nombre: proveedores.nombre })
    .from(proveedores);

  const empresasMap = new Map(empresasList.map((e) => [e.id, e.nombre]));
  const bancosMap = new Map(bancosList.map((b) => [b.id, b.nombre]));
  const provMap = new Map(proveedoresList.map((p) => [p.id, p.nombre]));

  const rows: PagoAtrasadoRow[] = atrasadosOTentativa.map((f) => ({
    id: f.id,
    fechaPago: f.fechaPago,
    fechaSugeridaTentativa: f.fechaSugeridaTentativa,
    descripcion: f.descripcion,
    monto: f.monto,
    empresaNombre: empresasMap.get(f.empresaId) ?? '—',
    bancoNombre: bancosMap.get(f.bancoId) ?? '—',
    proveedorNombre: f.proveedorId ? provMap.get(f.proveedorId) ?? null : null,
    estado: f.estado,
    prioridadAtraso:
      f.prioridadAtraso === 'laxo' ? 'laxo' : 'normal',
    esCritico: f.esCritico,
    diasAtraso:
      f.fechaPago < hoyStr ? calcularDiasAtraso(f.fechaPago, hoy) : 0,
  }));

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Pagos atrasados</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Pagos vencidos pendientes de procesar. El sistema te sugiere la
          primera fecha donde tu caja proyectada (sumando ingresos y descontando
          egresos comprometidos) se mantiene por encima de tu colchón mínimo.
          Las fechas sugeridas son tentativas — podés revisarlas en Calendario
          de caja y Proyección antes de confirmarlas.
        </p>
      </div>

      <PagosAtrasadosClient
        rows={rows}
        colchonDefault={COLCHON_DEFAULT}
        hoyISO={hoyStr}
      />
    </div>
  );
}
