"""
Cifrado simetrico (Fernet/AES-128-CBC + HMAC-SHA256) para secrets TOTP en DB.

Antes los secrets se guardaban en plaintext en users.totp_secret. Si la DB
se filtraba, 2FA era inutil porque el atacante podia generar OTPs validos.

Ahora se guardan cifrados con la key Fernet de la env var TOTP_CIPHER_KEY.

Migracion: get_totp_secret() detecta secrets en plaintext (look-like base32)
y los devuelve as-is. La proxima vez que el user reactive su 2FA, queda
cifrado. Para forzar la migracion, hay un management script que recifra
todos los secrets existentes.

Generar una key nueva:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import logging
import os
import re

log = logging.getLogger("unidata.totp_cipher")

# Regex para detectar plaintext TOTP secrets (base32 RFC 4648, longitud
# tipica 16, 26 o 32 chars). Fernet tokens empiezan con 'gAAAAAB' y son
# mas largos, no chocan con esto.
_TOTP_PLAINTEXT_PATTERN = re.compile(r"^[A-Z2-7]{16,64}={0,6}$")

_CIPHER = None


def _get_cipher():
    """Lazy-load. Si la env var no esta seteada, devuelve None y todo se
    comporta como antes (plaintext). Esto permite deployear el cambio antes
    de setear la env var sin romper a nadie."""
    global _CIPHER
    if _CIPHER is not None:
        return _CIPHER
    key = os.environ.get("TOTP_CIPHER_KEY", "").strip()
    if not key:
        log.warning(
            "TOTP_CIPHER_KEY no esta seteada. Los secrets TOTP se guardaran en "
            "PLAINTEXT. Generar con: python -c \"from cryptography.fernet import "
            "Fernet; print(Fernet.generate_key().decode())\" y agregar a Railway env."
        )
        return None
    try:
        from cryptography.fernet import Fernet
        _CIPHER = Fernet(key.encode())
        return _CIPHER
    except Exception as e:
        log.error("TOTP_CIPHER_KEY invalida (debe ser 32-byte url-safe base64): %s", e)
        return None


def encrypt(secret: str) -> str:
    """Cifra un secret TOTP. Si no hay cipher configurado, devuelve plaintext."""
    cipher = _get_cipher()
    if cipher is None:
        return secret
    return cipher.encrypt(secret.encode()).decode()


def decrypt(value: str | None) -> str | None:
    """Descifra un valor de DB. Si el valor parece plaintext (legacy), lo
    devuelve as-is. Si esta cifrado, lo descifra. Si falla, devuelve None."""
    if not value:
        return None
    cipher = _get_cipher()
    # Migracion graciosa: si parece base32 plaintext, lo devolvemos como esta.
    # La proxima vez que el user toque 2FA queda cifrado.
    if _TOTP_PLAINTEXT_PATTERN.match(value):
        return value
    if cipher is None:
        # Era cifrado pero no tenemos key -> no podemos leer. Esto solo pasa
        # si alguien quito la env var post-cifrado. Loggeamos y devolvemos None.
        log.error("Secret TOTP cifrado pero TOTP_CIPHER_KEY no esta seteada")
        return None
    try:
        return cipher.decrypt(value.encode()).decode()
    except Exception as e:
        log.error("decrypt fallo (key cambio o data corrupta): %s", e)
        return None
