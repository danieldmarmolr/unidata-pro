'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
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
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { Proveedor } from '@/db/schema';
import { cn } from '@/lib/utils';
import { borrarProveedor, crearProveedor, editarProveedor } from './actions';
import { proveedorSchema, type ProveedorInput } from './schema';

const PRIORIDAD_VARIANT: Record<
  Proveedor['prioridad'],
  'default' | 'secondary' | 'destructive'
> = {
  alta: 'destructive',
  media: 'default',
  baja: 'secondary',
};

const fmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
});

export function ProveedoresClient({ proveedores }: { proveedores: Proveedor[] }) {
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [pending, startTransition] = useTransition();

  const defaultValues: ProveedorInput = {
    nombre: '',
    cuit: '',
    prioridad: 'media',
    saldoPendiente: '',
    notas: '',
    tagsRaw: '',
    contactoNombre: '',
    contactoEmail: '',
    contactoTelefono: '',
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ProveedorInput>({
    resolver: zodResolver(proveedorSchema),
    defaultValues,
  });

  function abrirNuevo() {
    setEditando(null);
    reset(defaultValues);
    setOpen(true);
  }

  function abrirEditar(p: Proveedor) {
    setEditando(p);
    reset({
      nombre: p.nombre,
      cuit: p.cuit ?? '',
      prioridad: p.prioridad,
      saldoPendiente: p.saldoPendiente,
      notas: p.notas ?? '',
      tagsRaw: p.tags.join(', '),
      contactoNombre: p.contacto?.nombre ?? '',
      contactoEmail: p.contacto?.email ?? '',
      contactoTelefono: p.contacto?.telefono ?? '',
    });
    setOpen(true);
  }

  function onSubmit(values: ProveedorInput) {
    startTransition(async () => {
      const res = editando
        ? await editarProveedor(editando.id, values)
        : await crearProveedor(values);
      if (res.ok) {
        toast.success(editando ? 'Proveedor actualizado' : 'Proveedor creado');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function borrar(p: Proveedor) {
    if (!confirm(`Borrar "${p.nombre}"? Esta accion no se puede deshacer.`)) return;
    startTransition(async () => {
      const res = await borrarProveedor(p.id);
      if (res.ok) toast.success('Proveedor borrado');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo proveedor
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead className="text-right">Saldo pendiente</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proveedores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No hay proveedores cargados todavia.
                </TableCell>
              </TableRow>
            ) : (
              proveedores.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/proveedores/${p.id}`}
                      className="font-medium hover:text-primary hover:underline transition-colors"
                    >
                      {p.nombre}
                    </Link>
                    {p.cuit && (
                      <div className="text-xs text-muted-foreground">{p.cuit}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={PRIORIDAD_VARIANT[p.prioridad]}>{p.prioridad}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt.format(Number(p.saldoPendiente))}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {p.tags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        p.tags.map((t) => (
                          <Badge key={t} variant="outline" className="text-xs">
                            {t}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => abrirEditar(p)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => borrar(p)}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
            <DialogDescription>
              Datos del proveedor y su politica de cobro. Las notas son utiles para
              recordar acuerdos verbales.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input id="nombre" placeholder="Ej: Mixor" {...register('nombre')} />
                {errors.nombre && (
                  <p className="text-sm text-destructive">{errors.nombre.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cuit">CUIT</Label>
                <Input id="cuit" placeholder="20-12345678-9" {...register('cuit')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="prioridad">Prioridad</Label>
                <Controller
                  control={control}
                  name="prioridad"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="prioridad">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alta">Alta</SelectItem>
                        <SelectItem value="media">Media</SelectItem>
                        <SelectItem value="baja">Baja</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="saldoPendiente">Saldo pendiente</Label>
                <Input
                  id="saldoPendiente"
                  placeholder="0.00"
                  {...register('saldoPendiente')}
                />
                {errors.saldoPendiente && (
                  <p className="text-sm text-destructive">{errors.saldoPendiente.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notas">Notas</Label>
              <Textarea
                id="notas"
                rows={3}
                placeholder="Ej: Acepta cobrar en chirolas semanales. Si no le pagamos se enoja."
                {...register('notas')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tagsRaw">Tags (separados por coma)</Label>
              <Input
                id="tagsRaw"
                placeholder="electronica, mayorista, importado"
                {...register('tagsRaw')}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-medium">Contacto (opcional)</Label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Input placeholder="Nombre" {...register('contactoNombre')} />
                </div>
                <div>
                  <Input placeholder="Email" {...register('contactoEmail')} />
                  {errors.contactoEmail && (
                    <p className="text-xs text-destructive mt-1">
                      {errors.contactoEmail.message}
                    </p>
                  )}
                </div>
                <div>
                  <Input placeholder="Telefono" {...register('contactoTelefono')} />
                </div>
              </div>
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
