# Handoff a Unifull — Configuracion de acceso a BBDD productivas

> Documento que Daniel le pasa al equipo de Unifull (`crm-kommo-sync`)
> con todo lo que necesitan para conectarse a las RDS productivas del grupo
> via SSH bastion.

---

## Estado actual

✅ **AWS Security Group ya esta allowlistado** para la IP estatica de Railway
(`162.220.232.99/32`) en los 2 bastions del grupo. Esto fue confirmado por Mauro
Candia el 2026-05-08 con los siguientes IDs de regla:

| Bastion | IP publica | SG | ID regla |
|---|---|---|---|
| Unistore | `3.139.209.227` | `unistore-prod-bastion-sg` | `sgr-0ed7dc9cd769da5e3` |
| Unidrop  | `18.191.119.38` | `launch-wizard-1`         | `sgr-0df2a3616e35bfc8d` |

Como ambos workspaces de Railway (UNIDATA + Unifull) salen por la misma IP
shared del pool us-west-2, **una sola regla cubre los dos proyectos**. No
hace falta pedirle a Mauro nada mas en cuanto a networking.

---

## Lo que Unifull necesita pedir a Mauro

Es la **Parte 2** del ticket consolidado que ya esta abierto. Le pueden
escribir directamente o sumarse al hilo. Necesitan dos cosas:

### 1. Llave SSH `.pem` del bastion

La llave es la misma que usan los devs del grupo (incluido Daniel) para
conectarse via DBeaver. Mauro tiene la fuente.

- **Para acceder a Unistore + Unidev:** llave del bastion `3.139.209.227`
- **Para acceder a Unidrop:** llave del bastion `18.191.119.38`

Recibirla por canal seguro (Vault, 1Password, archivo cifrado por Mauro).

### 2. Credenciales de DB read-only dedicadas

Pedirle a Mauro que cree el user con permisos solo `SELECT`:

```sql
-- Sugerencia de SQL para Mauro:
CREATE USER unifull_readonly WITH PASSWORD '<password generada>';
GRANT CONNECT ON DATABASE unistore_api TO unifull_readonly;
GRANT USAGE ON SCHEMA public, tienda_nube, meli, contabilium, digip TO unifull_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public, tienda_nube, meli, contabilium, digip TO unifull_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, tienda_nube, meli, contabilium, digip
  GRANT SELECT ON TABLES TO unifull_readonly;
```

> Nota: el listado de schemas a habilitar depende de que data necesita Kommo
> sync. **El equipo Unifull tiene que confirmar a Mauro que tablas o schemas
> consultan** para limitar el GRANT a lo justo (principio menor privilegio).

Salida esperada de Mauro: connection string formato

```
postgresql://unifull_readonly:<password>@unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com:5432/unistore_api?sslmode=require
```

(Si tambien necesitan Unidrop, pedir el mismo flujo para esa RDS.)

---

## Configuracion del lado Railway (cuando tengan llave + credentials)

### Paso 1 — Variables de entorno en Railway

Setear estas vars en el servicio `crm-kommo-sync` de Railway:

```env
# Bastion
BASTION_HOST=3.139.209.227
BASTION_USER=ec2-user
BASTION_PORT=22
BASTION_KEY_BASE64=<base64 de la .pem>

# RDS via tunel
DB_HOST_REMOTE=unistore-prod-db.c1u2aymu0gg8.us-east-2.rds.amazonaws.com
DB_PORT_REMOTE=5432
DB_NAME=unistore_api
DB_USER=unifull_readonly
DB_PASSWORD=<el password que les paso Mauro>

# Puerto local del tunel (cualquiera libre)
LOCAL_PORT=5440
```

### Paso 2 — Convertir la llave SSH a base64

Las llaves multi-linea no entran en env vars de Railway. Convertirla:

```bash
# Linux / Mac
base64 -w 0 unistore-bastion-key.pem

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("unistore-bastion-key.pem"))
```

Pegar el output (sin saltos de linea) en `BASTION_KEY_BASE64`.

### Paso 3 — Codigo: abrir tunel + conectar

#### Si el stack es Python:

```bash
pip install sshtunnel psycopg2-binary
```

```python
import os, base64, tempfile, psycopg2
from sshtunnel import SSHTunnelForwarder

# 1. Materializar la llave .pem desde la env var base64
key_path = "/tmp/bastion.pem"
with open(key_path, "wb") as f:
    f.write(base64.b64decode(os.environ["BASTION_KEY_BASE64"]))
os.chmod(key_path, 0o600)

# 2. Abrir tunel SSH
tunnel = SSHTunnelForwarder(
    (os.environ["BASTION_HOST"], int(os.environ.get("BASTION_PORT", 22))),
    ssh_username=os.environ["BASTION_USER"],
    ssh_pkey=key_path,
    remote_bind_address=(os.environ["DB_HOST_REMOTE"], int(os.environ["DB_PORT_REMOTE"])),
    local_bind_address=("127.0.0.1", int(os.environ.get("LOCAL_PORT", 5440))),
)
tunnel.start()

# 3. Conectar a Postgres a traves del tunel local
conn = psycopg2.connect(
    host="127.0.0.1",
    port=tunnel.local_bind_port,
    database=os.environ["DB_NAME"],
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    sslmode="require",
)

# 4. Smoke test
with conn.cursor() as cur:
    cur.execute("SELECT current_user, current_database(), now()")
    print(cur.fetchone())
    # Verificar que es read-only
    try:
        cur.execute("CREATE TABLE _test_readonly (id int)")
        print("OOPS, deberia haber fallado")
    except psycopg2.errors.InsufficientPrivilege:
        print("OK: usuario es read-only como esperado")
```

#### Si el stack es Node.js:

```bash
npm install ssh2 pg
```

```javascript
import fs from "fs";
import { Client as SSHClient } from "ssh2";
import { Client as PgClient } from "pg";
import net from "net";

// 1. Decodificar la llave
const keyBuffer = Buffer.from(process.env.BASTION_KEY_BASE64, "base64");

// 2. Conectar al bastion via SSH y forwardear puerto
const ssh = new SSHClient();
ssh.connect({
  host: process.env.BASTION_HOST,
  port: parseInt(process.env.BASTION_PORT || "22"),
  username: process.env.BASTION_USER,
  privateKey: keyBuffer,
});

ssh.on("ready", () => {
  const localServer = net.createServer((sock) => {
    ssh.forwardOut(
      "127.0.0.1", 0,
      process.env.DB_HOST_REMOTE, parseInt(process.env.DB_PORT_REMOTE),
      (err, stream) => {
        if (err) return sock.end();
        sock.pipe(stream).pipe(sock);
      }
    );
  });
  localServer.listen(parseInt(process.env.LOCAL_PORT || "5440"), "127.0.0.1", async () => {
    // 3. Conectar a Postgres a traves del puerto forwardeado
    const pg = new PgClient({
      host: "127.0.0.1",
      port: parseInt(process.env.LOCAL_PORT || "5440"),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    });
    await pg.connect();
    const r = await pg.query("SELECT current_user, current_database(), now()");
    console.log(r.rows);
    await pg.end();
    ssh.end();
  });
});
```

---

## Smoke test desde Railway (verificacion)

Una vez deployado, los siguientes 4 chequeos confirman que todo funciona:

```sql
-- 1. Usuario y DB correctos
SELECT current_user, current_database();
-- Esperado: ('unifull_readonly', 'unistore_api')

-- 2. Read-only confirmado (debe FALLAR)
INSERT INTO public.<algunatabla> (col) VALUES (1);
-- Esperado: permission denied for table

-- 3. Lectura real funciona
SELECT COUNT(*) FROM tienda_nube."Order";
-- Esperado: numero entero (cantidad de ordenes en TN)

-- 4. Schemas accesibles
SELECT DISTINCT table_schema FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema');
-- Esperado: lista de schemas que Mauro habilito (public, tienda_nube, etc)
```

---

## Notas importantes

### Sobre la IP de Railway

La IP `162.220.232.99` es **shared** en el pool us-west-2 de Railway Pro. Si
en algun momento el equipo Unifull migra el workspace a otra region, o cambia
de plan, **la IP cambia** y hay que reabrir ticket con Mauro para sumar la
nueva. Mientras se mantenga el setup actual (Pro plan + us-west-2), no hay
que tocar nada.

### Sobre la llave SSH

La misma llave .pem que usan los devs para DBeaver es la que va a Railway.
**Tratarla con cuidado**:
- Nunca commitearla al repo (gitignore + scan periodico)
- Solo en env var encriptada de Railway, no en codigo
- Si se filtra, pedirle a Mauro que la rote y vuelva a distribuir

### Sobre el user read-only

- **Solo SELECT.** Si en el codigo intentan INSERT/UPDATE/DELETE, falla con
  `permission denied`. Esto es intencional y esperado.
- **No mezclar con datos de Unidrop sin aviso.** Si Kommo necesita data de
  Unidrop tambien, pedir un user `unifull_readonly_unidrop` separado y NO
  reusar credenciales entre RDS distintas.
- **Auditar regularmente** que tablas se consultan, para evitar drift de
  alcance del GRANT.

### Sobre el endpoint local del tunel

El puerto `5440` (o el que elijas) tiene que estar libre en el container de
Railway. Si tu codigo ya usa ese puerto para otra cosa, cambiarlo a otro
no privilegiado (5432 va a chocar con clientes Postgres locales que asumen
ese default).

---

## Si algo falla

| Sintoma | Causa probable |
|---|---|
| `Connection timed out` al SSH | IP no allowlistada (revisar SG con Mauro) |
| `Permission denied (publickey)` | Llave .pem incorrecta o mal decodificada |
| `password authentication failed` | Credenciales DB equivocadas |
| `permission denied for table X` | El user read-only no tiene SELECT en ese schema/tabla |
| `connection refused` al RDS | Tunel no se levanto bien — chequear logs Railway |
| `SSL/TLS required` | Falta `sslmode=require` en connection string |

---

## Contactos

- **Daniel Marmol** (UNIDATA, autor de este doc): `daniel.marmol@unistore.ar`
- **Mauro Candia** (data engineer / AWS): coordina llaves, SG y user creation
- **Equipo Unifull**: implementa la integracion en `crm-kommo-sync`
