'use server';

import { asc, desc, ilike, or, eq } from 'drizzle-orm';
import { db } from '@/db';
import { acuerdos, erogaciones, proveedores } from '@/db/schema';

export type ResultadoErogacion = {
  tipo: 'erogacion';
  id: number;
  titulo: string;
  detalle: string;
  href: string;
};

export type ResultadoProveedor = {
  tipo: 'proveedor';
  id: number;
  titulo: string;
  detalle: string;
  href: string;
};

export type ResultadoAcuerdo = {
  tipo: 'acuerdo';
  id: number;
  titulo: string;
  detalle: string;
  href: string;
};

export type ResultadoBusqueda =
  | ResultadoErogacion
  | ResultadoProveedor
  | ResultadoAcuerdo;

export async function buscarGlobal(q: string): Promise<{
  erogaciones: ResultadoErogacion[];
  proveedores: ResultadoProveedor[];
  acuerdos: ResultadoAcuerdo[];
}> {
  const query = q.trim();
  if (query.length < 2) {
    return { erogaciones: [], proveedores: [], acuerdos: [] };
  }
  const pattern = `%${query}%`;

  const [erogs, provs, acs] = await Promise.all([
    db
      .select({
        id: erogaciones.id,
        fechaPago: erogaciones.fechaPago,
        descripcion: erogaciones.descripcion,
        monto: erogaciones.monto,
        estado: erogaciones.estado,
      })
      .from(erogaciones)
      .where(ilike(erogaciones.descripcion, pattern))
      .orderBy(desc(erogaciones.fechaPago))
      .limit(6),

    db
      .select({
        id: proveedores.id,
        nombre: proveedores.nombre,
        cuit: proveedores.cuit,
        prioridad: proveedores.prioridad,
      })
      .from(proveedores)
      .where(
        or(
          ilike(proveedores.nombre, pattern),
          ilike(proveedores.cuit, pattern),
        ),
      )
      .orderBy(asc(proveedores.nombre))
      .limit(6),

    db
      .select({
        id: acuerdos.id,
        proveedorId: acuerdos.proveedorId,
        proveedorNombre: proveedores.nombre,
        compromiso: acuerdos.compromiso,
        estado: acuerdos.estado,
        fechaCompromiso: acuerdos.fechaCompromiso,
      })
      .from(acuerdos)
      .innerJoin(proveedores, eq(proveedores.id, acuerdos.proveedorId))
      .where(
        or(
          ilike(acuerdos.compromiso, pattern),
          ilike(proveedores.nombre, pattern),
        ),
      )
      .orderBy(desc(acuerdos.createdAt))
      .limit(6),
  ]);

  return {
    erogaciones: erogs.map((e) => ({
      tipo: 'erogacion' as const,
      id: e.id,
      titulo: e.descripcion,
      detalle: `${e.fechaPago} · ${Number(e.monto).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} · ${e.estado}`,
      href: `/erogaciones?q=${encodeURIComponent(e.descripcion)}`,
    })),
    proveedores: provs.map((p) => ({
      tipo: 'proveedor' as const,
      id: p.id,
      titulo: p.nombre,
      detalle: `${p.cuit ? `CUIT ${p.cuit} · ` : ''}prioridad ${p.prioridad}`,
      href: `/proveedores/${p.id}`,
    })),
    acuerdos: acs.map((a) => ({
      tipo: 'acuerdo' as const,
      id: a.id,
      titulo: a.compromiso,
      detalle: `${a.proveedorNombre} · ${a.estado}${a.fechaCompromiso ? ` · ${a.fechaCompromiso}` : ''}`,
      href: `/acuerdos?proveedor=${a.proveedorId}`,
    })),
  };
}
