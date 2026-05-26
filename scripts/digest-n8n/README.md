# People digest diario · n8n workflow

Deploy automatizado del workflow que cada mañana lee `/api/people/digest/recipients`,
genera el HTML de cada user y lo envía vía Resend.

## Setup en 4 pasos

### 1) Generar el JWT de UNIDATA (90 días)
1. Entrá a https://app.unidatacenter.com.ar/dashboard/account
2. Tocá **"Generar token"** (scope `mcp`)
3. Copialo (no se vuelve a mostrar)

### 2) Crear cuenta + API key de Resend
1. https://resend.com/signup (gratis hasta 100 emails/día, 3k/mes)
2. **Domains** → Add domain → `unidatacenter.com.ar`
   - Pegá los 3 registros DNS en Cloudflare (TXT + 2 MX o CNAME según método)
   - Resend tarda 5-30 min en verificar
3. **API Keys** → Create → permisos `Full access` o `Send`
4. Copiá la key `re_xxxxx`

**Alternativa rápida** (sin DNS): usá `RESEND_FROM="UNIDATA <onboarding@resend.dev>"` —
Resend te deja enviar desde ese dominio sin verificación, pero solo a tu propio email.
Útil para test.

### 3) Conseguir el N8N_API_KEY
1. Login en https://unistore-it.app.n8n.cloud
2. Settings → **API** → Create API Key
3. Pegalo en run.bat

### 4) Editar `run.bat` y correr

```cmd
cd scripts\digest-n8n
notepad run.bat        REM editar las 4 vars
run.bat                REM deploy
```

Esperás ver:

```
== n8n: https://unistore-it.app.n8n.cloud/api/v1
Asegurando credentials:
  credential 'UNIDATA API Bearer' creada (id=abc123)
  credential 'Resend API Bearer' creada (id=def456)
Creando workflow 'UNIDATA - People digest diario'...
  Workflow creado (id=xyz789)

Activando workflow...
  OK, workflow ACTIVO. Proximo run: manana a las 08:00 AR.
```

## Qué hace el workflow

```
[Daily 8am AR cron]
        ↓
[GET /digest/recipients] → lista de users con contenido pendiente
        ↓
[Split recipients] → 1 fila por user
        ↓
[Loop por user] (SplitInBatches batch=1)
        ↓
[Tiene email? filter]
        ↓
[GET /digest/preview?as_html=true] → HTML email-safe
        ↓
[Armar email Code node] → construye body Resend
        ↓
[POST resend.com/emails] → manda
        ↓
[← loop hasta agotar la lista]
```

## Probar sin esperar al cron

En el editor del workflow:
1. Click **"Execute Workflow"** (botón arriba a la derecha)
2. Mirá la ejecución en **Executions** → la última

Si querés enviarte a vos solo: usá el endpoint local
`GET https://api.unidatacenter.com.ar/api/people/digest/preview?as_html=true`
con tu Authorization Bearer, y mirá el HTML directo en el browser.

## Modo dry-run (debug)

```cmd
python deploy.py --dry-run
```

No toca n8n, sólo imprime el JSON que iba a mandar.

## Re-deploy / cambios

Si modificás `workflow.json`, corré `run.bat` de nuevo. Es idempotente: hace PUT
sobre el workflow existente (no duplica) y reusa credentials.

## Rotar credenciales

n8n no permite update del `data` de una credential vía API. Para rotar el JWT
de UNIDATA o la Resend key:

1. Entrá a https://unistore-it.app.n8n.cloud → Credentials
2. Borrá la credential vieja
3. Corré `run.bat` de nuevo (la recreará con el nuevo valor del env var)

## Costos esperados

- **Resend free tier**: 100 emails/día, 3000/mes → suficiente si el equipo es <100 personas
- **n8n cloud free/starter**: 5k ejecuciones/mes — un mail por día por user encaja fácil
- Si el equipo supera 100 personas, pasar a Resend Pro ($20/mo, 50k emails) o
  SES/Postmark
