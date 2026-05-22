"""
Background scheduler para tareas recurrentes del modulo People.

Tareas activas:
- Auto-post de cumpleaños diario a las 09:00 hora Argentina.
  Idempotente del dia (marker `[auto-cumple:user_id:YYYY-MM-DD]` en el content).

El scheduler corre en el mismo proceso de FastAPI; si Railway escala
multiples instancias, la idempotencia del marker evita duplicados.
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger("unidata.people.scheduler")

_scheduler = None


def start_scheduler() -> None:
    """Inicializa APScheduler una sola vez. Llamar desde startup de FastAPI.

    Skip si:
    - PEOPLE_SCHEDULER_DISABLED=1 (para tests / dev)
    - Ya esta corriendo (idempotente)
    """
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

    _scheduler.start()
    log.info("people scheduler started: 1 job (auto_birthdays @ 09:00 AR)")


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


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("scheduler stopped")
