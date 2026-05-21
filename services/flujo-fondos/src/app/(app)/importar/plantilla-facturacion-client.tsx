'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import type {
  FacturacionPlantilla,
  ParsePlantillaFactResult,
} from '@/app/api/parsear-plantilla-facturacion/route';
import type { AplicarPlantillaFactResult } from '@/app/api/aplicar-plantilla-facturacion/route';

type Preview = Extract<ParsePlantillaFactResult, { ok: true }>;

export function PlantillaFacturacionClient() {
  const [file, setFile] = useState<File | null>(null);
  const [parseando, setParseando] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aplicando, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [resultado, setResultado] = useState<{
    insertadas: number;
    actualizadas: number;
    salteadas: number;
  } | null>(null);

  function aceptarArchivo(f: File | null | undefined) {
    if (!f) return;
    const nombre = f.name.toLowerCase();
    if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.xls')) {
      toast.error('El archivo debe ser .xlsx');
      return;
    }
    setFile(f);
    setPreview(null);
  }

  async function onParsear() {
    if (!file) {
      toast.error('Seleccioná un archivo primero');
      return;
    }
    setParseando(true);
    setPreview(null);
    setResultado(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const httpRes = await fetch('/api/parsear-plantilla-facturacion', {
        method: 'POST',
        body: fd,
      });
      if (!httpRes.ok) {
        toast.error(`Server respondio ${httpRes.status} ${httpRes.statusText}`);
        return;
      }
      const res = (await httpRes.json()) as ParsePlantillaFactResult;
      if (res.ok) {
        setPreview(res);
        if (res.totalFilas === 0) {
          toast.error('El archivo no tiene filas con datos');
        } else {
          toast.success(`Archivo analizado: ${res.totalFilas} filas`);
        }
      } else {
        console.error('parsear-plantilla-facturacion:', res);
        toast.error(res.error);
      }
    } catch (e) {
      console.error('Error al parsear:', e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Error al analizar: ${msg}`);
    } finally {
      setParseando(false);
    }
  }

  function onAplicar() {
    if (!preview) return;
    if (preview.filasValidas === 0) {
      toast.error('No hay filas validas para importar');
      return;
    }
    startTransition(async () => {
      try {
        const httpRes = await fetch('/api/aplicar-plantilla-facturacion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filas: preview.filas }),
        });
        if (!httpRes.ok) {
          toast.error(`Server respondio ${httpRes.status} ${httpRes.statusText}`);
          return;
        }
        const res = (await httpRes.json()) as AplicarPlantillaFactResult;
        if (res.ok) {
          setResultado({
            insertadas: res.insertadas,
            actualizadas: res.actualizadas,
            salteadas: res.salteadas,
          });
          toast.success('Facturacion importada');
        } else {
          console.error('aplicar-plantilla-facturacion:', res);
          toast.error(res.error);
        }
      } catch (e) {
        console.error('Error al aplicar:', e);
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Error al importar: ${msg}`);
      }
    });
  }

  function resetear() {
    setFile(null);
    setPreview(null);
    setResultado(null);
  }

  if (resultado) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
          <p className="text-lg font-medium">Facturacion importada</p>
          <div className="grid grid-cols-3 gap-3 max-w-2xl mx-auto text-left text-sm">
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Insertadas</p>
              <p className="text-2xl font-semibold tabular-nums text-success">
                {resultado.insertadas}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Actualizadas</p>
              <p className="text-2xl font-semibold tabular-nums text-info">
                {resultado.actualizadas}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Salteadas</p>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  resultado.salteadas > 0 && 'text-warning',
                )}
              >
                {resultado.salteadas}
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <Link href="/promedios" className={buttonVariants({ variant: 'default' })}>
              Ver promedios →
            </Link>
            <Link href="/calendario" className={buttonVariants({ variant: 'outline' })}>
              Ver calendario
            </Link>
            <button
              type="button"
              onClick={resetear}
              className={buttonVariants({ variant: 'outline' })}
            >
              Subir otro archivo
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-5 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[300px]">
            <p className="text-sm font-medium mb-1">
              Carga masiva de facturacion diaria desde plantilla
            </p>
            <p className="text-xs text-muted-foreground">
              Descargá la plantilla, completala con la facturacion real (un renglon por
              dia × unidad de negocio), y subila. Los promedios ponderados y la
              proyeccion de saldo se recalculan automaticamente. Si ya existe una fila
              para esa fecha + unidad + empresa, se actualiza (no se duplica).
            </p>
          </div>
          <Link
            href="/api/plantilla-facturacion"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            prefetch={false}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Descargar plantilla
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              aceptarArchivo(e.target.files?.[0] ?? null);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              aceptarArchivo(f ?? null);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-lg transition-colors',
              file
                ? 'border-success/40 bg-success/5'
                : dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-input bg-muted/10',
            )}
          >
            {file ? (
              <>
                <FileSpreadsheet className="h-10 w-10 text-success" />
                <div className="text-center">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="font-medium">Arrastrá tu archivo aca</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Plantilla .xlsx de facturacion rellenada
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                >
                  O hace click para elegir archivo
                </Button>
              </>
            )}
          </div>

          <div className="flex justify-end mt-4 gap-2">
            {file && (
              <>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Cambiar archivo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                  }}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Quitar
                </button>
              </>
            )}
            <Button onClick={onParsear} disabled={!file || parseando}>
              {parseando ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analizando...
                </>
              ) : (
                'Analizar archivo'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total filas
                </p>
                <p className="text-2xl font-semibold tabular-nums mt-1">
                  {preview.totalFilas}
                </p>
              </CardContent>
            </Card>
            <Card className={preview.filasValidas > 0 ? 'border-success/30' : ''}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Validas
                </p>
                <p
                  className={cn(
                    'text-2xl font-semibold tabular-nums mt-1',
                    preview.filasValidas > 0 && 'text-success',
                  )}
                >
                  {preview.filasValidas}
                </p>
              </CardContent>
            </Card>
            <Card className={preview.filasConError > 0 ? 'border-warning/30' : ''}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Con error
                </p>
                <p
                  className={cn(
                    'text-2xl font-semibold tabular-nums mt-1',
                    preview.filasConError > 0 && 'text-warning',
                  )}
                >
                  {preview.filasConError}
                </p>
              </CardContent>
            </Card>
          </div>

          {preview.faltantes.unidades.length > 0 && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Unidades de negocio faltantes
                </p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Los siguientes nombres no existen en{' '}
                  <Link
                    href="/unidades-negocio"
                    className="text-primary hover:underline"
                  >
                    /unidades-negocio
                  </Link>
                  . Creálos exactamente como aparecen abajo y volvé a analizar.
                </p>
                <div className="flex flex-wrap gap-1">
                  {preview.faltantes.unidades.map((u) => (
                    <Badge
                      key={u}
                      variant="outline"
                      className="text-[10px] bg-warning/10 border-warning/30"
                    >
                      {u}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <div className="p-4 border-b">
              <p className="text-sm font-medium">Preview de filas</p>
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Fila
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Fecha
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Unidad
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Monto
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Empresa
                    </th>
                    <th className="text-center px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Evento puntual
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Validacion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.filas
                    .slice(0, 200)
                    .map((f: FacturacionPlantilla, idx) => {
                      const conError = f.errores.length > 0;
                      return (
                        <tr
                          key={idx}
                          className={cn('border-t', conError && 'bg-warning/5')}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                            {f.filaExcel}
                          </td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                            {f.fecha ? fmtFechaAR(f.fecha) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={!f.unidadNegocioId ? 'text-warning' : ''}>
                              {f.unidadInput || '(vacio)'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtMonto(f.monto)}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {f.empresaInput || '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {f.esEventoPuntual ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-warning/10 border-warning/30"
                              >
                                si
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">no</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {conError ? (
                              <span className="text-warning">
                                {f.errores.join(', ')}
                              </span>
                            ) : (
                              <span className="text-success">OK</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {preview.filas.length > 200 && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                  +{preview.filas.length - 200} mas
                </p>
              )}
            </div>
          </Card>

          <div className="flex justify-end gap-2 sticky bottom-4 bg-background/95 backdrop-blur p-3 rounded-lg border shadow-lg">
            <button
              type="button"
              onClick={resetear}
              className={buttonVariants({ variant: 'outline' })}
            >
              Cancelar
            </button>
            <Button
              onClick={onAplicar}
              disabled={aplicando || preview.filasValidas === 0}
            >
              {aplicando ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importando...
                </>
              ) : (
                `Importar ${preview.filasValidas} filas`
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
