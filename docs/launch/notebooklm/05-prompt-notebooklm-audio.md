# UNIDATA — Prompt para Audio Overview de NotebookLM

Pegá el contenido del bloque de abajo en el campo **"Customize"** del Audio Overview en NotebookLM, después de subir como sources los archivos `01-brief-promocional.md`, `02-tour-dashboards.md` y `03-faq-colaboradores.md`.

---

## Cómo usarlo paso a paso

1. Entrá a **notebooklm.google.com** y creá un nuevo notebook.
2. En "Sources", subí estos tres archivos:
   - `01-brief-promocional.md`
   - `02-tour-dashboards.md`
   - `03-faq-colaboradores.md`
3. En el panel "Studio" (derecha), ubicá **Audio Overview** y hacé click en los tres puntos → "Customize".
4. Pegá el prompt del bloque siguiente.
5. Dale "Generate". Tarda 3–8 minutos.
6. Cuando esté listo, descargá el .mp3 o compartilo por link.

---

## Prompt para pegar en Customize

```
Generá una conversación tipo podcast de 6 a 8 minutos en ESPAÑOL RIOPLATENSE (Argentina), entre dos personas, presentando UNIDATA — la nueva plataforma de datos del grupo Unistore — a colaboradores internos no técnicos.

AUDIENCIA:
Empleados del grupo Unistore (Unidrop, Unidev, Unifull). Mezcla de áreas: producto, finanzas, marketing, operaciones, comercial, customer success, liderazgo. La mayoría no son técnicos, no programan ni saben SQL. Algunos sí.

TONO:
Entusiasta pero profesional. Como dos colegas contando algo realmente bueno que les cambió el laburo. Concreto, con ejemplos. Cero marketing vacío. Cero corporativismo. Que se sienta humano, no comercial.

ESTRUCTURA SUGERIDA:
1. Apertura corta — el problema cotidiano (esperar reportes, datos dispersos)
2. Qué es UNIDATA en lenguaje simple
3. Recorrido por los dashboards más importantes, agrupados por área (no los nombres uno a uno — agrupar por para qué sirven)
4. Diferenciales clave: roles separados, SQL seguro, mobile, audit log
5. Cómo se pide acceso y qué experiencia tiene un usuario nuevo
6. Cierre con un mensaje aspiracional realista — no hyperbólico

INSTRUCCIONES IMPORTANTES:
- Hablá SIEMPRE en español rioplatense ("vos", "tenés", "querés", "che" si fluye natural — sin forzar)
- NUNCA digas: "revolucionario", "game-changer", "disruptivo", "next level", "imaginate un mundo donde…", "la inteligencia artificial cambia todo"
- NO inventes features, números ni casos de éxito que no estén en las fuentes
- Si alguien hipotéticamente pregunta algo no cubierto en las fuentes, que el otro responda "eso lo confirmás con el equipo de UNIDATA" en lugar de inventar
- Mencioná concretamente algunos dashboards reales: Home, Ventas, Finanzas, Marketing, Logística, SQL libre, Audit
- Mencioná la separación de Unistore vs Unidrop como un feature de seguridad, no como una limitación
- Ejemplos concretos > frases generales. En lugar de "te ayuda a tomar mejores decisiones", decir "abrís Ventas y ves qué canal vendió más esta semana"
- Cerrá con una llamada a la acción clara: pedir acceso por el canal interno

DURACIÓN: 6 a 8 minutos. Si tenés que recortar, recortá los detalles técnicos antes que los ejemplos por área.
```

---

## Variantes opcionales

### Versión más corta (3–4 minutos)
Si querés algo para mandar por WhatsApp interno, cambiá la última línea del prompt por:
> DURACIÓN: 3 a 4 minutos. Foco en problema → qué es → 3 ejemplos por área → cómo pedir acceso.

### Versión solo para liderazgo
Cambiá la sección AUDIENCIA por:
> AUDIENCIA: Gerencias y dirección del grupo Unistore. Foco en visión ejecutiva, KPIs de negocio, ROI del proyecto y cómo acelera la toma de decisiones. Menos énfasis en SQL y power users.

### Versión solo para data analysts / equipo técnico
Cambiá AUDIENCIA por:
> AUDIENCIA: Data analysts, devs y power users del grupo. Foco en SQL libre, schema introspection, audit log, separación por unidad de negocio, seguridad (read-only, timeout 30s, túnel SSH). Menos énfasis en dashboards visuales.

---

## Tip final

NotebookLM también te genera **Briefing Doc**, **Study Guide** y **FAQ** automáticos a partir de las mismas fuentes. Probá generar los cuatro formatos — el Briefing Doc te queda buenísimo para mandar por mail formal, el FAQ se complementa con el `03-faq-colaboradores.md` que ya escribimos.
