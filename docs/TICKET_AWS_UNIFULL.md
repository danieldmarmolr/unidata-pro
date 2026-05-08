# Ticket Jira — Habilitar acceso de Unifull (crm-kommo-sync) a BBDD productivas

> Solicitud paralela a la de UNIDATA. Misma IP estatica (Railway shared IP en
> us-west2). Si AWS-01 (UNIDATA) ya esta resuelto, este queda automaticamente
> cubierto y solo falta el read-only DB user.

---

## Project / Tipo

- **Project:** Infra / DevOps
- **Issue Type:** Task
- **Priority:** Medium
- **Componente:** AWS / Networking + Database
- **Etiquetas:** `unifull`, `kommo`, `railway`, `bastion`, `read-only-user`

---

## Title

`[Unifull] Acceso de proyecto crm-kommo-sync a BBDD productivas via Railway`

---

## Solicitante

- **Reporter:** Daniel Marmol (`daniel.marmol@unistore.ar`) — coordinando por unifull
- **Assignee:** Mauro Candia
- **Watchers:** Equipo Unifull, IT

---

## Contexto

El equipo de **Unifull** esta desarrollando el proyecto `crm-kommo-sync` (Railway)
que necesita leer datos productivos del grupo Unistore para alimentar la
integracion con Kommo CRM.

Es el mismo patron que ya usamos para UNIDATA: backend en Railway -> SSH
tunnel a bastion -> RDS Postgres privada en VPC AWS.

---

## Lo que se pide

### 1. Allowlist de IP (probablemente ya cubierto por AWS-01 / UNIDATA)

La IP estatica de salida de Railway de `crm-kommo-sync` es:

```
IP: 162.220.232.99
Region: us-west-2
Tipo: Shared (Railway Pro plan)
```

**Importante:** esta es **la misma IP que UNIDATA** porque las Static
Outbound IPs de Railway son compartidas dentro de la misma region. Si
ya allowlisteaste UNIDATA en los SG, Unifull queda cubierto **sin cambios
adicionales**.

Si no esta hecho, alcanza con UNA sola regla:

| Campo | Valor |
|---|---|
| Type | SSH |
| Protocol | TCP |
| Port range | 22 |
| Source | `162.220.232.99/32` |
| Description | `Railway shared IP - UNIDATA + Unifull (crm-kommo-sync)` |

Aplicada en SG de los 2 bastions:
- Bastion Unistore: `3.139.209.227` (us-east-2)
- Bastion Unidrop: `18.191.119.38` (us-east-2)

### 2. Connection string **read-only** dedicada para Unifull

Esto si es un pedido nuevo y separado del de UNIDATA.

Se necesita un user PostgreSQL **read-only** dedicado para `crm-kommo-sync`,
con permisos solo de `SELECT` sobre las tablas que su integracion necesita
leer (a coordinar con el dev de Unifull cuales son).

```sql
-- Ejemplo del comando que esperamos correr en la RDS:
CREATE USER unifull_readonly WITH PASSWORD '<generar password fuerte>';
GRANT CONNECT ON DATABASE unistore_api TO unifull_readonly;
GRANT USAGE ON SCHEMA public TO unifull_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO unifull_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO unifull_readonly;
```

Output esperado del ticket: connection string formato

```
postgresql://unifull_readonly:<password>@<rds-endpoint>:5432/unistore_api?sslmode=require
```

Mauro la pasa por canal seguro a Daniel, Daniel la entrega al equipo de
Unifull, ellos la guardan como env var en Railway.

---

## Que NO se toca

- BBDD de produccion de Unistore.com / Unidrop.com / paneles internos
- Llaves SSH de los bastions (Unifull las recibe aparte si las necesita)
- Configuracion del bastion EC2
- Recursos productivos del grupo

---

## Criterios de aceptacion

- [ ] Confirmacion de que `162.220.232.99/32` esta allowlistada en los 2 bastions (puede ser que ya este por AWS-01)
- [ ] User `unifull_readonly` creado en RDS Unistore con permisos solo SELECT
- [ ] Connection string entregada a Daniel por canal seguro (Vault / 1Password / DM cifrado)
- [ ] Daniel valida acceso desde Railway (`crm-kommo-sync` se conecta y devuelve datos)

---

## Plan de rollback

- Eliminar regla SG (si fue agregada solo por este ticket): ~30 segundos.
- Revocar user PostgreSQL: `DROP USER unifull_readonly;` ~1 minuto.

Sin impacto en produccion ni en UNIDATA.

---

## Notas de seguridad

1. **User dedicado read-only** = mejor postura que reusar el user de prod.
2. **`/32` source** evita exponer SSH a internet entera.
3. **Sin acceso a UNIDATA**: Unifull no necesita y no recibe acceso a la
   Postgres propia de UNIDATA en Supabase. Solo lee de las RDS de Unistore.
4. **Si Unifull deja Unistore o cambia de dueño:** revocar user + rotar
   password del user. La IP de Railway no es problema porque es shared.

---

## Tiempo estimado

- **Si AWS-01 ya hecho:** solo crear user + entregar connection string -> **5-10 min**.
- **Si AWS-01 no hecho:** + agregar regla SG -> **10-15 min total**.

---

## FAQ

**Q: Por que la misma IP que UNIDATA?**
A: Railway asigna Static Outbound IPs en pool compartido por region (us-west-2).
Cualquier proyecto del grupo en esa region usa la misma IP. Esto es por diseno
de Railway en plan Pro y no implica problema de seguridad — la regla de SG sigue
siendo `/32`, y el control de acceso real esta en SSH key + DB user.

**Q: Por que Unifull necesita esto si UNIDATA ya lee la data?**
A: Son sistemas distintos con proposito distinto. UNIDATA es la plataforma
de visualizacion / analitica para personas. Unifull crm-kommo-sync es una
integracion automatizada que sincroniza datos con Kommo CRM. Cada uno tiene
sus credenciales, sus permisos especificos, y su audit log separado.

**Q: Por que read-only en vez de reusar el user existente?**
A: Principio de menor privilegio. El user de Unistore prod (que UNIDATA usa
hoy temporalmente, ver AWS-02) tiene write access. Para una integracion
externa como Unifull, conviene aislar y limitar.

**Q: La IP cambia si Unifull migra de cuenta Railway o region?**
A: Si — si Unifull cambia de region o sale de Railway Pro, la IP cambia
y hay que reabrir ticket. Mientras se mantenga `crm-kommo-sync` en Railway
Pro / us-west-2, la IP es estable.
