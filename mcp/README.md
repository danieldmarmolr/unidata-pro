# UNIDATA MCP

Servidor [Model Context Protocol](https://modelcontextprotocol.io) que expone
los dashboards y la base de datos read-only de UNIDATA como herramientas
invocables desde **Claude Desktop**, **Claude Code** y la **Claude API**.

Con esto, podés pedirle a Claude cosas como:
> *Mostrame los 10 dropshippers que más cayeron en GMV el último mes y sacame el ticket promedio de cada uno*
>
> *Corré un SELECT en Unistore que cuente órdenes pagadas por provincia y armame un CSV*
>
> *Dame el 360 del dropshipper id=102 y explicame si vale la pena retenerlo*

Y Claude usa la API de UNIDATA real (con tu JWT) para responder.

---

## Qué expone

10 herramientas **read-only**, todas respetando RBAC por rol+área del JWT:

| Tool | Qué hace |
|---|---|
| `whoami` | Usuario actual: rol, área, flag is_admin |
| `list_dropshippers` | Listado con search/sort por GMV/profit/recencia |
| `get_dropshipper` | 360 view: KPIs, ventas, pagos Talo, referidos, top clientes |
| `get_dropshipper_unified_orders` | Órdenes ML+TN combinadas con shipping, items, status |
| `get_executive_dashboard` | KPIs gerenciales cross-unidad |
| `get_unit_dashboard` | Ventas/finanzas/marketing/logística/CS por unidad |
| `list_orders` | Drilldown: paid / cancelled / stuck / all |
| `run_sql` | SELECT libre (statement_timeout 30s, max 5k filas) |
| `list_tables` | Browse schemas/tablas de una unidad |
| `preview_table` | Primeras N filas + definición de columnas |
| `describe_table` | Solo columnas (name, type, nullable, default, PK) |

Sin write/delete. Sin endpoints admin (gestión de usuarios). Todo lo destructivo
queda en la app web bajo auth de sesión.

---

## Setup local (Claude Desktop o Claude Code)

### 1. Obtener tu token JWT

Logueate en https://app.unidatacenter.com.ar y abrí las DevTools del browser
(F12 → Application → Local Storage → app.unidatacenter.com.ar). Copiá el valor
de la key `unidata.token` (empieza con `eyJ...`).

> El token tiene 24h de validez. Cuando expire, Claude te va a tirar
> `Token JWT inválido o expirado` — solo tenés que reabrir la app y copiar el
> nuevo token.

### 2. Agregar el server al config de Claude

**Claude Desktop** — abrí `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Agregá en la sección `mcpServers`:

```json
{
  "mcpServers": {
    "unidata": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/danieldmarmolr/unidata-pro.git#subdirectory=mcp",
        "unidata-mcp"
      ],
      "env": {
        "UNIDATA_API_URL": "https://api.unidatacenter.com.ar",
        "UNIDATA_TOKEN": "eyJhbGciOi...tu-token-aca"
      }
    }
  }
}
```

`uvx` viene con [uv](https://docs.astral.sh/uv/). Si no lo tenés:
- macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`

Reiniciá Claude Desktop. Vas a ver el ícono de tools 🛠️ abajo del input.

**Claude Code** — en el repo donde quieras usarlo:

```bash
claude mcp add unidata uvx --from git+https://github.com/danieldmarmolr/unidata-pro.git#subdirectory=mcp unidata-mcp \
  --env UNIDATA_API_URL=https://api.unidatacenter.com.ar \
  --env UNIDATA_TOKEN=eyJ...tu-token
```

### 3. Probarlo

En el chat: *"Llamá a whoami y decime quién soy en UNIDATA"*

---

## Dev local (clonando el repo)

```bash
cd unidata-pro/mcp
uv venv && source .venv/bin/activate   # o .venv\Scripts\activate en Windows
uv pip install -e .
cp .env.example .env
# Editá .env con tu token
unidata-mcp                            # arranca el server stdio
```

Para probarlo sin Claude, podés usar el `mcp` CLI:

```bash
mcp dev unidata_mcp/server.py
```

Eso abre el MCP Inspector en `http://localhost:5173` donde podés invocar las
tools manualmente.

---

## HTTP/SSE remoto

Servicio deployado en Railway que cualquier user puede usar **sin instalar nada
localmente**. Cada request lleva su propio JWT en el header `Authorization`,
asi el RBAC del backend sigue aplicando por usuario.

### Para usuarios — config Claude Desktop

```json
{
  "mcpServers": {
    "unidata": {
      "url": "https://unidata-mcp.unidatacenter.com.ar/sse",
      "headers": {
        "Authorization": "Bearer eyJ...tu-token"
      }
    }
  }
}
```

El token se genera en https://app.unidatacenter.com.ar/dashboard/account
(botón "Generar token"). Dura 90 días.

### Para devs — arquitectura

`http_server.py` levanta una app Starlette con:
- `Middleware AuthMiddleware` extrae `Authorization: Bearer <jwt>` y lo deposita
  en el contextvar `_request_token`
- `get_client()` en server.py lee el contextvar y construye un `UnidataClient`
  por request con ese token (en stdio el contextvar queda en None y cae al
  singleton con env var)
- `Mount("/")` con el SSE app de FastMCP
- `/health` y `/whoami-probe` (debug) sin auth

### Deploy local (testing)

```bash
cd mcp
uv pip install -e .
UNIDATA_API_URL=https://api.unidatacenter.com.ar unidata-mcp-http
# escucha en :8765
```

Verifica:
```bash
curl http://localhost:8765/health
# {"status":"ok","service":"unidata-mcp",...}

curl -H "Authorization: Bearer eyJ..." http://localhost:8765/whoami-probe
# {"received_bearer_token":true,"token_suffix":"...XYZ"}
```

### Deploy Railway

El paquete incluye `Dockerfile` y `railway.toml`. Para deployar:

```bash
# Crear service nuevo si no existe
railway service create mcp

# Set env vars (solo API_URL; el token va por request)
railway variables --service mcp --set UNIDATA_API_URL=https://api.unidatacenter.com.ar

# Deploy
railway up ./mcp --path-as-root --service mcp
```

Despues asignar custom domain `unidata-mcp.unidatacenter.com.ar` via Cloudflare
→ Railway.

---

## Seguridad

- El MCP corre con TU JWT — Claude solo ve lo que vos podés ver en la app.
- Todas las tools son read-only. No hay forma de crear/borrar nada via el MCP.
- `run_sql` valida que el SQL empiece con `SELECT` o `WITH` y rechaza
  `INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|CREATE` a nivel parser
  (validación en el backend, no en este wrapper).
- El JWT que pongas en la config queda en texto plano en `claude_desktop_config.json`
  — si compartís la PC, considerá cifrar el archivo o usar un keychain.

---

## Roadmap

- [ ] Middleware per-request en HTTP server (extrae JWT de header)
- [ ] Endpoint `/api/auth/mcp-token` en el backend que genere un token de larga vida (90d) específico para MCP
- [ ] Tool `search_customers` (end consumers de Unistore)
- [ ] Tool `get_rfm_segments` y `get_cohort_analysis`
- [ ] Tool `list_notifications` para que el agente avise de alertas activas
- [ ] Tests con pytest + httpx mocks
