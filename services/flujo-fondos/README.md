# Flujo de Fondos

ERP web de flujo de fondos / tesorería para un grupo económico argentino con
4 razones sociales que comparten una sola tesorería. Proyecta el saldo de caja
día a día combinando ingresos esperados (promedios ponderados por día de
semana) y egresos comprometidos.

**Producción**: https://flujo-fondos.vercel.app

## Documentación

- **[`docs/HANDOFF.md`](docs/HANDOFF.md)** — Guía completa para equipo IT que
  vaya a hacerse cargo del proyecto. Stack, setup, decisiones técnicas,
  opciones de hosting on-premise, migración de datos.
- **[`docs/REPORTE_ESTADO.md`](docs/REPORTE_ESTADO.md)** — Reporte de estado
  del proyecto (auditoría).
- **[`AGENTS.md`](AGENTS.md)** — Notas críticas para asistentes de IA que
  toquen este código.
- **[`CLAUDE.md`](CLAUDE.md)** — Configuración para Claude Code.

## Stack rápido

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn (registry custom sobre `@base-ui/react`)
- Drizzle ORM + Postgres (hosteado en Supabase)
- Supabase Auth
- Deploy: Vercel (región São Paulo)

## Quick start (dev)

```bash
npm install
cp .env.local.example .env.local   # completar variables (ver HANDOFF.md §4)
npm run db:migrate
npm run dev
# http://localhost:3000
```

## Comandos

```bash
npm run dev          # dev server
npm run build        # build prod
npm run start        # start prod
npm run lint         # ESLint
npm run db:generate  # generar nueva migración
npm run db:migrate   # aplicar migraciones pendientes
npm run db:studio    # GUI Drizzle Studio
```

## Idioma

Todo el código y la UI están en español argentino (es-AR). Moneda ARS, fechas
DD/MM/YYYY.
