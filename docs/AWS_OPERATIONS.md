# AWS Operations Guide — UNIDATA

**Propósito:** runbook para operar UNIDATA en AWS sin Mauro. Guía día a día para Daniel.

---

## TL;DR — lo que cambia vs Railway

| Necesidad | Railway hoy | AWS post-migración |
|---|---|---|
| Deploy de un cambio | `git push origin main` | **`git push origin main`** (CI/CD automático en ~3 min) |
| Ver logs | `railway logs --service backend` | `aws logs tail /ecs/unidata-prod-backend --follow` |
| Rollback al deploy anterior | Railway dashboard → "Rollback" | `aws ecs update-service` con task def revision anterior |
| Restart manual | Railway dashboard → "Restart" | `aws ecs update-service --force-new-deployment` |
| Agregar env var secret | Railway dashboard | AWS Secrets Manager (`aws secretsmanager update-secret`) |
| Agregar env var plain (no-secret) | Railway dashboard | Editar task definition + nueva revision |
| Healthcheck status | Railway shows green/red | ALB Target Groups en consola |

---

## Arquitectura de referencia (post-cutover)

```
Cloudflare DNS
    ↓
ALB unidata-prod-alb (HTTPS:443, ACM cert wildcard)
    ↓ host: api.~  / host: unidata-mcp.~
    ↓
ECS Fargate:
  - unidata-prod-backend (1 vCPU / 2 GB, port 8000)
  - unidata-prod-mcp     (0.25 vCPU / 512 MB, port 8765)
    ↓ VPC privada (vpc-0f1f604c0d3e3ea06)
    ↓
RDS PostgreSQL:
  - unidata-prod-db     (datos propios de UNIDATA, ex-Supabase)
  - unistore-prod-db    (datos Unistore, lectura)
  - unidrop-prod-db     (datos Unidrop, lectura)
  - unidev en unistore-prod-db (datos Unidev, lectura)

Amplify Hosting:
  - frontend Next.js → app.unidatacenter.com.ar
```

---

## CI/CD — cómo deployar (lo más común)

### Deploy automático

```bash
# 1. hacer cambios en backend/
# 2. commit + push
git add backend/
git commit -m "feat: nueva feature X"
git push origin main

# 3. GitHub Actions detecta y deploya:
#    https://github.com/danieldmarmolr/unidata-pro/actions
#    - Build Docker image
#    - Push a ECR
#    - aws ecs update-service --force-new-deployment
#    - ECS levanta task nueva, healthcheck OK, drena la vieja
#    - ~2-3 min total
```

### Trigger deploy manual (si CI/CD falla)

```bash
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --force-new-deployment \
  --region us-east-2

# Para MCP:
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-mcp \
  --force-new-deployment \
  --region us-east-2
```

### Verificar progreso del deploy

```bash
# En vivo (espera hasta que termine)
aws ecs wait services-stable \
  --cluster unidata-prod \
  --services unidata-prod-backend \
  --region us-east-2

# Snapshot del estado actual
aws ecs describe-services \
  --cluster unidata-prod \
  --services unidata-prod-backend \
  --query 'services[0].{Desired:desiredCount,Running:runningCount,Status:status,Deployments:deployments[*].{Status:status,Tasks:runningCount,Rollout:rolloutState}}' \
  --region us-east-2
```

Salida esperada cuando estable:
```json
{
  "Desired": 1,
  "Running": 1,
  "Status": "ACTIVE",
  "Deployments": [{"Status": "PRIMARY", "Tasks": 1, "Rollout": "COMPLETED"}]
}
```

---

## Logs

### Ver logs en vivo

```bash
# Backend
aws logs tail /ecs/unidata-prod-backend --follow --region us-east-2

# MCP
aws logs tail /ecs/unidata-prod-mcp --follow --region us-east-2

# Solo errores de las últimas 1h
aws logs tail /ecs/unidata-prod-backend --since 1h --filter-pattern ERROR --region us-east-2
```

### Buscar en histórico

```bash
# Últimas 24h con un filtro
aws logs filter-log-events \
  --log-group-name /ecs/unidata-prod-backend \
  --start-time $(($(date +%s) * 1000 - 86400000)) \
  --filter-pattern "Token invalido" \
  --region us-east-2 \
  --query 'events[*].[timestamp,message]' \
  --output table
```

### Console UI

CloudWatch Logs → log groups → `/ecs/unidata-prod-backend` → log streams.

---

## Rollback

### Caso 1: el último deploy rompió algo

```bash
# 1. Listar últimas task definitions (la actual está al tope)
aws ecs list-task-definitions \
  --family-prefix unidata-prod-backend \
  --status ACTIVE \
  --sort DESC \
  --max-items 5 \
  --region us-east-2

# 2. Apuntar el service a la task def anterior
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --task-definition unidata-prod-backend:<N-1> \
  --region us-east-2

# 3. ECS levanta la versión vieja, drena la nueva
# 4. Verificar
aws ecs wait services-stable --cluster unidata-prod --services unidata-prod-backend --region us-east-2
curl https://api.unidatacenter.com.ar/api/health
```

### Caso 2: revertir un commit en git (rollback proactivo)

```bash
git revert HEAD
git push origin main
# Espera ~3 min, el nuevo commit (revert) triggea CI/CD y deploya la versión anterior
```

---

## Agregar / rotar secrets

### Agregar un secret nuevo

```bash
# Si es una env var NUEVA que el código consume con os.environ.get("X"):

# 1. Update el secret en Secrets Manager (extiende el JSON)
aws secretsmanager get-secret-value \
  --secret-id unidata/prod/backend \
  --region us-east-2 \
  --query SecretString --output text > current.json

# Editar current.json y agregar "MI_NUEVA_VAR": "valor"

aws secretsmanager update-secret \
  --secret-id unidata/prod/backend \
  --secret-string file://current.json \
  --region us-east-2

rm current.json

# 2. Update task definition para inyectar la nueva var
# (esto es manual en consola: ECS → Task Definitions → backend → Create new revision
# → Container → Environment → Secrets → Add → name=MI_NUEVA_VAR, valueFrom=arn:...:secret:unidata/prod/backend:MI_NUEVA_VAR::)

# 3. Forzar redeploy con la nueva task def
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --task-definition unidata-prod-backend \
  --force-new-deployment \
  --region us-east-2
```

### Rotar un secret (ej. JWT_SECRET)

```bash
# 1. Generar valor nuevo
NEW_JWT_SECRET=$(openssl rand -hex 64)

# 2. Update en Secrets Manager (preservar el resto del JSON)
# Conviene usar Console UI: Secrets Manager → unidata/prod/backend → Retrieve → Edit → modificar solo JWT_SECRET → Save

# 3. Force redeploy para que el backend tome el secret nuevo
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --force-new-deployment \
  --region us-east-2

# ⚠️ Esto invalida todas las sesiones JWT activas. Los users tienen que re-loguearse.
```

---

## Escalar el service (si carga aumenta)

### Más réplicas (horizontal scaling)

```bash
# De 1 task a 2 tasks (alta disponibilidad)
aws ecs update-service \
  --cluster unidata-prod \
  --service unidata-prod-backend \
  --desired-count 2 \
  --region us-east-2
```

> ⚠️ **Heads up importante**: con 2+ réplicas, el `APScheduler` interno corre en cada una → potencial duplicación de jobs (ej. auto-cumpleaños posteado 2x). El marker idempotente en DB previene el duplicado pero conviene confirmar antes de escalar. Si vas a escalar, considerar mover el scheduler a EventBridge.

### Más recursos (vertical scaling)

Modificar la task definition (consola: ECS → Task Definitions → Create new revision):
- Task CPU: 1024 → 2048 (1 vCPU → 2 vCPU)
- Task Memory: 2048 → 4096 (2 GB → 4 GB)
- Save + update service para usar la nueva revision

---

## Conectarse al RDS para debugging

### Vía bastión EC2 (18.226.5.216)

```bash
# 1. Setup tunnel
ssh -i unidata-bastion-key.pem \
  -L 5432:unidata-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432 \
  ec2-user@18.226.5.216

# 2. En otra terminal o DBeaver:
# host: localhost, port: 5432, db: unidata, user: unidata, password: <de Secrets Manager>
```

### Para los RDS productivos (unistore-prod-db, unidrop-prod-db)

Mismo flow pero usar el bastión correspondiente:
- Unistore: `3.139.209.227` con su key
- Unidrop: `18.191.119.38` con su key

---

## Monitoreo

### Healthcheck en vivo

```bash
# Backend
curl -s -w "\n→ HTTP %{http_code} | %{time_total}s\n" https://api.unidatacenter.com.ar/api/health

# MCP
curl -s -w "\n→ HTTP %{http_code} | %{time_total}s\n" https://unidata-mcp.unidatacenter.com.ar/health
```

### Métricas en CloudWatch

Acceder desde consola: **CloudWatch → Dashboards → unidata-prod** (cuando Mauro arme el dashboard).

Métricas clave a vigilar:
- **ECS Service CPU Utilization** — debería ser < 70% promedio
- **ECS Service Memory Utilization** — < 80%
- **ALB Target Response Time** — p95 < 2s para dashboards, < 500ms para health/auth
- **ALB HTTPCode_Target_5xx_Count** — < 1% del total de requests
- **RDS DatabaseConnections** — < 50 conexiones simultáneas

### Alarmas recomendadas

(Mauro probablemente las arma en su deploy. Si no, configurar en CloudWatch → Alarms:)

| Alarma | Threshold | Acción |
|---|---|---|
| Backend 5xx > 1% por 5 min | error rate | SNS → email |
| Backend response time p95 > 5s por 5 min | latency | SNS → email |
| ECS task count < 1 por 1 min | service down | SNS → page (alta urgencia) |
| RDS CPU > 80% por 10 min | DB stress | SNS → email |
| RDS storage > 80% | disk full | SNS → email |

---

## Costos — quick reference

| Servicio | Costo/mes estimado | Cómo ver real |
|---|---|---|
| ECS Fargate backend (1 vCPU / 2 GB) | ~$25 | Cost Explorer → filter by service: ECS |
| ECS Fargate mcp | ~$8 | idem |
| ALB | $22 fijo + tráfico | idem |
| RDS db.t3.micro | $15 | idem |
| Amplify | $5-10 | idem |
| CloudWatch + ECR + Data transfer | ~$15 | idem |
| **Total** | **~$90-100/mes** | AWS Cost Explorer |

### Configurar Budget alert (recomendado)

```bash
aws budgets create-budget \
  --account-id 043187662940 \
  --budget '{
    "BudgetName": "unidata-prod-monthly",
    "BudgetLimit": {"Amount": "150", "Unit": "USD"},
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[{
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 100
    },
    "Subscribers": [{"SubscriptionType": "EMAIL", "Address": "daniel.marmol@unistore.ar"}]
  }]' \
  --region us-east-2
```

---

## Troubleshooting común

### Síntoma: el backend devuelve 500 en endpoints que tocan DB

**Causa probable**: connection pool exhausted o DB lenta.

```bash
# Ver active connections en RDS
aws rds describe-db-instances \
  --db-instance-identifier unidata-prod-db \
  --query 'DBInstances[0].DBInstanceStatus' \
  --region us-east-2

# Ver logs ECS por errores SQL
aws logs tail /ecs/unidata-prod-backend --since 30m --filter-pattern "Error\|exception" --region us-east-2
```

Fix rápido: force redeploy para reset connection pools.

### Síntoma: latencia alta en dashboards

**Causa probable**: queries lentas o pool size insuficiente.

- Verificar en CloudWatch: ALB Target Response Time
- En el RDS: identificar queries lentas con Performance Insights (si está habilitado)
- Considerar: aumentar `pool_size` en `engines.py` o escalar a 2 réplicas

### Síntoma: MCP no responde

**Causa probable**: SSE timeout del ALB o ulimit.

- Verificar idle timeout del ALB = 4000s
- Verificar ulimit en task definition (`ulimits` field con nofile=2048)
- Revisar logs `/ecs/unidata-prod-mcp` por crashes

### Síntoma: CI/CD falla en GitHub Actions

**Causa probable**: build falla, ECR push falla, o ECS update falla.

- Ir a https://github.com/danieldmarmolr/unidata-pro/actions → último run → ver logs
- Causas comunes:
  - Test/lint failure en el código
  - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY rotados sin actualizar GitHub secrets
  - ECR repo rate limit (raro pero pasa)

---

## Cheatsheet de comandos diarios

```bash
# Estado general
curl -s https://api.unidatacenter.com.ar/api/health
aws ecs describe-services --cluster unidata-prod --services unidata-prod-backend unidata-prod-mcp --query 'services[*].{Name:serviceName,Running:runningCount,Desired:desiredCount}' --region us-east-2

# Logs en vivo
aws logs tail /ecs/unidata-prod-backend --follow --region us-east-2

# Force redeploy
aws ecs update-service --cluster unidata-prod --service unidata-prod-backend --force-new-deployment --region us-east-2

# Listar últimos commits deployados
aws ecs describe-task-definition --task-definition unidata-prod-backend --query 'taskDefinition.containerDefinitions[0].image' --region us-east-2
```

---

## Cuándo escalar a Mauro / contratar AWS support

Aunque ya operás solo, hay casos donde conviene tener una segunda opinión:

| Escenario | A quién consultar |
|---|---|
| RDS apagado, datos corruptos | AWS Support (Business plan si tenés) |
| Costos AWS suben >2x sin explicación | Cost Explorer + auditar resources |
| Tenés que armar disaster recovery a otra region | Consultor AWS o Mauro |
| Necesitás migrar a multi-account / AWS Organizations | Consultor AWS |
| Modificar la VPC compartida con Unistore/Unidrop | El equipo IT (no tocar solo) |

Para todo lo del día a día (deploys, logs, rollbacks, scaling, env vars) → este doc + AWS Console.
