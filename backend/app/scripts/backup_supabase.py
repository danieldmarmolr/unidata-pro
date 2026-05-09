"""
Backup off-site de la BBDD propia (Supabase Postgres).

Uso manual:
    python -m app.scripts.backup_supabase

Variables de entorno requeridas:
    SUPABASE_DB_URL    - postgres://... (la misma que usa local_persistence)

Variables opcionales (para subir a S3):
    BACKUP_S3_BUCKET       - nombre del bucket
    BACKUP_S3_PREFIX       - prefijo de path (default: 'unidata-backups')
    AWS_ACCESS_KEY_ID      - credenciales AWS
    AWS_SECRET_ACCESS_KEY  - credenciales AWS
    AWS_REGION             - region (default: 'us-east-1')

Si las variables S3 no estan presentes, el backup queda en disco local
en /tmp/unidata-backups/<YYYY-MM-DD>.sql (o equivalente Windows).

Cron sugerido (Linux):
    0 3 * * * cd /app && python -m app.scripts.backup_supabase >> /var/log/backup.log 2>&1

Para retencion: el script borra automaticamente backups locales > 30 dias.
"""
from __future__ import annotations

import os
import sys
import shutil
import subprocess
import logging
from pathlib import Path
from datetime import datetime, timedelta

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("unidata.backup")


def _backup_dir() -> Path:
    base = Path(os.environ.get("BACKUP_LOCAL_DIR", ""))
    if not base:
        base = Path("/tmp") if os.name != "nt" else Path(os.environ.get("TEMP", "."))
    out = base / "unidata-backups"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _run_pg_dump(db_url: str, out_path: Path) -> bool:
    """Ejecuta pg_dump al path indicado. Devuelve True si exito."""
    if not shutil.which("pg_dump"):
        log.error("pg_dump no esta instalado o no esta en PATH")
        return False
    cmd = [
        "pg_dump",
        "--no-owner",
        "--no-privileges",
        "--format=plain",
        "--file", str(out_path),
        db_url,
    ]
    log.info("Ejecutando pg_dump → %s", out_path.name)
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        log.error("pg_dump fallo: %s", res.stderr.strip())
        return False
    size_mb = out_path.stat().st_size / (1024 * 1024)
    log.info("Backup OK · %.2f MB", size_mb)
    return True


def _upload_s3(local_path: Path) -> bool:
    bucket = os.environ.get("BACKUP_S3_BUCKET")
    if not bucket:
        log.info("S3 no configurado (BACKUP_S3_BUCKET ausente) - backup queda local")
        return False
    try:
        import boto3  # type: ignore
    except ImportError:
        log.error("boto3 no instalado. pip install boto3")
        return False
    prefix = os.environ.get("BACKUP_S3_PREFIX", "unidata-backups")
    region = os.environ.get("AWS_REGION", "us-east-1")
    key = f"{prefix}/{local_path.name}"
    log.info("Subiendo a s3://%s/%s ...", bucket, key)
    client = boto3.client("s3", region_name=region)
    client.upload_file(str(local_path), bucket, key)
    log.info("Upload S3 OK")
    return True


def _purge_old(out_dir: Path, days: int = 30) -> None:
    cutoff = datetime.now() - timedelta(days=days)
    for f in out_dir.glob("*.sql"):
        if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
            log.info("Purgando backup viejo: %s", f.name)
            f.unlink(missing_ok=True)


def main() -> int:
    db_url = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        log.error("Falta SUPABASE_DB_URL o DATABASE_URL")
        return 2

    out_dir = _backup_dir()
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    out_path = out_dir / f"unidata-{ts}.sql"

    if not _run_pg_dump(db_url, out_path):
        return 3

    _upload_s3(out_path)
    _purge_old(out_dir, days=30)

    log.info("Backup terminado: %s", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
