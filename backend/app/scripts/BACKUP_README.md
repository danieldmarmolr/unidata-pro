# Backup off-site UNIDATA → S3

Script: `app/scripts/backup_supabase.py`

## Qué hace

1. Ejecuta `pg_dump` de la base Supabase de UNIDATA (usuarios, audit, costs).
2. Guarda el SQL plano en disco local del container.
3. Si hay credenciales AWS → sube a S3.
4. Purga backups locales con más de 30 días.

## Variables de entorno requeridas

| Variable | Obligatoria | Descripción |
|---|---|---|
| `SUPABASE_DB_URL` | ✅ | Connection string Postgres (la misma que usa `local_persistence`) |
| `BACKUP_S3_BUCKET` | opcional | Si presente sube a S3, sino solo local |
| `BACKUP_S3_PREFIX` | opcional | Prefijo de path. Default: `unidata-backups` |
| `AWS_ACCESS_KEY_ID` | si se usa S3 | |
| `AWS_SECRET_ACCESS_KEY` | si se usa S3 | |
| `AWS_REGION` | si se usa S3 | Default: `us-east-1` |
| `BACKUP_LOCAL_DIR` | opcional | Path local de backups. Default: `/tmp/unidata-backups` |

## Activar en Railway

### Opción A: Cron via Railway dashboard (recomendado)

1. En Railway → service `backend` → tab **Settings** → sección **Cron Schedule**.
2. Agregar nuevo cron:
   - **Schedule**: `0 6 * * *` (todos los días a las 6am UTC = 3am AR)
   - **Command**: `python -m app.scripts.backup_supabase`
3. En **Variables** agregar las S3 vars listadas arriba.
4. Deploy → Railway ejecutará el script en el horario indicado.

### Opción B: Trigger manual desde la UI

Endpoint protegido:
```
POST /api/admin/backup/run
Authorization: Bearer <admin-token>
```

Solo usuarios con `is_admin=true` pueden disparar el backup.

### Opción C: Trigger remoto desde GitHub Actions

```yaml
name: Daily Backup
on:
  schedule:
    - cron: "0 6 * * *"
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST "${BACKEND_URL}/api/admin/backup/run" \
            -H "Authorization: Bearer ${ADMIN_TOKEN}"
        env:
          BACKEND_URL: ${{ secrets.UNIDATA_BACKEND_URL }}
          ADMIN_TOKEN: ${{ secrets.UNIDATA_ADMIN_TOKEN }}
```

## Restaurar un backup

```bash
# Descargar de S3
aws s3 cp s3://$BACKUP_S3_BUCKET/unidata-backups/unidata-2026-05-09_030000.sql ./

# Restaurar (CUIDADO: pisará los datos)
psql "$SUPABASE_DB_URL_RESTORE" < unidata-2026-05-09_030000.sql
```

## Estado actual

- Script: ✅ implementado y testeado en local
- Endpoint admin: ✅ `/api/admin/backup/run`
- Cron Railway: ⚠️ requiere configurar manualmente (instrucciones arriba)
- S3 bucket: ⚠️ requiere crear y agregar credenciales

## TODO post-deploy

1. Crear bucket S3 (ej `unidata-backups-fox-electronics`) con versionado y lifecycle policy de 90 días.
2. Crear IAM user dedicado con permisos PutObject sobre ese bucket.
3. Agregar credenciales en Railway variables.
4. Configurar el cron schedule.
5. Verificar primer backup exitoso a las 24hs.
