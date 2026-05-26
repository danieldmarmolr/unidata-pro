"""
Aprende UNIDATA — capacitacion del equipo en la herramienta.

Tablas:
  aprende_lessons   -> contenido de las lecciones (general + por area)
  aprende_progress  -> progreso individual del user (lesson_slug -> completed_at)

Las lecciones se cargan via seed idempotente en init(): si el slug existe,
respeta lo que ya esta cargado (para que admin/People pueda editarlo desde UI
sin que el seed pise los cambios). Solo crea las que faltan.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading

from app.db.local_persistence import get_conn

log = logging.getLogger("unidata.aprende")

_LOCK = threading.RLock()
_INITIALIZED = False


# ============================================================
# Seed content — lecciones por area
# ============================================================
# Cada item: (slug, area_slug, title, description, content_md, link, sort_order)
# area_slug = 'general' es la cross (todos la ven)
# area_slug puede ser: general, administracion, compras, finanzas, ventas,
#                       logistica, cs, marketing, people, it_data,
#                       unistore, unidrop, unidev
SEED_LESSONS: list[tuple[str, str, str, str, str, str | None, int]] = [
    # ============================================================
    # GENERAL — para todos los users
    # ============================================================
    (
        "general-bienvenida", "general",
        "Bienvenido a UNIDATA",
        "Que es UNIDATA, por que existe y como esta organizada la herramienta.",
        """UNIDATA es la **plataforma BI interna** del grupo Unistore. Centraliza datos de las tres unidades de negocio del grupo en un solo lugar:

- **Unistore** — e-commerce propio (Tienda Nube + Mercado Libre)
- **Unidrop** — dropshipping (dropshippers que operan bajo la marca)
- **Unidev** — desarrollo y operaciones internas

La idea es que **todo el equipo** (sin importar el area) tenga acceso facil a la informacion que necesita para tomar decisiones, sin tener que pedirsela a IT/Data ni esperar reportes manuales.

### Como esta organizada

El sidebar de la izquierda agrupa todo en 6 secciones:
1. **Principal** — tu inicio, perfil, notificaciones, buscar clientes, exportaciones
2. **Cross** — paneles que cruzan unidades (Gerencia, Marketing, CS, Ventas, Logistica, Finanzas, People, Producto)
3. **Unistore** — todo lo especifico de la marca propia
4. **Unidrop** — todo lo especifico de dropshippers
5. **Unidev** — devoluciones + NLP de causas
6. **Datos** — herramientas de exploracion (Catalog, SQL libre, Audit log) para usuarios con permisos

### Que se espera de vos
Que uses UNIDATA todos los dias. Cada dashboard responde una pregunta concreta de tu trabajo — si no encontras lo que necesitas, **pedilo en #data-requests** y lo armamos.
""",
        "/dashboard/home", 0,
    ),
    (
        "general-navegar", "general",
        "Como navegar UNIDATA",
        "Filtros de periodo, comparativas, drill-downs, exportaciones.",
        """### Filtros de periodo
Casi todos los dashboards tienen un selector de periodo arriba a la derecha: **7d / 30d / 90d / YTD / Custom**. El filtro se persiste entre paginas (esta en el estado global), asi que si elegis "30d" en Ventas, cuando entres a Logistica vas a ver tambien "30d".

### Comparativas
Cuando aparece un numero KPI grande, suele venir con una **variacion vs periodo anterior** abajo. Verde = mejoro, rojo = empeoro. Hover sobre el numero para ver el detalle de la comparacion.

### Drill-downs
Casi todo es clickeable. Si ves un nombre de cliente, dropshipper o SKU subrayado o en color, es un link a la vista 360 de ese item. Por ejemplo:
- Click en un dropshipper -> abre `/dashboard/dropshipper/[id]` (vista 360)
- Click en un SKU -> abre `/dashboard/productos/[sku]`
- Click en un order -> abre el modal con detalle completo

### Exportaciones
En `/dashboard/exports` podes descargar cualquier dashboard a CSV o Excel formateado. Tambien hay botones puntuales de export en algunas tablas.

### Tip
Si una pagina tarda en cargar, mira el indicador `X-Cache: HIT|MISS` en el response. UNIDATA cachea responses por 180s para acelerar.
""",
        "/dashboard/home", 1,
    ),
    (
        "general-roles", "general",
        "Tu rol y tu area",
        "Como funciona el RBAC de UNIDATA y por que ves (o no) ciertos paneles.",
        """UNIDATA usa **RBAC por rol + area**.

### Roles
- **admin / is_admin=TRUE** — ven todo, pueden administrar usuarios
- **gerencia** — ven todas las areas + dashboard Gerencia
- **user / analista / lector** — solo ven dashboards de su area asignada

### Areas (9)
`administracion · compras · finanzas · ventas · logistica · cs · marketing · people · it_data`

Tu area se asigna cuando te crean el user. Si no ves un panel que necesitas, pedile a admin/People que te agregue a esa area (un user puede pertenecer a varias areas secundarias).

### Que pasa si soy gerencia
Tenes bypass total — vas a ver el sidebar completo igual que un admin, **excepto** funciones de administracion (CRUD de usuarios, audit log).
""",
        "/dashboard/perfil", 2,
    ),
    (
        "general-notificaciones", "general",
        "Bandeja y notificaciones",
        "Mensajes directos, menciones, kudos, comentarios y anuncios — todo en un solo lugar.",
        """La **Bandeja** (en People > Comunicación > Bandeja) unifica:
- **Notificaciones** — menciones (@vos), kudos recibidos, comentarios a tus posts, anuncios pinneados
- **Mensajes** — DMs 1:1 y grupos ad-hoc con companeros

### Sugerencias
- Marca tus notifs como leidas con un click — el badge del sidebar baja en tiempo real
- Para conversaciones especificas, abri el chat desde la Bandeja
- Los anuncios pinneados (de gerencia o People) requieren confirmacion de lectura

### Digest diario
Si activas el digest en Mi cuenta, recibis un email cada manana con: cumples del dia, mensajes sin leer, aniversarios, y eventos proximos.
""",
        "/dashboard/people/bandeja", 3,
    ),
    (
        "general-buscar-clientes", "general",
        "Buscar clientes y dropshippers",
        "El buscador global de la barra superior y los buscadores por unidad.",
        """En **Buscar clientes** (sidebar > Principal) podes encontrar a cualquier cliente/dropshipper del grupo en menos de 3 segundos.

- Sin filtro de unidad -> busca en TODAS las unidades (Unistore + Unidrop + Unidev)
- Con filtro de unidad activo (?unit=unistore o ?unit=unidrop) -> busca solo ahi

Los resultados muestran:
- Nombre, email, telefono, DNI
- Ultima compra
- GMV total + cantidad de ordenes
- Canal principal (TN / ML / ambos)
- Click -> vista 360 del cliente
""",
        "/dashboard/clientes", 4,
    ),

    # ============================================================
    # FINANZAS
    # ============================================================
    (
        "finanzas-vista-general", "finanzas",
        "Vista general de Finanzas",
        "KPIs de cashflow, margenes y compromisos por unidad.",
        """`/dashboard/finanzas` te da el pulso financiero del grupo. Mostra:
- Ingresos del periodo por unidad
- Costos directos (mercaderia, envios, comisiones)
- Margen bruto consolidado
- Compromisos pendientes (facturas no pagadas, anticipos, deudas)

Para ver detalle de Unistore vs Unidrop, usa el switch de unidad arriba.
""",
        "/dashboard/finanzas", 0,
    ),
    (
        "finanzas-flujo-fondos", "finanzas",
        "Flujo de Fondos",
        "El ERP de tesoreria del grupo — proyeccion, erogaciones, pagos atrasados.",
        """**Flujo de Fondos** es el ERP de tesoreria. Te permite:
- Cargar **erogaciones futuras** (pagos a proveedores, sueldos, impuestos, alquileres)
- Ver la **proyeccion de caja** dia a dia con saldo proyectado
- Detectar **pagos atrasados** automaticamente (con sugerencias)
- Marcar pagos como conciliados desde el bank statement

### Recordatorios clave
- Unistore Mayorista cobra dia X+1 (configurado en `DIFERIMIENTO_POR_UNIDAD`)
- La proyeccion incluye automaticamente cobros esperados de ventas + suscripciones
- Los patrones de gasto se detectan con IA: si cargas 3 veces el mismo concepto, sugiere recurrencia
""",
        "/dashboard/finanzas/flujo-fondos", 1,
    ),
    (
        "finanzas-facturas-suscripciones", "finanzas",
        "Facturas de Suscripciones MELI",
        "Tracking de cobros mensuales recurrentes de dropshippers via MELI.",
        """`/dashboard/finanzas/facturas-suscripciones-meli` te muestra:
- Lista de dropshippers con suscripcion MELI activa
- Estado de la factura del mes (cobrada / pendiente / fallida)
- Monto cobrado vs esperado
- Click en una fila -> detalle + link al ContaBilium

### Conciliacion
Para conciliar contra el bank statement, exporta a Excel desde el boton arriba a la derecha.
""",
        "/dashboard/finanzas/facturas-suscripciones-meli", 2,
    ),
    (
        "finanzas-dev-suscripciones", "finanzas",
        "Devoluciones de Suscripciones",
        "Reembolsos de cobros fallidos o disputas.",
        """`/dashboard/finanzas/dev-suscripciones` lista los reembolsos que se hicieron de cobros de suscripcion (chargebacks, refunds manuales). Util para reconciliar contra el extracto y para detectar patrones de churn temprano (un dropshipper que dispute es señal de cancelacion proxima).
""",
        "/dashboard/finanzas/dev-suscripciones", 3,
    ),

    # ============================================================
    # VENTAS
    # ============================================================
    (
        "ventas-vista-general", "ventas",
        "Vista general de Ventas",
        "GMV, ordenes, ticket promedio, canales por unidad y periodo.",
        """`/dashboard/ventas` te muestra el pulso comercial del grupo:
- **GMV** (Gross Merchandise Value) del periodo
- **Ordenes pagadas** + cancelaciones
- **Ticket promedio**
- **Canales**: MELI vs TN vs ambos
- **Top SKUs** + top clientes
- **Evolucion mensual** comparativa

Switch de unidad arriba para Unistore / Unidrop / consolidado.
""",
        "/dashboard/ventas", 0,
    ),
    (
        "ventas-cohortes", "ventas",
        "Analisis de Cohortes",
        "Retencion de clientes mes a mes desde su primera compra.",
        """`/dashboard/cohortes` agrupa clientes por mes de **primera compra** y mide su comportamiento en los meses siguientes.
- Te dice si los clientes que captaste en marzo siguen comprando en junio
- Identifica las cohortes mas valiosas (clientes que vuelven mas)
- Detecta cambios en el ciclo de vida del cliente

### Lectura tipica
- Cohorte alta y plana = base de clientes leales
- Cohorte que cae rapido = problema de retencion (CX, calidad producto)
""",
        "/dashboard/cohortes", 1,
    ),
    (
        "ventas-rfm", "ventas",
        "Segmentacion RFM",
        "Clasifica clientes por Recencia + Frecuencia + Monto.",
        """**RFM** = Recency (cuando compro por ultima vez) + Frequency (cuantas veces) + Monetary (cuanto gasto).

`/dashboard/rfm` clasifica a todos los clientes en 11 segmentos:
- **Champions** — compran seguido, gastan mucho, recientes
- **Loyal Customers** — frecuentes, buen gasto, recientes
- **At Risk** — antes compraban seguido, hace rato que no vuelven
- **Cant Lose** — alto gasto historico, ahora ausentes
- **Hibernating / Lost** — perdidos

### Uso practico
- Marketing arma campanas distintas por segmento (Champions reciben programa de fidelidad, At Risk reciben re-engagement)
- Comercial prioriza At Risk de alto Monetary
""",
        "/dashboard/rfm", 2,
    ),

    # ============================================================
    # LOGISTICA
    # ============================================================
    (
        "logistica-vista-general", "logistica",
        "Vista general de Logistica",
        "Pedidos pendientes, en transito, entregados; estados por carrier.",
        """`/dashboard/logistica` muestra el estado operativo de los pedidos:
- Pendientes de empaquetar
- En transito (ML / OCA / Lightdata / Andreani)
- Entregados ultimos 7d
- Tasa de entrega vs SLA por carrier
- Errores y devoluciones

Switch de unidad arriba.
""",
        "/dashboard/logistica", 0,
    ),
    (
        "logistica-carga-digip", "logistica",
        "Carga DigiP",
        "Push de pedidos al WMS de Patagonia (DigiPWMS).",
        """`/dashboard/logistica/carga-digip` te permite:
- Ver pedidos **listos para empaquetar** que aun no estan en DigiP
- Cargarlos en bulk al WMS (con verificacion previa de stock + cliente + direccion)
- Detectar errores tipicos: "Ya existe", "sequence contains more than one element", truncacion de observacion

### Gotchas
- Si un cliente DigiP no existe, hay que crearlo antes (la app lo hace automatico si esta el flag)
- La direccion del cliente se trae de TN/ML con normalizacion
""",
        "/dashboard/logistica/carga-digip", 1,
    ),
    (
        "logistica-targets", "logistica",
        "Targets de Logistica",
        "Configurar y revisar metas de SLA, tasa de error, costo por envio.",
        """`/dashboard/logistica/targets` te permite definir:
- **SLA target** por carrier (ej: OCA 95% entrega en 5 dias)
- **Costo promedio** target por envio
- **Tasa de error** target (devoluciones / re-envios)

Cada KPI principal se compara contra el target con semaforo verde / amarillo / rojo.
""",
        "/dashboard/logistica/targets", 2,
    ),
    (
        "logistica-envios-unistore", "logistica",
        "Envios por canal (Unistore)",
        "Desglose de envios de Unistore por carrier, modo y canal de venta.",
        """`/dashboard/envios-unistore` te muestra todos los envios de Unistore (TN + ML) cruzados:
- Por carrier (OCA, Lightdata, Andreani, ML, Tienda Nube Envios)
- Por modo (estandar, express, retiro en sucursal, flex)
- Por canal de venta (TN web, ML, otros)
- Costo + tiempo promedio por combinacion
""",
        "/dashboard/envios-unistore", 3,
    ),

    # ============================================================
    # CUSTOMER SUCCESS
    # ============================================================
    (
        "cs-vista-general", "cs",
        "Vista general de CS",
        "Cola de tickets, tiempo de respuesta, NPS, churn.",
        """`/dashboard/cs` es el dashboard cross de Customer Success. Muestra:
- **Cola actual** de acciones (cs_actions) por estado
- **Tiempo de respuesta** promedio + SLA
- **NPS** del periodo (eNPS si esta activo)
- **Churn rate** (dropshippers que cancelaron)
- **At Risk** (dropshippers que segun RFM estan por irse)
""",
        "/dashboard/cs", 0,
    ),
    (
        "cs-bandeja", "cs",
        "Bandeja CS",
        "Cola operativa de tareas — tomar, completar, dejar nota.",
        """`/dashboard/cs-acciones` es la **cola de trabajo** del equipo CS. Cada accion (cs_action) tiene:
- Tipo: retention, billing, support, onboarding, escalation
- Asignado a: alguien del equipo (o sin asignar)
- Estado: pending / in_progress / completed / cancelled
- Notas internas

### Workflow
1. Filtra por "Sin asignar" o "Mis tareas"
2. Toma una accion con el boton **Tomar**
3. Trabajala (llamada / mail / WhatsApp al dropshipper)
4. Completa con una **nota** que describa que paso
5. Si requiere seguimiento, programa un **recordatorio**
""",
        "/dashboard/cs-acciones", 1,
    ),
    (
        "cs-performance", "cs",
        "Performance del equipo CS",
        "Tickets resueltos por persona, tiempo promedio, NPS por agente.",
        """`/dashboard/cs-performance` muestra el desempeno del equipo:
- Acciones cerradas por agente
- Tiempo promedio de resolucion
- Satisfaccion (si el dropshipper respondio una encuesta post-accion)
- Distribucion por tipo de accion

Util para 1:1s con el equipo y para detectar agentes que necesitan apoyo o capacitacion adicional.
""",
        "/dashboard/cs-performance", 2,
    ),
    (
        "cs-rfm-flows", "cs",
        "RFM Flows (Migracion)",
        "Movimientos de clientes entre segmentos RFM mes a mes.",
        """`/dashboard/rfm-flows` muestra como se mueven los clientes entre segmentos:
- Cuantos Champions cayeron a At Risk este mes?
- Cuantos At Risk se reactivaron?
- Cuantos Hibernating se perdieron definitivamente?

### Para que sirve
Para medir el **impacto de campanas de CS**. Si lanzaste un flow de re-engagement, queres ver que clientes At Risk efectivamente volvieron a Loyal.
""",
        "/dashboard/rfm-flows", 3,
    ),
    (
        "cs-nlp-cancelaciones", "cs",
        "NLP Cancelaciones",
        "Causas de cancelacion detectadas automaticamente con IA.",
        """`/dashboard/cancel-nlp` agrupa las cancelaciones de dropshippers por **motivo detectado por IA** a partir del texto libre:
- "Sin ventas" / "Probo unos meses y no funciono"
- "Soporte / atencion al cliente"
- "Cambio de rubro / cerro el negocio"
- "Demasiado caro" / "Mas barato afuera"

### Uso
Identifica las causas top + permite trackear si las acciones que tomas (mejor onboarding, mejor catalogo, mejor precio) bajan los motivos correspondientes.
""",
        "/dashboard/cancel-nlp", 4,
    ),

    # ============================================================
    # MARKETING
    # ============================================================
    (
        "marketing-vista-general", "marketing",
        "Vista general de Marketing",
        "Inversion publicitaria, ROAS, atribucion por canal.",
        """`/dashboard/marketing` muestra:
- **Inversion publicitaria** total del periodo (Meta + Google + otros)
- **Ventas atribuidas** a marketing (last-click + first-click)
- **ROAS** (Return on Ad Spend) por canal
- **CAC** (Customer Acquisition Cost)
- **LTV/CAC** ratio

### Lectura
ROAS > 3 es bueno en ecommerce. ROAS < 1 = perdes plata.
""",
        "/dashboard/marketing", 0,
    ),
    (
        "marketing-meta-ads", "marketing",
        "Meta Ads",
        "Detalle de campanas de Facebook + Instagram.",
        """`/dashboard/marketing/meta` integra con la API de Meta y muestra:
- Lista de campanas activas con spend + impressions + clicks + CTR
- Ad sets debajo de cada campana
- Atribucion a ventas (cruzando con TN orders y ML orders)
- Comparativa periodo vs periodo

### Importante
La sync se hace cada 4 horas via job en `meta_sync_runs`. Si ves data vieja, podes forzar un sync manual desde el boton arriba.
""",
        "/dashboard/marketing/meta", 1,
    ),

    # ============================================================
    # PEOPLE
    # ============================================================
    (
        "people-feed", "people",
        "Feed de People",
        "Publicaciones del equipo, anuncios, kudos, cumples.",
        """El **Feed** (`/dashboard/people`) es el muro social del equipo. Aca van:
- Anuncios oficiales (pinneados arriba — gerencia / admin / People)
- Posts de companeros
- Auto-posts de cumpleanos (job diario)
- Reacciones, comentarios, kudos

### Spaces
A la izquierda hay **espacios tematicos** (Anuncios, Random, Cumples, etc). Click en un space para filtrar el feed.

### Posts
Cualquier user puede postear. Soporta:
- Texto + emojis
- Imagenes (5MB max)
- Menciones @[Nombre]
- Encuestas inline (polls)
""",
        "/dashboard/people", 0,
    ),
    (
        "people-bandeja", "people",
        "Bandeja",
        "Notificaciones + mensajes directos en un solo lugar.",
        """La **Bandeja** (`/dashboard/people/bandeja`) tiene dos tabs:
- **Notificaciones** — menciones, kudos, comentarios, anuncios, DMs nuevos
- **Mensajes** — chat 1:1 y grupos ad-hoc

### Workflow
Cuando alguien te menciona o te manda un DM, aparece como badge en el sidebar (en el item Bandeja). Abrila al menos 2 veces al dia.
""",
        "/dashboard/people/bandeja", 1,
    ),
    (
        "people-directorio", "people",
        "Directorio + Org Chart",
        "Quien es quien, con foto, area, manager y reportes.",
        """**Directorio** (`/dashboard/people/directory`) — lista plana con filtro por area + buscador.
**Org Chart** (`/dashboard/people/org-chart`) — arbol jerarquico con manager <-> reportes.

Click en cualquier persona te abre su perfil publico con: bio, fecha de ingreso, manager, reportes directos, kudos recibidos, posts recientes.
""",
        "/dashboard/people/directory", 2,
    ),
    (
        "people-kudos", "people",
        "Kudos",
        "Reconocimiento entre pares basado en valores de la empresa.",
        """**Kudos** son los reconocimientos que un companero te da por demostrar un valor de la empresa.

### Como funciona
- Cualquier user puede darle kudos a otro
- Tenes que **elegir el valor** que esta demostrando (lista configurable por admin/People)
- El kudo se publica en el Feed (espacio Kudos)
- Se trackea en `/dashboard/people/kudos` con leaderboard mensual

### Como manager
Usa kudos publicos para reforzar comportamientos que queres ver mas. Es mas potente que feedback privado para cambio cultural.
""",
        "/dashboard/people/kudos", 3,
    ),
    (
        "people-1on1", "people",
        "1:1s",
        "Agenda de reuniones manager <-> reporte con notas compartidas y action items.",
        """**1:1s** (`/dashboard/people/one-on-ones`) te permite a vos y tu manager:
- Agendar la proxima reunion
- Tomar notas en vivo (compartidas)
- Definir action items con due date
- Marcar como completada

### Recomendacion de cadencia
- 1:1 dia 1, 7 y 30 con manager (templates de onboarding)
- 1:1 quincenal o semanal despues

Solo manager + reporte ven las notas (admin si querria ver, no puede sin que el reporte explicite que es ok).
""",
        "/dashboard/people/one-on-ones", 4,
    ),
    (
        "people-encuestas", "people",
        "Encuestas (Pulse + eNPS)",
        "Encuestas anonimas o nominales para medir clima del equipo.",
        """`/dashboard/people/surveys` te muestra las encuestas activas. Tipos:
- **Pulse** — semanal, una pregunta cortita ("Como estas esta semana? 1-5")
- **eNPS** — trimestral, "Recomendarias a UNIDATA como lugar para trabajar? 0-10"
- **Custom** — preguntas puntuales (ej: "Que tal el ultimo team building?")

Las anonimas no guardan tu user_id en las respuestas. Las nominales si (y solo admin/People ve resultados).

### Como manager
Mira tu eNPS de equipo cada trimestre — caidas de >5 puntos son señal de algo que arreglar urgente.
""",
        "/dashboard/people/surveys", 5,
    ),

    # ============================================================
    # PRODUCTO / COMPRAS
    # ============================================================
    (
        "compras-sku-optimizer", "compras",
        "SKU Optimizer",
        "Sugerencias de que reponer y cuanto en base a forecast + stock.",
        """`/dashboard/sku-optimizer` te dice **que SKUs reponer ya** y **cuanto pedir** en base a:
- Forecast de demanda (modelo entrenado)
- Stock actual en DigiP
- Lead time del proveedor (configurable por SKU)
- Costo de stockout vs costo de carrying

### Listado
Cada SKU viene con: Stock actual / Forecast 30d / Reorder point / Sugerencia de cantidad / Costo estimado del pedido.

Click en un SKU -> abre su vista 360.
""",
        "/dashboard/sku-optimizer", 0,
    ),
    (
        "compras-costos", "compras",
        "Costos de Importacion",
        "Tracking de lotes importados, costos USD, despachos, tipo de cambio.",
        """`/dashboard/costos` te permite:
- Cargar **lotes nuevos** con su FOB USD, fletes, derechos, IVA, IIBB
- Trackear cada lote por estado (en transito, en aduana, despachado)
- Calcular el **costo final unitario en ARS** post-importacion (con FX del dia de pago)
- Comparar costos historicos del mismo SKU para detectar inflacion de proveedor
""",
        "/dashboard/costos", 1,
    ),
    (
        "compras-forecast", "compras",
        "Forecast de Demanda",
        "Proyeccion de ventas SKU por canal para los proximos 30-90 dias.",
        """`/dashboard/forecast` te muestra la **demanda proyectada** de cada SKU para los proximos 30 / 60 / 90 dias, separado por canal (ML / TN / Mayorista). Util para:
- Decidir cuanto importar
- Anticipar quiebres de stock
- Detectar SKUs con crecimiento (priorizarlos en compras)
- Detectar SKUs decadentes (liquidarlos)
""",
        "/dashboard/forecast", 2,
    ),
    (
        "compras-heatmap-stock", "compras",
        "Heatmap de Stock",
        "Visualizacion de salud del stock por SKU y canal.",
        """`/dashboard/stock-heatmap` muestra todos los SKUs como una grilla con colores:
- **Verde** — stock saludable
- **Amarillo** — stock bajo
- **Rojo** — quebrado o por quebrar
- **Gris** — stock excesivo (>3 meses de cobertura)

Util para una vista panoramica del catalogo.
""",
        "/dashboard/stock-heatmap", 3,
    ),

    # ============================================================
    # ADMINISTRACION
    # ============================================================
    (
        "administracion-usuarios", "administracion",
        "Gestion de Usuarios",
        "ABM de usuarios, asignacion de roles y areas.",
        """`/dashboard/admin/users` (solo admin) te permite:
- Listar todos los usuarios con su area + rol + estado
- Crear / editar / desactivar users
- Asignar **rol** (admin, gerencia, user, analista, lector)
- Asignar **area primaria** + **areas secundarias**
- Resetear contrasenas

### Importante
- Un user con `is_admin=TRUE` ve TODO, mas que un `role='gerencia'`
- Un user con multiples areas ve los dashboards de TODAS sus areas
- Desactivar > eliminar (preserva history)
""",
        "/dashboard/admin/users", 0,
    ),
    (
        "administracion-audit", "administracion",
        "Audit Log",
        "Log de queries y acciones sensibles ejecutadas.",
        """`/dashboard/audit` te muestra el historial de queries en bases productivas + acciones sensibles. Te dice:
- Quien ejecuto que query
- Cuanto tardo
- Que tablas toco
- Si fue read u operacion de write

Util para auditoria de seguridad y para detectar usuarios que abusan del SQL libre.
""",
        "/dashboard/audit", 1,
    ),

    # ============================================================
    # IT / DATA
    # ============================================================
    (
        "it-data-catalog", "it_data",
        "Data Catalog",
        "Documentacion automatica de todas las tablas y columnas.",
        """`/dashboard/catalog` es el catalogo de datos del grupo:
- Lista todas las **tablas** de cada engine (unistore_api, unidrop_api, unidev_api)
- Para cada tabla: descripcion + lista de columnas + tipo + sample
- Diagrama **ER** (entity-relationship) con joins
- Auto-doc con Gemini (las descripciones se autogeneran a partir del schema y se editan manualmente)
- Stories (queries guardadas tipicas)

### Para que sirve
Antes de escribir una query nueva, pasa por el catalog para saber donde esta el dato. Te ahorra horas.
""",
        "/dashboard/catalog", 0,
    ),
    (
        "it-data-sql", "it_data",
        "SQL Libre",
        "Ejecutar queries arbitrarias contra cualquier engine.",
        """`/dashboard/sql` te deja correr SQL libre. Aclaraciones:
- Solo `SELECT` (no UPDATE / DELETE / DROP — esta bloqueado en la app)
- Switch arriba para elegir engine: unistore / unidrop / unidev
- Se loguea en audit log (todo queda registrado)
- Limite 60s de timeout
- Resultado descargable a CSV/Excel

### Gotchas
- Antes de joinear tablas, verifica los nombres de columna en `information_schema.columns` — el schema tiene inconsistencias
- En unidrop, ENUM type a veces requiere `::text` cast
""",
        "/dashboard/sql", 1,
    ),
    (
        "it-data-explorador", "it_data",
        "Explorador de Sources",
        "Browse de tablas y views con preview de filas.",
        """`/dashboard/sources` es un browser visual:
- Lista de schemas + tablas por engine
- Click en una tabla -> preview de las primeras 100 filas
- Filtros y orden interactivos
- Export directo a CSV

Util para data scientists que quieren explorar antes de escribir queries.
""",
        "/dashboard/sources", 2,
    ),
    (
        "it-data-jira-flow", "it_data",
        "Jira Flow",
        "Integracion con Jira Cloud para crear/listar issues.",
        """`/dashboard/jira-flow` integra con Atlassian Cloud (Jira de Unistore). Te permite:
- Listar issues abiertos del board
- Crear issues nuevos con type + priority + assignee
- Linkar issues a entidades de UNIDATA (orden, dropshipper, SKU)

Util para que CS / Ops puedan crear tickets de IT sin salir de UNIDATA.
""",
        "/dashboard/jira-flow", 3,
    ),
    (
        "it-data-mcp", "it_data",
        "MCP Server",
        "Conectar UNIDATA con Claude Desktop / Claude Code via MCP.",
        """Con el **MCP server** de UNIDATA podes consultar el grupo desde Claude (chat o CLI). Tiene 24 tools — 10 read (dashboards, dropshippers, ordenes, SQL libre) y 14 write (CS actions, alertas IT, notas, recordatorios).

### Setup
1. Andate a `/dashboard/account`
2. Click en "Generar token MCP" — devuelve un JWT de 90d con scope=mcp
3. Pega el token en `claude_desktop_config.json` o `claude_code config`
4. Reinicia Claude

### Que podes hacer
- "Mostrame los pedidos de hoy de Unistore"
- "Que dropshippers estan en At Risk segun RFM?"
- "Creame un cs_action para llamar al dropshipper Pedro Gonzalez"
""",
        "/dashboard/account", 4,
    ),

    # ============================================================
    # UNIDROP (especifico)
    # ============================================================
    (
        "unidrop-dropshippers", "unidrop",
        "Dropshippers — vista 360",
        "Listado y detalle de cada dropshipper con todo lo que vende, paga y debe.",
        """`/dashboard/dropshippers` es el listado de **todos los dropshippers** del grupo Unidrop con:
- Estado de suscripcion (MELI / TN / ambos)
- GMV omnicanal (suma de ML + TN)
- Margen Unidrop (lo que se gana sobre cada venta del dropshipper)
- Ultima venta
- Deuda Talo (anticipos sin liquidar)

### Vista 360
Click en cualquier dropshipper -> `/dashboard/dropshipper/[id]` con TODO lo que necesitas saber: ordenes, productos vendidos, clientes finales, notas del equipo, cuentas Talo, etc.
""",
        "/dashboard/dropshippers", 0,
    ),
    (
        "unidrop-saas-metrics", "unidrop",
        "SaaS Metrics",
        "MRR, churn, LTV, payback del modelo de suscripcion Unidrop.",
        """`/dashboard/saas` muestra las metricas de modelo recurrente:
- **MRR** (Monthly Recurring Revenue)
- **Churn rate** mensual + cohortes
- **LTV** (Lifetime Value) promedio
- **CAC payback** (cuantos meses tarda en recuperarse el CAC)
- **Net Revenue Retention**

Tipico dashboard SaaS — util para inversores y para decisiones de pricing.
""",
        "/dashboard/saas", 1,
    ),
    (
        "unidrop-pagos-talo", "unidrop",
        "Pagos Talo",
        "Movimientos en las cuentas Talo de los dropshippers.",
        """`/dashboard/pagos` lista los **payment intents** de Talo (procesador de pagos del grupo) con:
- Dropshipper destino
- Monto + status (pending / paid / failed / cancelled)
- ML orders asociadas (un PI puede agrupar varias ventas)
- Fecha de cobro / liquidacion

### Para que sirve
Para reconciliar pagos contra ventas y detectar errores (PI cobrado pero orden no marcada como paid, o viceversa).
""",
        "/dashboard/pagos", 2,
    ),

    # ============================================================
    # UNIDEV (especifico)
    # ============================================================
    (
        "unidev-devoluciones", "unidev",
        "Devoluciones",
        "Tracking de devoluciones de MELI + TN con motivo + costo.",
        """`/dashboard/devoluciones` te muestra todas las devoluciones del periodo:
- Por canal (ML claim, TN return, otros)
- Por motivo (defectuoso, no coincide, arrepentimiento, etc.)
- Costo de la devolucion (refund + logistica reversa)
- Status (en proceso, completada, disputa)

Util para detectar patrones de calidad o de error de catalogo.
""",
        "/dashboard/devoluciones", 0,
    ),
    (
        "unidev-nlp-causas", "unidev",
        "NLP Causas (Unidev)",
        "Causas de devolucion detectadas con IA a partir del mensaje del cliente.",
        """`/dashboard/dev-nlp` agrupa las devoluciones por **categoria detectada via NLP** del texto del cliente:
- "Producto defectuoso"
- "No es lo que pedi"
- "Llego tarde / cancele"
- "Cambio de opinion"

Para tomar decisiones de mejora: si "no coincide" sube, hay que mejorar las fotos / descripciones.
""",
        "/dashboard/dev-nlp", 1,
    ),
]


def init() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return
    with _LOCK:
        if _INITIALIZED:
            return
        with get_conn() as c, c.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS aprende_lessons (
                    id            BIGSERIAL PRIMARY KEY,
                    slug          TEXT NOT NULL UNIQUE,
                    area_slug     TEXT NOT NULL,
                    title         TEXT NOT NULL,
                    description   TEXT NOT NULL DEFAULT '',
                    content_md    TEXT NOT NULL DEFAULT '',
                    link          TEXT,
                    sort_order    INT NOT NULL DEFAULT 0,
                    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_aprende_lessons_area "
                "ON aprende_lessons (area_slug, sort_order, id)"
            )

            cur.execute("""
                CREATE TABLE IF NOT EXISTS aprende_progress (
                    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    lesson_slug   TEXT NOT NULL,
                    completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (user_id, lesson_slug)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_aprende_progress_user "
                "ON aprende_progress (user_id, completed_at DESC)"
            )

            # Seed idempotente: solo inserta las que no existen.
            for slug, area_slug, title, desc, content, link, order in SEED_LESSONS:
                cur.execute(
                    """
                    INSERT INTO aprende_lessons
                        (slug, area_slug, title, description, content_md, link, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (slug) DO NOTHING
                    """,
                    (slug, area_slug, title, desc, content, link, order),
                )

        _INITIALIZED = True


def _iso(v):
    if v is None:
        return None
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


# ============================================================
# Queries
# ============================================================

def list_areas_with_counts(*, user_id: int) -> list[dict]:
    """Lista las areas activas (con lecciones) + completadas por el user."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT
                l.area_slug,
                COUNT(*) AS total,
                COUNT(p.lesson_slug) AS done
              FROM aprende_lessons l
              LEFT JOIN aprende_progress p
                ON p.lesson_slug = l.slug AND p.user_id = %s
             WHERE l.is_active = TRUE
             GROUP BY l.area_slug
             ORDER BY (l.area_slug = 'general') DESC, l.area_slug ASC
            """,
            (user_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["total"] = int(r.get("total") or 0)
        r["done"] = int(r.get("done") or 0)
        r["pct"] = round((r["done"] / r["total"]) * 100) if r["total"] else 0
    return rows


def list_lessons_for_area(*, area_slug: str, user_id: int) -> list[dict]:
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute(
            """
            SELECT
                l.id, l.slug, l.area_slug, l.title, l.description, l.content_md,
                l.link, l.sort_order, l.created_at, l.updated_at,
                p.completed_at
              FROM aprende_lessons l
              LEFT JOIN aprende_progress p
                ON p.lesson_slug = l.slug AND p.user_id = %s
             WHERE l.is_active = TRUE AND l.area_slug = %s
             ORDER BY l.sort_order, l.id
            """,
            (user_id, area_slug),
        )
        rows = [dict(r) for r in cur.fetchall()]
    for r in rows:
        r["created_at"] = _iso(r.get("created_at"))
        r["updated_at"] = _iso(r.get("updated_at"))
        r["completed_at"] = _iso(r.get("completed_at"))
    return rows


def mark_lesson(*, user_id: int, lesson_slug: str, done: bool) -> dict:
    """Marca o desmarca una leccion como completada. Idempotente."""
    init()
    with get_conn() as c, c.cursor() as cur:
        # Validar que existe la leccion
        cur.execute("SELECT 1 FROM aprende_lessons WHERE slug = %s AND is_active = TRUE", (lesson_slug,))
        if not cur.fetchone():
            raise ValueError(f"leccion no existe o esta inactiva: {lesson_slug}")
        if done:
            cur.execute(
                """
                INSERT INTO aprende_progress (user_id, lesson_slug)
                VALUES (%s, %s)
                ON CONFLICT (user_id, lesson_slug) DO NOTHING
                RETURNING completed_at
                """,
                (user_id, lesson_slug),
            )
            row = cur.fetchone()
            ts = row["completed_at"] if row else None
            return {"lesson_slug": lesson_slug, "completed": True, "completed_at": _iso(ts)}
        else:
            cur.execute(
                "DELETE FROM aprende_progress WHERE user_id = %s AND lesson_slug = %s",
                (user_id, lesson_slug),
            )
            return {"lesson_slug": lesson_slug, "completed": False, "completed_at": None}


def my_progress_summary(*, user_id: int) -> dict:
    """Resumen general: lecciones totales, completadas, % overall."""
    init()
    with get_conn() as c, c.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM aprende_lessons WHERE is_active = TRUE")
        total = int(cur.fetchone()["n"] or 0)
        cur.execute(
            "SELECT COUNT(*) AS n FROM aprende_progress p "
            "JOIN aprende_lessons l ON l.slug = p.lesson_slug AND l.is_active = TRUE "
            "WHERE p.user_id = %s",
            (user_id,),
        )
        done = int(cur.fetchone()["n"] or 0)
    return {
        "total": total,
        "done": done,
        "pct": round((done / total) * 100) if total else 0,
    }
