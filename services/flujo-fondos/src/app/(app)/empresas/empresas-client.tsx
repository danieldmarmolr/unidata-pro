'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Empresa } from '@/db/schema';
import { cn } from '@/lib/utils';
import { borrarEmpresa, crearEmpresa, editarEmpresa } from './actions';
import { empresaSchema, type EmpresaInput } from './schema';

export function EmpresasClient({ empresas }: { empresas: Empresa[] }) {
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmpresaInput>({
    resolver: zodResolver(empresaSchema),
    defaultValues: { nombre: '', cuit: '', activa: true },
  });

  function abrirNuevo() {
    setEditando(null);
    reset({ nombre: '', cuit: '', activa: true });
    setOpen(true);
  }

  function abrirEditar(empresa: Empresa) {
    setEditando(empresa);
    reset({
      nombre: empresa.nombre,
      cuit: empresa.cuit ?? '',
      activa: empresa.activa,
    });
    setOpen(true);
  }

  function onSubmit(values: EmpresaInput) {
    startTransition(async () => {
      const res = editando
        ? await editarEmpresa(editando.id, values)
        : await crearEmpresa(values);
      if (res.ok) {
        toast.success(editando ? 'Empresa actualizada' : 'Empresa creada');
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function borrar(empresa: Empresa) {
    if (!confirm(`Borrar "${empresa.nombre}"? Esta accion no se puede deshacer.`)) return;
    startTransition(async () => {
      const res = await borrarEmpresa(empresa.id);
      if (res.ok) toast.success('Empresa borrada');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={abrirNuevo}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva empresa
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>CUIT</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {empresas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No hay empresas cargadas todavia.
                </TableCell>
              </TableRow>
            ) : (
              empresas.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{e.cuit ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={e.activa ? 'default' : 'secondary'}>
                      {e.activa ? 'Activa' : 'Inactiva'}
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
                        <DropdownMenuItem onClick={() => abrirEditar(e)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => borrar(e)}
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
            <DialogTitle>{editando ? 'Editar empresa' : 'Nueva empresa'}</DialogTitle>
            <DialogDescription>
              {editando
                ? 'Modifica los datos de la empresa.'
                : 'Carga una nueva razon social del grupo.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" placeholder="Ej: FOX ELECTRONICS" {...register('nombre')} />
              {errors.nombre && (
                <p className="text-sm text-destructive">{errors.nombre.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cuit">CUIT (opcional)</Label>
              <Input id="cuit" placeholder="20-12345678-9" {...register('cuit')} />
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
