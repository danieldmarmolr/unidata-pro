'use client';

import { differenceInDays } from 'date-fns';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Plus,
  Trash2,
  Wallet,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import {
  borrarSaldo,
  cargarSaldo,
  cargarSaldoConsolidado,
} from './actions';

type SaldoRow = {
  id: number;
  bancoId: number;
  fecha: string;
  saldo: string;
  fuente: 'manual' | 'api_banco' | 'extracto_csv';
  createdAt: Date;
};

type BancoConSaldos = {
  id: number;
  nombre: string;
  tipo: string;
  saldos: SaldoRow[];
  ultimo: SaldoRow | null;
};

function hoyISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function SaldosClient({
  bancos,
  consolidado,
}: {
  bancos: BancoConSaldos[];
  consolidado: BancoConSaldos | null;
}) {
  const [open, setOpen] = useState(false);
  const [bancoEditando, setBancoEditando] = useState<BancoConSaldos | null>(null);
  const [fecha, setFecha] = useState(hoyISO());
  const [saldo, setSaldo] = useState('');
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [mostrarBancos, setMostrarBancos] = useState(
    () => bancos.some((b) => b.ultimo !== null) || consolidado === null,
  );
  const [pending, startTransition] = useTransition();

  // Estado para "Saldo total de hoy"
  const [consolidadoFecha, setConsolidadoFecha] = useState(hoyISO());
  const [consolidadoSaldo, setConsolidadoSaldo] = useState(
    consolidado?.ultimo?.saldo ?? '',
  );
  const [consolidadoHistorial, setConsolidadoHistorial] = useState(false);

  if (bancos.length === 0 && consolidado === null) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Wallet className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-base font-medium">No hay bancos cargados</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Antes de cargar saldos necesitas tener al menos un banco creado.
          </p>
          <Link
            href="/bancos"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Ir a bancos →
          </Link>
        </CardContent>
      </Card>
    );
  }

  function abrirNuevo(banco: BancoConSaldos) {
    setBancoEditando(banco);
    setFecha(hoyISO());
    setSaldo(banco.ultimo?.saldo ?? '');
    setOpen(true);
  }

  function onGuardar() {
    if (!bancoEditando) return;
    if (!saldo.trim()) {
      toast.error('Ingresa el saldo');
      return;
    }
    startTransition(async () => {
      const res = await cargarSaldo({
        bancoId: bancoEditando.id,
        fecha,
        saldo: saldo.trim(),
        fuente: 'manual',
      });
      if (res.ok) {
        toast.success('Saldo cargado');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function onGuardarConsolidado() {
    if (!consolidadoSaldo.trim()) {
      toast.error('Ingresa el saldo total');
      return;
    }
    startTransition(async () => {
      const res = await cargarSaldoConsolidado({
        fecha: consolidadoFecha,
        saldo: consolidadoSaldo.trim(),
      });
      if (res.ok) {
        toast.success('Saldo total de hoy guardado');
      } else {
        toast.error(res.error);
      }
    });
  }

  function onBorrar(s: SaldoRow, banco: BancoConSaldos) {
    if (!confirm(`Borrar el saldo del ${fmtFechaAR(s.fecha)} para ${banco.nombre}?`))
      return;
    startTransition(async () => {
      const res = await borrarSaldo(s.id);
      if (res.ok) toast.success('Saldo borrado');
      else toast.error(res.error);
    });
  }

  function toggleExpand(id: number) {
    const nuevo = new Set(expandidos);
    if (nuevo.has(id)) nuevo.delete(id);
    else nuevo.add(id);
    setExpandidos(nuevo);
  }

  const saldoConsolidadoActual = consolidado?.ultimo
    ? Number(consolidado.ultimo.saldo)
    : 0;
  const saldoBancosActual = bancos.reduce(
    (a, b) => a + (b.ultimo ? Number(b.ultimo.saldo) : 0),
    0,
  );
  const saldoTotal = saldoConsolidadoActual + saldoBancosActual;
  const tieneConsolidadoActivo = consolidado?.ultimo !== undefined && consolidado?.ultimo !== null;
  const tieneBancosActivos = bancos.some((b) => b.ultimo !== null);
  const mezclaConsolidadoYBancos = tieneConsolidadoActivo && tieneBancosActivos;

  const bancosConSaldo = bancos.filter((b) => b.ultimo !== null);
  const bancosSinSaldo = bancos.filter((b) => b.ultimo === null);

  return (
    <div className="space-y-5">
      {/* Saldo total de hoy (forma rapida) */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">Saldo total de hoy</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                  Cargá una sola cifra con lo que tenés disponible (caja + bancos)
                  para arrancar rapido. La proyeccion la levanta automaticamente.
                </p>
              </div>
            </div>
            {tieneConsolidadoActivo && consolidado?.ultimo && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Actual
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {fmtMonto(consolidado.ultimo.saldo)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  al {fmtFechaAR(consolidado.ultimo.fecha)}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <div className="space-y-1">
              <Label htmlFor="consolidado-fecha" className="text-xs">
                Fecha
              </Label>
              <Input
                id="consolidado-fecha"
                type="date"
                value={consolidadoFecha}
                onChange={(e) => setConsolidadoFecha(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label htmlFor="consolidado-saldo" className="text-xs">
                Saldo total (ARS)
              </Label>
              <Input
                id="consolidado-saldo"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={consolidadoSaldo}
                onChange={(e) => setConsolidadoSaldo(e.target.value)}
                className="h-9"
              />
            </div>
            <Button onClick={onGuardarConsolidado} disabled={pending} className="h-9">
              {pending ? 'Guardando...' : 'Guardar saldo de hoy'}
            </Button>
          </div>

          {consolidado && consolidado.saldos.length > 0 && (
            <button
              type="button"
              onClick={() => setConsolidadoHistorial((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              {consolidadoHistorial ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Historial ({consolidado.saldos.length}{' '}
              {consolidado.saldos.length === 1 ? 'registro' : 'registros'})
            </button>
          )}

          {consolidadoHistorial && consolidado && (
            <div className="space-y-1 pt-2 border-t">
              {consolidado.saldos.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 py-1 px-2 rounded hover:bg-card text-sm"
                >
                  <span className="text-xs text-muted-foreground tabular-nums w-24">
                    {fmtFechaAR(s.fecha)}
                  </span>
                  <span className="tabular-nums flex-1">{fmtMonto(s.saldo)}</span>
                  <button
                    type="button"
                    onClick={() => onBorrar(s, consolidado)}
                    className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-danger hover:bg-danger/10"
                    aria-label="Borrar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerta si hay mezcla */}
      {mezclaConsolidadoYBancos && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                Estas combinando saldo consolidado y saldo por banco
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                La proyeccion suma ambos:{' '}
                <span className="font-medium tabular-nums">
                  {fmtMonto(saldoConsolidadoActual)}
                </span>{' '}
                (consolidado) +{' '}
                <span className="font-medium tabular-nums">
                  {fmtMonto(saldoBancosActual)}
                </span>{' '}
                (bancos) ={' '}
                <span className="font-medium tabular-nums">
                  {fmtMonto(saldoTotal)}
                </span>
                . Si querés que sea solo uno, borrá el otro.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumen consolidado */}
      {(tieneConsolidadoActivo || tieneBancosActivos) && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Wallet className="h-3 w-3" /> Saldo consolidado total
                </p>
                <p className="text-3xl font-semibold tabular-nums mt-1">
                  {fmtMonto(saldoTotal)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Es lo que la proyeccion toma como punto de partida
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {tieneConsolidadoActivo && (
                  <p>
                    {fmtMonto(saldoConsolidadoActual)}{' '}
                    <span className="text-muted-foreground/60">consolidado</span>
                  </p>
                )}
                {tieneBancosActivos && (
                  <p>
                    {fmtMonto(saldoBancosActual)}{' '}
                    <span className="text-muted-foreground/60">
                      {bancosConSaldo.length} de {bancos.length}{' '}
                      {bancos.length === 1 ? 'banco' : 'bancos'}
                    </span>
                  </p>
                )}
                {bancosSinSaldo.length > 0 && tieneBancosActivos && (
                  <p className="text-warning mt-0.5">
                    {bancosSinSaldo.length} sin saldo cargado
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Toggle desglose por banco */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Desglose por banco{' '}
          <span className="text-muted-foreground/60 normal-case font-normal">
            (mas preciso)
          </span>
        </p>
        <button
          type="button"
          onClick={() => setMostrarBancos((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {mostrarBancos ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {mostrarBancos ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {mostrarBancos && bancos.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground w-8"></th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Banco
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Saldo actual
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Antigüedad
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {bancos.map((b) => {
                  const expandido = expandidos.has(b.id);
                  const antiguedad =
                    b.ultimo !== null
                      ? differenceInDays(new Date(), new Date(b.ultimo.fecha))
                      : null;
                  const desactualizado = antiguedad !== null && antiguedad > 14;
                  return (
                    <>
                      <tr
                        key={`row-${b.id}`}
                        className={cn(
                          'border-t hover:bg-muted/30',
                          b.ultimo === null && 'bg-warning/5',
                        )}
                      >
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExpand(b.id)}
                            disabled={b.saldos.length === 0}
                            className="h-6 w-6 inline-flex items-center justify-center rounded-md hover:bg-muted disabled:opacity-30"
                            aria-label={expandido ? 'Colapsar' : 'Expandir'}
                          >
                            {expandido ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{b.nombre}</div>
                          <div className="text-xs text-muted-foreground capitalize">
                            {b.tipo.replace('_', ' ')}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {b.ultimo ? (
                            <span
                              className={cn(
                                'font-medium',
                                Number(b.ultimo.saldo) < 0 && 'text-danger',
                              )}
                            >
                              {fmtMonto(b.ultimo.saldo)}
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-warning/10 text-warning border-warning/30 text-[10px]"
                            >
                              sin cargar
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {b.ultimo ? (
                            <div>
                              <p className="tabular-nums">
                                {fmtFechaAR(b.ultimo.fecha)}
                              </p>
                              {antiguedad !== null && (
                                <p
                                  className={cn(
                                    'text-[10px]',
                                    desactualizado && 'text-warning font-medium',
                                  )}
                                >
                                  {antiguedad === 0
                                    ? 'hoy'
                                    : antiguedad === 1
                                      ? 'hace 1 dia'
                                      : `hace ${antiguedad} dias`}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/60">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            onClick={() => abrirNuevo(b)}
                            size="sm"
                            variant={b.ultimo ? 'outline' : 'default'}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            {b.ultimo ? 'Nuevo saldo' : 'Cargar saldo'}
                          </Button>
                        </td>
                      </tr>
                      {expandido && b.saldos.length > 0 && (
                        <tr key={`expand-${b.id}`} className="border-t bg-muted/10">
                          <td colSpan={5} className="px-12 py-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                              Historial ({b.saldos.length} registros)
                            </p>
                            <div className="space-y-1">
                              {b.saldos.map((s) => (
                                <div
                                  key={s.id}
                                  className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-card"
                                >
                                  <span className="text-xs text-muted-foreground tabular-nums w-24">
                                    {fmtFechaAR(s.fecha)}
                                  </span>
                                  <span className="text-sm tabular-nums flex-1">
                                    {fmtMonto(s.saldo)}
                                  </span>
                                  <Badge variant="outline" className="text-[10px]">
                                    {s.fuente.replace('_', ' ')}
                                  </Badge>
                                  <button
                                    type="button"
                                    onClick={() => onBorrar(s, b)}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-danger hover:bg-danger/10"
                                    aria-label="Borrar"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {bancosSinSaldo.length > 0 && (
            <Card className="border-info/30 bg-info/5">
              <CardContent className="p-4 text-sm flex items-start gap-3">
                <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Los bancos sin saldo cargado contribuyen 0 al consolidado. Si
                  cargaste el &quot;Saldo total de hoy&quot; arriba, no hace falta cargar
                  uno por uno.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Dialog para nuevo saldo por banco */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bancoEditando?.ultimo ? 'Nuevo saldo' : 'Cargar saldo inicial'}
            </DialogTitle>
            <DialogDescription>
              {bancoEditando?.nombre}. Si ya existe un saldo para esta fecha, se
              actualiza.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fecha">Fecha del saldo</Label>
              <Input
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="saldo">Saldo (ARS)</Label>
              <Input
                id="saldo"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={saldo}
                onChange={(e) => setSaldo(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Puede ser negativo si la cuenta está en rojo.
              </p>
            </div>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonVariants({ variant: 'outline' })}
            >
              Cancelar
            </button>
            <Button onClick={onGuardar} disabled={pending}>
              {pending ? 'Guardando...' : 'Guardar saldo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
