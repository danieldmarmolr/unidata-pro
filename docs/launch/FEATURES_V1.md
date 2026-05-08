# UNIDATA V1 — Lo que se puede hacer hoy

> Lista honesta y conservadora de capacidades disponibles en la version
> 1.0.0-mvp publicada el 2026-05-08. Sin marketing fluff, sin
> sobre-promesas. Lo que esta marcado como "habilitandose" es real-data
> dependiente del equipo de IT.

---

## Cuenta y acceso

| Capacidad | Estado | Notas |
|---|---|---|
| Registrarse con email `@unistore.ar` | ✅ Disponible | Self-service, sin pedir permisos |
| Setear contrasena en primer login | ✅ Disponible | Minimo 6 caracteres |
| Login y mantenerse logueado 12 hs | ✅ Disponible | JWT con expiry automatico |
| Cambiar mi propia contrasena | ✅ Disponible | Desde "Mi cuenta" |
| "Olvide mi contrasena" auto-recovery | ⏳ Sprint 2 | Por ahora pedir al admin |
| Login con Microsoft 365 | ⏳ Sprint 3 | Coexiste con login normal |

---

## Roles y permisos

| Rol | Que puede ver |
|---|---|
| `lector` | Dashboards basicos + sus propios datos. Default al registrarse. |
| `analista` | + Editor SQL libre + drilldowns completos |
| `gerencia` | + Dashboards ejecutivos (ventas, margenes, mapa Argentina) |
| `admin` | + Gestion de usuarios + audit log + configuracion |
| `user` | Rol legacy, sin uso recomendado |

**Promocion de rol:** la hace un admin desde `/admin/usuarios`.

---

## Vista de datos de negocio

| Capacidad | Estado | Notas |
|---|---|---|
| Dashboard "HOY" para Unistore | ⏳ Habilitandose | UI lista, datos en cuanto termine config IT |
| Dashboard "HOY" para Unidev | ⏳ Habilitandose | idem |
| Dashboard "HOY" para Unidrop | ⏳ Habilitandose | idem |
| Comparacion vs ayer / semana anterior | ⏳ Habilitandose | Toggle en top de cada dashboard |
| Filtro de fechas global (hoy / 7d / 30d / custom) | ✅ UI lista | Datos en cuanto este IT |
| Mapa Argentina por provincia | ⏳ Habilitandose | 24 provincias con drilldown |
| Drilldown a ordenes especificas | ⏳ Habilitandose | Click en cualquier metrica |
| Click en order_id -> abre Tienda Nube | ✅ Disponible | Linkea a `unistore8.mitiendanube.com/admin/orders/...` |
| Catalogo de costos importables | ✅ Disponible | UI funcional, requiere datos |

> Nota: "habilitandose" significa que la UI ya esta deployada y funcional, pero
> los datos en vivo dependen de que el equipo de IT (Mauro Candia) habilite el
> acceso a las BBDD de produccion para la IP de UNIDATA. Esto es un cambio en
> reglas de firewall AWS, y se procesa esta semana.

---

## Editor SQL libre (read-only)

| Capacidad | Estado |
|---|---|
| Escribir consultas SQL custom | ✅ UI lista |
| Validacion: solo SELECT y WITH | ✅ Disponible |
| Bloqueo de DML/DDL (INSERT, UPDATE, DELETE, DROP, etc.) | ✅ Disponible |
| Statement timeout 30 segundos | ✅ Disponible |
| Resultados truncados a 5000 filas | ✅ Disponible |
| Audit log de cada query | ✅ Disponible |
| Export del resultado a CSV | ✅ Disponible |
| Sintaxis highlighting en el editor | ⏳ Sprint 2 |
| Sugerencias de tablas / columnas | ⏳ Sprint 3 |

---

## Exports

| Capacidad | Estado |
|---|---|
| Export tabla actual a CSV (UTF-8 BOM, abre OK en Excel) | ✅ Disponible |
| Export a PDF con branding Unistore | ⏳ Sprint 3 |
| Export a Excel nativo (.xlsx) | ⏳ Sprint 3 |
| Export programado por email | ⏳ Sprint 4 |

---

## Auditoria y seguridad

| Capacidad | Estado |
|---|---|
| Log persistente de cada query SQL | ✅ Disponible |
| Vista de audit log por admin | ✅ Disponible |
| Vista de audit log de mi propia actividad | ⏳ Sprint 2 |
| Rate limiting en login (anti-brute-force) | ⏳ Sprint 2 |
| 2FA para admins | ⏳ Sprint 3 |
| HTTPS en todas las conexiones | ✅ Disponible |
| Passwords hasheadas con bcrypt | ✅ Disponible |

---

## Gestion de usuarios (solo admin)

| Capacidad | Estado |
|---|---|
| Lista de usuarios con filtros | ✅ Disponible |
| Crear usuario manualmente (sin self-registration) | ✅ Disponible |
| Editar nombre, rol, estado | ✅ Disponible |
| Resetear contrasena de un usuario | ✅ Disponible |
| Desactivar usuario (soft delete) | ✅ Disponible |
| Ver pendientes de password (post-self-registration sin haber seteado) | ⏳ Sprint 2 |

---

## Datos del colaborador (People Module)

> **Toda esta seccion entra en Sprint 2 / 3.** Hoy en la version 1.0.0-mvp,
> UNIDATA solo tiene email + nombre + rol por usuario.

| Capacidad | Estado | Etapa planificada |
|---|---|---|
| Mi perfil enriquecido (area, posicion, skills, idiomas) | ⏳ | Sprint 2 |
| Wizard de onboarding rico | ⏳ | Sprint 2 |
| Encontrar colegas similares | ⏳ | Sprint 3 |
| Network graph del equipo | ⏳ | Sprint 3 |
| Dashboard People Analytics (RRHH) | ⏳ | Sprint 3 |
| Timeline de hitos profesionales | ⏳ | Sprint 4 |
| Privacidad granular por campo | ⏳ | Sprint 4 |
| Audit log de quien vio mi perfil | ⏳ | Sprint 4 |

---

## Resumen ejecutivo

**Que pueden hacer los usuarios HOY mismo:**
- Registrarse y autogestionarse su contrasena.
- Explorar la UI completa de UNIDATA.
- Familiarizarse con el flujo de dashboards y SQL libre.
- Entender que les va a permitir cuando los datos esten en vivo.

**Que van a poder hacer en cuanto IT termine la config (esta semana):**
- Ver datos en vivo de Unistore, Unidev y Unidrop.
- Hacer drilldowns y exports reales.
- Correr SQL custom contra las bases de produccion.

**Que viene en las proximas 2-3 semanas:**
- Completar su perfil enriquecido.
- Ver datos de sus colegas y equipos.
- Empezar a tener dashboards de People para RRHH.
