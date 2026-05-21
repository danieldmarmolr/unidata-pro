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
import {
  CATEGORIA_LABELS,
  type CategoriaIngresoPuntual,
} from '../ingresos-puntuales/schema';
import type {
  IngresoPuntualPlantilla,
  ParsePlantillaIngrPuntResult,
} from '@/app/api/parsear-ingresos-puntuales/route';
import type { AplicarPlantillaIngrPuntResult } from '@/app/api/aplicar-ingresos-puntuales/route';

type Preview = Extract<ParsePlantillaIngrPuntResult, { ok: true }>;

export function PlantillaIngresosPuntualesClient() {
  const [file, setFile] = useState<File | null>(null);
  const [parseando, setParseando] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aplicando, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const [soloErrores, setSoloErrores] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [resultado, setResultado] = useState<{
    insertadas: number;
    salteadas: number;
    salteadasPorDuplicado: number;
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
      const httpRes = await fetch('/api/parsear-ingresos-puntuales', {
        method: 'POST',
        body: fd,
      });
      if (!httpRes.ok) {
        toast.error(
          `Server respondio ${httpRes.status} ${httpRes.statusText}`,
        );
        return;
      }
      const res = (await httpRes.json()) as ParsePlantillaIngrPuntResult;
      if (res.ok) {
        setPreview(res);
        if (res.totalFilas === 0) toast.error('El archivo no tiene filas con datos');
        else toast.success(`Archivo analizado: ${res.totalFilas} filas`);
      } else {
        console.error('parsear-ingresos-puntuales:', res);
        toast.error(res.error);
      }
    } catch (e) {
      console.error('Error al parsear:', e);
      toast.error(`Error al analizar: ${e instanceof Error ? e.message : String(e)}`);
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
        const httpRes = await fetch('/api/aplicar-ingresos-puntuales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filas: preview.filas }),
        });
        if (!httpRes.ok) {
          toast.error(
            `Server respondio ${httpRes.status} ${httpRes.statusText}`,
          );
          return;
        }
        const res = (await httpRes.json()) as AplicarPlantillaIngrPuntResult;
        if (res.ok) {
          setResultado({
            insertadas: res.insertadas,
            salteadas: res.salteadas,
            salteadasPorDuplicado: res.salteadasPorDuplicado,
          });
          toast.success(`${res.insertadas} ingresos puntuales cargados`);
        } else {
          toast.error(res.error);
        }
      } catch (e) {
        toast.error(`Error al importar: ${e instanceof Error ? e.message : String(e)}`);
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
          <p className="text-lg font-medium">Carga masiva completada</p>
          <div className="grid grid-cols-3 gap-3 max-w-2xl mx-auto text-left text-sm">
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Insertados</p>
              <p className="text-2xl font-semibold tabular-nums text-success">
                {resultado.insertadas}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Ya existian</p>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  resultado.salteadasPorDuplicado > 0 && 'text-info',
                )}
              >
                {resultado.salteadasPorDuplicado}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Con errores</p>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  resultado.salteadas - resultado.salteadasPorDuplicado > 0 &&
                    'text-warning',
                )}
              >
                {resultado.salteadas - resultado.salteadasPorDuplicado}
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <Link
              href="/ingresos-puntuales"
              className={buttonVariants({ variant: 'default' })}
            >
              Ver ingresos puntuales →
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
              Carga masiva de ingresos puntuales desde plantilla
            </p>
            <p className="text-xs text-muted-foreground">
              Para cobros de cheques, prestamos, devoluciones, aportes y cualquier
              plata que entra fuera de la facturacion recurrente. Se suman al
              saldo del dia en la proyeccion.
            </p>
          </div>
          <Link
            href="/api/plantilla-ingresos-puntuales"
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
                    Plantilla .xlsx de ingresos puntuales rellenada
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                  Nuevos (se importan)
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
            <Card className={preview.filasDuplicadas > 0 ? 'border-info/30 bg-info/5' : ''}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Ya en la base
                </p>
                <p
                  className={cn(
                    'text-2xl font-semibold tabular-nums mt-1',
                    preview.filasDuplicadas > 0 && 'text-info',
                  )}
                >
                  {preview.filasDuplicadas}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">no se duplican</p>
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

          {(preview.faltantes.empresas.length > 0 ||
            preview.faltantes.bancos.length > 0) && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Datos maestros faltantes
                </p>
                {preview.faltantes.empresas.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium mb-1">
                      Empresas faltantes ({preview.faltantes.empresas.length}):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preview.faltantes.empresas.map((e) => (
                        <Badge
                          key={e}
                          variant="outline"
                          className="text-[10px] bg-warning/10 border-warning/30"
                        >
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {preview.faltantes.bancos.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium mb-1">
                      Bancos faltantes ({preview.faltantes.bancos.length}):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preview.faltantes.bancos.map((b) => (
                        <Badge
                          key={b}
                          variant="outline"
                          className="text-[10px] bg-warning/10 border-warning/30"
                        >
                          {b}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {preview.filasConError > 0 && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4">
                <p className="text-sm font-medium flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Detalle de las {preview.filasConError}{' '}
                  {preview.filasConError === 1 ? 'fila' : 'filas'} con error
                </p>
                <div className="space-y-2">
                  {agruparErrores(preview.filas).map((grupo) => (
                    <div
                      key={grupo.motivo}
                      className="text-xs bg-card border rounded p-2.5"
                    >
                      <p className="font-medium text-warning mb-1">
                        {grupo.motivo} ({grupo.filas.length}{' '}
                        {grupo.filas.length === 1 ? 'fila' : 'filas'})
                      </p>
                      <p className="text-muted-foreground">
                        Filas del Excel:{' '}
                        <span className="tabular-nums font-medium text-foreground">
                          {grupo.filas.map((f) => f.filaExcel).join(', ')}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-medium">Preview de filas</p>
              {preview.filasConError > 0 && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={soloErrores}
                    onChange={(e) => setSoloErrores(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  Ver solo las filas con error ({preview.filasConError})
                </label>
              )}
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
                      Descripcion
                    </th>
                    <th className="text-right px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Monto
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Empresa / Banco
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Categoria
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                      Validacion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(soloErrores
                    ? preview.filas.filter((f) => f.errores.length > 0)
                    : preview.filas
                  )
                    .slice(0, 200)
                    .map((f: IngresoPuntualPlantilla, idx) => {
                      const conError = f.errores.length > 0;
                      const esDuplicado = !conError && f.yaExiste;
                      return (
                        <tr
                          key={idx}
                          className={cn(
                            'border-t',
                            conError && 'bg-warning/5',
                            esDuplicado && 'bg-info/5',
                          )}
                        >
                          <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                            {f.filaExcel}
                          </td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                            {f.fecha ? fmtFechaAR(f.fecha) : '—'}
                          </td>
                          <td className="px-3 py-2 max-w-xs">
                            <p className="line-clamp-1">{f.descripcion || '—'}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-success">
                            +{fmtMonto(f.monto)}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            <div className={!f.empresaId ? 'text-warning' : ''}>
                              {f.empresaInput || '(vacio)'}
                            </div>
                            <div className="text-muted-foreground">
                              {f.bancoInput || '(sin banco)'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {f.categoria ? (
                              <Badge variant="outline" className="text-[10px]">
                                {CATEGORIA_LABELS[f.categoria as CategoriaIngresoPuntual]}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {conError ? (
                              <span className="text-warning">{f.errores.join(', ')}</span>
                            ) : esDuplicado ? (
                              <span className="text-info">ya en la base</span>
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
            <Button onClick={onAplicar} disabled={aplicando || preview.filasValidas === 0}>
              {aplicando ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importando...
                </>
              ) : (
                `Importar ${preview.filasValidas} nuevos ingresos`
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function agruparErrores(filas: IngresoPuntualPlantilla[]): Array<{
  motivo: string;
  filas: IngresoPuntualPlantilla[];
}> {
  const mapa = new Map<string, IngresoPuntualPlantilla[]>();
  for (const f of filas) {
    if (f.errores.length === 0) continue;
    for (const err of f.errores) {
      const arr = mapa.get(err) ?? [];
      arr.push(f);
      mapa.set(err, arr);
    }
  }
  return Array.from(mapa.entries())
    .map(([motivo, filas]) => ({ motivo, filas }))
    .sort((a, b) => b.filas.length - a.filas.length);
}
