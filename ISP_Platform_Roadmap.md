# ISP Platform — Roadmap de desarrollo

---

## Estructura del monorepo

```
isp-platform/
├── backend/
│   ├── app/
│   │   ├── api/              # Routers FastAPI por módulo
│   │   ├── models/           # Modelos SQLAlchemy
│   │   ├── schemas/          # Pydantic schemas
│   │   ├── services/         # Lógica de negocio
│   │   │   ├── mikrotik/     # librouteros — queues, PPPoE, firewall
│   │   │   ├── sri/          # Módulo facturación electrónica
│   │   │   └── notifications/
│   │   ├── workers/          # Tareas Celery
│   │   ├── core/             # Config, auth, seguridad
│   │   └── main.py
│   ├── alembic/
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/       # Componentes reutilizables
│   │   ├── pages/            # Vistas por módulo
│   │   ├── hooks/            # Custom hooks (useRouter, useTraffic…)
│   │   ├── stores/           # Zustand stores
│   │   ├── services/         # Llamadas a la API
│   │   └── lib/              # Utils, validaciones Zod
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── Dockerfile
├── mobile/
│   ├── app/                  # Expo Router (file-based routing)
│   ├── components/
│   └── app.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx/
│   └── nginx.conf
└── .github/
    └── workflows/
        └── ci.yml
```

---

## Fase 1 — Fundación: infraestructura y núcleo

**Duración estimada:** 3–4 semanas  
**Objetivo:** Proyecto funcionando con auth, multi-router y conexión a MikroTik verificada.

### 1.1 Setup del proyecto

- [x] Crear monorepo con carpetas `backend/`, `frontend/`, `mobile/`
- [x] Configurar `docker-compose.yml` con servicios: `api`, `postgres`, `redis`, `celery-worker`, `adminer`
- [x] Estructura de carpetas FastAPI: `/api`, `/models`, `/schemas`, `/services`, `/workers`, `/core`
- [x] Configurar Alembic para migraciones de base de datos
- [x] Pydantic Settings v2 con validación de variables de entorno (`.env`)
- [x] Configurar Ruff + Black (Python) y ESLint + Prettier (TypeScript)
- [x] Setup Vite + React + TypeScript + Tailwind CSS + shadcn/ui
- [x] GitHub Actions CI: lint + tests en cada push a `main`

### 1.2 Autenticación y usuarios

- [x] Modelo `User`: id, nombre, email, contraseña (bcrypt), rol (admin / técnico / viewer), activo
- [x] Endpoints JWT: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`
- [x] Middleware de permisos por rol con decoradores FastAPI
- [x] Gestión de sesiones (refresh tokens) en Redis con TTL
- [x] UI: pantalla de login con Tailwind + shadcn/ui, guards de rutas React Router
- [x] UI: panel de gestión de usuarios (solo admin)

### 1.3 Modelo multi-router

- [x] Modelo `Router`: id, nombre, ip, usuario_api, contraseña (Fernet cifrada), activo, modelo_hw, notas
- [x] Servicio `RouterPool`: pool de conexiones `librouteros` por `router_id`, con reconexión automática
- [x] Health check automático cada 60 s (Celery Beat) → estado en Redis
- [x] Endpoint `GET /routers/{id}/status`: ping, versión RouterOS, uptime, interfaces
- [x] UI: CRUD de routers con indicador de estado en tiempo real (verde/rojo/amarillo)
- [x] UI: test de conexión manual desde el formulario

---

## Fase 2 — Clientes, colas y suspensión

**Duración estimada:** 4–5 semanas  
**Objetivo:** Gestión completa del ciclo de vida de un cliente con IP estática: alta, asignación de plan, cambio de BW y suspensión/reactivación desde la plataforma.

### 2.1 Gestión de clientes

- [x] Modelo `Client`: id, nombre, cédula, teléfono, dirección, coordenadas GPS, router_id, tipo (static/pppoe), activo
- [x] Modelo `Plan`: id, nombre, velocidad_down_mbps, velocidad_up_mbps, precio
- [x] Modelo `ClientPlan`: cliente_id, plan_id, fecha_inicio, fecha_fin, estado (activo/suspendido/cancelado)
- [x] CRUD completo de clientes con validaciones de cédula ecuatoriana
- [x] UI: listado con filtros dinámicos (router, plan, estado, zona) + paginación
- [x] UI: formulario de nuevo cliente con mapa Leaflet para marcar coordenadas GPS
- [x] UI: perfil de cliente — historial de planes, suspensiones, pagos y tickets

### 2.2 IP estáticas y sincronización MikroTik

- [x] Modelo `StaticIP`: cliente_id, ip, router_id, mac (opcional), notas
- [x] Servicio: al crear cliente → agregar IP a `/ip firewall address-list list=clientes`
- [x] Importar clientes existentes del router (address-list → BD)
- [x] Validación: IP no duplicada dentro del mismo router
- [x] Endpoint `POST /clients/{id}/sync-router`: forzar sincronización manual

### 2.3 Colas de ancho de banda

- [x] Servicio `QueueService`: crear Simple Queue hija bajo cola padre por router
- [x] Convención de nombre: `comment` = tag del plan (compatible con scripts CAKE existentes)
- [x] Endpoint: cambio de plan → modifica `max-limit` de la cola en RouterOS en tiempo real
- [x] Endpoint: deshabilitar / habilitar cola por `cliente_id`
- [x] UI: vista de colas activas por router — nombre, límites, TX/RX actual
- [x] UI: botón de cambio de plan con efecto inmediato y confirmación

### 2.4 Suspensión y reactivación

- [x] Lógica de suspensión: agregar IP a address-list `suspendidos` en firewall
- [x] Lógica de reactivación: quitar de address-list + restaurar cola
- [x] Cron job diario (Celery Beat): suspensión masiva por vencimiento de pago
- [x] Endpoint `POST /clients/{id}/suspend` y `POST /clients/{id}/reactivate`
- [x] Modelo `SuspensionLog`: cliente_id, motivo, fecha_suspensión, fecha_reactivación, usuario_id
- [x] Notificación WhatsApp/SMS (Twilio) al cliente al suspender y reactivar
- [x] UI: botón suspender/reactivar con modal de confirmación + historial de suspensiones

---

## Fase 3 — Monitoreo, tráfico y PPPoE

**Duración estimada:** 4–5 semanas  
**Objetivo:** Dashboard de monitoreo en tiempo real, sistema de alertas operativo y gestión completa de sesiones PPPoE.

### 3.1 Monitoreo en tiempo real

- [x] Colector de tráfico: polling RouterOS API cada 5 s → guardar en tabla `traffic_samples` (PostgreSQL particionado por mes)
- [x] WebSocket endpoint `/ws/traffic/{router_id}` — push de métricas al frontend
- [x] UI: dashboard principal con gráficos en tiempo real por router (Recharts)
- [x] UI: top 10 clientes por consumo en el momento actual
- [x] Histórico: tráfico por cliente — últimas 1h, 24h, 7d, 30d
- [x] Endpoint `GET /clients/{id}/traffic?range=24h` — datos para gráfico de consumo individual

### 3.2 Sistema de alertas

- [ ] Modelo `AlertRule`: tipo (router_down / cliente_alto_consumo / ancho_de_banda_saturado), umbral, router_id, activo
- [ ] Modelo `AlertEvent`: rule_id, mensaje, fecha, resuelto
- [ ] Motor de alertas: evaluar umbrales cada 60 s con Celery Beat
- [ ] Alerta router offline: 3 pings fallidos consecutivos → notificación inmediata
- [ ] Alerta cliente sobre umbral: % del plan configurado (ej. >90% por 5 min)
- [ ] Alerta saturación enlace: BW total > X% de capacidad del router
- [ ] Canales de notificación: email (SMTP) + webhook configurable (Slack, Telegram, etc.)
- [ ] UI: panel de alertas activas + historial + gestión de reglas

### 3.3 Gestión PPPoE

- [x] Modelo `PPPoEProfile`: nombre, velocidad_down, velocidad_up, router_id
- [x] Modelo `PPPoESecret`: cliente_id, usuario_ppp, contraseña_ppp (Fernet), perfil_id, router_id
- [x] Servicio: crear / editar / eliminar `/ppp secret` en RouterOS al gestionar cliente PPPoE
- [x] Servicio: listar sesiones activas `/ppp active` — IP asignada, tiempo conectado, bytes TX/RX
- [x] Sincronizar perfiles PPPoE desde RouterOS al registrar un router nuevo
- [x] Endpoint `DELETE /pppoe/sessions/{username}`: desconectar sesión activa
- [x] UI: pestaña PPPoE en perfil de cliente — credenciales, sesión activa, opción de desconectar
- [x] UI: vista global de sesiones PPPoE activas en todos los routers

---

## Fase 4 — Facturación, reportes y app móvil

**Duración estimada:** 5–6 semanas  
**Objetivo:** Sistema de cobro con emisión de facturas electrónicas SRI, reportes exportables y app móvil para técnicos en campo.

### 4.1 Facturación y pagos

- [x] Modelo `Invoice`: cliente_id, plan_id, período (mes/año), monto, fecha_emisión, fecha_vencimiento, estado (pendiente/pagado/vencido)
- [x] Modelo `Payment`: invoice_id, fecha_pago, monto, método (efectivo/transferencia/tarjeta), usuario_id, notas
- [x] Cron mensual (Celery Beat): generar facturas automáticas para todos los clientes activos
- [x] Endpoint `POST /payments`: registrar pago manual + reactivación automática si estaba suspendido
- [x] Endpoint `GET /invoices?status=pending&overdue=true`: listado para cobranza
- [x] UI: módulo de cobranza — facturas pendientes, vencidas, historial por cliente
- [x] UI: caja del día — resumen de pagos recibidos con totales por método
- [x] UI: recibo de pago en PDF descargable

### 4.2 Integración SRI Ecuador

- [ ] Conectar módulo `facturacion_sri` (repo existente) como servicio interno vía imports
- [ ] Centralizar configuración: RUC, clave `.p12` vía env var, ambiente (pruebas/producción)
- [ ] Generar XML de factura + firma digital Fernet al emitir factura electrónica
- [ ] Envío SOAP al SRI + manejo de respuesta: autorizado / no autorizado / devuelto
- [ ] Retry automático para facturas devueltas (hasta 3 intentos con backoff)
- [ ] Generar RIDE PDF y enviarlo al cliente por email automáticamente
- [ ] Modelo `SRIDocument`: invoice_id, clave_acceso, número_autorización, fecha_autorización, estado_sri, xml_path, ride_path
- [ ] UI: estado de facturas SRI — autorizadas, pendientes, rechazadas con detalle de error
- [ ] UI: reenvío manual de RIDE por email desde el panel

### 4.3 Reportes

- [ ] Reporte de ingresos: por período (mes/trimestre/año), por plan, por router / zona geográfica
- [ ] Reporte de clientes: activos, suspendidos, nuevos y bajas por mes (con gráfico de evolución)
- [ ] Reporte de consumo: top consumidores, promedio por plan, horas pico
- [ ] Reporte de mora: clientes con facturas vencidas, días de mora, monto total
- [ ] Export PDF (WeasyPrint) con logo y datos de la empresa
- [ ] Export Excel (openpyxl) con formato de tabla y totales
- [ ] UI: módulo de reportes con selector de período, filtros y botones de descarga

### 4.4 App móvil — React Native / Expo

- [ ] Setup Expo + TypeScript + React Navigation (tabs + stack) + NativeWind
- [ ] Autenticación JWT con almacenamiento seguro (Expo SecureStore)
- [ ] Dashboard: resumen de routers (estado), clientes activos, alertas sin resolver
- [ ] Búsqueda de cliente por nombre o IP — ver estado, plan, consumo, suspender/reactivar
- [ ] Vista de sesiones PPPoE activas con opción de desconectar
- [ ] Registro de pago desde la app (cobro en campo)
- [ ] Notificaciones push (Expo Notifications) para alertas críticas de router offline
- [ ] Build con EAS (Expo Application Services) para distribución interna (APK directo)

---

## Decisiones de arquitectura clave

### Seguridad

- Contraseñas de routers cifradas con **Fernet** (clave maestra en variable de entorno, nunca en BD)
- Passwords de usuarios con **bcrypt** (cost factor 12)
- Certificados `.p12` SRI referenciados por ruta en filesystem seguro, nunca en BD
- Refresh tokens almacenados en Redis con TTL de 7 días; access tokens con TTL de 15 min
- Rate limiting en endpoints de auth (10 intentos/min por IP)

### Escalabilidad

- Pool de conexiones RouterOS: máximo 2 conexiones simultáneas por router (límite RouterOS)
- Colector de tráfico: arquitectura pull (Celery) en lugar de SNMP trap para simplificar la red
- PostgreSQL particionado por mes para `traffic_samples` — purga automática de datos > 12 meses
- Redis como broker y backend de Celery; también para caché de status de routers

---

## Stack tecnológico

### Backend

| Componente    | Tecnología            | Versión | Uso                       |
| ------------- | --------------------- | ------- | ------------------------- |
| Lenguaje      | Python                | 3.12+   | Runtime principal         |
| Framework API | FastAPI               | 0.111+  | REST + WebSocket          |
| ORM           | SQLAlchemy            | 2.0+    | Modelos y queries         |
| Migraciones   | Alembic               | 1.13+   | Control de esquema BD     |
| Validación    | Pydantic v2           | 2.7+    | Schemas + Settings        |
| Auth          | python-jose + passlib | —       | JWT + bcrypt              |
| Cifrado       | cryptography (Fernet) | 42+     | Credenciales de routers   |
| RouterOS API  | librouteros           | 3.2+    | Comunicación MikroTik     |
| Jobs async    | Celery + Redis        | 5.3+    | Cron, alertas, colector   |
| WebSockets    | FastAPI WebSocket     | —       | Tráfico en tiempo real    |
| PDF           | WeasyPrint            | 62+     | Reportes + RIDE SRI       |
| Excel         | openpyxl              | 3.1+    | Exportación de reportes   |
| Firma XML     | signxml               | 3.2+    | Facturas electrónicas SRI |
| SOAP SRI      | zeep                  | 4.2+    | Comunicación SRI          |
| Notif. SMS/WA | Twilio SDK            | —       | Alertas a clientes        |
| Email         | FastAPI-Mail          | —       | Notificaciones SMTP       |
| Tests         | pytest + httpx        | —       | Unit + integration tests  |
| Linting       | Ruff + Black          | —       | Calidad de código         |

### Base de datos

| Componente        | Tecnología                       | Uso                              |
| ----------------- | -------------------------------- | -------------------------------- |
| BD principal      | PostgreSQL 16                    | Clientes, routers, facturas      |
| Cache / sesiones  | Redis 7                          | JWT, colas Celery, health checks |
| Migraciones       | Alembic                          | Versionado de esquema            |
| Historial tráfico | PostgreSQL (particiones por mes) | Series de tiempo de consumo      |

### Frontend

| Componente     | Tecnología              | Versión | Uso                        |
| -------------- | ----------------------- | ------- | -------------------------- |
| Framework      | React                   | 18+     | UI principal               |
| Lenguaje       | TypeScript              | 5+      | Tipado estático            |
| Build tool     | Vite                    | 5+      | Dev server + build         |
| Estilos        | Tailwind CSS            | 3.4+    | Utilidades CSS             |
| Componentes UI | shadcn/ui               | —       | Componentes sobre Tailwind |
| Iconos         | Lucide React            | —       | Iconografía                |
| Routing        | React Router v6         | —       | Navegación SPA             |
| Estado global  | Zustand                 | —       | Estado de la app           |
| Server state   | TanStack Query          | 5+      | Cache + fetching de datos  |
| Gráficos       | Recharts                | —       | Tráfico, consumo, ingresos |
| Mapas          | Leaflet + react-leaflet | —       | GPS de clientes            |
| Formularios    | React Hook Form + Zod   | —       | Validación en cliente      |
| Tablas         | TanStack Table          | —       | Listados con filtros       |
| WebSocket      | native browser API      | —       | Tráfico en tiempo real     |

### App móvil

| Componente         | Tecnología                    | Uso                |
| ------------------ | ----------------------------- | ------------------ |
| Framework          | React Native + Expo           | App iOS y Android  |
| Lenguaje           | TypeScript                    | Tipado estático    |
| Navegación         | React Navigation v6           | Pantallas y tabs   |
| Estilos            | NativeWind (Tailwind para RN) | Clases utilitarias |
| Push notifications | Expo Notifications            | Alertas críticas   |
| Storage seguro     | Expo SecureStore              | JWT tokens         |

### Infraestructura y DevOps

| Componente           | Tecnología                        | Uso                        |
| -------------------- | --------------------------------- | -------------------------- |
| Contenedores         | Docker + Docker Compose           | Dev y producción           |
| Proxy inverso        | Nginx                             | SSL, routing, static files |
| CI/CD                | GitHub Actions                    | Lint, tests, build         |
| Conectividad routers | ZeroTier VPN                      | Túnel seguro a MikroTik    |
| Secretos             | python-dotenv + Pydantic Settings | Variables de entorno       |
| Monitoreo servidor   | Uptime Kuma (self-hosted)         | Health checks internos     |
