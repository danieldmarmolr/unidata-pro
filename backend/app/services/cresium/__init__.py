"""Motor de payouts Cresium — port nativo del modulo cresium de Unidrop-Back.

Cresium es el PSP que ejecuta transferencias CBU/CVU (reembolsos) a los
dropshippers. Este paquete porta el motor de Unidrop-Back (NestJS) al stack
UNIDATA (FastAPI + psycopg2 sobre la app DB).

Postura de seguridad (identica a Unidrop): el master switch
FEATURE_CRESIUM_REFUNDS_ENABLED arranca en false. Con el flag apagado se puede
armar lotes y previsualizar, pero NINGUN call sale a Cresium — no se mueve plata.
"""
