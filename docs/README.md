# UNIDATA — Documentacion

Indice de los docs operativos y de deploy.

## Deploy y operacion

- **[DEPLOY.md](./DEPLOY.md)** — Guia completa de deploy a Railway (paso a paso, env vars, volumenes, troubleshooting).
- **[DEPLOY_legacy.md](./DEPLOY_legacy.md)** — Version anterior del deploy guide. Conservada por referencia historica.

## AWS / Bastions / Networking

- **[TICKET_AWS_BASTION.md](./TICKET_AWS_BASTION.md)** — Ticket de Jira listo para mandar al data engineer (Mauro). Pide allowlistar la IP estatica de Railway (`162.220.232.99`) en los SG de los 2 bastions (Unistore + Unidrop). Cuando esta regla este aplicada, UNIDATA queda en produccion real.

- **[GUIA_UNIFULL_AWS_RAILWAY.md](./GUIA_UNIFULL_AWS_RAILWAY.md)** — Guia para que el equipo de **Unifull** (proyecto paralelo en Railway) consiga la misma habilitacion. Responde el doc generico que les pasaron con la info concreta de Unistore (engine, endpoints, bastions, DB names, etc).

## Convenciones

- Los docs operativos viven en este folder (`docs/`).
- Los archivos sensibles con secretos (env vars, llaves, credenciales) viven en `.deploy/` que esta **gitignored**.
- El `README.md` raiz apunta aca para el deploy.
