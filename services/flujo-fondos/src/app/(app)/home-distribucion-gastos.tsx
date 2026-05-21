'use client';

import { ArrowRight, PieChart as PieChartIcon } from 'lucide-react';
import Link from 'next/link';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fmtMonto } from './erogaciones/utils';

const COLORS = [
  'oklch(var(--primary))',
  'oklch(var(--success))',
  'oklch(var(--warning))',
  'oklch(var(--info))',
  'oklch(var(--danger))',
  'oklch(0.65 0.15 280)',
  'oklch(0.7 0.13 200)',
  'oklch(0.6 0.18 30)',
];

type CategoriaRow = { categoria: string | null; total: number };

type Props = { items: CategoriaRow[]; total: number };

export function HomeDistribucionGastos({ items, total }: Props) {
  if (items.length === 0 || total === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Gastos por categoria</CardTitle>
          </div>
          <CardDescription>Este mes</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground py-6 text-center">
          Sin gastos cargados este mes.
        </CardContent>
      </Card>
    );
  }

  const data = items.map((it, i) => ({
    name: it.categoria ?? 'Sin categoria',
    value: it.total,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Gastos por categoria</CardTitle>
          </div>
          <Link
            href="/analisis"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Ver
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <CardDescription>Este mes · {fmtMonto(total)}</CardDescription>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="h-[140px] w-[140px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={36}
                  outerRadius={66}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0];
                    const value = p.value as number;
                    return (
                      <div className="rounded-md border bg-popover px-2 py-1.5 text-[11px] shadow-md">
                        <p className="font-medium">{p.name}</p>
                        <p className="tabular-nums">{fmtMonto(value)}</p>
                        <p className="text-muted-foreground">
                          {((value / total) * 100).toFixed(1)}%
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1 text-xs">
            {data.slice(0, 5).map((d) => (
              <div key={d.name} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: d.color }}
                />
                <span className="truncate flex-1">{d.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {((d.value / total) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            {data.length > 5 && (
              <p className="text-[10px] text-muted-foreground pt-1">
                +{data.length - 5} mas
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
