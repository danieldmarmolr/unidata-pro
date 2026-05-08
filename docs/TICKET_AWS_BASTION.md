# Ticket Jira — Habilitar acceso de UNIDATA + Unifull (Railway) a bastions de AWS

> Ticket consolidado: **un solo cambio en AWS** que habilita los **dos
> proyectos del grupo en Railway** (UNIDATA y Unifull `crm-kommo-sync`).
> Se aprovecha que ambos comparten la misma IP estatica de salida.

---

## Project / Tipo

- **Project:** Infra / DevOps
- **Issue Type:** Task
- **Priority:** Medium-High
- **Componente:** AWS / Networking / Security Groups + Database
- **Etiquetas:** `unidata`, `unifull`, `kommo`, `bastion`, `security-group`, `production`, `railway`

---

## Title (Summary)

`[UNIDATA + Unifull] Allowlistar IP estatica de Railway en SG de bastions + crear read-only user para Unifull`

---

## Contexto

Estamos lanzando dos proyectos del grupo en Railway que necesitan acceder a
las BBDD productivas a traves de los bastions SSH ya existentes. **Son dos
workspaces de Railway independientes**, gestionados por equipos distintos:

1. **UNIDATA** (Daniel Marmol) — plataforma de analitica interna del grupo Unistore (FastAPI + Next.js).
   Lee datos productivos para dashboards, drilldowns y editor SQL libre.
   Workspace Railway propio.

2. **Unifull `crm-kommo-sync`** (equipo Unifull) — integracion automatizada que
   sincroniza datos del grupo con Kommo CRM. Read-only.
   Workspace Railway propio (separado del de UNIDATA).

**Importante:** ambos equipos confirmaron sus IPs estaticas y, por
arquitectura del pool **shared** de Railway en region `us-west-2`, ambos
proyectos salen por la **misma IP**:

```
IP confirmada UNIDATA:  162.220.232.99/32 (Daniel Marmol)
IP confirmada Unifull:  162.220.232.99/32 (equipo Unifull)
```

Esto es porque Railway en plan Pro asigna las Static Outbound IPs desde un
pool compartido por region — multiples workspaces pueden recibir la misma IP.
Para nuestros proyectos esto **simplifica el ticket**: una sola regla en cada
SG cubre los dos proyectos sin ambiguedad.

No estamos pidiendo:
- Hacer las RDS publicas
- Cambiar passwords de prod
- Tocar las BBDD existentes
- Crear users nuevos en sistemas externos

---

## Recursos involucrados

### Bastion 1 — Unistore (sirve tambien para Unidev, misma instancia EC2)

- **IP publica:** `3.139.209.227`
- **Region:** `us-east-2` (Ohio)
- **RDS detras:** `unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com`
- **DBs accedidas:** `unistore_api`, `unidev`

### Bastion 2 — Unidrop

- **IP publica:** `18.191.119.38`
- **Region:** `us-east-2` (Ohio)
- **RDS detras:** `unidrop-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com`
- **DB accedida:** `unidrop`

---

## Que se pide — 2 cambios

### Parte 1: Allowlist de IP (una regla cubre ambos proyectos)

Agregar **una regla de inbound** (SSH/22/TCP) en cada uno de los 2 SG de los
bastions, con la IP estatica de Railway como source. Cubre tanto UNIDATA
como Unifull (confirmado por ambos equipos que comparten la misma IP).

#### IP a allowlistar

```
162.220.232.99/32
```

#### Regla concreta (en cada SG)

| Campo | Valor |
|---|---|
| Type | SSH |
| Protocol | TCP |
| Port range | 22 |
| Source | `162.220.232.99/32` |
| Description | `Railway us-west-2 - UNIDATA + Unifull (crm-kommo-sync)` |

### Parte 2: User PostgreSQL read-only para Unifull

Esto es exclusivo de Unifull (UNIDATA usa users distintos por ahora).

Crear un user dedicado **read-only** en RDS Unistore (donde viven `unistore_api`
y `unidev`) con permisos solo `SELECT` sobre las tablas que la integracion
Kommo necesita (a coordinar con dev de Unifull cuales son).

#### Comando esperado

```sql
-- Generar password fuerte y guardarla en vault del grupo
CREATE USER unifull_readonly WITH PASSWORD '<PASSWORD>';

GRANT CONNECT ON DATABASE unistore_api TO unifull_readonly;
GRANT USAGE ON SCHEMA public TO unifull_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO unifull_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO unifull_readonly;

-- Si Kommo necesita data de Unidrop tambien, repetir en su RDS:
-- (a confirmar con equipo Unifull antes de aplicar)
```

#### Output esperado

Connection string formato:

```
postgresql://unifull_readonly:<password>@<rds-endpoint>:5432/unistore_api?sslmode=require
```

Mauro la entrega a Daniel por canal seguro (Vault / 1Password / DM cifrado).
Daniel se la pasa al equipo de Unifull para que la guarden como env var en
Railway.

---

## Que NO se toca

- BBDD de produccion de Unistore.com / Unidrop.com / paneles internos
- Llaves SSH de los bastions (los devs ya las tienen)
- Configuracion del bastion EC2 mas alla del SG
- Recursos productivos de los e-commerces
- Costos / billing de la cuenta AWS
- Users de UNIDATA (siguen usando los users de prod existentes hasta que
  hagamos AWS-02 / read-only dedicado para UNIDATA en otro ticket)

---

## Pasos detallados (para el data engineer)

### Para Parte 1 (allowlist) — ~5-10 min

1. Login en https://console.aws.amazon.com -> cuenta AWS de Unistore -> region **us-east-2 (Ohio)**.
2. **EC2** -> **Instances** -> filtrar por IP publica `3.139.209.227` (bastion Unistore).
3. Click en la instancia -> tab **Security** -> click al Security Group asociado.
4. Tab **Inbound rules** -> **Edit inbound rules** -> **Add rule**:
   - Type: `SSH`
   - Source: `Custom` -> `162.220.232.99/32`
   - Description: `Railway us-west-2 - UNIDATA + Unifull (crm-kommo-sync)`
5. **Save rules**. Anotar el ID (`sgr-xxxxxx`).
6. Repetir 2-5 para la instancia con IP `18.191.119.38` (bastion Unidrop).

### Para Parte 2 (user read-only Unifull) — ~3-5 min

7. Conectar a la RDS Unistore como superuser.
8. Generar password fuerte (ej `openssl rand -base64 24`).
9. Correr el bloque SQL del `CREATE USER` arriba.
10. Validar:
    ```sql
    \du unifull_readonly
    -- Debe aparecer SIN atributos de Superuser, Createrole, etc.
    ```
11. Build de la connection string final con la password.
12. Entregar a Daniel por canal seguro.

### Final

13. Comentar en el ticket con: IDs de las 2 reglas SG creadas + confirmacion
    de creacion de user.
14. Avisar a Daniel para validacion end-to-end.

---

## Verificacion

### Smoke test UNIDATA (lo hace Daniel desde Railway)

1. `GET https://backend-production-c1ee.up.railway.app/api/health` -> `{"status":"ok"}`.
2. Login con admin -> JWT emitido.
3. `GET /api/sources/unistore/schemas` con JWT -> deberia devolver lista de
   schemas reales (no timeout). **Smoke test que confirma que el bastion deja pasar.**
4. Frontend muestra dashboards con datos reales (no ceros).

### Smoke test Unifull (lo hace equipo Unifull)

1. Setear `DATABASE_URL` con la connection string nueva en Railway crm-kommo-sync.
2. Conectar y correr `SELECT current_user, current_database();` -> debe devolver
   `unifull_readonly`.
3. Intentar un `INSERT INTO ...` -> debe **fallar con permission denied** (confirma read-only).
4. Probar query real de la integracion Kommo -> debe devolver datos.

---

## Criterios de aceptacion

- [ ] Regla SG (`162.220.232.99/32`) agregada en bastion Unistore (`3.139.209.227`) — cubre UNIDATA + Unifull
- [ ] Regla SG (`162.220.232.99/32`) agregada en bastion Unidrop (`18.191.119.38`) — cubre UNIDATA + Unifull
- [ ] User `unifull_readonly` creado en RDS Unistore (y opcional Unidrop si Kommo lo necesita)
- [ ] Connection string entregada a Daniel por canal seguro
- [ ] Smoke test UNIDATA pasa: `/api/sources/unistore/schemas` devuelve datos
- [ ] Smoke test Unifull pasa: `unifull_readonly` puede SELECT pero no INSERT
- [ ] Comentario en el ticket con los IDs de las reglas + confirmacion del user

---

## Plan de rollback

| Cambio | Rollback |
|---|---|
| Regla SG | Eliminar la regla del SG. ~30 segundos. |
| User PostgreSQL | `REVOKE` permisos + `DROP USER unifull_readonly;`. ~1 min. |

Sin impacto en UNIDATA ni en Unifull pre-existente — solo deja a los proyectos
sin acceso temporalmente hasta reaplicar.

---

## Notas de seguridad

1. **Source `/32` (single host), NO `0.0.0.0/0`.** Solo Railway puede entrar
   por SSH al bastion.

2. **La conexion SSH sigue requiriendo la llave privada `.pem`** del bastion
   para autenticarse. El SG es el primer filtro, no el unico.

3. **IP shared es estable mientras los proyectos sigan en Railway Pro / us-west-2.**
   Si cambian de plan o migran de region, hay que reabrir ticket.

4. **Mejora futura (no para este ticket):** UNIDATA hoy usa los users de prod
   (`unistore`, `unidrop`). Crear users read-only dedicados para UNIDATA tambien
   es buena practica — esta planificado como AWS-02 en `docs/PLAN_JIRA.md`.

5. **Aislamiento entre proyectos:** UNIDATA y Unifull son sistemas distintos
   con users distintos en la DB. Cada uno tiene su audit log separado. No
   comparten data ni credentials a nivel de aplicacion — solo comparten la
   IP de salida (que es shared por arquitectura de Railway).

6. **Habeas Data:** ambos proyectos solo procesan datos del grupo Unistore.
   No transmiten data a terceros sin proceso interno acordado.

---

## Tiempo estimado total

- Parte 1 (allowlist 1 regla en cada SG, total 2 reglas): **5-10 min**
- Parte 2 (user read-only + entrega connection string): **3-5 min**
- Total: **~10-15 min**

---

## Asignacion

- **Reporter:** Daniel Marmol (`daniel.marmol@unistore.ar`) — coordinando ambos proyectos
- **Assignee:** Mauro Candia / Data Engineer con acceso AWS Console de Unistore
- **Watchers:** Equipo Unifull, Equipo Producto, Gerencia (opcional)

---

## FAQ del ticket

**Q: Por que dos reglas si quizas las IPs coinciden?**
A: UNIDATA y Unifull corren en **dos workspaces independientes de Railway**
(equipos distintos, billing distinto). Cada workspace tiene su propia IP
estatica de salida en plan Pro. Aunque por arquitectura del pool shared en
us-west-2 las IPs pueden coincidir, no hay garantia ni contrato — Railway
podria asignar distintas IPs en cualquier momento. Por eso pedimos las dos
reglas, asi el ticket no depende de coincidencias.

**Q: Que pasa si manana sumamos un tercer proyecto del grupo en Railway?**
A: Si tiene workspace propio, hay que pedir su IP estatica y allowlistearla
con su propia regla. Esa es la operatoria estandar.

**Q: Por que no usar el mismo user para los dos proyectos?**
A: Principio de menor privilegio + auditoria limpia. Si Unifull genera trafico
sospechoso, podemos rastrearlo a su user; idem UNIDATA. Mezclar users hace
imposible distinguir quien hizo que.

**Q: Por que UNIDATA no pide tambien user read-only en este ticket?**
A: UNIDATA hoy ya esta funcionando con los users de prod existentes (lo
heredamos asi). Mejorarlo a read-only dedicado esta planificado en otro ticket
(AWS-02). Lo separamos para no agrandar este ticket. Ese si es discusion
mas larga porque hay que listar todas las tablas que UNIDATA consulta.

**Q: La regla SG sigue funcionando si la IP cambia?**
A: Si Railway cambia la IP shared (cosa rara pero posible si reorganizan su
infra), la regla con `162.220.232.99/32` deja de funcionar y los dos proyectos
caen al mismo tiempo. Daniel se entera por monitoreo y abre ticket
de actualizacion. En ~3 anos de uso de Railway por la comunidad, este tipo
de cambios es excepcional.
