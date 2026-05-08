# UNIDATA — Launch Package

Carpeta con todo el material para el lanzamiento de UNIDATA V1 al equipo de Unistore.

---

## Contenido

| Archivo | Para que sirve | Audiencia |
|---|---|---|
| **[UNIDATA_OVERVIEW.md](./UNIDATA_OVERVIEW.md)** | Narrativa larga (~2000 palabras) que explica el problema, la solucion, el stack y el roadmap. **Optimizada para alimentar a NotebookLM y generar un Audio Overview**. | Todo el equipo (audio + lectura) |
| **[FEATURES_V1.md](./FEATURES_V1.md)** | Lista honesta y conservadora de capacidades disponibles HOY (1.0.0-mvp), separadas de las que vienen en proximos sprints. Sin sobre-promesas. | Stakeholders, gerencia, futuros usuarios |
| **[INVITATION.md](./INVITATION.md)** | 3 versiones del mensaje de invitacion: Slack informal, email formal, talking points para reunion en vivo. Mas tips de potenciacion del lanzamiento. | Daniel (para distribuir) |

---

## Como usar este paquete

### Paso 1 — Generar el Audio Overview en NotebookLM

1. Ir a https://notebooklm.google.com
2. **New notebook** -> **Add sources** -> **Markdown text**
3. Pegar el contenido de `UNIDATA_OVERVIEW.md`
4. (Opcional) sumar tambien `FEATURES_V1.md` para que NotebookLM tenga la
   lista exacta de funcionalidades disponibles
5. Click en **Audio Overview** -> **Generate**
6. NotebookLM genera un podcast de 5-10 minutos con dos voces conversacionales
   discutiendo el contenido
7. Descargar el audio como `.mp3` o compartir el link directo

### Paso 2 — Mandar la invitacion

1. Elegir la version de `INVITATION.md` segun canal:
   - Slack -> Version 1 (informal, con emojis)
   - Email a gerencia -> Version 2 (formal)
   - Reunion en vivo -> Version 3 (bullets para hablar)
2. Personalizar nombres/links si hace falta
3. Adjuntar el audio del podcast NotebookLM como "para los que prefieren
   escuchar antes que leer"

### Paso 3 — Seguimiento en la primera semana

- Crear canal `#unidata` en Slack para centralizar feedback
- Hacer una demo en vivo de 10 minutos en una standup/all-hands
- Responder rapido a bugs reportados (todo va al `docs/PLAN_JIRA.md`)
- Anotar metricas basicas: cuantos se registraron, cuantos hicieron al menos
  un login, cuantos exploraron mas de un dashboard

### Paso 4 — Sprint 2 (semana siguiente)

- Activar el wizard de perfil enriquecido (US-12)
- Mandar un segundo anuncio: "completá tu perfil y empezamos a funcionar
  como red interna"

---

## Principios al hablar de UNIDATA externamente

### Hacer

- **Honestidad sobre el estado.** Si algo todavia no funciona (datos de
  negocio en vivo dependen de IT), decirlo claro.
- **Concreto antes que abstracto.** "Ver ventas del fin de semana por
  provincia" pega mas que "potencial analitica multidimensional".
- **Foco en el problema que resuelve.** Friccion para conseguir datos =
  decisiones lentas. UNIDATA elimina esa friccion.
- **Respetar el rol del area de datos.** UNIDATA no los reemplaza,
  los empodera para enfocarse en proyectos profundos.

### No hacer

- **No usar lenguaje hyperbolico.** "Revolucionario", "disruptivo", "AI
  inteligente" — todo eso aleja a usuarios serios.
- **No sobre-prometer features de Sprint futuros.** El People Module se
  menciona como "viene despues", no como "ya hace X".
- **No asustar con detalles tecnicos.** El stack lo presentamos como
  "moderno y maduro"; los detalles van en `ARCHITECTURE.md`.
- **No ignorar la privacidad.** El People Module trae visibilidad granular
  desde dia 1 — eso es una feature, no una restriccion.

---

## Metricas de exito del lanzamiento (sugeridas)

Para evaluar como salio en las primeras 2 semanas:

| Metrica | Target conservador | Target optimista |
|---|---|---|
| Usuarios registrados | 10 | 25 |
| Usuarios que hicieron al menos 1 login | 8 | 22 |
| Usuarios activos en una semana (login + nav) | 5 | 18 |
| Bugs reportados | 5+ | 15+ (mas reportes = mas uso) |
| Feedback positivo cualitativo | 3+ | 10+ |

(Una vez que el ANL Sprint este implementado, estas metricas las podemos
ver en el dashboard `/admin/analytics` automaticamente.)
