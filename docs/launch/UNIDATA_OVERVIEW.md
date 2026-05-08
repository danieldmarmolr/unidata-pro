# UNIDATA — Que es, por que existe, y que cambia para Unistore

> Documento narrativo pensado para alimentar a NotebookLM y generar un Audio
> Overview que sirva de presentacion del producto a todo el grupo. Esta escrito
> en prosa, con ejemplos concretos y sin marketing fluff.

---

## El problema que UNIDATA resuelve

En Unistore, los datos que mueven el negocio viven dispersos en tres bases de
datos productivas — una por unidad de negocio. Estan en una nube privada de
Amazon Web Services y solo se pueden consultar pasando por un bastion de
seguridad y abriendo un tunel encriptado contra la base de datos. Eso significa
que en la practica solo dos o tres personas con conocimiento tecnico pueden
extraer informacion. El resto del equipo — gerencia, ventas, marketing,
logistica, operaciones — depende de pedir reportes manuales, esperar que alguien
del area de datos tenga tiempo, y recibir un Excel armado con suposiciones que
no siempre coinciden con la pregunta original.

Esa friccion tiene tres consecuencias dolorosas. La primera es que muchas
decisiones se toman con intuicion en lugar de con datos, simplemente porque
conseguir el dato cuesta horas o dias. La segunda es que el conocimiento queda
encerrado en pocas cabezas — si esa persona se va de vacaciones, el flujo de
informacion se corta. La tercera es que la gente que mas necesita ver el pulso
del negocio, los gerentes y analistas operativos, son justamente los que mas
sufren la espera.

UNIDATA nace para romper ese cuello de botella.

---

## Que es UNIDATA en una sola frase

**UNIDATA es la plataforma interna de analitica del grupo Unistore: un solo
lugar al que cualquier colaborador con email corporativo puede entrar para ver
en tiempo real lo que pasa en Unistore, Unidev y Unidrop, hacer sus propias
preguntas a los datos, y compartir hallazgos con el equipo.**

No reemplaza a nadie. No automatiza decisiones. No saca a las personas del
proceso. Lo que hace es bajar a casi cero el costo de hacerle una pregunta
concreta a los datos, y eso cambia como se trabaja.

---

## Como se usa, en concreto

Imaginate que sos gerente comercial de Unistore. Llegas un lunes a la oficina y
queres saber: "como vinieron las ventas del fin de semana, comparado con el
fin de semana anterior, separado por provincia". Hoy eso es un mensaje de
Slack a alguien del area de datos, una espera de varias horas, y un Excel que
quizas responda lo que preguntaste.

Con UNIDATA, abris la url de la app, te logueas con tu mail @unistore.ar,
elegis el dashboard "HOY" de Unistore, y en cinco segundos tenes los KPIs
del fin de semana actual con la comparacion contra el anterior. Si queres mas
detalle, hacés click sobre cualquier numero y se abre el drilldown — la
lista de las ordenes especificas que componen ese total. Si queres ir a un
nivel mas profundo, abris la pestana de SQL libre y escribis tu propia
consulta — pero solo de lectura, asi nunca podes romper nada.

Ese es el ciclo: pregunta, respuesta, profundizacion, exportacion. Todo en
minutos, sin pedir permiso a nadie.

---

## Que tiene UNIDATA en esta primera version

En el primer release que se acaba de poner en produccion, UNIDATA ofrece tres
grandes capacidades.

**La primera es el dashboard "HOY" para las tres unidades de negocio.** En una
sola pantalla, segmentado por unidad, se ve el pulso del dia: ventas, ordenes,
clientes activos, comparaciones con periodos anteriores. Cada metrica es
clickeable y abre el detalle de las filas que la componen — las ordenes
especificas, los productos, los clientes, las provincias. Tambien hay un mapa
interactivo de Argentina con las 24 provincias coloreadas por volumen, asi se
ve de un vistazo donde se concentra la actividad.

**La segunda es el editor SQL libre.** Para los analistas y miembros del
equipo de datos que necesitan ir mas alla de los dashboards predefinidos,
UNIDATA tiene una pestana donde se puede escribir cualquier consulta de
lectura sobre las bases de produccion. La plataforma valida que la consulta
sea solo de lectura — no se puede borrar, modificar ni crear nada — y aplica
un timeout de treinta segundos para que ninguna consulta pesada afecte al
sistema. Cada consulta queda registrada en un audit log con el usuario, la
SQL exacta, la duracion y el resultado, asi siempre hay trazabilidad de
quien preguntó qué.

**La tercera es la gestion segura de usuarios.** UNIDATA permite que cada
colaborador con email @unistore.ar se registre solo, sin pedir cuenta al
admin. La primera vez setea su contrasena, despues entra normalmente. Hay
roles definidos — lector, analista, gerencia, admin — y cada rol ve un
subconjunto de las pantallas, asi una persona de marketing no ve datos
financieros sensibles a menos que se le otorgue ese permiso explicitamente.

---

## Que NO hace UNIDATA, para ser claros

UNIDATA no escribe en las bases de produccion. Nunca. La arquitectura misma
lo impide: el codigo bloquea cualquier consulta que no empiece con SELECT, y
el usuario de base de datos que se usa solo tiene permisos de lectura. Si
alguien intenta correr un DELETE, un UPDATE o un DROP, la plataforma lo
rechaza antes de siquiera tocar la base.

UNIDATA tampoco automatiza decisiones de negocio. No es una herramienta de
inteligencia artificial generativa. No "predice" ni "recomienda" nada por su
cuenta. Es una herramienta de visibilidad y exploracion — la inteligencia
sigue siendo de la persona que la usa.

UNIDATA tampoco reemplaza al equipo de datos. Al contrario: les saca de
encima las preguntas operativas repetitivas y les permite enfocarse en
analisis profundos, modelos, y proyectos estrategicos.

---

## Como se eligio el stack tecnologico

UNIDATA esta construido con tecnologias modernas y maduras, todas
probadas en produccion por empresas mucho mas grandes que Unistore. El
backend es FastAPI, un framework Python conocido por su velocidad y por la
calidad de sus apis. El frontend es Next.js 16, la version mas reciente del
framework de React mas usado del mundo. La base de datos propia de UNIDATA
— donde viven los usuarios y el audit log — es PostgreSQL alojada en
Supabase, con backups automaticos diarios. La infraestructura corre en
Railway, con auto-deploy desde GitHub, asi cada cambio aprobado pasa a
produccion en minutos.

La seguridad fue prioridad desde el primer dia. Las contrasenas se guardan
hasheadas con bcrypt — nadie, ni siquiera el admin, puede ver la
contrasena en plano de un usuario. La comunicacion entre el navegador y el
servidor va por HTTPS encriptado. El acceso a las bases de produccion va por
SSH bastion con doble factor: la IP del servidor de UNIDATA tiene que estar
en una lista blanca, y ademas hay que tener la llave privada de acceso. Si
una persona deja Unistore, solo hay que desactivar su cuenta en UNIDATA y
pierde acceso instantaneamente.

---

## Que viene despues

Esta version inicial es lo que se llama un MVP — Minimo Producto Viable. La
intencion es ponerlo en mano de los primeros usuarios reales y aprender de
ellos antes de seguir construyendo. Hay un roadmap claro de lo que viene en
las proximas semanas y meses.

**En las proximas dos semanas**, UNIDATA va a sumar un wizard de
enriquecimiento de perfil. La idea es simple: cada colaborador completa
campos sobre su area, posicion, equipo, skills, idiomas, modalidad de trabajo.
Esto convierte a UNIDATA en una segunda capa de valor — no solo se ven los
datos del negocio, tambien se ve quien sabe que en el grupo, quien podria
ayudar en un proyecto, quien tiene un skill que estabas buscando. Empieza a
funcionar como una pequeña red social interna basada en datos profesionales.

**En el siguiente mes**, se va a sumar un dashboard especial para la gerencia
de People — la gente de recursos humanos. Headcount por area, distribucion
de skills, adopcion de UNIDATA por equipo, funnel de onboarding, cumpleaños,
aniversarios. Todo con una vision agregada y respetando la privacidad de
cada colaborador, que sigue eligiendo que campos comparte y con quien.

**Mas adelante**, vienen integraciones con Microsoft 365 para login con un
solo click, busqueda inteligente, mentor matching automatico entre
colaboradores con perfiles complementarios, exports en PDF con el branding
de Unistore, y mucho mas.

---

## Un mensaje a los primeros usuarios

UNIDATA esta vivo. Funciona. Pueden registrarse hoy mismo y empezar a
explorar. Los datos del negocio van a empezar a fluir en cuanto el equipo de
infraestructura termine de habilitar la conexion segura — ese ultimo paso
esta en proceso esta semana — pero la app, las pantallas, el flujo de
registro, todo lo demas, ya esta funcionando.

Lo que pedimos del equipo en este primer momento es simple. Primero,
registrense en la plataforma con su email corporativo. Segundo, exploren las
pantallas para familiarizarse con la herramienta. Tercero, manden feedback —
que les gustaria ver, que no entienden, que se sienta lento, que les falta.
UNIDATA mejora rapido cuando hay feedback rapido.

Y si en las proximas semanas reciben un pedido para completar su perfil —
area, skills, idiomas — sepan que no es un capricho de RRHH. Es la pieza
que convierte a UNIDATA de "una herramienta donde miro datos del negocio"
en "una plataforma donde tambien me encuentran a mi cuando alguien busca un
skill que tengo, y donde tengo data de mis colegas para colaborar mejor".

La data esta presente en todo. Hace mas de un ano que decimos eso en
Unistore. UNIDATA es la primera herramienta interna que hace que esa frase
sea operativa.

---

*UNIDATA — Plataforma de analitica interna del grupo Unistore.*
*Owner: Daniel Marmol · daniel.marmol@unistore.ar*
*Repo: github.com/danieldmarmolr/unidata-pro*
