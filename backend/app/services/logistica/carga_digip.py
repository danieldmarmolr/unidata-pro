# -*- coding: utf-8 -*-
"""
Carga unificada: TN + TN_UNI + MELI_DB + MELI_API → DigiPWMS.
Adaptado de carga_unificada.py para ejecutar dentro del backend UNIDATA.

Cambios vs. versión standalone:
  - SSH tunnels → get_engine("unidrop") (ya abierto por el backend)
  - CSV antidup  → carga_digip_db.load/append_processed
  - Excel MELI   → fuente='MELI_API_VID' en carga_digip_processed
  - Token ML     → escribe en os.environ (no en .env)
  - Logs         → capturado via ListHandler inyectado por execute_run
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
from pandas import json_normalize
from sqlalchemy import text

from app.db import carga_digip_db
from app.db.engines import get_engine

log = logging.getLogger(__name__)

# ── Credenciales DigiP ────────────────────────────────────────────────────
DIGIP_KEY = os.getenv("DIGIP_API_KEY", "1afacc94-4c12-414e-8f8d-f6812df956f3")
DIGIP_HDR = {"X-API-KEY": DIGIP_KEY, "Accept": "application/json", "Content-Type": "application/json"}

# ── Contabilium ───────────────────────────────────────────────────────────
CB_ID     = os.getenv("CB_CLIENT_ID", "")
CB_SECRET = os.getenv("CB_CLIENT_SECRET", "")

# ── MercadoLibre ──────────────────────────────────────────────────────────
ML_APP_ID  = os.getenv("ML_APP_ID", "")
ML_SECRET  = os.getenv("ML_CLIENT_SECRET", "")
ML_REFRESH = os.getenv("ML_REFRESH_TOKEN", "")
ML_USER_ID = os.getenv("ML_USER_ID", "1088266694")

# ── TiendaNube Unistore (API directa) ─────────────────────────────────────
TN_UNI_STORE = os.getenv("TN_UNI_STORE_ID", "1771149")
TN_UNI_TOKEN = os.getenv("TN_UNI_ACCESS_TOKEN") or os.getenv("ACCESS_TOKEN", "")
TN_UNI_HDR   = {
    "Authentication": f"bearer {TN_UNI_TOKEN}",
    "User-Agent": "API-TiendaNube-Unistore (unistorearg@gmail.com)",
    "Content-Type": "application/json",
}

# ── Constantes de negocio ─────────────────────────────────────────────────
REQUEST_TIMEOUT         = 30
AR_TZ                   = timezone(timedelta(hours=-3))
_TN_UNI_EXCLUDED_SKUS   = {"PERMUJ100ML5", "PVA1", "PVA2"}
_TN_UNI_NO_MARCAR       = {"Microcentro Retira", "Unistore Pacheco"}
_TN_UNI_VIP_UMBRAL      = 300_000
_MAP_DESPACHO_TN_UNI    = {
    "unifast caba envio en moto en el dia (demora actual de 48 hs)": "Moto domicilio",
    "unifast gba1. envio en moto en el dia (demora actual de 48 hs)": "Moto domicilio",
    "unifast gba 2 y 3 envio en moto en el dia (demora actual de 48 hs)": "Moto domicilio",
    "unifast gba1.    envio en moto en el dia (demora actual de 48 hs)": "Moto domicilio",
    "unifast gba 2 y 3    envio en moto en el dia (demora actual de 48 hs)": "Moto domicilio",
    "unifast gba 1. envio en moto en el dia gratis": "Moto domicilio",
    "unifast gba 2 y 3 envio en moto en el dia gratis": "Moto domicilio",
    "unifast caba envio en moto en el dia gratis": "Moto domicilio",
    "unifast gba 2 y 3 envio en moto en el dia  gratis": "Moto domicilio",
    "unifast gba 1.  envio en moto en el dia gratis": "Moto domicilio",
    "a convenir": "Moto expreso",
    "expreso de tu confianza a convenir (el envio se paga en destino puede fluctuar)": "Moto expreso",
    "expreso de tu confianza a convenir (el envio se paga en destino puede fluctuar)(dejar nombre del expreso en la nota final)": "Moto expreso",
    "empresa transportista propia a convenir": "Moto expreso",
    "empresa transoportista propia a convenir": "Moto expreso",
    "empresa transportista propia (unistore solo hace el envio hasta el transporte) (en el comentario al finalizar la compra detallar nombre de la empresa)": "Moto expreso",
    "no es envio a domicilio esta opcion!!!!! envio hasta el expreso que elijas o via cargo (desde caba unicamente) (no incluye costo de envio hasta tu localidad)": "Moto expreso",
    "envio hasta el expreso que elijas o via cargo (desde caba unicamente) (no incluye costo de envio hasta tu localidad)": "Moto expreso",
    "¡te vamos a contactar para coordinar la entrega!": "Moto expreso",
    "envio express amba bsas (24 hs) (verificar barrios en descripción del producto)": "Moto expreso",
    "envio express caba (24 hs)": "Moto expreso",
    "andreani online": "Andreani",
    "andreani estandar “envío a domicilio”": "Andreani",
    'andreani estandar "envío a domicilio"': "Andreani",
    "correo argentino shipping": "Correo Argentino",
    "envío nube - correo argentino expreso a domicilio": "Correo Argentino",
    "correo argentino clasico - envio a domicilio": "Correo Argentino",
    "correo argentino expreso - envio a domicilio": "Correo Argentino",
    "envío nube - correo argentino clásico a domicilio": "Correo Argentino",
    "envío nube - correo argentino clásico a sucursal": "Correo Argentino",
    "correo argentino - envio a domicilio": "Correo Argentino",
    "envío nube - correo argentino expreso a sucursal": "Correo Argentino",
    "oca": "OCA",
    "oca envío a domicilio": "OCA",
    "unistore": "Microcentro Retira",
    "unistore microcentro": "Microcentro Retira",
    "microcentro unistore": "Microcentro Retira",
    "unistore pacheco (solo pago anticipado)": "Unistore Pacheco",
    "unistore pacheco": "Unistore Pacheco",
    "urbano envios": "Urbano",
    "via cargo a convenir (el envio se paga en destino puede fluctuar)": "Via Cargo",
    "viacargo": "Via Cargo",
    "viacargo - entrega a domicilio": "Via Cargo",
    "nan": "Sin despacho",
    "": "Sin despacho",
}

# ── Caches por ejecución ──────────────────────────────────────────────────
_digip_cache: dict = {"codigos": None}
_cli_cache:   dict = {}
_ubi_cache:   dict = {}


def reset_digip_caches() -> None:
    _digip_cache["codigos"] = None
    _cli_cache.clear()
    _ubi_cache.clear()


# =========================================================================
# HELPERS
# =========================================================================

def _s(series):
    return series.astype(str).replace({np.nan: ""}).str.strip()


def _ensure_dict(x):
    if isinstance(x, dict):
        return x
    if isinstance(x, str):
        try:
            p = json.loads(x)
            return p if isinstance(p, dict) else {}
        except Exception:
            return {}
    return {}


def _parse_fecha(v):
    v = str(v).strip()
    for fmt in ["%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d"]:
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%dT00:00:00")
        except ValueError:
            pass
    return datetime.now().strftime("%Y-%m-%dT00:00:00")


def _sku_ok(v):
    if v is None:
        return False
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return False
    s = str(v).strip()
    return bool(s) and s.lower() not in ("nan", "none", "nat", "")


# ── DigiP API helpers ─────────────────────────────────────────────────────

def _dget(url, params=None):
    try:
        return requests.get(url, headers=DIGIP_HDR, params=params, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as e:
        log.warning("GET %s: %s", url, e)
        return None


def _dpost(url, payload):
    try:
        return requests.post(url, headers=DIGIP_HDR, json=payload, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as e:
        log.warning("POST %s: %s", url, e)
        return None


def _get_digip_existentes(force_refresh: bool = False) -> set:
    if not force_refresh and _digip_cache["codigos"] is not None:
        return _digip_cache["codigos"]

    codigos: set = set()
    COD_KEYS = ("codigo", "Codigo", "codigoPedido", "PedidoCodigo", "codigoDeEnvio", "CodigoDeEnvio")
    PAGE_SIZE = 500

    def _harvest(raw) -> int:
        items = raw if isinstance(raw, list) else next(
            (raw[k] for k in ("data", "Items", "items", "results", "Pedidos") if k in raw), []
        )
        items = items if isinstance(items, list) else []
        for item in items:
            for k in COD_KEYS:
                cod = item.get(k)
                if cod:
                    codigos.add(str(cod).strip())
                    break
        return len(items)

    ENDPOINTS = [
        ("https://api.v2.digipwms.com", "/api/v2/Pedidos"),
        ("http://api.patagoniawms.com", "/v1/Pedidos"),
    ]
    MAX_PAGES = 50

    for base, path in ENDPOINTS:
        try:
            ok, offset, page_no = False, 0, 1
            log.info("  DigiP: descargando pedidos existentes...")
            while True:
                r = requests.get(
                    f"{base}{path}", headers=DIGIP_HDR,
                    params={"limit": PAGE_SIZE, "offset": offset,
                            "pageSize": PAGE_SIZE, "pageNumber": page_no,
                            "take": PAGE_SIZE, "skip": offset},
                    timeout=10,
                )
                if r.status_code not in (200, 206):
                    break
                ok = True
                n = _harvest(r.json())
                log.info("  DigiP página %d: %d registros (total=%d)", page_no, n, len(codigos))
                if n == 0:
                    break
                offset += n
                page_no += 1
                if page_no > MAX_PAGES:
                    log.warning("  DigiP: límite de páginas (%d) alcanzado", MAX_PAGES)
                    break
            if ok:
                break
        except Exception as exc:
            log.warning("DigiP list %s%s: %s", base, path, exc)

    log.info("  DigiP: %d pedidos en sistema", len(codigos))
    _digip_cache["codigos"] = codigos
    return codigos


def _verificar_cliente(cod):
    if cod in _cli_cache:
        return _cli_cache[cod]
    r = _dget(f"http://api.patagoniawms.com/v1/Clientes/{cod}")
    if r is None:
        return None
    if r.status_code == 200:
        _cli_cache[cod] = True
        return True
    if r.status_code == 404 or "No se encontraron" in r.text:
        _cli_cache[cod] = False
        return False
    return None


def _crear_cliente(cod, desc):
    r = _dpost("http://api.patagoniawms.com/v1/Clientes", {
        "codigo": str(cod), "descripcion": desc,
        "identificadorFiscal": str(cod), "Activo": True,
    })
    ok = r is not None and r.status_code in (200, 201)
    if ok:
        _cli_cache[cod] = True
        log.info("  Cliente %s creado", cod)
    return ok


def _obtener_ubicaciones(cod):
    r = _dget(f"http://api.patagoniawms.com/v1/Cliente/{cod}/ClientesUbicaciones")
    try:
        return r.json() if r and r.status_code == 200 and isinstance(r.json(), list) else []
    except Exception:
        return []


def _crear_ubicacion(cli_cod, ubi_cod, direccion, reintentos=3):
    key = (cli_cod, ubi_cod)
    if key in _ubi_cache:
        return _ubi_cache[key]
    for intento in range(1, reintentos + 1):
        r = _dpost(
            f"http://api.patagoniawms.com/v1/Cliente/{cli_cod}/ClientesUbicaciones",
            {"Codigo": str(ubi_cod), "Descripcion": direccion, "Direccion": direccion},
        )
        if r is None:
            if intento < reintentos:
                time.sleep(2 ** intento)
                continue
            _ubi_cache[key] = False
            return False
        if r.status_code in (200, 201):
            _ubi_cache[key] = ubi_cod
            return ubi_cod
        txt = (r.text or "").lower()
        if "cliente ubicacion ya existe" in txt:
            _ubi_cache[key] = ubi_cod
            return ubi_cod
        if "sequence contains more than one element" in txt:
            ubs = _obtener_ubicaciones(cli_cod)
            resultado = ubs[0]["Codigo"] if ubs else False
            _ubi_cache[key] = resultado
            return resultado
        log.warning("  crear_ubicacion %s: HTTP %d", ubi_cod, r.status_code)
        _ubi_cache[key] = False
        return False
    _ubi_cache[key] = False
    return False


def _truncar_obs_smart(obs: str, limite: int = 250) -> str:
    s = str(obs or "")
    if len(s) <= limite:
        return s
    truncado = s[:limite]
    pipe = truncado.rfind("|")
    return truncado[:pipe] if pipe > 0 else truncado


def _es_error_observacion(resp) -> bool:
    if resp is None:
        return False
    try:
        body = resp.json()
    except Exception:
        return False
    errors = body.get("errors") if isinstance(body, dict) else None
    if not isinstance(errors, dict):
        return False
    return any("observacion" in str(k).lower() for k in errors.keys())


def _resumir_error_api(resp) -> str:
    if resp is None:
        return "sin_respuesta"
    try:
        body = resp.json()
    except Exception:
        return (resp.text or "")[:120].strip() or f"HTTP {resp.status_code}"
    if isinstance(body, dict):
        errs = body.get("errors")
        if isinstance(errs, dict) and errs:
            return "campos_invalidos:" + ",".join(sorted(errs.keys()))
        title = body.get("title") or body.get("message")
        if title:
            return str(title)[:120]
    return (resp.text or "")[:120].strip() or f"HTTP {resp.status_code}"


def _post_pedido(codigo, cli_ubi, fecha_iso, despacho, obs, items, importe=1, max_retry=3):
    payload = {
        "codigo": codigo, "clienteUbicacionCodigo": cli_ubi,
        "fecha": fecha_iso, "estado": "Pendiente",
        "observacion": str(obs), "importe": importe,
        "codigoDespacho": despacho, "codigoDeEnvio": codigo,
        "servicioDeEnvioTipo": "Propio", "ordenPreparacion": 0,
        "items": items, "tags": [],
    }
    r = None
    for attempt in range(max_retry):
        r = _dpost("https://api.v2.digipwms.com/api/v2/Pedidos", payload)
        if r is None:
            if attempt < max_retry - 1:
                time.sleep(2 ** attempt)
                continue
            return None
        if r.status_code < 500:
            break
        if attempt < max_retry - 1:
            log.warning("  %s: HTTP %d — reintento %d/%d", codigo, r.status_code, attempt + 1, max_retry)
            time.sleep(2 ** attempt)

    if r is not None and r.status_code in (400, 422) and _es_error_observacion(r) and str(obs) != "1":
        log.warning("  %s: DigiP rechazó Observacion — reintento con obs='1'", codigo)
        payload["observacion"] = "1"
        r2 = _dpost("https://api.v2.digipwms.com/api/v2/Pedidos", payload)
        if r2 is not None:
            return r2
    return r


# =========================================================================
# NÚCLEO DE CARGA
# =========================================================================

MAX_SUFIJOS_LOTE = 9


def _procesar_df_digip(df, fuente: str, dry_run: bool, pedido_tipo: str = "TODOS") -> dict:
    """Itera el df normalizado y carga cada pedido en DigiP."""
    df = df.copy()
    df["ClienteUbicacionCodigo"] = (
        df["ClienteUbicacionCodigo"].astype(str)
        .str.replace("–", "-", regex=False)
        .str.replace("—", "-", regex=False)
    )
    ya_cargados        = carga_digip_db.load_processed(fuente)
    grouped            = df.groupby("PedidoCodigo")
    total              = len(grouped)
    ok = ya = omit = err = 0
    created_codes:     set = set()
    ya_existian_codes: set = set()
    renamed_codes:     dict = {}
    errors_by_type:    Counter = Counter()

    for pedido_cod, grupo in grouped:
        pedido_cod = str(pedido_cod)
        if pedido_cod in ya_cargados:
            ya += 1
            continue

        if pedido_tipo != "TODOS":
            es_lote = pedido_cod.startswith(("MELI", "UDMELI"))
            if pedido_tipo == "LOTE" and not es_lote:
                omit += 1
                continue
            if pedido_tipo == "INDIV" and es_lote:
                omit += 1
                continue

        row     = grupo.iloc[0]
        cli_cod = str(row["ClienteCodigo"])
        ubi_cod = str(row["ClienteUbicacionCodigo"])
        obs     = str(row.get("PedidoObservacion", "1")) or "1"

        items = []
        for _, ir in grupo.iterrows():
            v = ir["ArticuloCodigo"]
            if not _sku_ok(v):
                continue
            sku = str(v).strip()
            try:
                uds = int(float(ir["PedidoUnidades"]))
            except Exception:
                uds = 0
            if uds > 0:
                items.append({"linea": str(len(items) + 1), "articuloCodigo": sku, "unidades": uds})

        if not items:
            log.warning("  %s sin ítems válidos — omitido", pedido_cod)
            omit += 1
            continue

        tipo      = "LOTE" if pedido_cod.startswith(("MELI", "UDMELI")) else "INDIV"
        total_uds = sum(it["unidades"] for it in items)

        if dry_run:
            ok += 1
            created_codes.add(pedido_cod)
            log.info("  [DRY][%s][%s] %s | cli=%s | %d SKU(s) · %d ud(s) | desp=%s",
                     fuente, tipo, pedido_cod, cli_cod, len(items), total_uds, row["CodigoDespacho"])
            continue

        existe = _verificar_cliente(cli_cod)
        if existe is False and not _crear_cliente(cli_cod, str(row["ClienteDescripcion"])):
            omit += 1
            continue
        if existe is None:
            omit += 1
            continue

        ubi_final = _crear_ubicacion(cli_cod, ubi_cod, str(row["ClienteUbicacionDireccion"]))
        if not ubi_final:
            log.warning("  Sin ubicación %s — omitido", pedido_cod)
            omit += 1
            continue

        log.info("  [%s][%s] %s | cli=%s | %d ud(s) | desp=%s",
                 fuente, tipo, pedido_cod, cli_cod, total_uds, row["CodigoDespacho"])

        despacho_cod = str(row["CodigoDespacho"])
        fecha_iso    = _parse_fecha(row["PedidoFecha"])
        importe      = float(row.get("PedidoImporte") or 1)

        r = _post_pedido(pedido_cod, ubi_final, fecha_iso, despacho_cod, obs, items, importe)
        if r is None:
            err += 1
            errors_by_type["sin_respuesta"] += 1
            continue

        ya_existe = "Ya existe" in r.text or "exist" in r.text.lower()
        es_lote_sin_sufijo = (
            pedido_cod.startswith("UDMELI")
            and "-" not in pedido_cod.split("UDMELI", 1)[1]
        )

        if ya_existe and es_lote_sin_sufijo and not dry_run:
            sufijo_ganador = None
            for n in range(1, MAX_SUFIJOS_LOTE + 1):
                cod_alt = f"{pedido_cod}-{n}"
                if cod_alt in ya_cargados:
                    continue
                log.info("  %s ya existe en DigiP — reintento con sufijo %s", pedido_cod, cod_alt)
                r_alt = _post_pedido(cod_alt, ubi_final, fecha_iso, despacho_cod, obs, items, importe)
                if r_alt is None:
                    continue
                if r_alt.status_code in (200, 201):
                    r = r_alt
                    sufijo_ganador = cod_alt
                    break
                if "Ya existe" in r_alt.text or "exist" in r_alt.text.lower():
                    continue
                r = r_alt
                break
            if sufijo_ganador:
                renamed_codes[pedido_cod] = sufijo_ganador
                pedido_cod = sufijo_ganador
                ya_existe = False

        if r.status_code in (200, 201):
            carga_digip_db.append_processed(fuente, [pedido_cod])
            ya_cargados.add(pedido_cod)
            created_codes.add(pedido_cod)
            log.info("  OK %s — %d ítem(s)", pedido_cod, len(items))
            ok += 1
        elif ya_existe or "Ya existe" in r.text or "exist" in r.text.lower():
            carga_digip_db.append_processed(fuente, [pedido_cod])
            ya_cargados.add(pedido_cod)
            ya_existian_codes.add(pedido_cod)
            ya += 1
        else:
            resumen = _resumir_error_api(r)
            errors_by_type[resumen] += 1
            log.error("  ERR %s: HTTP %s — %s", pedido_cod, r.status_code, r.text[:200])
            err += 1

        time.sleep(0.05)

    if errors_by_type:
        top = errors_by_type.most_common(5)
        resumen_txt = " · ".join(f"{tipo}: {cnt}" for tipo, cnt in top)
        log.info("  Errores agrupados: %s", resumen_txt)

    return {
        "total": total, "creados": ok, "ya_existian": ya, "omitidos": omit, "errores": err,
        "created_codes": created_codes, "ya_existian_codes": ya_existian_codes,
        "renamed_codes": renamed_codes,
    }


# =========================================================================
# FLUJO 1: TiendaNube Unidrop → DigiPWMS  (via RDS Unidrop)
# =========================================================================

def run_tn(dry_run: bool, pedido_tipo: str = "TODOS", tipo: str = "TODOS") -> dict | None:
    log.info("=" * 60)
    log.info("  FLUJO TN → DigiPWMS")
    log.info("=" * 60)
    try:
        engine   = get_engine("unidrop")
        df       = pd.read_sql(
            'SELECT * FROM public."tienda_nube_orders" '
            "WHERE status = 'open' AND payment_status = 'paid' AND shipping_status = 'unpacked' "
            'ORDER BY tienda_nube_id ASC', engine)
        df_items = pd.read_sql(
            'SELECT * FROM public.tienda_nube_order_items ORDER BY tienda_nube_line_item_id ASC', engine)
        df_pi    = pd.read_sql(
            "SELECT * FROM public.\"PaymentIntent\" WHERE status='PROCESSED' ORDER BY id ASC", engine)
        df_carg  = pd.read_sql(
            'SELECT DISTINCT number FROM public."pedidos_por_lotes" WHERE number IS NOT NULL', engine)
    except Exception as e:
        log.error("Conexión TN fallida: %s", e)
        return None

    ya_en_db_tn = set(df_carg["number"].astype(str).str.strip())
    log.info("DB TN: %d órdenes | %d items | %d PIs | %d ya en pedidos_por_lotes",
             len(df), len(df_items), len(df_pi), len(ya_en_db_tn))

    processed: set = set()
    for raw_val in df_pi["orderIds"].dropna():
        clean = re.sub(r"[\[\]{}'\"\\s]", "", str(raw_val))
        for part in clean.split(","):
            d = re.sub(r"\D", "", part.strip())
            if d:
                processed.add(d)

    cust_flat = json_normalize([_ensure_dict(v) for v in df["customer"]], sep="_").add_prefix("customer_")
    if "addresses" in cust_flat.columns:
        cust_flat = cust_flat.drop(columns=["addresses"])
    ship_flat = json_normalize([_ensure_dict(v) for v in df["shipping_address"]], sep="_").add_prefix("shipping_address_")
    base_cols = [c for c in df.columns if c not in ["fulfillments", "customer", "shipping_address"]]
    df_main   = pd.concat([df[base_cols].reset_index(drop=True),
                           cust_flat.reset_index(drop=True),
                           ship_flat.reset_index(drop=True)], axis=1)
    df_main   = df_main.merge(df_items[["tienda_nube_order_id", "name", "quantity", "sku"]],
                              left_on="tienda_nube_id", right_on="tienda_nube_order_id", how="left")
    df_main["tid"] = df_main["tienda_nube_id"].astype(str).str.replace(r"\D", "", regex=True)
    df_proc   = df_main[df_main["tid"].isin(processed) & (df_main["payment_status"] == "paid")].copy()

    if df_proc.empty:
        log.info("TN: sin órdenes nuevas")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    log.info("TN paid+PROCESSED: %d órdenes únicas", df_proc["tienda_nube_id"].nunique())

    MAP_DESPACHO_TN = {"UNIFAST": "Unifast", "OCA": "MADERA-OCA", "NAN": "Sin despacho", "": "Sin despacho"}

    ident = _s(df_proc["contact_identification"]).replace({"None": "", "none": "", "NONE": "", "nan": ""})
    num   = _s(df_proc["number"].astype(str))
    dni   = num.str.split("-").str[1].fillna("").str.extract(r"(\d+)", expand=False).fillna("").str.strip()
    ident_final = ident.mask(ident.eq(""), dni).fillna("").str.strip()
    ident_final = ident_final.where(ident_final.ne(""), num)

    carrier  = _s(df_proc["shipping_carrier"]).str.upper()
    tipoenv  = _s(df_proc["shipping_option"]).str.upper()
    cod_desp = carrier.map(MAP_DESPACHO_TN).fillna(carrier)
    cod_desp = cod_desp.where(~(tipoenv == "ENVIO NACIONAL"), "MADERA-OCA")
    cod_desp = cod_desp.where(~(tipoenv == "ENVIO LOCAL"), "MADERA-FLEX")

    addr  = _s(df_proc.get("shipping_address_address",  pd.Series("", index=df_proc.index)))
    num_n = _s(df_proc.get("shipping_address_number",   pd.Series("", index=df_proc.index)))
    floor = _s(df_proc.get("shipping_address_floor",    pd.Series("", index=df_proc.index)))
    city  = _s(df_proc.get("shipping_address_city",     pd.Series("", index=df_proc.index)))
    loc   = _s(df_proc.get("shipping_address_locality", pd.Series("", index=df_proc.index)))
    loc   = loc.mask(loc.str.count("/") >= 1, "")
    dir_c = (addr + " " + num_n + " " + floor + " " + loc + " " + city).str.split().str.join(" ")
    dir_c = dir_c.where(dir_c.ne(""), "Unistore " + ident_final)

    cli_desc = _s(df_proc.get("customer_default_address_name", pd.Series("", index=df_proc.index)))
    cli_desc = cli_desc.replace({"nan": "", "None": "", "none": "", "NONE": ""})
    cli_desc = cli_desc.where(cli_desc.ne(""), ident_final)
    ubi_cod  = (ident_final + "-" + num_n).str.strip().str.rstrip("-").str.strip()

    df_digip = pd.DataFrame({
        "PedidoFecha":               pd.to_datetime(df_proc["created_at"], errors="coerce").dt.strftime("%m/%d/%Y"),
        "PedidoCodigo":              df_proc["number"],
        "PedidoUnidades":            df_proc["quantity"],
        "ArticuloCodigo":            df_proc["sku"],
        "ArticuloDescripcion":       df_proc["name"],
        "ClienteCodigo":             ident_final,
        "ClienteDescripcion":        cli_desc,
        "ClienteUbicacionCodigo":    ubi_cod,
        "CodigoDespacho":            cod_desp,
        "ClienteUbicacionDireccion": dir_c,
        "PedidoObservacion":         "",
        "PedidoImporte":             0.0,
    }, index=df_proc.index)

    TN_TIPO_MAP = {"PR": "OCA", "FLEX": "FLEX"}
    if tipo != "TODOS" and tipo in TN_TIPO_MAP:
        keyword  = TN_TIPO_MAP[tipo]
        tipo_mask = df_digip["CodigoDespacho"].str.upper().str.contains(keyword, na=False)
        df_digip  = df_digip[tipo_mask].copy()

    dup_db = df_digip["PedidoCodigo"].astype(str).isin(ya_en_db_tn)
    if dup_db.any():
        log.info("  Anti-dup DB: %d pedidos ya en pedidos_por_lotes", df_digip.loc[dup_db, "PedidoCodigo"].nunique())
        df_digip = df_digip[~dup_db].copy()

    digip_exist = _get_digip_existentes()
    if digip_exist:
        dup_digip = df_digip["PedidoCodigo"].astype(str).isin(digip_exist)
        if dup_digip.any():
            log.info("  Anti-dup DigiP: %d pedidos ya en DigiP", df_digip.loc[dup_digip, "PedidoCodigo"].nunique())
            df_digip  = df_digip[~dup_digip].copy()

    if df_digip.empty:
        log.info("TN: todos los pedidos ya están procesados")
        return {"total": 0, "creados": 0, "ya_existian": len(ya_en_db_tn), "omitidos": 0, "errores": 0}

    log.info("TN pendientes: %d", df_digip["PedidoCodigo"].nunique())
    return _procesar_df_digip(df_digip, "TN", dry_run, pedido_tipo=pedido_tipo)


# =========================================================================
# FLUJO 2: MercadoLibre Unidrop → DigiPWMS  (via RDS Unidrop)
# =========================================================================

def run_meli_db(
    dry_run: bool,
    tipo: str = "TODOS",
    pedido_tipo: str = "TODOS",
    fecha_desde: str | None = None,
    modo_lote: str = "TODOS",
) -> dict | None:
    log.info("=" * 60)
    log.info("  FLUJO MELI-DB → DigiPWMS")
    log.info("=" * 60)
    try:
        engine = get_engine("unidrop")
        _fecha_cond = f' AND "lastUpdated"::date >= \'{fecha_desde}\'' if fecha_desde else ""
        df_ord   = pd.read_sql(
            'SELECT * FROM mercado_libre_dev."OrderMercadoLibre" '
            'WHERE status=\'paid\' '
            'AND ("shipping_option_reference" IS NULL OR UPPER("shipping_option_reference") != \'EMPAQUETADO\')'
            + _fecha_cond + ' ORDER BY "dateCreated" ASC', engine)
        df_items = pd.read_sql(
            'SELECT oi.* FROM mercado_libre_dev."OrderItemMercadoLibre" oi '
            'INNER JOIN mercado_libre_dev."OrderMercadoLibre" o ON oi."orderId"=o.id '
            'WHERE o.status=\'paid\' '
            'AND (o."shipping_option_reference" IS NULL OR UPPER(o."shipping_option_reference") != \'EMPAQUETADO\')'
            + _fecha_cond + ' ORDER BY oi.id ASC', engine)
        df_pi    = pd.read_sql(
            'SELECT * FROM public."PaymentIntent" WHERE status=\'PROCESSED\' AND "mlOrderIds" IS NOT NULL AND "mlOrderIds"::text<>\'{}\'',
            engine)
        df_carg     = pd.read_sql(
            'SELECT DISTINCT number FROM public."pedidos_por_lotes" WHERE number IS NOT NULL', engine)
        df_lotes_db = pd.read_sql(
            'SELECT DISTINCT nombre_lote FROM public."pedidos_por_lotes" WHERE nombre_lote IS NOT NULL', engine)
    except Exception as e:
        log.error("Conexión MELI_DB fallida: %s", e)
        return None

    ya_en_db       = set(df_carg["number"].astype(str).str.strip())
    ya_lotes_en_db = set(df_lotes_db["nombre_lote"].astype(str).str.strip())
    log.info("DB MELI: %d órdenes | %d items | %d PIs | %d ya en pedidos_por_lotes",
             len(df_ord), len(df_items), len(df_pi), len(ya_en_db))

    processed: set = set()
    for raw_val in df_pi["mlOrderIds"].dropna():
        raw = str(raw_val).lstrip("{").rstrip("}")
        for id_str in raw.split(","):
            t = id_str.strip()
            if t and t.lower() != "null":
                processed.add(t)

    df_ord["id_str"] = df_ord["id"].astype(str).str.strip()
    df_proc = df_ord[df_ord["id_str"].isin(processed) & (df_ord["status"] == "paid")].copy().reset_index(drop=True)

    if df_proc.empty:
        log.info("MELI_DB: sin órdenes nuevas")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    log.info("MELI_DB candidatas: %d", len(df_proc))

    MAP_DESPACHO_ML = {"PUNTO DE RETIRO": "MELI PR", "FLEXI": "MELI FLEX", "": "Sin despacho"}
    ship_flat = json_normalize(df_proc["shipping_address_detail"].apply(_ensure_dict).tolist(), sep="_").add_prefix("shipping_")
    base_cols = [c for c in df_proc.columns if c != "shipping_address_detail"]
    df_main   = pd.concat([df_proc[base_cols].reset_index(drop=True), ship_flat.reset_index(drop=True)], axis=1)
    df_main   = df_main.merge(df_items[["orderId", "title", "quantity", "sellerSku"]],
                              left_on="id", right_on="orderId", how="left")

    carrier  = _s(df_main.get("shipping_carrier", pd.Series("", index=df_main.index))).str.upper()
    cod_desp = carrier.map(MAP_DESPACHO_ML).fillna(carrier)
    cli_cod  = _s(df_main["buyerId"])
    ship_st  = _s(df_main.get("shipping_street_name",   pd.Series("", index=df_main.index)))
    ship_no  = _s(df_main.get("shipping_street_number", pd.Series("", index=df_main.index)))
    ship_ci  = _s(df_main.get("shipping_city",          pd.Series("", index=df_main.index)))
    ship_st2 = _s(df_main.get("shipping_state",         pd.Series("", index=df_main.index)))
    direccion = (ship_st + " " + ship_no + " " + ship_ci + " " + ship_st2).str.split().str.join(" ").str.strip()
    direccion = direccion.where(direccion.ne(""), "Sin dir " + cli_cod)
    pedido_cod = _s(df_main["number"]) if "number" in df_main.columns else _s(df_main["id"])

    df_digip = pd.DataFrame({
        "PedidoFecha":               pd.to_datetime(df_main["dateCreated"], errors="coerce").dt.strftime("%m/%d/%Y"),
        "PedidoCodigo":              pedido_cod,
        "PedidoUnidades":            df_main["quantity"],
        "ArticuloCodigo":            _s(df_main["sellerSku"]),
        "ArticuloDescripcion":       _s(df_main["title"]),
        "ClienteCodigo":             cli_cod,
        "ClienteDescripcion":        _s(df_main.get("buyer_name", pd.Series("", index=df_main.index))),
        "ClienteUbicacionCodigo":    (cli_cod + "-" + ship_no).str.strip().str.replace("–", "-", regex=False),
        "CodigoDespacho":            cod_desp,
        "ClienteUbicacionDireccion": direccion,
        "PedidoObservacion":         "1",
        "PedidoImporte":             pd.to_numeric(df_main.get("paidAmount", pd.Series(1, index=df_main.index)), errors="coerce").fillna(1.0),
    }, index=df_main.index)

    if tipo != "TODOS":
        tipo_mask = df_digip["CodigoDespacho"].str.upper().str.contains(tipo, na=False)
        df_digip  = df_digip[tipo_mask].copy()

    if df_digip.empty:
        log.info("MELI_DB: sin órdenes para tipo=%s", tipo)
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    ya_db_fallback = carga_digip_db.load_processed("MELI_DB")
    dup_mask       = df_digip["PedidoCodigo"].astype(str).isin(ya_en_db | ya_db_fallback)
    if dup_mask.any():
        log.info("  Anti-dup: %d pedidos ya procesados — omitidos", dup_mask.sum())
        df_digip = df_digip[~dup_mask].copy()
    if df_digip.empty:
        log.info("MELI_DB: todos los pedidos ya están cargados")
        return {"total": 0, "creados": 0, "ya_existian": len(ya_en_db), "omitidos": 0, "errores": 0}

    # ── Clasificación lote / individual ──────────────────────────────
    _ahora_db  = datetime.now(AR_TZ)
    prefijo_db = f"UDMELI{_ahora_db.strftime('%d%m')}"
    fecha_hoy  = _ahora_db.strftime("%m/%d/%Y")

    def _proximo_contador(prefijo_tipo: str) -> int:
        """Devuelve el próximo N libre para un prefijo dado (ej. UDMELI0519FLEX → 1, 2, 3...).

        Considera lotes ya en pedidos_por_lotes con el patrón {prefijo_tipo}{N}[-{sufijo}].
        """
        pat  = re.compile(rf"^{re.escape(prefijo_tipo)}(\d+)(?:-\d+)?$")
        used = set()
        for n in ya_lotes_en_db:
            m = pat.match(str(n))
            if m:
                used.add(int(m.group(1)))
        counter = 1
        while counter in used:
            counter += 1
        return counter

    uds_por_pedido  = df_digip.groupby("PedidoCodigo")["PedidoUnidades"].sum().to_dict()
    desp_por_pedido = df_digip.groupby("PedidoCodigo")["CodigoDespacho"].first().to_dict()

    pre_lote_info: dict = {}
    for _orig in df_digip["PedidoCodigo"].unique():
        _rows = df_digip[df_digip["PedidoCodigo"].astype(str) == str(_orig)]
        pre_lote_info[str(_orig)] = {
            "sku":      "|".join(_rows["ArticuloCodigo"].astype(str).str.strip().dropna().unique()[:3]),
            "cantidad": int(_rows["PedidoUnidades"].sum()),
        }

    _lote_state:    dict = {}   # prefijo_tipo (ej UDMELI0519FLEX) → código asignado
    lotes_origenes: dict = {}

    def _asignar_lote(orig_cod, desp):
        tipo_e = "FLEX" if "FLEX" in str(desp).upper() else "PR"
        prefijo_tipo = f"{prefijo_db}{tipo_e}"
        if prefijo_tipo not in _lote_state:
            n = _proximo_contador(prefijo_tipo)
            _lote_state[prefijo_tipo] = f"{prefijo_tipo}{n}"
        lc = _lote_state[prefijo_tipo]
        lotes_origenes.setdefault(lc, set()).add(str(orig_cod))
        return lc

    lote_assignments: dict = {}
    for orig_cod in df_digip["PedidoCodigo"].unique():
        uds  = uds_por_pedido.get(str(orig_cod), 0)
        desp = desp_por_pedido.get(str(orig_cod), "")
        if int(uds) == 1:
            lc = _asignar_lote(str(orig_cod), desp)
            lote_assignments[str(orig_cod)] = lc

    for lc, origs in list(lotes_origenes.items()):
        if len(origs) == 1:
            orig_cod = next(iter(origs))
            del lote_assignments[orig_cod]
            del lotes_origenes[lc]
            log.info("  Lote %s tiene 1 orden → INDIV: %s", lc, orig_cod)

    for orig_cod, lc in lote_assignments.items():
        mask   = df_digip["PedidoCodigo"].astype(str) == orig_cod
        uds    = uds_por_pedido.get(orig_cod, 0)
        desp   = desp_por_pedido.get(orig_cod, "")
        tipo_e = "FLEX" if "FLEX" in str(desp).upper() else "PR"
        df_digip.loc[mask, "PedidoCodigo"]              = lc
        df_digip.loc[mask, "PedidoFecha"]               = fecha_hoy
        df_digip.loc[mask, "ClienteCodigo"]             = "99999999999"
        df_digip.loc[mask, "ClienteDescripcion"]        = f"MELI {int(uds)} {tipo_e}"
        df_digip.loc[mask, "ClienteUbicacionCodigo"]    = "99999999999-"
        df_digip.loc[mask, "ClienteUbicacionDireccion"] = "Unistore 99999999999"
        df_digip.loc[mask, "PedidoImporte"]             = 1.0

    for lc, origs in lotes_origenes.items():
        obs = _truncar_obs_smart("|".join(sorted(origs)), 250)
        df_digip.loc[df_digip["PedidoCodigo"] == lc, "PedidoObservacion"] = obs

    if modo_lote != "TODOS":
        es_lote_mask = df_digip["PedidoCodigo"].astype(str).str.startswith("UDMELI")
        if modo_lote == "SOLO_INDIVIDUALES":
            df_digip = df_digip[~es_lote_mask].copy()
        elif modo_lote == "SOLO_LOTES":
            df_digip = df_digip[es_lote_mask].copy()
        elif modo_lote == "SOLO_LOTES_FLEX":
            df_digip = df_digip[es_lote_mask & df_digip["PedidoCodigo"].astype(str).str.contains("FLEX")].copy()
        elif modo_lote == "SOLO_LOTES_PR":
            df_digip = df_digip[es_lote_mask & df_digip["PedidoCodigo"].astype(str).str.contains("PR")].copy()
        log.info("  Filtro modo_lote=%s → %d filas restantes", modo_lote, len(df_digip))
        if df_digip.empty:
            log.info("MELI_DB: sin pedidos tras filtro modo_lote=%s", modo_lote)
            return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    df_digip = (df_digip.groupby([
        "PedidoFecha", "PedidoCodigo", "ArticuloCodigo", "ArticuloDescripcion",
        "ClienteCodigo", "ClienteDescripcion", "ClienteUbicacionCodigo",
        "CodigoDespacho", "ClienteUbicacionDireccion", "PedidoObservacion", "PedidoImporte",
    ])["PedidoUnidades"].sum().reset_index())

    res     = _procesar_df_digip(df_digip, "MELI_DB", dry_run, pedido_tipo=pedido_tipo)
    created = res.get("created_codes", set())

    # Si _procesar_df_digip aplicó sufijos por colisión con DigiP, re-mapear lotes_origenes
    for orig_code, final_code in res.get("renamed_codes", {}).items():
        if orig_code in lotes_origenes:
            lotes_origenes[final_code] = lotes_origenes.pop(orig_code)

    if not dry_run:
        codes_to_save = []
        for lc in created:
            if lc in lotes_origenes:
                codes_to_save.extend(str(orig) for orig in lotes_origenes[lc])
            else:
                codes_to_save.append(str(lc))
        carga_digip_db.append_processed("MELI_DB", codes_to_save)

    # Persistir en pedidos_por_lotes
    def _build_rows(codes):
        rows = []
        for code in codes:
            if code in lotes_origenes:
                for orig_drop in lotes_origenes[code]:
                    info = pre_lote_info.get(str(orig_drop), {})
                    rows.append({
                        "nombre_lote":    code,
                        "number":         str(orig_drop),
                        "platform":       "ML",
                        "sku":            info.get("sku", ""),
                        "cantidad":       info.get("cantidad", 0),
                        "estado_pedido":  "PENDIENTE",
                        "order_id":       str(orig_drop),
                        "tracking_number": None,
                    })
        return rows

    all_done  = created | res.get("ya_existian_codes", set())
    rows_ppl  = _build_rows(all_done)

    if not dry_run and rows_ppl:
        try:
            _INSERT_PPL = text("""
                INSERT INTO public.pedidos_por_lotes
                    (nombre_lote, number, platform, sku, cantidad, estado_pedido, order_id, tracking_number, updated_at)
                VALUES
                    (:nombre_lote, :number, 'ML'::"LotePlataforma", :sku,
                     :cantidad, :estado_pedido, :order_id, :tracking_number, NOW())
                ON CONFLICT DO NOTHING
            """)
            with get_engine("unidrop").begin() as conn:
                conn.execute(_INSERT_PPL, rows_ppl)
            log.info("  pedidos_por_lotes: +%d registros insertados", len(rows_ppl))
        except Exception as _e:
            log.error("  Error escribiendo pedidos_por_lotes: %s", _e)
    elif dry_run and all_done:
        log.info("  DRY-RUN: %d registros listos para pedidos_por_lotes", len(rows_ppl))

    return res


# =========================================================================
# FLUJO 3: MercadoLibre Fox → DigiPWMS  (ML API + combos + lotes batch)
# =========================================================================

def run_meli_api(
    dry_run: bool, tipo: str = "TODOS", fecha: str | None = None, pedido_tipo: str = "TODOS"
) -> dict | None:
    log.info("=" * 60)
    log.info("  FLUJO MELI-API → DigiPWMS")
    log.info("=" * 60)

    FORMAS_MAP = {"FLEX": "Mercado Envíos Flex", "PR": "Correo y puntos de despacho"}
    FLEX_TYPES = {"self_service"}
    PR_TYPES   = {"cross_docking", "drop_off", "xd_drop_off"}
    VALID_ST   = {"pending", "handling", "ready_to_ship"}
    EXCL_SUB   = {"printed", "shipped", "delivered", "not_delivered", "cancelled"}

    if tipo == "TODOS":
        filtro_tipo = {"FLEX", "PR"}
    elif tipo in ("FLEX", "PR"):
        filtro_tipo = {tipo}
    else:
        log.error("TIPO inválido: %s", tipo)
        return None

    formas_activas = {FORMAS_MAP[t] for t in filtro_tipo}
    _ahora         = datetime.now(AR_TZ)
    dias_back      = 3 if _ahora.weekday() == 0 else 1
    fecha_obj      = fecha or _ahora.strftime("%Y-%m-%d")
    if fecha:
        dias_back = max(dias_back, 2)
    prefijo = f"MELI{datetime.strptime(fecha_obj, '%Y-%m-%d').strftime('%d%m')}"
    log.info("TIPO=%s | fecha=%s | prefijo=%s | DIAS_BACK=%d", tipo, fecha_obj, prefijo, dias_back)

    # ── ML OAuth ──────────────────────────────────────────────────────
    _tok = {"token": os.environ.get("ML_ACCESS_TOKEN", "")}

    def _refresh():
        log.info("Refrescando token ML...")
        r = requests.post("https://api.mercadolibre.com/oauth/token", data={
            "grant_type": "refresh_token", "client_id": ML_APP_ID,
            "client_secret": ML_SECRET, "refresh_token": os.environ.get("ML_REFRESH_TOKEN", ML_REFRESH),
        }, timeout=20)
        r.raise_for_status()
        d = r.json()
        _tok["token"] = d["access_token"]
        os.environ["ML_ACCESS_TOKEN"]  = d["access_token"]
        os.environ["ML_REFRESH_TOKEN"] = d.get("refresh_token", "")
        log.info("Token ML actualizado (válido ~%ds)", d.get("expires_in", 21600))

    def _ml_get(url, params=None, extra=None):
        refreshed = False
        for attempt in range(3):
            if attempt:
                time.sleep(0.7 * attempt)
            hdrs = {"Authorization": f"Bearer {_tok['token']}"}
            if extra:
                hdrs.update(extra)
            try:
                r = requests.get(url, headers=hdrs, params=params, timeout=30)
            except (requests.exceptions.ConnectTimeout, requests.exceptions.ConnectionError):
                continue
            if r.status_code == 401 and not refreshed:
                refreshed = True
                _refresh()
                continue
            if r.status_code in (429,) or r.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError(f"ML sin respuesta: {url}")

    _refresh()
    dt_to   = datetime.now(timezone.utc)
    dt_from = dt_to - timedelta(days=dias_back)
    _iso    = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%S.000-00:00")

    log.info("Consultando ML API...")
    orders, offset = [], 0
    while True:
        data  = _ml_get("https://api.mercadolibre.com/orders/search", params={
            "seller": ML_USER_ID, "order.status": "paid",
            "order.date_closed.from": _iso(dt_from), "order.date_closed.to": _iso(dt_to),
            "sort": "date_asc", "limit": 50, "offset": offset,
        })
        batch  = data.get("results", [])
        orders.extend(batch)
        total  = data.get("paging", {}).get("total", len(orders))
        offset += len(batch)
        if not batch or offset >= total:
            break
    log.info("  → %d órdenes pagadas", len(orders))

    ship_ids = list({
        str(sid) for o in orders
        for sid in [((o.get("shipping") or {}).get("id") or (o.get("shipment") or {}).get("id"))]
        if sid
    })
    log.info("  → %d shipments únicos", len(ship_ids))
    ships = {}
    for sid in ship_ids:
        try:
            ships[sid] = _ml_get(f"https://api.mercadolibre.com/shipments/{sid}", extra={"x-format-new": "true"})
        except Exception as e:
            ships[sid] = {}
            log.warning("    ship %s: %s", sid, e)

    def _forma(s):
        lt = (s.get("logistic_type") or (s.get("logistic") or {}).get("type") or "").strip()
        if lt in FLEX_TYPES:
            return "Mercado Envíos Flex"
        if lt in PR_TYPES:
            return "Correo y puntos de despacho"
        return None

    def _har(s):
        lead = s.get("lead_time") or {}
        src  = (
            (lead.get("estimated_handling_limit") or {}).get("date")
            or (lead.get("estimated_delivery_limit") or {}).get("date")
            or (lead.get("estimated_delivery_time") or {}).get("date")
        )
        if not src:
            return ""
        try:
            ts = pd.to_datetime(str(src), utc=False, errors="coerce")
            if pd.isna(ts):
                return ""
            ts_ar = ts.tz_convert(AR_TZ) if ts.tzinfo else ts.tz_localize(AR_TZ)
            return ts_ar.strftime("%Y-%m-%d")
        except Exception:
            return ""

    def _dom(addr):
        line = (addr.get("address_line") or "").strip()
        if not line:
            line = f"{addr.get('street_name', '').strip()} {addr.get('street_number', '').strip()}".strip()
        comment = (addr.get("comment") or "").strip()
        if comment:
            line += f" / {comment}"
        city  = (addr.get("city") or {}).get("name", "") if isinstance(addr.get("city"), dict) else addr.get("city", "")
        state = (addr.get("state") or {}).get("name", "") if isinstance(addr.get("state"), dict) else addr.get("state", "")
        cp    = str(addr.get("zip_code") or "").strip()
        tail  = " - ".join(filter(None, [f"CP {cp}" if cp else "", city, state]))
        return f"{line} - {tail}" if tail else line

    by_ship = {}
    for o in orders:
        sid = str(((o.get("shipping") or {}).get("id") or (o.get("shipment") or {}).get("id")) or "")
        if sid:
            by_ship.setdefault(sid, []).append(o)

    rows = []
    desc_t = desc_s = desc_sub = desc_f = 0
    for sid, group in by_ship.items():
        sh    = ships.get(sid, {})
        forma = _forma(sh)
        if not forma:
            desc_t += 1
            continue
        if (sh.get("status") or "").lower() not in VALID_ST:
            desc_s += 1
            continue
        if (sh.get("substatus") or "").lower() in EXCL_SUB:
            desc_sub += 1
            continue
        har = _har(sh)
        if har and har < fecha_obj:
            desc_f += 1
            continue
        first = group[0]
        buyer = first.get("buyer") or {}
        bi    = buyer.get("billing_info") or {}
        dni   = str(bi.get("doc_number") or buyer.get("id") or "").strip()
        nom   = f"{buyer.get('first_name', '').strip()} {buyer.get('last_name', '').strip()}".strip() or (buyer.get("nickname") or "").strip()
        addr  = ((sh.get("destination") or {}).get("shipping_address") or sh.get("receiver_address") or {})
        pack  = first.get("pack_id")
        vid   = str(pack).strip() if pack else str(first.get("id") or "").strip()
        items_todos = []
        for o in group:
            for it in (o.get("order_items") or []):
                item = it.get("item") or {}
                sku  = (item.get("seller_sku") or item.get("seller_custom_field") or "").strip()
                items_todos.append({"sku": sku, "qty": int(it.get("quantity") or 0)})
        if not items_todos:
            continue
        if len(items_todos) > 1:
            rows.append({"#_de_venta": vid, "fecha": first.get("date_created", ""), "estado": f"paquete de {len(items_todos)}", "uds": 0, "sku": "", "forma": forma, "comprador": nom, "dni": dni, "dom": _dom(addr), "har": har})
            for it in items_todos:
                rows.append({"#_de_venta": vid, "fecha": first.get("date_created", ""), "estado": "etiqueta lista para imprimir", "uds": it["qty"], "sku": it["sku"], "forma": "", "comprador": nom, "dni": dni, "dom": _dom(addr), "har": har})
        else:
            it = items_todos[0]
            rows.append({"#_de_venta": vid, "fecha": first.get("date_created", ""), "estado": "etiqueta lista para imprimir", "uds": it["qty"], "sku": it["sku"], "forma": forma, "comprador": nom, "dni": dni, "dom": _dom(addr), "har": har})

    df = pd.DataFrame(rows, columns=["#_de_venta", "fecha", "estado", "uds", "sku", "forma", "comprador", "dni", "dom", "har"])
    if df.empty:
        log.info("MELI_API: sin filas")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}
    df["uds"]    = pd.to_numeric(df["uds"], errors="coerce").fillna(0).astype(int)
    df["estado"] = df["estado"].fillna("").astype(str).str.lower().str.strip()
    df["forma"]  = df["forma"].astype(str).str.strip().replace(["", "nan"], pd.NA).ffill()
    df["har"]    = df["har"].replace(["", "nan"], pd.NA).ffill()
    df           = df[df["forma"].isin(formas_activas)].reset_index(drop=True)
    log.info("  FLEX=%d | PR=%d | desc_tipo=%d | desc_status=%d | desc_fecha=%d",
             df[df["forma"] == "Mercado Envíos Flex"]["#_de_venta"].nunique(),
             df[df["forma"] == "Correo y puntos de despacho"]["#_de_venta"].nunique(),
             desc_t, desc_s, desc_f)

    # Anti-dup via DB (reemplaza Excel)
    ordenes_ya   = carga_digip_db.load_processed("MELI_API_VID")
    log.info("  Histórico DB: %d ya procesadas", len(ordenes_ya))

    total_orig = len(df)
    keep = []
    i    = 0
    while i < total_orig:
        fila = df.iloc[i]
        est  = str(fila["estado"])
        vid  = str(fila["#_de_venta"]).replace(".0", "").strip()
        if "paquete de" in est:
            try:
                cant = int("".join(filter(str.isdigit, est)))
            except Exception:
                cant = 1
            ids_b = [vid] + [str(df.iloc[j]["#_de_venta"]).replace(".0", "").strip() for j in range(i + 1, min(i + cant + 1, total_orig))]
            if not any(v in ordenes_ya for v in ids_b):
                for j in range(i, min(i + cant + 1, total_orig)):
                    keep.append(j)
            i += cant + 1
        else:
            if vid not in ordenes_ya:
                keep.append(i)
            i += 1
    df = df.iloc[keep].reset_index(drop=True)
    if df.empty:
        log.info("MELI_API: todas las órdenes ya procesadas")
        return {"total": 0, "creados": 0, "ya_existian": len(ordenes_ya), "omitidos": 0, "errores": 0}

    skus_v = set()
    idx = 0
    while idx < len(df):
        fila = df.iloc[idx]
        est  = str(fila["estado"])
        if "paquete de" in est:
            try:
                cant = int("".join(filter(str.isdigit, est)))
            except Exception:
                cant = 1
            for _, p in df.iloc[idx + 1:idx + 1 + cant].iterrows():
                if _sku_ok(p["sku"]):
                    skus_v.add(str(p["sku"]).strip())
            idx += cant + 1
        elif "etiqueta lista para imprimir" == est.strip():
            if _sku_ok(fila["sku"]):
                skus_v.add(str(fila["sku"]).strip())
            idx += 1
        else:
            idx += 1

    # ── Combos Contabilium ─────────────────────────────────────────
    def _cb_token():
        r = requests.post("https://rest.contabilium.com/token", data={
            "grant_type": "client_credentials", "client_id": CB_ID, "client_secret": CB_SECRET,
        }, timeout=15)
        r.raise_for_status()
        return r.json()["access_token"]

    def _get_combos(skus, token):
        mapeo = {}
        hdrs  = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        log.info("Contabilium: %d SKUs...", len(skus))
        for sku in list(skus):
            sku = str(sku).strip()
            try:
                r = requests.get(f"https://rest.contabilium.com/api/conceptos/getByCodigo?codigo={sku}", headers=hdrs, timeout=10)
                if r.status_code == 200:
                    d  = r.json()
                    es = str(d.get("Tipo", "")).lower() == "combo"
                    mapeo[sku] = {"es_combo": es, "items": d.get("Items", []) if es else []}
                else:
                    mapeo[sku] = {"es_combo": False, "items": []}
            except Exception:
                mapeo[sku] = {"es_combo": False, "items": []}
        return mapeo

    def _get_descs(skus):
        mapeo = {}
        hdrs  = {"X-API-KEY": DIGIP_KEY, "Accept": "application/json"}
        log.info("DigiP descripciones: %d SKUs...", len(skus))
        for sku in list(skus):
            sku = str(sku).strip()
            try:
                r = requests.get(f"http://api.patagoniawms.com/v1/Articulos/{sku}", headers=hdrs, timeout=10)
                if r.status_code == 200:
                    d    = r.json()
                    desc = d.get("Descripcion") or d.get("descripcion")
                    mapeo[sku] = str(desc).strip() if desc else f"SIN DESC ({sku})"
                else:
                    mapeo[sku] = f"NO ENCONTRADO ({sku})"
            except Exception:
                mapeo[sku] = f"ERROR ({sku})"
        return mapeo

    cb_tok    = _cb_token()
    combos    = _get_combos(list(skus_v), cb_tok)
    todos_skus = set(skus_v)
    for info in combos.values():
        if info["es_combo"]:
            for it in info["items"]:
                sc = str(it.get("Codigo", "")).strip()
                if sc and sc.lower() not in ("nan", "none", ""):
                    todos_skus.add(sc)
    descs = _get_descs(list(todos_skus))

    # ── Clasificación + build df_final ────────────────────────────
    processed_lotes = carga_digip_db.load_processed("MELI_API")

    def _sufijo(base):
        pat = re.compile(rf"^{re.escape(base)}(-(\d+))?$")
        mx  = -1
        for code in processed_lotes:
            m = pat.match(str(code))
            if m:
                n  = int(m.group(2)) if m.group(2) else 0
                mx = max(mx, n)
        return f"-{mx + 1}" if mx >= 0 else ""

    def _build_obs(ids):
        n = len(ids)
        if n == 0:
            return "1"
        if n == 1:
            return ids[0]
        pfx = f"Lote {n}: "
        for dg in (None, 10, 8):
            parts = [s[-dg:] if dg else s for s in sorted(ids)]
            r = pfx + "|".join(parts)
            if len(r) <= 280:
                return r
        return (pfx + "|".join(s[-8:] for s in sorted(ids)))[:280]

    def _limpiar_dir(d):
        if pd.isna(d) or d == "":
            return ""
        r = re.sub(r"referencia:\s*", "", str(d), flags=re.IGNORECASE)
        r = re.sub(r"-\s*CP\s*\d+\s*-", "", r)
        r = re.sub(r"CP\s*\d+", "", r)
        r = r.replace("/", ",").replace("  ", " ")
        return re.sub(r"\s*,\s*", ", ", r).strip().strip(",")

    def _num_dom(d):
        m = re.search(r"\d+", str(d))
        return m.group(0) if m else "0"

    _cache        = {}
    pedidos_proc  = []
    vids_procesados = []
    lotes_t:      dict = {}
    fecha_pedido  = datetime.now().strftime("%m/%d/%Y")
    i = 0
    total = len(df)

    while i < total:
        fila = df.iloc[i]
        est  = str(fila["estado"]).lower()
        vid  = str(fila["#_de_venta"]).replace(".0", "").strip()
        if "paquete de" in est:
            try:
                cant = int("".join(filter(str.isdigit, est)))
            except Exception:
                cant = 1
            filas_prod = df.iloc[i + 1:i + 1 + cant]
            salto      = cant + 1
            if not (filas_prod["estado"].astype(str).str.lower().str.strip() == "etiqueta lista para imprimir").all():
                i += salto
                continue
        elif "etiqueta lista para imprimir" == est.strip():
            filas_prod = df.iloc[[i]]
            salto      = 1
        else:
            i += 1
            continue

        forma  = str(fila.get("forma", "")).strip()
        tipo_e = "FLEX" if forma == "Mercado Envíos Flex" else "PR" if forma == "Correo y puntos de despacho" else None
        if not tipo_e:
            i += salto
            continue
        despacho = f"MELI {tipo_e}"
        prods    = []
        uds_r    = 0

        for _, prod in filas_prod.iterrows():
            sku_o = str(prod["sku"]).strip()
            qty   = int(prod["uds"])
            info  = combos.get(sku_o, {"es_combo": False, "items": []})
            if info["es_combo"] and info["items"]:
                for it in info["items"]:
                    sc = str(it.get("Codigo", "")).strip()
                    if not _sku_ok(sc):
                        continue
                    cc = int(float(it.get("Cantidad", 0))) * qty
                    prods.append({"sku": sc, "uds": cc})
                    uds_r += cc
            else:
                prods.append({"sku": sku_o, "uds": qty})
                uds_r += qty

        if not prods:
            i += salto
            continue

        if uds_r in (1, 2):
            base = f"{prefijo}{tipo_e}{uds_r}"
            if base not in _cache:
                suf         = _sufijo(base)
                _cache[base] = base + suf
                if suf:
                    log.info("  %s ya existe → '%s'", base, _cache[base])
            cod_final = _cache[base]
            cli_cod   = "99999999999"
            cli_desc  = f"MELI {uds_r} {tipo_e}"
            ubi_cod   = "99999999999-"
            ubi_dir   = "Unistore 99999999999"
            lotes_t.setdefault(cod_final, set()).add(vid)
        else:
            cod_final = vid
            cli_cod   = str(fila.get("dni", "99999999")).strip()
            cli_desc  = str(fila.get("comprador", "")).strip()
            dom_o     = str(fila.get("dom", "")).strip()
            ubi_cod   = f"{cli_cod}-{_num_dom(dom_o)}"
            ubi_dir   = _limpiar_dir(dom_o)

        vids_procesados.append(vid)
        for p in prods:
            pedidos_proc.append({
                "PedidoFecha": fecha_pedido, "PedidoCodigo": cod_final,
                "ArticuloCodigo": p["sku"], "ArticuloDescripcion": descs.get(p["sku"], f"PROD {p['sku']}"),
                "PedidoUnidades": p["uds"], "ClienteCodigo": cli_cod, "ClienteDescripcion": cli_desc,
                "ClienteUbicacionCodigo": ubi_cod, "CodigoDespacho": despacho,
                "ClienteUbicacionDireccion": ubi_dir, "PedidoObservacion": "1", "PedidoImporte": 1,
            })
        i += salto

    if not pedidos_proc:
        log.info("MELI_API: sin pedidos válidos")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    df_final = pd.DataFrame(pedidos_proc).groupby([
        "PedidoFecha", "PedidoCodigo", "ArticuloCodigo", "ArticuloDescripcion",
        "ClienteCodigo", "ClienteDescripcion", "ClienteUbicacionCodigo",
        "CodigoDespacho", "ClienteUbicacionDireccion", "PedidoObservacion", "PedidoImporte",
    ])["PedidoUnidades"].sum().reset_index()

    for cod, ords in lotes_t.items():
        obs = _build_obs(sorted(ords))
        df_final.loc[df_final["PedidoCodigo"] == cod, "PedidoObservacion"] = obs

    res     = _procesar_df_digip(df_final, "MELI_API", dry_run, pedido_tipo=pedido_tipo)
    created = res.get("created_codes", set())

    if not dry_run and vids_procesados:
        carga_digip_db.append_processed("MELI_API_VID", vids_procesados)
        log.info("  DB: +%d venta IDs guardadas como procesadas", len(vids_procesados))

    return res


# =========================================================================
# FLUJO 4: TiendaNube Unistore → DigiPWMS  (API directa)
# =========================================================================

def _marcar_tn_uni(order_id: str, pedido_codigo: str, codigo_despacho: str) -> None:
    norm = str(codigo_despacho).replace(" VIP", "").strip()
    if norm in _TN_UNI_NO_MARCAR:
        log.info("  Omitiendo marcado TN %s (sucursal: %s)", pedido_codigo, norm)
        return
    try:
        r = requests.post(
            f"https://api.tiendanube.com/v1/{TN_UNI_STORE}/orders/{order_id}/pack",
            headers=TN_UNI_HDR, json={}, timeout=60,
        )
        if r.status_code in (200, 201):
            log.info("  TN marcado empaquetado: %s", pedido_codigo)
        else:
            log.warning("  TN mark %s: HTTP %d — %s", pedido_codigo, r.status_code, r.text[:100])
    except Exception as e:
        log.warning("  TN mark error %s: %s", pedido_codigo, e)


def run_tn_unistore(
    dry_run: bool, pedido_tipo: str = "TODOS", despachos_filter: list | None = None
) -> dict | None:
    log.info("=" * 60)
    log.info("  FLUJO TN_UNI → DigiPWMS  (TiendaNube Unistore API)")
    log.info("=" * 60)

    if not TN_UNI_TOKEN:
        log.error("TN_UNI: TN_UNI_ACCESS_TOKEN no encontrado en env")
        return None

    if pedido_tipo == "LOTE":
        log.info("TN_UNI: skip — sin lotes en Unistore TN")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    ESTADOS_PAGO_OK  = {"paid", "partially_paid", "partially_refunded"}
    ESTADOS_ENVIO_OK = {"unpacked", "partially_packed"}

    log.info("Consultando API TiendaNube Unistore...")
    all_orders, page = [], 1
    while True:
        url = (
            f"https://api.tiendanube.com/v1/{TN_UNI_STORE}/orders"
            f"?page={page}&per_page=200"
            f"&fulfillment_status=unpacked&status=open&aggregates=fulfillment_orders"
        )
        try:
            r = requests.get(url, headers=TN_UNI_HDR, timeout=60)
            if r.status_code == 404:
                break
            r.raise_for_status()
            data = r.json()
            if not data:
                break
        except Exception as e:
            log.error("TN_UNI página %d: %s", page, e)
            break

        for o in data:
            if not o.get("has_shippable_products"):
                continue
            ps           = str(o.get("payment_status", "") or "").lower()
            ss           = str(o.get("shipping_status") or o.get("fulfillment_status") or "").lower()
            ship_opt_raw = str(o.get("shipping_option", "") or "").strip()
            mapped_desp  = _MAP_DESPACHO_TN_UNI.get(ship_opt_raw.lower(), "")
            pago_ok      = ps in ESTADOS_PAGO_OK and ss in ESTADOS_ENVIO_OK
            suc_pend     = ps == "pending" and mapped_desp in {"Microcentro Retira", "Unistore Pacheco"}
            if pago_ok or suc_pend:
                all_orders.append(o)
        page += 1

    log.info("  → %d pedidos filtrados de TN Unistore", len(all_orders))
    if not all_orders:
        log.info("TN_UNI: sin pedidos válidos")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    ya_db       = carga_digip_db.load_processed("TN_UNI")
    digip_exist = _get_digip_existentes()
    new_orders  = [o for o in all_orders if str(o.get("number", "")).strip() not in ya_db | digip_exist]
    log.info("  → %d nuevos (ya_db=%d ya_digip=%d)", len(new_orders), len(ya_db), len(digip_exist))

    if not new_orders:
        log.info("TN_UNI: todos ya procesados")
        return {"total": 0, "creados": 0, "ya_existian": len(ya_db), "omitidos": 0, "errores": 0}

    rows:        list = []
    order_id_map: dict = {}
    desp_map:     dict = {}

    for o in new_orders:
        num       = str(o.get("number", "")).strip()
        order_id  = str(o.get("id", "")).strip()
        cust      = o.get("customer") or {}
        ident     = str(cust.get("identification") or "").strip() or num
        cust_name = str(cust.get("name") or "").strip() or ident
        fuls      = o.get("fulfillments") or []
        ship_opt  = str(o.get("shipping_option", "") or "").strip()

        is_pickup = any(
            str((f.get("shipping") or {}).get("type", "")).lower() == "pickup"
            for f in fuls
        ) and ship_opt not in {
            "Unistore Pacheco", "Unistore Pacheco (Solo Pago Anticipado)",
            "Unistore Microcentro", "Microcentro Unistore",
        }

        if is_pickup:
            pd_det = (o.get("shipping_pickup_details") or {}).get("address") or {}
            s_addr = str(pd_det.get("address", "") or "").strip()
            s_num  = str(pd_det.get("number", "") or "").strip()
            s_loc  = str(pd_det.get("locality", "") or "").strip()
            s_city = str(pd_det.get("city", "") or "").strip()
        else:
            ship   = o.get("shipping_address") or {}
            s_addr = str(ship.get("address", "") or "").strip()
            s_num  = str(ship.get("number", "") or "").strip()
            s_loc  = str(ship.get("locality", "") or "").strip()
            s_city = str(ship.get("city", "") or "").strip()

        direccion = " ".join(p for p in [s_addr, s_num, s_loc, s_city] if p).strip()
        if not direccion:
            direccion = f"Unistore {ident}"
        ubi_cod = f"{ident}-{s_num}".rstrip("-").strip()

        ful_name = ""
        for f in fuls:
            n = ((f.get("shipping") or {}).get("option") or {}).get("name") or ""
            if n:
                ful_name = n
                break
        carrier = str(o.get("shipping_carrier_name") or "").strip()

        def _d(raw):
            return _MAP_DESPACHO_TN_UNI.get(str(raw).lower().strip())

        cod_desp = str(
            _d(ful_name) or _d(ship_opt) or _d(carrier) or
            (ful_name or ship_opt or carrier or "Sin despacho")
        )

        try:
            subtotal = float(str(o.get("subtotal") or 0).replace(",", "."))
        except Exception:
            subtotal = 0.0
        if subtotal >= _TN_UNI_VIP_UMBRAL and not cod_desp.endswith("VIP"):
            cod_desp += " VIP"

        _RETIRA_DESPS = {"Microcentro Retira", "Unistore Pacheco"}
        base_desp = cod_desp.replace(" VIP", "")
        if despachos_filter:
            categoria = "RETIRA" if base_desp in _RETIRA_DESPS else "OTROS"
            if categoria not in despachos_filter:
                continue

        try:
            fecha_fmt = pd.to_datetime(str(o.get("created_at") or "")).strftime("%m/%d/%Y")
        except Exception:
            fecha_fmt = datetime.now().strftime("%m/%d/%Y")

        order_id_map[num] = order_id
        desp_map[num]     = cod_desp

        for prod in o.get("products", []):
            sku = str(prod.get("sku") or "").strip()
            if not sku or sku in _TN_UNI_EXCLUDED_SKUS:
                continue
            qty = int(prod.get("quantity") or 0)
            if qty <= 0:
                continue
            rows.append({
                "PedidoFecha":               fecha_fmt,
                "PedidoCodigo":              num,
                "PedidoUnidades":            qty,
                "ArticuloCodigo":            sku,
                "ArticuloDescripcion":       str(prod.get("name") or "").strip(),
                "ClienteCodigo":             ident,
                "ClienteDescripcion":        cust_name,
                "ClienteUbicacionCodigo":    ubi_cod,
                "CodigoDespacho":            cod_desp,
                "ClienteUbicacionDireccion": direccion,
                "PedidoObservacion":         "1",
                "PedidoImporte":             1.0,
            })

    if not rows:
        log.info("TN_UNI: sin ítems válidos tras filtros de SKU")
        return {"total": 0, "creados": 0, "ya_existian": 0, "omitidos": 0, "errores": 0}

    df_digip = pd.DataFrame(rows)
    log.info("TN_UNI: %d pedidos únicos, %d líneas SKU",
             df_digip["PedidoCodigo"].nunique(), len(df_digip))

    res = _procesar_df_digip(df_digip, "TN_UNI", dry_run, pedido_tipo=pedido_tipo)

    if not dry_run:
        for pedido_cod in res.get("created_codes", set()):
            oid  = order_id_map.get(str(pedido_cod))
            desp = desp_map.get(str(pedido_cod), "")
            if oid:
                _marcar_tn_uni(oid, pedido_cod, desp)
    else:
        for pedido_cod in res.get("created_codes", set()):
            log.info("  DRY: marcaría empaquetado TN pedido %s", pedido_cod)

    return res


# =========================================================================
# RUNNER PRINCIPAL
# =========================================================================

class _ListHandler(logging.Handler):
    """Captura logs en una lista para persistir en DB."""

    def __init__(self, log_list: list):
        super().__init__()
        self.log_list = log_list

    def emit(self, record):
        self.log_list.append(self.format(record))


def execute_run(params: dict, log_list: list) -> dict:
    """
    Corre todos los flujos especificados en params.
    Captura logs en log_list para que el caller los persista.
    Retorna dict {fuente: result_dict, ...}.
    """
    handler = _ListHandler(log_list)
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    svc_logger = logging.getLogger(__name__)
    svc_logger.addHandler(handler)

    fuentes      = params.get("fuentes", [])
    dry_run      = params.get("dry_run", True)
    pedido_tipo  = params.get("pedido_tipo", "TODOS")
    tipo_envio   = params.get("tipo_envio", "TODOS")
    fecha_meli   = params.get("fecha_meli")
    fecha_desde  = params.get("fecha_desde")
    tn_desps     = params.get("tn_uni_despacho")
    meli_db_modo_lote = params.get("meli_db_modo_lote", "TODOS")

    reset_digip_caches()
    resultados: dict = {}

    try:
        if "TN" in fuentes:
            try:
                resultados["TN"] = run_tn(dry_run, pedido_tipo=pedido_tipo, tipo=tipo_envio)
            except Exception as e:
                log.error("TN falló: %s\n%s", e, traceback.format_exc())
                resultados["TN"] = None

        if "TN_UNI" in fuentes:
            try:
                resultados["TN_UNI"] = run_tn_unistore(dry_run, pedido_tipo=pedido_tipo, despachos_filter=tn_desps)
            except Exception as e:
                log.error("TN_UNI falló: %s\n%s", e, traceback.format_exc())
                resultados["TN_UNI"] = None

        if "MELI_DB" in fuentes:
            try:
                resultados["MELI_DB"] = run_meli_db(
                    dry_run,
                    tipo=tipo_envio,
                    pedido_tipo=pedido_tipo,
                    fecha_desde=fecha_desde,
                    modo_lote=meli_db_modo_lote,
                )
            except Exception as e:
                log.error("MELI_DB falló: %s\n%s", e, traceback.format_exc())
                resultados["MELI_DB"] = None

        if "MELI_API" in fuentes:
            try:
                resultados["MELI_API"] = run_meli_api(dry_run, tipo=tipo_envio, fecha=fecha_meli, pedido_tipo=pedido_tipo)
            except Exception as e:
                log.error("MELI_API falló: %s\n%s", e, traceback.format_exc())
                resultados["MELI_API"] = None
    finally:
        svc_logger.removeHandler(handler)

    return resultados
