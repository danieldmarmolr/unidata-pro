"""
Engines SQLAlchemy por unidad de negocio.

Dos modos de conexion segun USE_SSH_TUNNEL:
  - true  (default, dev local / Railway): SSH tunnel a bastion EC2 -> RDS
  - false (Fargate dentro de la misma VPC que los RDS): conexion directa
          a `db_host:db_port`, sin tunnel.

Auto-recovery: si el tunel se cayo o el engine perdio conexion, se reconectan.

Mapeo de unidades de negocio -> base de datos y schemas:

UNISTORE (engine "unistore" -> RDS unistore_api):
  - tienda_nube  : ventas TN del retail Unistore
  - meli         : ventas MELI del retail Unistore
  - digip        : WMS / logistica (StockDetalle, DespachoPedido, Pedido)
  - contabilium  : ERP, facturas (SalesOrder, ReceiptItem)
  - public

UNIDROP (engine "unidrop" -> RDS unidrop_api):
  - public            : usuarios dropshippers, TaloPay (PaymentTransaction,
                        PaymentIntent), TiendaNube denormalizada
                        (tienda_nube_orders) y suscripciones
                        (PaymentIntentSubscription)
  - mercado_libre_dev : ventas MELI de Unidrop (OrderMercadoLibre),
                        suscripciones (SubscriptionMeli,
                        PaymentTransactionSubscription)
  - contabillium_dev  : ERP Unidrop (ContabilliumInvoice,
                        ContabiliumSalesOrder)
  - digip_dev         : WMS Unidrop (solo pedidos MELI) - subset chico:
                        clientes, clientes_ubicaciones, pedidos,
                        pedidos_detalles. Estado del pedido en
                        pedidos."PedidoEstado". Linkage: pedidos."Codigo" =
                        OrderMercadoLibre.number (88% cobertura).
  - cresium

REGLA: cada query usa get_engine("unistore") o get_engine("unidrop") segun
la unidad. NO se mezclan datos entre unidades.
"""
from __future__ import annotations

import atexit
import logging
import threading

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, URL
from sqlalchemy.exc import OperationalError, DBAPIError
from sshtunnel import SSHTunnelForwarder

from app.config import UnitConfig, get_settings

log = logging.getLogger("unidata.engines")

_LOCK = threading.RLock()
_TUNNELS: dict[str, SSHTunnelForwarder] = {}
_ENGINES: dict[str, Engine] = {}


def _tunnel_alive(t: SSHTunnelForwarder | None) -> bool:
    if t is None:
        return False
    try:
        if not t.is_active:
            return False
        # is_active reporta True aunque la SSH session interna haya muerto.
        # Validamos que el transport siga vivo.
        transport = getattr(t, "ssh_transport", None) or getattr(t, "_transport", None)
        if transport is None:
            return True  # benefit of the doubt
        return transport.is_active() and transport.is_alive()
    except Exception:
        return False


def _close_tunnel_silent(name: str) -> None:
    t = _TUNNELS.pop(name, None)
    if t is not None:
        try:
            t.stop(force=True)
        except Exception:
            pass


def _open_tunnel(cfg: UnitConfig) -> SSHTunnelForwarder:
    existing = _TUNNELS.get(cfg.name)
    if _tunnel_alive(existing):
        return existing  # type: ignore[return-value]
    if existing is not None:
        log.warning("Tunnel %s muerto, reabriendo", cfg.name)
        _close_tunnel_silent(cfg.name)
    tunnel = SSHTunnelForwarder(
        (cfg.bastion_host, cfg.bastion_port),
        ssh_username=cfg.bastion_user,
        ssh_pkey=cfg.bastion_key,
        remote_bind_address=(cfg.db_host, cfg.db_port),
        local_bind_address=("127.0.0.1", cfg.local_port),
        set_keepalive=30.0,
    )
    tunnel.start()
    _TUNNELS[cfg.name] = tunnel
    return tunnel


def _build_engine(cfg: UnitConfig) -> Engine:
    settings = get_settings()
    if settings.use_ssh_tunnel:
        _open_tunnel(cfg)
        host, port = "127.0.0.1", cfg.local_port
    else:
        host, port = cfg.db_host, cfg.db_port
    url = URL.create(
        "postgresql+psycopg2",
        username=cfg.db_user,
        password=cfg.db_password,
        host=host,
        port=port,
        database=cfg.db_name,
    )
    engine = create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=300,
        # Pool subido de 5+5 -> 15+10. Antes saturaba con ~10 reqs concurrentes
        # (3 engines x dashboards corriendo en threadpool) y los siguientes
        # esperaban en cola, lo que se sentia como "lento" en prod.
        pool_size=15,
        max_overflow=10,
        pool_timeout=20,
        connect_args={
            # statement_timeout: 30s | timezone Argentina: NOW(), CURRENT_DATE,
            # CURRENT_TIMESTAMP, etc devuelven hora local AR (UTC-3) automaticamente
            "options": "-c statement_timeout=30000 -c timezone=America/Argentina/Buenos_Aires",
            "connect_timeout": 10,
        },
    )
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return engine


def _reset_unit(name: str) -> None:
    """Cierra engine + tunnel para forzar reconexion en el proximo get_engine."""
    eng = _ENGINES.pop(name, None)
    if eng is not None:
        try:
            eng.dispose()
        except Exception:
            pass
    _close_tunnel_silent(name)


def get_engine(unit: str) -> Engine:
    """
    Devuelve el engine para la unidad. Si el tunnel/engine esta caido, lo reabre.
    Caller no necesita hacer nada especial - una query a un engine reciclado
    deberia funcionar la primera vez.
    """
    settings = get_settings()
    if unit not in settings.units:
        raise ValueError(f"Unidad desconocida: {unit}")
    cfg = settings.units[unit]
    with _LOCK:
        existing_eng = _ENGINES.get(unit)
        if existing_eng is not None:
            # En modo directo no hay tunnel que validar; engine SQLAlchemy
            # tiene pool_pre_ping=True asi que detecta conexiones muertas solo.
            if not settings.use_ssh_tunnel or _tunnel_alive(_TUNNELS.get(unit)):
                return existing_eng
        # tunnel muerto o engine no creado: rebuild todo
        _reset_unit(unit)
        try:
            eng = _build_engine(cfg)
        except Exception as e:
            log.error("Falla creando engine para %s: %s", unit, e)
            _reset_unit(unit)
            raise
        _ENGINES[unit] = eng
        return eng


def force_reset(unit: str) -> None:
    """Forzar reconexion en proximo uso (lo usa _utils.q en error)."""
    with _LOCK:
        _reset_unit(unit)


def shutdown() -> None:
    for name in list(_ENGINES):
        try:
            _ENGINES[name].dispose()
        except Exception:
            pass
    _ENGINES.clear()
    for name in list(_TUNNELS):
        _close_tunnel_silent(name)


atexit.register(shutdown)
