# UNIDATA — Material para invitar al equipo

3 versiones del mensaje de invitacion segun canal y tono. Todos coherentes con
lo que la app realmente hace hoy (no sobre-promete).

---

## Version 1 — Slack / mensaje informal al grupo

> Para mandar al canal #general o equivalente.

```
Hola equipo!

Estamos lanzando UNIDATA, la nueva plataforma interna de analitica del
grupo Unistore. Ya pueden registrarse y empezar a conocer la herramienta.

🔗 Como entrar:
   https://frontend-production-7d1c.up.railway.app/register

⚡ Que les va a permitir cuando este 100% conectada:
   - Ver el pulso de Unistore, Unidev y Unidrop en tiempo real
   - Hacer sus propias consultas SQL (read-only) sobre las bases de prod
   - Drilldown en cualquier metrica para ver el detalle
   - Export a CSV de cualquier tabla
   - Mapa Argentina con datos por provincia

⏳ Importante:
Esta semana estamos terminando la habilitacion de red con IT (la conexion
segura a las bases productivas). Mientras eso se completa, pueden registrarse
y explorar la UI - los datos en vivo van a empezar a fluir solos en cuanto
este listo, sin que tengan que hacer nada.

📅 Que viene la proxima semana:
Vamos a sumar un mini-wizard donde completen su perfil profesional (area,
skills, idiomas) - asi UNIDATA empieza a funcionar tambien como red interna
del equipo.

Cualquier feedback, bug o sugerencia: respondan este hilo o me escriben
directo. La idea es iterar rapido con feedback real de uso.

Daniel
daniel.marmol@unistore.ar
```

---

## Version 2 — Email mas formal

> Para mandar a gerencia / management que prefieren mail antes que Slack.

**Subject:** UNIDATA - Nueva plataforma interna de analitica del grupo Unistore

---

Estimadas y estimados,

Les escribo para anunciar el lanzamiento de **UNIDATA**, la primera plataforma
interna de analitica de datos del grupo Unistore.

**Que es:**
UNIDATA es un punto unico de entrada para que cualquier colaborador con
email corporativo pueda consultar el pulso del negocio de Unistore, Unidev y
Unidrop en tiempo real, hacer sus propias preguntas a los datos, y compartir
hallazgos con su equipo - todo sin pedir reportes manuales al area de datos.

**Que cambia para el equipo:**
- Decisiones operativas con datos en vez de intuicion
- Auto-servicio para preguntas que hoy requieren un pedido + espera
- Drilldowns para profundizar en cualquier metrica
- Editor SQL libre (solo lectura) para analisis ad-hoc
- Audit log completo - todo queda registrado y trazable

**Como acceder:**
URL: https://frontend-production-7d1c.up.railway.app/register
Login: con su email @unistore.ar
Roles: por default todos arrancan como "lector"; gerencias y analistas se
       promueven manualmente.

**Estado actual:**
La plataforma esta deployada en produccion. Esta semana se termina la
habilitacion de red con el area de IT (Mauro Candia gestionando el cambio
de Security Group en AWS para que UNIDATA pueda conectarse a las bases
productivas). Mientras tanto, pueden registrarse y explorar la UI - los
datos en vivo se activan automaticamente cuando IT confirme.

**Roadmap proximo:**
- Sprint 2 (semana siguiente): wizard de perfil enriquecido
- Sprint 3 (mes siguiente): dashboards de People Analytics para RRHH
- Sprint 3+: integracion con Microsoft 365 SSO

Quedo a disposicion para cualquier consulta, feedback o coordinacion.

Saludos,
Daniel Marmol
daniel.marmol@unistore.ar

---

## Version 3 — Para incluir en una reunion / presentacion (talking points)

> Bullets cortos para usar en una presentacion verbal de 5 minutos.

**Apertura (30 segundos):**
> "Hoy lanzamos UNIDATA. Es la primera plataforma interna de analitica del
> grupo. Lo que les voy a mostrar son tres cosas: que es, como se usa, y
> que viene despues."

**Que es (1 min):**
- Un solo lugar para ver datos de Unistore, Unidev y Unidrop.
- Cualquiera con email @unistore.ar puede registrarse en 30 segundos.
- Tres tipos de uso: dashboards predefinidos, drilldowns, SQL libre.
- Todo read-only, todo auditado, todo seguro.

**Como se usa (2 min):**
- Demo en vivo: registro -> dashboard HOY -> drilldown -> export CSV.
- Mostrar el editor SQL con un ejemplo simple ("ventas del fin de semana
  por provincia").
- Mostrar como se ven los roles en `/admin/usuarios`.

**Que viene (1 min):**
- Esta semana: terminar config de red con IT (Mauro).
- Proxima semana: wizard de perfil enriquecido.
- Mes 2: dashboards de People para RRHH.
- Mes 3+: SSO con Microsoft 365, network graph, mentor matching.

**Cierre (30 segundos):**
> "El registro esta abierto desde ya. Dense una vuelta, exploren, y manden
> feedback. Cuanta mas gente lo use esta primera semana, mas rapido podemos
> iterar y hacerlo util de verdad."

---

## Tips para potenciar el lanzamiento

1. **Hacer una demo en vivo**, no solo mandar el link. Compartir pantalla
   en una standup o en un all-hands de 10 min hace mucho mas que un mensaje
   de texto.

2. **Mostrar el problema antes de la solucion.** Empezar con "hoy si yo
   quiero saber X tengo que pedirselo a Y, esperar Z horas, y..." pega
   mucho mas fuerte que "tenemos una nueva herramienta!".

3. **Compartir un ejemplo concreto.** Una pregunta especifica que UNIDATA
   responde en 5 segundos vs el flujo actual.

4. **Pedir feedback explicito.** "Quien encuentre algo confuso o roto en
   la primera semana se gana un cafe del owner". Suena tonto pero
   funciona — la gente quiere ayudar cuando sienten que su input cuenta.

5. **Usar el podcast generado por NotebookLM** como contenido secundario.
   Mandarlo el dia 2 o 3 con "para los que prefieren escuchar antes que
   leer, el equipo de Marketing armó un audio overview de 5 minutos".

6. **Aniadir un canal #unidata** en Slack para que el feedback se
   centralize. Asi se ve quien participa y se evita repetir respuestas.
