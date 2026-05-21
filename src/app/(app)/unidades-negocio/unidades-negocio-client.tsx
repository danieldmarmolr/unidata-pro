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
import type { UnidadNegocio } from '@/db/schema';
import { cn } from '@/lib/utils';
import {
  borrarUnidadNegocio,
  crearUnidadNegocio,
  editarUnidadNegocio,
} from './actions';
import { unidadNegocioSchema, type UnidadNegocioInput } from './schema';

const CANAL_LABELS: Record<UnidadNegocio['canal'], string> = {
  directo: 'Directo',
  marketplace: 'Marketplace',
  dropshipping: 'Dropshipping',
  otro: 'Otro',
};

export function UnidadesNegocioClient({ unidades }: { unidades: UnidadNegocio[] }) {
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<UnidadNegocio | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<UnidadNegocioInput>({
    resolver: zodResolver(unidadNegocioSchema),
    defaultValues: { nombre: '', canal: 'directo', activa: true },
  });

  function abrirNuevo() {
    setEditando(null);
    reset({ nombre: '', canal: 'directo', activa: true });
    setOpen(true);
  }

  function abrirEditar(u: UnidadNegocio) {
    setEditando(u);
    reset({ nombre: u.nombre, canal: u.canal, activa: u.activa });
    setOpen(true);
  }

  function onSubmit(values: UnidadNegocioInput) {
    startTransition(async () => {
      const res = editando
        ? await editarUnidadNegocio(editando.id, values)
        : await crearUnidadNegocio(values);
      if (res.ok) {
        toast.success(editando ? 'Unidad actualizada' : 'Unidad creada');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function borrar(u: UnidadNegocio) {
    if (!confirm(`Borrar "${u.nombre}"? Esta accion no se puede deshacer.`)) return;
    startTransition(async () => {
      const res = await borrarUnidadNegocio(u.id);
      if (res.ok) toast.success('Unidad borrada');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva unidad
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {unidades.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No hay unidades de negocio cargadas todavia.
                </TableCell>
              </TableRow>
            ) : (
              unidades.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {CANAL_LABELS[u.canal]}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.activa ? 'default' : 'secondary'}>
                      {u.activa ? 'Activa' : 'Inactiva'}
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
                        <DropdownMenuItem onClick={() => abrirEditar(u)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => borrar(u)}
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
            <DialogTitle>{editando ? 'Editar unidad' : 'Nueva unidad de negocio'}</DialogTitle>
            <DialogDescription>
              Canal comercial generador de facturacion (ej: Unistore Mayorista, ML, Unidrop).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" placeholder="Ej: Unistore Mayorista" {...register('nombre')} />
              {errors.nombre && (
                <p className="text-sm text-destructive">{errors.nombre.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="canal">Canal</Label>
              <Controller
                control={control}
                name="canal"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="canal">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="directo">Directo</SelectItem>
                      <SelectItem value="marketplace">Marketplace</SelectItem>
                      <SelectItem value="dropshipping">Dropshipping</SelectItem>
                      <SelectItem value="otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="activa"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                {...register('activa')}
              />
              <Label htmlFor="activa" className="cursor-pointer">
                Activa
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
