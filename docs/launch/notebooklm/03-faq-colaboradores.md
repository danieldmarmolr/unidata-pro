# UNIDATA — Preguntas frecuentes

## Acceso

### ¿Cómo pido mi usuario?
Hablá con el admin de UNIDATA por el canal interno habitual. Te crean el usuario con una contraseña temporal y al primer login te pide cambiarla.

### ¿Quién aprueba los accesos?
El admin del proyecto, junto con el responsable del área a la que pertenecés. Cada usuario se asigna a una unidad de negocio (Unistore o Unidrop) y a un rol.

### ¿Necesito VPN o instalar algo?
No. UNIDATA es una web. Abrís el link interno desde cualquier navegador y entrás.

### ¿Funciona en el celular?
Sí. La interfaz se adapta a mobile — útil para revisar un KPI rápido en una reunión o desde casa.

## Datos y permisos

### ¿Qué voy a poder ver?
Depende de tu rol y tu unidad de negocio. Por defecto, ves los dashboards de tu unidad (Unistore o Unidrop). Los admins pueden ver más.

### ¿Por qué Unidrop ve cosas que Unistore no, y viceversa?
Cada unidad de negocio tiene su propia base de datos y sus propios dashboards. Mantenemos esa separación a propósito: protege la información sensible y evita que se mezclen métricas de negocios distintos.

### ¿Los datos son en tiempo real?
Sí — UNIDATA consulta directamente las bases de producción a través de un túnel seguro. Lo que ves es lo que pasó hasta hace minutos, no datos del cierre de ayer.

### ¿Puedo ver datos sensibles, como salarios o info de clientes finales?
No. UNIDATA expone métricas operativas y comerciales, no datos personales sensibles. El acceso a esos sistemas se gestiona por separado.

## SQL libre

### ¿Puedo escribir SQL?
Sí, hay un editor SQL profesional en la sección "SQL libre". Trae syntax highlight, autocomplete y vista del schema.

### ¿Puedo romper algo escribiendo SQL?
No. Es estrictamente solo lectura — no podés ejecutar `INSERT`, `UPDATE`, `DELETE` ni `DROP`. La plataforma rechaza cualquier query de escritura. Tirate a probar tranquilo.

### ¿Hay límite a las queries?
Sí, timeout de 30 segundos por query para evitar consultas que carguen demasiado las bases. Si necesitás algo más pesado, hablá con el equipo de datos.

## Auditoría y seguridad

### ¿Mis queries quedan registradas?
Sí, todas. Hay un log de auditoría que registra quién ejecutó qué query y cuándo. No es para vigilarte — es para trazabilidad y seguridad estándar.

### ¿Es seguro tener todos los datos en una sola plataforma?
Más seguro que tenerlos sueltos en planillas en cada compu. Login con contraseña, roles separados, audit log, conexión a las bases vía túnel SSH cifrado, deploy en infraestructura privada.

## Reportes y exportación

### ¿Puedo exportar lo que veo?
Sí, los dashboards generan reportes PDF descargables. Útil para mandar a un cliente, archivar o presentar en una reunión.

### ¿Y si necesito Excel?
El SQL libre permite exportar resultados de tu query. Si necesitás algo regular en formato planilla, hablá con el equipo para armarlo como dashboard fijo.

## Cambios y feedback

### Encontré un bug, ¿qué hago?
Avisanos por el canal interno de UNIDATA con captura y pasos para reproducirlo. Se prioriza y se corrige — los deploys son automáticos, los fixes salen rápido.

### Quiero un dashboard nuevo o un KPI que no está, ¿cómo lo pido?
Mismo canal interno. Decinos qué pregunta querés responder y de qué área, y vemos cómo armarlo. Los pedidos con caso de uso concreto se mueven más rápido.

### ¿Esto va a seguir creciendo?
Sí. UNIDATA está activa, se actualiza seguido y se siguen sumando dashboards. La idea es que sea **la** plataforma de datos del grupo a largo plazo.

---

**¿Quedó alguna pregunta sin responder?** Pregúntala en el canal interno o probá la sección de chat con NotebookLM cargando este documento — te responde con base en este contenido.
