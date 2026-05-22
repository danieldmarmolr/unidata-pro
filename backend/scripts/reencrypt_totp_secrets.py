"""
Re-cifra todos los secrets TOTP existentes que estan en plaintext.

Uso (correr UNA SOLA VEZ despues de setear TOTP_CIPHER_KEY en Railway):

    # Desde local con railway CLI logueado:
    railway run --service backend python backend/scripts/reencrypt_totp_secrets.py --yes

    # O desde una sesion interactiva (preguntara confirmacion):
    cd backend
    python scripts/reencrypt_totp_secrets.py

Genera la key con:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
y agregala a Railway como TOTP_CIPHER_KEY.

El script es idempotente: si un secret ya esta cifrado, lo detecta y skipea.
"""
from __future__ import annotations

import os
import sys

# Permite correr el script desde backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re

from app.auth import totp_cipher
from app.db.local_persistence import get_conn

_TOTP_PLAINTEXT_PATTERN = re.compile(r"^[A-Z2-7]{16,64}={0,6}$")


def main() -> int:
    if not os.environ.get("TOTP_CIPHER_KEY"):
        print("ERROR: TOTP_CIPHER_KEY no esta seteada. Abortando.")
        print("Generar con: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"")
        return 1

    cipher = totp_cipher._get_cipher()
    if cipher is None:
        print("ERROR: TOTP_CIPHER_KEY invalida.")
        return 1

    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT id, email, totp_secret FROM users WHERE totp_secret IS NOT NULL")
        rows = cur.fetchall()

    print(f"Encontrados {len(rows)} usuarios con TOTP secret.")
    plain = [r for r in rows if r["totp_secret"] and _TOTP_PLAINTEXT_PATTERN.match(r["totp_secret"])]
    already_encrypted = len(rows) - len(plain)
    print(f"  - {already_encrypted} ya cifrados (skip)")
    print(f"  - {len(plain)} en plaintext (re-cifrar)")

    if not plain:
        print("Nada que hacer.")
        return 0

    auto_confirm = "--yes" in sys.argv or os.environ.get("REENCRYPT_CONFIRM") == "yes"
    if not auto_confirm:
        try:
            confirm = input("Confirmar re-cifrado? [y/N]: ").strip().lower()
        except EOFError:
            print("Stdin no es interactivo. Re-correr con --yes para confirmar sin prompt.")
            return 0
        if confirm != "y":
            print("Abortado.")
            return 0

    n_ok = 0
    n_fail = 0
    for r in plain:
        try:
            new_value = totp_cipher.encrypt(r["totp_secret"])
            with get_conn() as c, c.cursor() as cur:
                cur.execute(
                    "UPDATE users SET totp_secret = %s, updated_at = NOW() WHERE id = %s",
                    (new_value, r["id"]),
                )
            n_ok += 1
            print(f"  OK  user_id={r['id']} ({r['email']})")
        except Exception as e:
            n_fail += 1
            print(f"  ERR user_id={r['id']} ({r['email']}): {e}")

    print(f"\nDone: {n_ok} OK, {n_fail} fallos.")
    return 0 if n_fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
