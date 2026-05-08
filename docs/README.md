# UNIDATA — Documentacion

Indice del repositorio de documentacion. Organizado por proposito.

---

## 📘 Para entender el producto

| Archivo | Para que sirve |
|---|---|
| **[CHANGELOG.md](./CHANGELOG.md)** | Historia versionada de cambios. v1.0.0-mvp es la primera release. |
| **[PLAN_JIRA.md](./PLAN_JIRA.md)** | Epic UNIDATA + 16 User Stories + 70+ tasks tecnicas. Listo para que un agente Jira lo cree. |
| **[launch/README.md](./launch/README.md)** | Paquete de lanzamiento: invitacion, overview narrativo (NotebookLM-ready) y lista honesta de features V1. |

## 🛠 Para operar el sistema

| Archivo | Para que sirve |
|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Como funciona UNIDATA tecnicamente. Stack, flujos, env vars, seguridad. |
| **[OPERATIONS.md](./OPERATIONS.md)** | Runbook day-2: troubleshooting, deploys, rollback, mantenimiento mensual. |
| **[DEPLOY.md](./DEPLOY.md)** | Guia paso a paso del deploy original a Railway. Mas extensa que OPERATIONS. |
| **[DEPLOY_legacy.md](./DEPLOY_legacy.md)** | Version anterior del deploy guide. Conservada por referencia. |

## 🔐 Para coordinar con AWS / IT

| Archivo | Para que sirve |
|---|---|
| **[TICKET_AWS_BASTION.md](./TICKET_AWS_BASTION.md)** | Ticket Jira listo para mandar al data engineer (Mauro). Pide allowlistar la IP estatica de Railway en los SG de los bastions. |
| **[GUIA_UNIFULL_AWS_RAILWAY.md](./GUIA_UNIFULL_AWS_RAILWAY.md)** | Guia para que el equipo de Unifull (proyecto paralelo) consiga la misma habilitacion. |

---

## Ruta sugerida segun rol

### Si sos un nuevo dev del equipo
1. README raiz del repo
2. `ARCHITECTURE.md` (entender el sistema)
3. `OPERATIONS.md` (saber donde tocar cuando algo falla)
4. `CHANGELOG.md` (ver que se hizo recientemente)
5. `PLAN_JIRA.md` (que se viene)

### Si sos un usuario nuevo
1. `launch/UNIDATA_OVERVIEW.md` (que es y como se usa)
2. `launch/FEATURES_V1.md` (que puede hacer hoy)
3. URL de registro: https://frontend-production-7d1c.up.railway.app/register

### Si sos del equipo de IT
1. `TICKET_AWS_BASTION.md` (lo que se pide a AWS)
2. `ARCHITECTURE.md` seccion "Persistencia de negocio"

### Si sos del area de Marketing/Comms
1. `launch/UNIDATA_OVERVIEW.md` (alimentar NotebookLM)
2. `launch/INVITATION.md` (templates listos)
3. `launch/README.md` (paso a paso de como lanzar)

---

## Convenciones

- Los docs operativos viven en este folder (`docs/`).
- Los archivos sensibles con secretos (env vars, llaves, credenciales) viven en `.deploy/` que esta **gitignored**.
- El `README.md` raiz apunta aca como entrada principal.
- Markdown plano (sin componentes interactivos) para que sea agnostico de plataforma — funciona en GitHub, en NotebookLM, en cualquier viewer.
