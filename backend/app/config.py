"""Settings centralizados (lee del .env)."""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()


class UnitConfig(BaseModel):
    name: str
    bastion_host: str
    bastion_port: int = 22
    bastion_user: str
    bastion_key: str
    db_host: str
    db_port: int = 5432
    db_name: str
    db_user: str
    db_password: str
    local_port: int


class Settings(BaseModel):
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_hours: int = 12
    allowed_origins: list[str]
    units: dict[str, UnitConfig]


def _unit(name: str) -> UnitConfig:
    u = name.upper()
    return UnitConfig(
        name=name.lower(),
        bastion_host=os.environ[f"BASTION_HOST_{u}"],
        bastion_port=int(os.environ.get(f"BASTION_PORT_{u}", "22")),
        bastion_user=os.environ[f"BASTION_USER_{u}"],
        bastion_key=os.environ[f"BASTION_KEY_PATH_{u}"],
        db_host=os.environ[f"PROD_DB_HOST_{u}"],
        db_port=int(os.environ[f"PROD_DB_PORT_{u}"]),
        db_name=os.environ[f"PROD_DB_NAME_{u}"],
        db_user=os.environ[f"PROD_DB_USER_{u}"],
        db_password=os.environ[f"PROD_DB_PASSWORD_{u}"],
        local_port=int(os.environ[f"LOCAL_PORT_{u}"]),
    )


@lru_cache
def get_settings() -> Settings:
    origins = [
        o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    return Settings(
        jwt_secret=os.environ["JWT_SECRET"],
        jwt_algorithm=os.environ.get("JWT_ALGORITHM", "HS256"),
        jwt_expires_hours=int(os.environ.get("JWT_EXPIRES_HOURS", "12")),
        allowed_origins=origins,
        units={
            "unistore": _unit("unistore"),
            "unidrop": _unit("unidrop"),
            "unidev": _unit("unidev"),
        },
    )
