"""Settings centralizados (lee del .env)."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()


class UnitConfig(BaseModel):
    name: str
    # Campos del bastion: solo requeridos cuando USE_SSH_TUNNEL=true (dev local).
    # En Fargate misma VPC que los RDS productivos -> conexion directa, estos son None.
    bastion_host: Optional[str] = None
    bastion_port: int = 22
    bastion_user: Optional[str] = None
    bastion_key: Optional[str] = None
    db_host: str
    db_port: int = 5432
    db_name: str
    db_user: str
    db_password: str
    # local_port solo se usa con SSH tunnel; en modo directo se ignora
    local_port: int = 0


class Settings(BaseModel):
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_hours: int = 12
    allowed_origins: list[str]
    # Toggle: true (default) = SSH tunnel a bastion EC2 (dev local / Railway).
    # false = conexion directa via VPC privada (Fargate dentro de la VPC del RDS).
    use_ssh_tunnel: bool = True
    units: dict[str, UnitConfig]


def _unit(name: str, use_ssh_tunnel: bool) -> UnitConfig:
    u = name.upper()
    kwargs: dict = {
        "name": name.lower(),
        "db_host": os.environ[f"PROD_DB_HOST_{u}"],
        "db_port": int(os.environ.get(f"PROD_DB_PORT_{u}", "5432")),
        "db_name": os.environ[f"PROD_DB_NAME_{u}"],
        "db_user": os.environ[f"PROD_DB_USER_{u}"],
        "db_password": os.environ[f"PROD_DB_PASSWORD_{u}"],
    }
    if use_ssh_tunnel:
        kwargs["bastion_host"] = os.environ[f"BASTION_HOST_{u}"]
        kwargs["bastion_port"] = int(os.environ.get(f"BASTION_PORT_{u}", "22"))
        kwargs["bastion_user"] = os.environ[f"BASTION_USER_{u}"]
        kwargs["bastion_key"] = os.environ[f"BASTION_KEY_PATH_{u}"]
        kwargs["local_port"] = int(os.environ[f"LOCAL_PORT_{u}"])
    return UnitConfig(**kwargs)


@lru_cache
def get_settings() -> Settings:
    origins = [
        o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    use_ssh_tunnel = os.environ.get("USE_SSH_TUNNEL", "true").lower() == "true"
    return Settings(
        jwt_secret=os.environ["JWT_SECRET"],
        jwt_algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
        jwt_expires_hours=int(os.environ.get("JWT_EXPIRES_HOURS", "12")),
        allowed_origins=origins,
        use_ssh_tunnel=use_ssh_tunnel,
        units={
            "unistore": _unit("unistore", use_ssh_tunnel),
            "unidrop": _unit("unidrop", use_ssh_tunnel),
            "unidev": _unit("unidev", use_ssh_tunnel),
        },
    )
