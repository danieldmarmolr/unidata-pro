'use client';

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmtFechaAR, fmtMonto } from '../erogaciones/utils';
import {
  aplicarImport,
  parsearExcel,
  type ParseResult,
} from './actions';

type Resultado = Extract<ParseResult, { ok: true }>;

export function ImportarClient() {
  const [file, setFile] = useState<File | null>(null);
  const [parseando, setParseando] = useState(false);
  const [preview, setPreview] = useState<Resultado | null>(null);
  const [importarProveedores, setImportarProveedores] = useState(true);
  const [importarErogaciones, setImportarErogaciones] = useState(true);
  const [aplicando, startTransition] = useTransition();
  const [resultadoFinal, setResultadoFinal] = useState<{
    proveedoresInsertados: number;
    proveedoresActualizados: number;
    erogacionesInsertadas: number;
    erogacionesSalteadas: number;
  } | null>(null);

  async function onParsear() {
    if (!file) {
      toast.error('Seleccioná un archivo primero');
      return;
    }
    setParseando(true);
    setPreview(null);
    setResultadoFinal(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await parsearExcel(fd);
      if (res.ok) {
        setPreview(res);
      } else {
        toast.error(res.error);
      }
    } finally {
      setParseando(false);
    }
  }

  function onAplicar() {
    if (!preview) return;
    if (!importarProveedores && !importarErogaciones) {
      toast.error('Tenes que importar al menos algo (proveedores y/o erogaciones)');
      return;
    }
    startTransition(async () => {
      const res = await aplicarImport({
        proveedoresImport: preview.proveedores,
        erogacionesImport: preview.erogaciones,
        importarProveedores,
        importarErogaciones,
      });
      if (res.ok) {
        setResultadoFinal({
          proveedoresInsertados: res.proveedoresInsertados,
          proveedoresActualizados: res.proveedoresActualizados,
          erogacionesInsertadas: res.erogacionesInsertadas,
          erogacionesSalteadas: res.erogacionesSalteadas,
        });
        toast.success('Importacion completada');
      } else {
        toast.error(res.error);
      }
    });
  }

  function resetear() {
    setFile(null);
    setPreview(null);
    setResultadoFinal(null);
  }

  if (resultadoFinal) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
          <div>
            <p className="text-lg font-medium">Importacion completada</p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto text-left text-sm">
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Proveedores insertados</p>
              <p className="text-2xl font-semibold tabular-nums">
                {resultadoFinal.proveedoresInsertados}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Proveedores actualizados</p>
              <p className="text-2xl font-semibold tabular-nums">
                {resultadoFinal.proveedoresActualizados}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Erogaciones insertadas</p>
              <p className="text-2xl font-semibold tabular-nums text-success">
                {resultadoFinal.erogacionesInsertadas}
              </p>
            </div>
            <div className="p-3 rounded-md border bg-card">
              <p className="text-xs text-muted-foreground">Erogaciones salteadas</p>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  resultadoFinal.erogacionesSalteadas > 0 && 'text-warning',
                )}
              >
                {resultadoFinal.erogacionesSalteadas}
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <Link
              href="/erogaciones"
              className={buttonVariants({ variant: 'default' })}
            >
              Ver Inbox →
            </Link>
            <button
              type="button"
              onClick={resetear}
              className={buttonVariants({ variant: 'outline' })}
            >
              Importar otro
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Upload */}
      <Card>
        <CardContent className="p-6">
          <label
            htmlFor="file-input"
            className={cn(
              'flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
              file ? 'border-success/40 bg-success/5' : 'border-input hover:bg-muted/30',
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
                  <p className="font-medium">Arrastrá o hacé click para subir</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Archivos .xlsx del simulador de flujo
                  </p>
                </div>
              </>
            )}
            <input
              id="file-input"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </label>

          <div className="flex justify-end mt-4 gap-2">
            {file && (
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

      {/* Preview */}
      {preview && (
        <>
          {/* Hojas detectadas */}
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium mb-2">Hojas detectadas</p>
              <div className="flex flex-wrap gap-1.5">
                {preview.hojasDetectadas.map((h) => (
                  <Badge key={h} variant="outline" className="text-xs">
                    {h}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Proveedores
                </p>
                <p className="text-3xl font-semibold tabular-nums mt-1">
                  {preview.proveedores.length}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  filas detectadas en la hoja
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Erogaciones
                </p>
                <p className="text-3xl font-semibold tabular-nums mt-1">
                  {preview.erogacionesCompletas}
                  <span className="text-base text-muted-foreground ml-1">
                    / {preview.totalErogaciones}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  completas / totales
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Facturacion
                </p>
                <p className="text-3xl font-semibold tabular-nums mt-1">
                  {preview.facturacion.length}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  filas (no se importa todavia)
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Faltantes */}
          {(preview.faltantes.empresas.length > 0 ||
            preview.faltantes.bancos.length > 0) && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Datos maestros faltantes
                </p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Estas erogaciones no se van a importar hasta que los datos faltantes
                  existan en la base. Carga las{' '}
                  <Link href="/empresas" className="text-primary hover:underline">
                    empresas
                  </Link>{' '}
                  y{' '}
                  <Link href="/bancos" className="text-primary hover:underline">
                    bancos
                  </Link>{' '}
                  con los nombres que figuran abajo (case insensitive).
                </p>
                {preview.faltantes.empresas.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium mb-1">
                      Empresas faltantes ({preview.faltantes.empresas.length}):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preview.faltantes.empresas.map((e) => (
                        <Badge key={e} variant="outline" className="text-[10px] bg-warning/10 border-warning/30">
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {preview.faltantes.bancos.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1">
                      Bancos faltantes ({preview.faltantes.bancos.length}):
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {preview.faltantes.bancos.map((b) => (
                        <Badge key={b} variant="outline" className="text-[10px] bg-warning/10 border-warning/30">
                          {b}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Preview tablas */}
          {preview.proveedores.length > 0 && (
            <Card>
              <div className="p-4 border-b flex items-center justify-between">
                <p className="text-sm font-medium">
                  Preview proveedores ({preview.proveedores.length})
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={importarProveedores}
                    onChange={(e) => setImportarProveedores(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Importar esta hoja
                </label>
              </div>
              <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Nombre
                      </th>
                      <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Saldo pendiente
                      </th>
                      <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Prioridad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.proveedores.slice(0, 50).map((p, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2">{p.nombre}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {fmtMonto(p.saldoPendiente)}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {p.prioridad}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.proveedores.length > 50 && (
                  <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                    +{preview.proveedores.length - 50} mas
                  </p>
                )}
              </div>
            </Card>
          )}

          {preview.erogaciones.length > 0 && (
            <Card>
              <div className="p-4 border-b flex items-center justify-between">
                <p className="text-sm font-medium">
                  Preview erogaciones ({preview.erogaciones.length})
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={importarErogaciones}
                    onChange={(e) => setImportarErogaciones(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Importar esta hoja
                </label>
              </div>
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Fecha
                      </th>
                      <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Descripcion
                      </th>
                      <th className="text-right px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Monto
                      </th>
                      <th className="text-left px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Empresa / Banco
                      </th>
                      <th className="text-center px-4 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.erogaciones.slice(0, 100).map((e, idx) => {
                      const incompleto = !e.empresaId || !e.bancoId;
                      return (
                        <tr
                          key={idx}
                          className={cn('border-t', incompleto && 'bg-warning/5')}
                        >
                          <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                            {fmtFechaAR(e.fechaPago)}
                          </td>
                          <td className="px-4 py-2">{e.descripcion}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {fmtMonto(e.monto)}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            <div
                              className={!e.empresaId ? 'text-warning font-medium' : ''}
                            >
                              {e.empresaNombre || '(vacio)'}
                            </div>
                            <div
                              className={!e.bancoId ? 'text-warning font-medium' : ''}
                            >
                              {e.bancoNombre || '(vacio)'}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-center">
                            <Badge variant="outline" className="text-[10px]">
                              {e.estado}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {preview.erogaciones.length > 100 && (
                  <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                    +{preview.erogaciones.length - 100} mas
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Boton aplicar */}
          <div className="flex justify-end gap-2 sticky bottom-4 bg-background/95 backdrop-blur p-3 rounded-lg border shadow-lg">
            <button
              type="button"
              onClick={resetear}
              className={buttonVariants({ variant: 'outline' })}
            >
              Cancelar
            </button>
            <Button onClick={onAplicar} disabled={aplicando}>
              {aplicando ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importando...
                </>
              ) : (
                'Aplicar importacion'
              )}
            </Button>
          </div>

          {/* Nota facturacion */}
          {preview.facturacion.length > 0 && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-info shrink-0 mt-0.5" />
                <p>
                  La hoja de facturacion tiene {preview.facturacion.length} filas pero
                  no se importan automaticamente porque necesitan asignacion explicita
                  de unidad de negocio. Para cargarlas, usá la pantalla de unidades de
                  negocio o pedinos un importador especifico cuando lo necesites.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
