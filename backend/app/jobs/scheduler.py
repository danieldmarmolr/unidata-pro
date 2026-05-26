"""
Background scheduler para tareas recurrentes.

Tareas activas:
- people_auto_birthdays: auto-post cumples diario 09:00 AR (idempotente).
- meta_ads_core_sync: sync_all 7d cada 1h. Captura el restate de Meta para
  los ultimos 7 dias (cuando la atribucion se va ajustando).
- meta_ads_breakdowns_sync: sync_breakdowns 30d cada 6h. Heavier, menos
  frecuente.

El scheduler corre en el mismo proceso de FastAPI; si Railway escala
multiples instancias, la idempotencia (find_active del meta sync, marker
del cumples) evita duplicados.

Disable global: PEOPLE_SCHEDULER_DISABLED=1
Disable solo Meta Ads: META_ADS_SCHEDULER_DISABLED=1
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger("unidata.scheduler")

_scheduler = None


def start_scheduler() -> None:
    """Inicializa APScheduler una sola vez. Llamar desde startup de FastAPI."""
    global _scheduler
    if _scheduler is not None:
        log.info("scheduler ya inicializado, skip")
        return
    if os.environ.get("PEOPLE_SCHEDULER_DISABLED") == "1":
        log.info("scheduler deshabilitado via env, skip")
        return

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError:
        log.warning("apscheduler no instalado, scheduler off")
        return

    _scheduler = BackgroundScheduler(
        timezone="America/Argentina/Buenos_Aires",
        job_defaults={
            "coalesce": True,        # si misses, ejecuta 1 sola vez
            "max_instances": 1,      # nunca paralelo
            "misfire_grace_time": 3600,  # tolera 1h de delay si Railway reinicia
        },
    )

    # Auto-cumples: 09:00 AR todos los dias
    _scheduler.add_job(
        _job_auto_birthdays,
        CronTrigger(hour=9, minute=0),
        id="people_auto_birthdays",
        replace_existing=True,
    )
    jobs_added = ["auto_birthdays @ 09:00 AR"]

    # Meta Ads sync
    if os.environ.get("META_ADS_SCHEDULER_DISABLED") != "1":
        # Core sync cada hora a :05 (7d incremental — captura restate Meta)
        _scheduler.add_job(
            _job_meta_ads_core_sync,
            CronTrigger(minute=5),
            id="meta_ads_core_sync",
            replace_existing=True,
        )
        # Breakdowns cada 6h a :15 (30d — heavier, menos frecuente)
        _scheduler.add_job(
            _job_meta_ads_breakdowns_sync,
            CronTrigger(hour="*/6", minute=15),
            id="meta_ads_breakdowns_sync",
            replace_existing=True,
        )
        jobs_added += ["meta_ads_core @ */1h:05", "meta_ads_breakdowns @ */6h:15"]

    _scheduler.start()
    log.info("scheduler started: %s", " | ".join(jobs_added))


def _job_auto_birthdays() -> None:
    """Wrapper logueado de la funcion DB."""
    try:
        from app.db import people_hr_db
        result = people_hr_db.auto_post_today_birthdays()
        log.info(
            "auto_birthdays job: created=%d skipped=%d checked=%d",
            result.get("created", 0),
            result.get("skipped", 0),
            result.get("checked", 0),
        )
    except Exception as e:
        log.exception("auto_birthdays job failed: %s", e)


def _job_meta_ads_core_sync() -> None:
    """Dispatcher idempotente: si ya hay un run activo, reusa."""
    try:
        from app.services import meta_ads
        result = meta_ads.start_sync_async(
            kind="sync_all",
            historical_days=7,
            started_by_id=None,
            started_by_email="cron@unidata",
        )
        log.info("meta_ads core sync dispatched: %s", result)
    except Exception as e:
        log.exception("meta_ads core sync dispatch failed: %s", e)


def _job_meta_ads_breakdowns_sync() -> None:
    try:
        from app.services import meta_ads
        result = meta_ads.start_sync_async(
            kind="sync_breakdowns",
            historical_days=30,
            started_by_id=None,
            started_by_email="cron@unidata",
        )
        log.info("meta_ads breakdowns sync dispatched: %s", result)
    except Exception as e:
        log.exception("meta_ads breakdowns sync dispatch failed: %s", e)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("scheduler stopped")
