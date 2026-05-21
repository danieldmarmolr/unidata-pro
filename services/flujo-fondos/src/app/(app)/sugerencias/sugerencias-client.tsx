'use client';

import { Lightbulb, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import { FRECUENCIA_LABELS } from '../recurrencias/schema';
import { crearRecurrenciaDePatron } from './actions';
import type { PatronDetectado } from '@/lib/detectar-patrones';

export function SugerenciasClient({
  patrones,
  erogacionesAnalizadas,
}: {
  patrones: PatronDetectado[];
  erogacionesAnalizadas: number;
}) {
  const [pending, startTransition] = useTransition();

  function onCrear(patron: PatronDetectado) {
    startTransition(async () => {
      const res = await crearRecurrenciaDePatron(patron);
      if (res.ok) {
        toast.success('Recurrencia creada. Reviewala y generá las erogaciones.');
      } else {
        toast.error(res.error);
      }
    });
  }

  if (patrones.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Sparkles className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-base font-medium">Sin patrones detectados</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {erogacionesAnalizadas === 0
              ? 'Cargá erogaciones con proveedor asignado para que el detector tenga data sobre la que trabajar.'
              : `Analizamos ${erogacionesAnalizadas} erogaciones con proveedor asignado. Necesitamos al menos 3 pagos al mismo proveedor en fechas regulares (varianza <50%) y montos similares (varianza <30%) para sugerir una recurrencia.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-info/30 bg-info/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Lightbulb className="h-4 w-4 text-info shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">
              {patrones.length} {patrones.length === 1 ? 'sugerencia detectada' : 'sugerencias detectadas'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cada una se basa en pagos historicos al mismo proveedor con
              frecuencia regular y monto consistente. Al crear la recurrencia
              vas a poder editarla en{' '}
              <Link href="/recurrencias" className="text-primary hover:underline">
                /recurrencias
              </Link>{' '}
              antes de generar erogaciones automaticas.
            </p>
          </div>
        </CardContent>
      </Card>

      {patrones.map((p) => (
        <Card key={p.proveedorId}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Link
                    href={`/proveedores/${p.proveedorId}`}
                    className="font-semibold hover:underline"
                  >
                    {p.proveedorNombre}
                  </Link>
                  <Badge variant="outline" className="text-[10px]">
                    {FRECUENCIA_LABELS[p.frecuenciaSugerida]}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {p.cantidad} pagos
                  </Badge>
                </div>
                <p className="text-sm line-clamp-1">{p.descripcionTipica}</p>
              </div>
              <Button
                size="sm"
                onClick={() => onCrear(p)}
                disabled={pending}
              >
                Crear recurrencia
              </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Monto promedio
                </p>
                <p className="text-base font-semibold tabular-nums mt-0.5">
                  {fmtMonto(p.montoPromedio)}
                </p>
                {p.varianzaPct > 5 && (
                  <p className="text-[10px] text-muted-foreground">
                    Variacion: ±{p.varianzaPct.toFixed(0)}%
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Intervalo medio
                </p>
                <p className="text-base font-semibold tabular-nums mt-0.5">
                  {p.intervaloMedioDias}d
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {FRECUENCIA_LABELS[p.frecuenciaSugerida].toLowerCase()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Primer pago
                </p>
                <p className="text-sm font-medium tabular-nums mt-0.5">
                  {fmtFechaAR(p.fechaInicio)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Ultimo pago
                </p>
                <p className="text-sm font-medium tabular-nums mt-0.5">
                  {fmtFechaAR(p.fechaUltima)}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Rango de montos: {fmtMonto(p.montoMin)} → {fmtMonto(p.montoMax)}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
