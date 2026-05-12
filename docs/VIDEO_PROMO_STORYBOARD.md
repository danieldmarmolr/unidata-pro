# Video promocional UNIDATA · Storyboard

**Duración objetivo:** 2:30 - 3:00 minutos
**Tono:** Interno, "nosotros para nosotros", no corporativo Apple
**Plataforma destino:** Microsoft Teams · WhatsApp interno · Confluence
**Formato:** Screen recording con voz en off · sin actor

---

## Setup técnico recomendado

| Item | Recomendación |
|---|---|
| Captura | Camtasia Studio / Screen Studio Mac / OBS · 1080p · 30fps |
| Browser | Chrome incógnito · 1920×1080 · sin extensiones que afeen |
| Cuenta demo | Sub-cuenta admin con onboarding completado pero con perfil neutro |
| Cursor | Highlight automático del cursor (Camtasia tiene built-in) |
| Voz | Grabación posterior con guión escrito · sin improvisación |
| Música | Royalty-free instrumental low-key (ej. Epidemic Sound, plan team) |

## Antes de grabar · checklist

- [ ] Filtro global en `30 dias` (datos significativos sin ser ruidoso)
- [ ] Logueado con cuenta que tenga rol `gerencia` o `admin`
- [ ] Tomi confirmó nameservers + SSL activo (ya hecho ✅)
- [ ] Datos de prueba que NO expongan info sensible (ocultar emails reales si hace falta)
- [ ] Modo claro del browser (vista limpia, no oscuro)
- [ ] Cerrar pestañas de Confluence/Jira/Slack para no ensuciar

---

## Storyboard escena por escena

### 🎬 00:00 - 00:10 · Hook (10s)

**Visual:** Pantalla negra con texto blanco animado, sin app aún.

**Texto animado en pantalla:**
```
3 unidades de negocio.
3 bases de datos distintas.
1 plataforma que las orquesta.
```

**Voz en off:**
> "El Grupo Unistore genera datos en Unistore, Unidrop y Unidev. Hasta hoy, cada decisión necesitaba abrir 3 paneles distintos. Esto es UNIDATA."

**Cierre escena:** Fade in al logo UNIDATA + tagline.

---

### 🎬 00:10 - 00:25 · Onboarding (15s)

**Visual:**
1. Abrir `https://app.unidatacenter.com.ar` en pantalla limpia
2. Mostrar pantalla de login (1s) → click login con cuenta demo
3. Aparece el **modal de onboarding** (no skipear)
4. Mostrar los 4 pasos pasando rápido: Área → Cumple → Aniversario → Hobbies

**Voz en off:**
> "La primera vez, dos minutos. Tu área, tu cumpleaños, cuándo entraste a Unistore. Lo necesitamos para que veas lo que te corresponde y para empezar a contar historias internas."

**Detalle clave:** Mostrar cómo el dropdown de áreas tiene Customer Success, Marketing, IT/Data, etc. — refuerza que es "para nosotros".

---

### 🎬 00:25 - 00:50 · Gerencia cross-unidad (25s)

**Visual:**
1. Click "Cerrar onboarding" → entra al dashboard
2. Mostrar el sidebar con grupos (Principal, Cross, Unistore, Unidrop, Unidev, Datos)
3. Ir a **`/dashboard`** (Gerencia)
4. Scroll lento mostrando:
   - 5 cards arriba (GMV Unistore, Unidrop, MRR, Facturado a Unidrop, Devoluciones)
   - Sección "Salud por unidad de negocio" con 3 cards
   - **Cambiar el filtro de HOY a 30 días** — destacar que TODO se recalcula
   - Donut "Mix de revenue · 30 días" con 5 categorías

**Voz en off:**
> "Una sola vista. GMV de Unistore retail, ventas de los dropshippers en Unidrop, cobranzas de Talo, suscripciones MELI. Todo filtrable por el período que necesites — los números nunca mienten porque cada cifra muestra de dónde sale."

**Detalle clave:** Resaltar la card "Facturado a Unidrop" — esa es la métrica nueva que antes no existía.

---

### 🎬 00:50 - 01:20 · Customer Success (30s)

**Visual:**
1. Sidebar → Cross → **Customer Success** → click "Cohortes"
2. Mostrar las 5 cards de cohorte (Nuevo, Segunda compra, etc) + alertas Posible churn / Perdidos
3. **Click en una etiqueta** (ej. "Recurrente") → tabla aparece arriba con clientes reales
4. Cerrar tabla → ir a "Segmentación RFM"
5. Toggle UNISTORE / UNIDROP — mostrar que funciona para ambos
6. Click en card "Champions" → popup con descripción + "qué hacer" + lista de top 10
7. Ir a "RFM Flows" → click en una fila (ej. `Nuevo este mes → Leales`) → popup con ambas descripciones + lista de clientes específicos

**Voz en off:**
> "Customer Success no es solo dashboards. Es decir 'estos 444 clientes hicieron este movimiento, esto les pasó, y esto es lo que tenés que hacer con ellos'. Cada segmento tiene una acción concreta. Cada transición tiene a quién aplicársela."

**Detalle clave:** El popup de qué-hacer es el diferencial. Resaltar visualmente.

---

### 🎬 01:20 - 01:45 · Producto (25s)

**Visual:**
1. Sidebar → Producto → "Análisis ABC + más" — mostrar segmentación A/B/C rápida
2. Click en un SKU top → entra al **Producto 360** (`/dashboard/productos/[sku]`)
3. Scroll a la sección **"Vista omnicanal del SKU"** — mostrar las 4 cards (Unistore TN/ML + Unidrop TN/ML)
4. Mostrar el bloque de **inconsistencias detectadas** (ej. "Se vende en Unistore pero no en Unidrop")
5. Sidebar → "SKU Optimizer" → mostrar las 4 cards-filtro (Combos, Reposición, Liquidar, Subir precio)
6. Sidebar → "Forecast demanda" → tabla con PO sugerida 30d/60d

**Voz en off:**
> "Un producto en 4 canales. UNIDATA cruza las dos bases para mostrarte cómo se comporta el mismo SKU en cada uno y detectar cuando hay inconsistencias — por ejemplo, que vendés bien en Unistore pero ningún dropshipper lo activó."

**Detalle clave:** El SKU Omnichannel es feature único, no existe en ningún panel hoy del grupo.

---

### 🎬 01:45 - 02:10 · Unidrop · Dropshipper 360 (25s)

**Visual:**
1. Sidebar → Unidrop → "Dropshippers"
2. Mostrar el master list con filtros (plan, riesgo, canal)
3. Buscar "Tienda Pini" en la tabla → click
4. Entra al Dropshipper 360 — destacar:
   - Header con datos personales + plan
   - Bloque violeta "Ventas pagadas a Unidrop" con split TN/ML
   - Suscripciones COMBO XXL con detalle
   - Scroll hasta las tablas inferiores
5. **Mostrar la tabla "Últimas ventas en MELI"** — destacar la columna `Number · DROP`
6. Click un `DROP-14901845-073` → abre nueva pestaña con el detalle de ESA orden en el panel Unidrop

**Voz en off:**
> "Esto va más allá del retail. Acá ves a cada dropshipper como cliente nuestro de la plataforma. Cuántas ventas hizo, cuánto nos facturó, qué suscripción paga. Y cada orden tiene un click directo al panel operativo de Unidrop para resolver problemas en el momento."

**Detalle clave:** El link cross-app es el WOW moment.

---

### 🎬 02:10 - 02:25 · Unidev · NLP causas (15s)

**Visual:**
1. Sidebar → Unidev → "NLP causas (Unidev)"
2. Mostrar las 4 summary cards arriba
3. Scroll por los clusters detectados (Producto defectuoso, Llegó dañado, etc)
4. Click en un cluster → expandir y mostrar 3 muestras de descripciones reales
5. Mostrar el chip de top SKU clickeable

**Voz en off:**
> "Las devoluciones no son ruido. UNIDATA lee las descripciones que escribe el CS, las clusterea automáticamente, y te dice qué SKUs están atrás de cada problema. Si crece 'llegó dañado' este mes, sabés que es empaquetado o courier. Si crece 'producto defectuoso' en un solo SKU, es un problema de lote."

---

### 🎬 02:25 - 02:40 · Stories · comunidad (15s)

**Visual:**
1. Sidebar → Inicio
2. Banner naranja con cumpleaños + aniversarios del mes
3. Hover sobre un cumple → mostrar el área de la persona como chip de color
4. Mostrar también la sección "Mi perfil" como complementaria

**Voz en off:**
> "UNIDATA también es la comunidad interna. Quién cumple años este mes, quién festeja años en el grupo. Los datos cuentan historias — las nuestras también."

---

### 🎬 02:40 - 03:00 · Cierre (20s)

**Visual:**
1. Volver al `/dashboard` (Gerencia) — vista panorámica final
2. Texto animado superpuesto:
   ```
   https://app.unidatacenter.com.ar
   Los datos del Grupo Unistore, orquestados.
   ```
3. Fade out

**Voz en off:**
> "UNIDATA. La plataforma de datos del Grupo Unistore. Hoy, ya está corriendo. Lo que decidamos mañana, lo decidimos con esto."

---

## Recursos visuales

| Asset | Dónde está | Notas |
|---|---|---|
| Logo UNIDATA | `frontend/public/logo.svg` | Vector, escala bien |
| Paleta colores | `tailwind.config.ts` | Violeta primario #7a3eae |
| Tipografía | Inter (web font) | Ya cargada en el frontend |
| Screenshots | Capturás vos en vivo | Mejor que mockups |

## Variantes del video

- **Largo (3 min)** — equipo interno, primer launch
- **Corto (60s)** — Linkedin / posts internos, hits visuales rápidos
- **Tutorial (5 min)** — solo onboarding + Mi perfil para que la gente se anote

## Métricas de éxito (post-lanzamiento)

- Visualizaciones del video
- Cantidad de logins en `/dashboard` la primera semana
- Cuántos onboarding completados (tabla `users.profile_completed=TRUE`)
- Feedback en encuesta post-launch (formulario de 3 preguntas)

---

**Owner:** Daniel Marmol
**Estado:** Storyboard listo · grabación pendiente
**Última actualización:** 12/05/2026
