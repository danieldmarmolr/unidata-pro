# Ticket Jira — Habilitar acceso de UNIDATA (Railway) a bastions de AWS

> Ticket único y autocontenido para que el data engineer haga **un solo cambio** y UNIDATA quede en producción sin más fricción.

---

## Project / Tipo
- **Project:** Infra / DevOps
- **Issue Type:** Task
- **Priority:** Medium-High
- **Componente:** AWS / Networking / Security Groups
- **Etiquetas:** `unidata`, `bastion`, `security-group`, `production`, `railway`

---

## Title (Summary)

`[UNIDATA] Allowlistar IP estatica de Railway en SG de bastions Unistore + Unidrop`

---

## Contexto

Estamos lanzando **UNIDATA** — plataforma interna de analitica del grupo Unistore (FastAPI + Next.js, deployada en Railway).

El backend necesita conectarse a las 3 BBDD productivas (`unistore_api`, `unidrop`, `unidev`) **a traves de los bastions SSH ya existentes** (mismo path que cuando un dev se conecta con DBeaver). No estamos pidiendo:
- Hacer las RDS publicas
- Cambiar passwords
- Tocar las BBDD
- Crear users nuevos

Solo necesitamos que **una IP fija** (la de salida de Railway) este allowlistada en los Security Groups de los 2 bastions.

Este patron es el mismo que ya se uso para otros productos del grupo desplegados en Railway.

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

## Que se pide

Agregar **una sola regla de inbound** (SSH/22/TCP) en cada uno de los 2 Security Groups de los bastions, con la IP estatica de Railway como source.

### IP a allowlistar

```
162.220.232.99/32
```

> Esta IP esta asignada a UNIDATA backend en Railway via la feature **Static Outbound IPs** (plan Pro). No cambia salvo que el servicio se elimine y se recree.

### Regla concreta (en cada SG)

| Campo | Valor |
|---|---|
| Type | SSH |
| Protocol | TCP |
| Port range | 22 |
| Source | `162.220.232.99/32` |
| Description | `Railway UNIDATA backend - Daniel Marmol` |

---

## Que NO se toca

- RDS Postgres (siguen privadas dentro de la VPC)
- Users/passwords de Postgres
- Llaves SSH de los bastions
- Cualquier recurso productivo de Unistore.com / Unidrop.com / paneles internos
- Costos / billing de la cuenta AWS

---

## Pasos detallados (para el data engineer)

1. Login en https://console.aws.amazon.com -> cuenta AWS de Unistore -> region **us-east-2 (Ohio)**.
2. **EC2** -> **Instances** -> filtrar por IP publica `3.139.209.227`.
3. Click en la instancia -> tab **Security** -> click al Security Group asociado.
4. Tab **Inbound rules** -> **Edit inbound rules** -> **Add rule**:
   - Type: `SSH`
   - Source: `Custom` -> `162.220.232.99/32`
   - Description: `Railway UNIDATA backend - Daniel Marmol`
5. **Save rules**. Anotar el ID de la regla creada (`sgr-xxxxxx`).
6. Repetir 2-5 para la instancia con IP `18.191.119.38`.
7. Comentar en el ticket con los IDs de las reglas.
8. Avisar a Daniel para validacion end-to-end.

---

## Verificacion (la hace Daniel desde Railway)

1. Backend Railway: `https://backend-production-c1ee.up.railway.app/api/health` -> debe seguir devolviendo `{"status":"ok"}`.
2. Login: `daniel.marmol@unistor.ar` / `unidata2026.` -> emite JWT.
3. `GET /api/sources/unistore/schemas` con el JWT -> deberia devolver lista de schemas reales (no timeout). **Esto es el smoke test que confirma que el bastion deja pasar.**
4. Frontend `https://frontend-production-7d1c.up.railway.app/` -> dashboard con datos de hoy (no ceros).

---

## Criterios de aceptacion

- [ ] Regla agregada en SG del bastion Unistore (`3.139.209.227`)
- [ ] Regla agregada en SG del bastion Unidrop (`18.191.119.38`)
- [ ] Smoke test desde Railway pasa (`/api/sources/unistore/schemas` devuelve datos)
- [ ] Comentario en el ticket con los IDs de las 2 reglas

---

## Plan de rollback

Eliminar las 2 reglas. Sin impacto en producciones existentes — solo deja a UNIDATA sin acceso a las BBDD hasta que se reaplique.

---

## Notas de seguridad

1. **Source `/32` (single host)**, NO `0.0.0.0/0`. Solo Railway puede entrar.
2. La conexion sigue requiriendo la **llave privada** `.pem` del bastion para autenticarse. El SG es el primer filtro, no el unico.
3. La IP de Railway esta fijada via su feature **Static Outbound IP** (paga). No deberia cambiar nunca. Si en el futuro Daniel migra la cuenta o cambia el plan, mandara nuevo ticket.
4. **Mejora futura (no para este ticket):** crear un user PostgreSQL **read-only** dedicado para UNIDATA en cada DB. Hoy estamos usando los users de produccion existentes, lo que es subóptimo. Daniel armara ticket aparte cuando este lo cierre.

---

## Tiempo estimado

- Ejecucion del data engineer: **5-10 min**
- Validacion end-to-end con Daniel: **5 min**

---

## Asignacion

- **Reporter:** Daniel Marmol (`daniel.marmol@unistor.ar`)
- **Assignee:** Mauro Candia / Data Engineer con acceso AWS Console de Unistore
- **Watchers:** Equipo Producto / Gerencia (opcional)

---

## FAQ del ticket (preguntas que el data engineer puede tener)

**Q: Esto es lo mismo que se hizo para [otro producto en Railway]?**
A: Si, es el mismo patron exacto. UNIDATA no introduce nada nuevo de seguridad respecto al precedente.

**Q: La IP de Railway puede cambiar?**
A: No. Daniel activa **Static Outbound IP** (paga, ~USD 5/mes) en Railway que garantiza que la IP queda fija. Si por alguna razon Railway la rota, Daniel abre nuevo ticket — pero no se espera que pase.

**Q: Por que no hacer la RDS publica con whitelist directo?**
A: Porque exponer Postgres directo a internet (aun con whitelist) es peor postura de seguridad que mantener el bastion SSH como gate. El bastion ya existe, ya esta endurecido, y este es su uso natural.

**Q: Necesitan acceso al bastion como root?**
A: No. Solo SSH al user `ec2-user` con la llave que Daniel ya tiene. Mismo flujo que un dev abriendo DBeaver.

**Q: Esto requiere cambios en los .pem o llaves?**
A: No. Cero cambios en llaves, cero cambios en passwords, cero cambios en RDS.
