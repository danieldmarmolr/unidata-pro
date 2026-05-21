'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { BancoMedioPago } from '@/db/schema';
import { cn } from '@/lib/utils';
import { borrarBanco, crearBanco, editarBanco } from './actions';
import { bancoSchema, type BancoInput } from './schema';

const TIPO_LABELS: Record<BancoMedioPago['tipo'], string> = {
  banco: 'Banco',
  billetera_digital: 'Billetera digital',
  efectivo: 'Efectivo',
  otro: 'Otro',
};

const fmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
});

export function BancosClient({ bancos }: { bancos: BancoMedioPago[] }) {
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<BancoMedioPago | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<BancoInput>({
    resolver: zodResolver(bancoSchema),
    defaultValues: { nombre: '', tipo: 'banco', saldoActual: '', moneda: 'ARS', activo: true },
  });

  function abrirNuevo() {
    setEditando(null);
    reset({ nombre: '', tipo: 'banco', saldoActual: '', moneda: 'ARS', activo: true });
    setOpen(true);
  }

  function abrirEditar(b: BancoMedioPago) {
    setEditando(b);
    reset({
      nombre: b.nombre,
      tipo: b.tipo,
      saldoActual: b.saldoActual ?? '',
      moneda: b.moneda,
      activo: b.activo,
    });
    setOpen(true);
  }

  function onSubmit(values: BancoInput) {
    startTransition(async () => {
      const res = editando
        ? await editarBanco(editando.id, values)
        : await crearBanco(values);
      if (res.ok) {
        toast.success(editando ? 'Banco actualizado' : 'Banco creado');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function borrar(b: BancoMedioPago) {
    if (!confirm(`Borrar "${b.nombre}"? Esta accion no se puede deshacer.`)) return;
    startTransition(async () => {
      const res = await borrarBanco(b.id);
      if (res.ok) toast.success('Banco borrado');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo banco / medio de pago
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Saldo actual</TableHead>
              <TableHead>Moneda</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bancos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay bancos cargados todavia.
                </TableCell>
              </TableRow>
            ) : (
              bancos.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{TIPO_LABELS[b.tipo]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.saldoActual !== null
                      ? fmt.format(Number(b.saldoActual))
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.moneda}</TableCell>
                  <TableCell>
                    <Badge variant={b.activo ? 'default' : 'secondary'}>
                      {b.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => abrirEditar(b)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => borrar(b)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Borrar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar banco' : 'Nuevo banco / medio de pago'}</DialogTitle>
            <DialogDescription>
              Cuenta bancaria o billetera digital desde donde se ejecutan los pagos.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" placeholder="Ej: SUPERVIELLE" {...register('nombre')} />
              {errors.nombre && (
                <p className="text-sm text-destructive">{errors.nombre.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo</Label>
              <Controller
                control={control}
                name="tipo"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tipo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="banco">Banco</SelectItem>
                      <SelectItem value="billetera_digital">Billetera digital</SelectItem>
                      <SelectItem value="efectivo">Efectivo</SelectItem>
                      <SelectItem value="otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="saldoActual">Saldo actual (opcional)</Label>
                <Input
                  id="saldoActual"
                  placeholder="0.00"
                  {...register('saldoActual')}
                />
                {errors.saldoActual && (
                  <p className="text-sm text-destructive">{errors.saldoActual.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="moneda">Moneda</Label>
                <Input id="moneda" {...register('moneda')} />
                {errors.moneda && (
                  <p className="text-sm text-destructive">{errors.moneda.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="activo"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                {...register('activo')}
              />
              <Label htmlFor="activo" className="cursor-pointer">
                Activo
              </Label>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Guardando...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
