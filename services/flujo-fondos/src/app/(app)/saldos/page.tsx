import { asc, desc } from 'drizzle-orm';
import { db } from '@/db';
import { bancosMediosPago, saldosIniciales } from '@/db/schema';
import { SaldosClient } from './saldos-client';
import { BANCO_CONSOLIDADO_NOMBRE } from './schema';

export const dynamic = 'force-dynamic';

export default async function SaldosPage() {
  const bancos = await db
    .select({
      id: bancosMediosPago.id,
      nombre: bancosMediosPago.nombre,
      tipo: bancosMediosPago.tipo,
    })
    .from(bancosMediosPago)
    .orderBy(asc(bancosMediosPago.nombre));

  const todos = await db
    .select({
      id: saldosIniciales.id,
      bancoId: saldosIniciales.bancoId,
      fecha: saldosIniciales.fecha,
      saldo: saldosIniciales.saldo,
      fuente: saldosIniciales.fuente,
      createdAt: saldosIniciales.createdAt,
    })
    .from(saldosIniciales)
    .orderBy(desc(saldosIniciales.fecha));

  const porBanco = new Map<number, typeof todos>();
  for (const s of todos) {
    const arr = porBanco.get(s.bancoId) ?? [];
    arr.push(s);
    porBanco.set(s.bancoId, arr);
  }

  const bancosConSaldos = bancos.map((b) => {
    const saldos = porBanco.get(b.id) ?? [];
    const ultimo = saldos[0] ?? null;
    return { ...b, saldos, ultimo };
  });

  const consolidado =
    bancosConSaldos.find((b) => b.nombre === BANCO_CONSOLIDADO_NOMBRE) ?? null;
  const bancosReales = bancosConSaldos.filter(
    (b) => b.nombre !== BANCO_CONSOLIDADO_NOMBRE,
  );

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Saldos iniciales</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Punto de partida para la proyeccion de caja. Podes cargar un saldo
          total de hoy (rapido) o el saldo de cada banco por separado (mas
          preciso). El motor parte de ahi y aplica ingresos esperados menos
          egresos comprometidos para proyectar el saldo dia a dia.
        </p>
      </div>

      <SaldosClient bancos={bancosReales} consolidado={consolidado} />
    </div>
  );
}
