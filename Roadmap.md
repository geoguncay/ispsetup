# ISP SETUP — Roadmap de desarrollo

> **Nota de actualización (2026-08-17):** Este roadmap se revisó y ajustó contra
> el estado real del código. Cambios de fondo desde la versión anterior: se
> agregó un modo de monitoreo por **NetFlow v9 ("Traffic Flow")** como
> alternativa al polling, y se sumaron módulos que no estaban contemplados
> originalmente: **Inventario/Proveedores**, **Servicios personalizados**,
> **Datos de empresa (Company)** y **Auditoría**. El detalle de cada uno está
> marcado inline abajo. La carpeta `mobile/` del árbol original todavía no
> existe en el repo — ver nota en Fase 4.4.
>
> **Nota de actualización (2026-09-06):** La **Fase 4.4** deja de ser la "app móvil
> para técnicos" (descartada) y pasa a ser un **módulo completo de gestión OLT/ONU
> GPON** estilo SmartOLT: OLTs multi-vendor, aprovisionamiento de ONUs, perfiles de
> velocidad/VLAN, monitoreo de señal óptica y enganche con el ciclo de vida del
> cliente. Detalle en Fase 4.4; stack en "Módulo OLT / ONU".
>
> **Nota de actualización (2026-09-06):** La **subfase 3.5 (RADIUS Accounting)**
> se **descartó por completo** — no hay caso de uso (servicio 100% PPPoE + IP
> estática, sin Hotspot). Se eliminó del código el servidor FreeRADIUS
> (contenedor `radius/`), la ingesta de Accounting, los modos de seguridad
> `ppp_radius`/`hotspot_radius`, el secreto RADIUS por Router y `docs/radius.md`.
> La IP del servidor ISPSETUP se conserva porque la usa Traffic Flow.
>
> **Nota de actualización (2026-09-07):** Rename **`Gateway` → `Router`** en todo
> el stack (commit `07da040`): modelo `Router` (tabla `routers`), columnas
> `router_id`, rutas `/api/routers`, paquete `app/services/router/`, componentes
> `Router*` en el frontend. Se conservan los settings `mikrotik_*` /
> `MikrotikApiConfig` (son de la API MikroTik RouterOS) y
> `SystemSettings.ispsetup_server_ip` (lo usa Traffic Flow). **Aviso:** una BD
> Postgres de desarrollo existente no migra sola (`create_all` corre antes que
> `run_migrations`) — usar `docker compose down -v` o renombrar tabla/columnas a
> mano antes del primer arranque.

---

## Estructura del monorepo

```
isp-platform/
├── backend/
│   ├── app/
│   │   ├── api/              # Routers FastAPI por módulo (clients, routers,
│   │   │                     #   sites, inventory, suppliers, custom_services,
│   │   │                     #   audit_logs, zerotier, traffic, …)
│   │   ├── models/           # Modelos SQLAlchemy
│   │   ├── schemas/          # Pydantic schemas
│   │   ├── services/         # Lógica de negocio
│   │   │   ├── router/       # librouteros — queues, PPPoE, firewall
│   │   │   ├── netflow/      # Colector + parser NetFlow v9 (modo "Traffic Flow")
│   │   │   ├── zerotier/     # Cliente ZeroTier Central API
│   │   │   ├── olt/          # Drivers OLT/ONU por vendor (SSH/Telnet + SNMP) — pendiente (Fase 4.4)
│   │   │   ├── notifications/
│   │   │   └── sri/          # Módulo facturación electrónica — pendiente (Fase 4.2)
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
│   │   ├── pages/            # Vistas por módulo (incluye pages/settings/ con
│   │   │                     #   pestañas: Company, Security, Integrations, …)
│   │   ├── hooks/            # Custom hooks
│   │   ├── stores/           # Zustand stores
│   │   ├── services/         # Llamadas a la API
│   │   └── lib/              # Utils, validaciones Zod
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── Dockerfile
├── docs/
│   └── olt.md                # Matriz de vendors, flujo de aprovisionamiento
│                             #   ONU, seguridad de red y tabla de niveles ópticos
├── docker-compose.yml        # incluye netflow-collector, zerotier
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
**Objetivo:** Proyecto funcionando con auth, multi-router y conexión a RouterOS verificada.

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

> Renombrado `Router` (nombre original del plan) → `Gateway` durante el
> desarrollo, y luego de vuelta a **`Router`** el 2026-09-07 (ver nota al inicio
> del documento). Los ítems abajo reflejan el modelo actual.

- [x] Modelo `Router`: id, nombre, ip, api_port, api_username, contraseña (Fernet cifrada), activo, hw_model, notas, coordenadas
- [x] Modelo `Site`: agrupa Routers por ubicación/nodo (nombre, coordenadas) — no estaba en el plan original
- [x] Modos configurables por Router: `security_mode` (none_api / ppp_api / hotspot_api), `traffic_accounting` (polling / traffic_flow), `speed_control_type`
- [x] Servicio: pool de conexiones `librouteros` con reconexión automática
- [x] Health check automático cada 60 s (Celery Beat) → estado en Redis
- [x] Endpoint `GET /routers/{id}/status`: ping, versión RouterOS, uptime, interfaces
- [x] Cola de sincronización `RouterSyncQueue`: reintenta operaciones (address-list, queues, PPPoE) si el Router está offline al momento del cambio — no estaba en el plan original
- [x] UI: CRUD de Routers con indicador de estado en tiempo real (verde/rojo/amarillo), agrupados por Site
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
- [x] UI: listado con filtros dinámicos (router/site, plan, estado, zona) + paginación
- [x] UI: formulario de nuevo cliente con mapa Leaflet para marcar coordenadas GPS
- [x] UI: perfil de cliente — historial de planes, suspensiones, pagos y tickets

### 2.2 IP estáticas y sincronización Routers

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
- [x] **Modo alternativo "Traffic Flow" (no estaba en el plan original):** colector NetFlow v9 standalone (`netflow-collector`, servicio propio en `docker-compose.yml`) que recibe UDP del router y escribe en el mismo `traffic_samples` / canal Redis — se elige por Router vía `traffic_accounting` (`polling` vs `traffic_flow`), sin cambios en los endpoints de consumo
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

### 3.4 Integración ZeroTier

- [x] Modelo `SystemSettings`: `zt_network_id`, `zt_api_token_encrypted` (Fernet), `zt_enabled`
- [x] Servicio `zerotier_service`: cliente contra ZeroTier Central API (miembros, autorizar, asignar IP)
- [x] Endpoints `/zerotier/settings`, `/zerotier/status`, `/zerotier/members`, autorizar/revocar/renombrar
- [x] UI: pestaña Integraciones → ZeroTier — configuración, estado de la red, tabla de miembros
- [x] Modelo `Router.zerotier_node_id` — vínculo opcional con un nodo ZeroTier
- [x] UI: selector "Vincular con nodo ZeroTier" en el formulario de Router, autocompleta la IP
- [x] `docker-compose.yml`: servicio `zerotier` opcional (`--profile zerotier`) para acceso remoto al servidor completo
- [x] Cruce de estado ZeroTier + ping RouterOS en el health-check periódico (distinguir túnel caído vs. RouterOS caído) — nuevo estado `tunnel_down`: si RouterOS no responde y el nodo ZeroTier tampoco reporta a ZeroTier Central, el problema es el túnel/enlace; badge "Túnel caído" en la UI

### 3.5 RADIUS Accounting — ~~DESCARTADA~~ (2026-09-06)

Esta subfase (añadido a mitad de desarrollo, nunca estuvo en el plan original) se
**eliminó por completo del producto y del código**. Motivo: no hay caso de uso —
el ISP opera 100% PPPoE + IP estática, sin Hotspot ni venta por fichas, y el
consumo por cliente ya lo cubre Traffic Flow (NetFlow v9).

Se retiró: el contenedor FreeRADIUS (`radius/`), la ingesta de Accounting
(parser de `detail`, modelos `RadiusAccountingSession`/`RadiusIngestState`,
worker, API `/radius/accounting/*`, página **Dispositivos ▸ RADIUS**), los modos
de seguridad `ppp_radius`/`hotspot_radius`, el campo `Router.radius_secret_encrypted`,
la configuración de `/radius` en RouterOS y `docs/radius.md`. La IP del servidor
ISPSETUP (`SystemSettings.ispsetup_server_ip`) **se conserva** porque la usa
Traffic Flow. La limpieza de una entrada `/radius` heredada al eliminar un Router
se mantiene como higiene (para instalaciones que la tuvieran de una versión previa).

---

## Módulos adicionales implementados (fuera del alcance original)

Estos módulos surgieron durante el desarrollo y no tenían fase asignada en el plan inicial. Se documentan aquí para que el roadmap quede alineado con el producto real.

- [x] **Sites**: agrupación de Routers por ubicación/nodo (ver 1.3)
- [x] **Inventario**: modelo `InventoryItem` (stock, alerta de mínimo, precio compra/venta, categoría, modelo) + `Supplier` (proveedores) + `ProductCategory`; endpoints `inventory_api.py` / `suppliers_api.py`; UI de inventario y proveedores (`InventoryPage`, `ProvidersPage`)
- [x] **Servicios personalizados** (`CustomService`): cargos recurrentes o puntuales fuera de los planes de internet (nombre, precio, impuestos, recurrente/no) — extiende la facturación de la Fase 4.1
- [x] **Datos de empresa** (`Company`): RUC, dirección, teléfono, logo y fondo de login, editable desde Ajustes ▸ Empresa — cubre parte de lo que la Fase 4.2 preveía como variable de entorno estática (RUC ahora vive en BD, no solo en `.env`)
- [x] **Auditoría** (`AuditLog`): registro de acciones (usuario, acción, entidad, detalle, IP) con endpoint y UI dedicados (`audit_logs_api.py`, `AuditLogsPage`)
- [x] **Tickets de soporte**: implementado como se previó en 2.1 (perfil de cliente), con modelo `ClientTicket` propio (prioridad/estado) y endpoints anidados en `/clients/{id}/tickets`
- [x] **Panel de estadísticas de suscriptores** (`SubscribersStatsPage`): gráficos de clientes activos/suspendidos/nuevos — solapa parcialmente con lo previsto en el "Reporte de clientes" de 4.3; al construir esa fase, evaluar si se reutiliza esta pantalla en vez de duplicar

---

## Fase 4 — Facturación, reportes

**Duración estimada:** 5–6 semanas (4.1–4.3) + 10–14 semanas (4.4 OLT/ONU)  
**Objetivo:** Sistema de cobro con emisión de facturas electrónicas SRI, reportes
exportables y **módulo de gestión de OLTs/ONUs GPON** (estilo SmartOLT).

> **Estado real:** 4.1 (facturación y pagos) está implementado. 4.2 (SRI) y 4.3
> (reportes) siguen pendientes tal como estaban. **4.4 se replanteó:** la app
> móvil para técnicos (carpeta `mobile/`, nunca iniciada) se descarta y se
> reemplaza por un módulo completo de administración de fibra OLT/ONU — ver 4.4.
> La app móvil, si se retoma, pasa a una eventual Fase 5.

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
- [ ] Centralizar configuración: RUC ya disponible en modelo `Company` (Ajustes ▸ Empresa); falta clave `.p12` vía env var y ambiente (pruebas/producción)
- [ ] Generar XML de factura + firma digital Fernet al emitir factura electrónica
- [ ] Envío SOAP al SRI + manejo de respuesta: autorizado / no autorizado / devuelto
- [ ] Retry automático para facturas devueltas (hasta 3 intentos con backoff)
- [ ] Generar RIDE PDF y enviarlo al cliente por email automáticamente
- [ ] Modelo `SRIDocument`: invoice_id, clave_acceso, número_autorización, fecha_autorización, estado_sri, xml_path, ride_path
- [ ] UI: estado de facturas SRI — autorizadas, pendientes, rechazadas con detalle de error
- [ ] UI: reenvío manual de RIDE por email desde el panel

### 4.3 Reportes

- [x] Reporte de ingresos: por período (mes/trimestre/año, agregado en Python), por plan, por sitio (`GET /reports/revenue`)
- [x] Reporte de clientes: activos, suspendidos, nuevos por mes y "bajas" (planes con `estado="cancelado"`, proxy honesto — no existe un evento formal de baja separado de la suspensión), con evolución mensual sin huecos (`GET /reports/clients`)
- [x] Reporte de consumo: top consumidores, promedio por plan, horas pico — agregado en SQL sobre `traffic_samples` (no se trae la tabla completa a memoria) (`GET /reports/consumption`)
- [x] Reporte de mora: facturas `status="overdue"`, días de mora, monto y clientes totales (`GET /reports/overdue`)
- [x] Export PDF con **ReportLab** (no WeasyPrint — se usó la librería que ya trae el repo para los recibos de pago, `services/pdf_generator.py`, para no sumar una dependencia nueva) con logo/nombre de la empresa
- [x] Export Excel con **openpyxl**, tablas con encabezado y totales (`services/reports/excel_export.py`)
- [x] UI: `ReportsPage.tsx` (nav Facturación ▸ Reportes) — 4 pestañas (Ingresos/Clientes/Consumo/Mora), filtros de fecha y `group_by`, gráficos Recharts, botones de descarga PDF/Excel (mismo patrón `blob` + `<a download>` que el recibo de pago)

### 4.4 Módulo OLT / ONU GPON (reemplaza la app móvil — estilo SmartOLT)

**Estado: no iniciado.** Sustituye a la antigua "app móvil para técnicos". Objetivo:
gestión completa de fibra — registro de OLTs multi-vendor, aprovisionamiento de ONUs,
perfiles de velocidad/VLAN, monitoreo de señal óptica, diagnósticos y enganche con el
ciclo de vida del cliente (alta, cambio de plan, suspensión).

**Duración estimada:** 10–14 semanas (1 dev), entregable por sub-fases.

#### Arquitectura (alineada a los patrones actuales)

```
backend/app/
├── models/          olt.py, pon_port.py, onu.py, onu_type.py, speed_profile.py,
│                    vlan_profile.py, onu_config_profile.py, fiber_zone.py,
│                    splitter_box.py, onu_signal_sample.py
├── services/olt/
│   ├── pool.py      # pool SSH/Telnet por olt_id (mirror de services/router/router_pool)
│   ├── registry.py  # vendor → driver
│   ├── base.py      # OLTDriver (ABC): list_unconfigured/authorize/reboot/get_signal/
│   │                #   set_speed/get_onu_status/diagnostics/...
│   ├── snmp.py      # lecturas rápidas (octetos, rx/tx power, estado)
│   └── vendors/     # huawei/ zte/ vsol/ cdata/ bdcom/  (driver.py + templates *.j2 + parsers textfsm)
├── api/             olts_api.py, onus_api.py, onu_profiles_api.py, fiber_api.py
├── workers/         olt_health.py, onu_signal_poll.py, onu_discovery.py   (Celery Beat)
└── schemas/         olt_schema.py, onu_schema.py, ...

frontend/src/pages/  OltsPage, OltProfilePage, OnusPage, OnuProfilePage,
                     UnconfiguredOnusPage, FiberMapPage, settings/OltSettingsTab
docs/olt.md
```

Drivers por vendor = mismo enfoque que `services/router/`: CLI vía `scrapli[asyncssh]`
+ parsing con `ntc-templates`/textfsm, lecturas vía SNMP (`pysnmp`), plantillas de comandos
con Jinja2. Credenciales OLT cifradas con Fernet (`app.core.security`). Estado en vivo en
Redis + WebSocket `/ws/olt/{olt_id}`. `OnuSignalSample` particionada por mes como
`traffic_samples` (purga > 12 meses).

**Orden de construcción:** vertical slice con **un solo vendor** (4.4.1 + 4.4.2) hasta
"registrar OLT → ver ONUs sin configurar → autorizar una → verla online con señal";
luego 4.4.3/4.4.4; después 4.4.6 (valor operativo real); por último 4.4.5/4.4.7 y
agregar vendors 2..N (~3–5 días cada uno sobre la ABC estable).

#### 4.4.1 Núcleo OLT y conectividad (2–3 sem)

- [ ] Modelo `OLT`: nombre, vendor, modelo, ip_mgmt, método (ssh/telnet), puerto, credenciales (Fernet), enable_password, SNMP (community / v3), pon_type (GPON/EPON/XGS-PON), `site_id`, coordenadas, firmware, activo
- [ ] Modelo `PonPort`: olt_id, chasis/slot/puerto, descripción, admin_status, max_onus, tx_power
- [ ] `services/olt/pool.py` + `registry.py` + `base.OLTDriver` (ABC) + **1 vendor real** como vertical slice
- [ ] Worker `olt_health` (Celery Beat cada 60 s): alcanzabilidad, uptime, CPU/RAM/temp, estado de puertos PON, conteo de ONUs → Redis
- [ ] Endpoints: CRUD OLT, `GET /olts/{id}/status`, test de conexión manual
- [ ] UI: `OltsPage` (CRUD + badge de estado, agrupado por Site — reusar patrón `RouterPage`/`RouterStatusBadge`); `OltProfilePage` con pestaña Puertos PON
- [ ] Nav: nuevo grupo **"Fibra / OLT"** en `AppLayout.tsx`

#### 4.4.2 Descubrimiento y aprovisionamiento de ONUs (3–4 sem)

- [ ] Modelo `ONU`: olt_id, pon_port, onu_index, serial (SN GPON / MAC EPON), nombre, `client_id` (FK opcional a `Client`), onu_type_id, config_profile_id, zone_id, splitter_id, estado (online/offline/LOS/power-off/dying-gasp), rx_power_onu / rx_power_olt / tx_power, distancia_m, firmware, last_seen, coordenadas, descripción
- [ ] Worker `onu_discovery`: poll de ONUs "autofind"/no autorizadas → lista de **ONUs sin configurar** (SN, vendor, puerto PON, señal) en Redis + WebSocket
- [ ] Flujo de aprovisionamiento (1 clic): autorizar ONU en puerto → aplicar `OnuType` → asignar `SpeedProfile` (up/down) → asignar VLAN/service-ports → modo (bridge/router) → (opcional) credenciales PPPoE / IP estática
- [ ] Operaciones ONU: reboot, habilitar/deshabilitar, deautorizar/eliminar, resync de config, **reemplazo de ONU** (cambia SN, conserva config), refrescar señal
- [ ] Operaciones masivas: autorizar / reiniciar / aplicar perfil a N ONUs
- [ ] Endpoints `onus_api.py`: listado con filtros (olt/puerto/zona/estado/cliente) + paginación; `POST /onus/authorize`; `POST /onus/{id}/reboot|enable|disable|resync`; `POST /onus/bulk/...`
- [ ] UI: `UnconfiguredOnusPage` (autorizar desde ahí), `OnusPage` (listado global filtrable), `OnuProfilePage` (estado, señal, acciones, historial)

#### 4.4.3 Perfiles y plantillas (1–2 sem)

- [ ] `OnuType`: vendor, modelo, nº de puertos (eth/pots/wifi/catv), modo por defecto, capacidades
- [ ] `SpeedProfile`: nombre, down/up kbps → mapea a line-profile / DBA / traffic-profile del vendor (crear en la OLT o referenciar existente)
- [ ] `VlanProfile` / service config: vlan id, modo (tag/transparent/translate), servicio (internet/IPTV/VoIP)
- [ ] `OnuConfigProfile`: agrupa OnuType + SpeedProfile + VLAN + WiFi por defecto para el 1-clic
- [ ] Plantillas de comandos Jinja2 por vendor en `services/olt/vendors/<v>/templates/`
- [ ] UI: gestión de perfiles (pestaña en Ajustes ▸ OLT o página dedicada)

#### 4.4.4 Monitoreo de señal y tráfico (2 sem)

- [ ] Modelo `OnuSignalSample` (rx/tx power, temp, voltaje, bias) **particionado por mes**, purga > 12 meses
- [ ] Worker `onu_signal_poll` (Beat, cada 5–15 min configurable): SNMP en lote por OLT
- [ ] Tráfico por ONU vía SNMP (octetos in/out por service-port) → `traffic_samples` o tabla nueva; reusar endpoints de histórico 1h/24h/7d/30d + Recharts
- [ ] WebSocket `/ws/olt/{olt_id}`: online/offline, eventos LOS
- [ ] UI: gráficos de señal en `OnuProfilePage`; widget "Top ONUs con peor señal" en dashboard

#### 4.4.5 Zonas de fibra y mapa (1 sem)

- [ ] Modelos `FiberZone` (cobertura GPON) y `SplitterBox`/`ODB` (ratio, ubicación, PON padre, puertos usados); ONU → puerto de splitter
- [ ] `FiberMapPage` con Leaflet (ya en el stack): OLTs, splitters y ONUs; color por señal/estado

#### 4.4.6 Integración con cliente y facturación (2 sem)

- [x] `Client.medium` (`radio` | `fiber` | `unspecified`) y rename `Client.connection_type` →
      `Client.access_method` — separan el medio físico del método de aprovisionamiento MikroTik
      (`static` = address-list + cola, `pppoe` = ppp/secret). `medium` es informativo por ahora.
- [ ] `Client.onu_id` (FK → `Onu`, nullable) para clientes con `medium="fiber"`; asignación de ONU
      desde la pestaña "ONU / Fibra".
- [ ] Infra de `medium="radio"` (`access_point` / `sector` / enlace) → eventual Fase 5.
- [ ] Pestaña **"ONU / Fibra"** en `ClientProfilePage`: ONU asignada, SN, señal, puerto PON, ODB, botones reboot/diagnóstico, historial de señal
- [ ] **Suspensión GPON:** extender worker `suspension` → deshabilitar ONU o poner su service-port a perfil 0, en vez de address-list de firewall
- [ ] **Cambio de plan:** mapear `Plan` → `SpeedProfile`; aplicar en la ONU en tiempo real (análogo a `QueueService`)
- [ ] Flujo "aprovisionar desde cliente": alta de cliente → elegir ONU sin configurar → auto-provisión

#### 4.4.7 Alertas OLT/ONU (1 sem — depende de Fase 3.2)

- [ ] Si 3.2 está hecha: nuevos tipos de `AlertRule` (onu_los, onu_dying_gasp, onu_low_rx, olt_down, pon_port_down, olt_temp_high, onu_count_high)
- [ ] Si no: log de eventos mínimo en este módulo + notificación por los canales existentes (Twilio/email)

#### 4.4.8 Docs, infra y CI (transversal)

- [ ] `docs/olt.md`: matriz de vendors/comandos, flujo de aprovisionamiento, seguridad de red (VLAN de gestión, nunca exponer telnet/SNMP a Internet), tabla de referencia de niveles ópticos
- [ ] Deps nuevas en `requirements.txt`: `scrapli[asyncssh]`, `pysnmp`, `jinja2`, `ntc-templates`/`textfsm`
- [ ] (Opcional) contenedor `olt-poller` dedicado en `docker-compose.yml` (como `netflow-collector`) si el polling SNMP pesa; si no, sólo workers Celery
- [ ] CI: tests de driver por vendor con **fixtures de salida CLI grabada** (sin OLT real)
- [ ] SVG en `architecture/` para el flujo OLT ↔ ISPSETUP ↔ ONU; actualizar diagrama entidad-relación

#### 4.4.9 (Opcional — mover a Fase 5) Gestión WiFi / TR-069

- [ ] ACS (GenieACS) o WiFi por OMCI en ONUs modo router: SSID, clave, canal, reboot remoto — subproyecto grande por sí solo

#### Decisiones a confirmar antes de arrancar

- [ ] **Vendors/modelos prioritarios** (Huawei MA56xx, ZTE C320, V-SOL, C-Data, BDCOM…) — define el primer driver y la matriz de comandos. En Ecuador V-SOL / C-Data / Huawei son los más comunes
- [ ] **Topología:** ¿la OLT es L2 puro y el BNG sigue siendo un router MikroTik, o la OLT termina PPPoE/IPoE? — cambia por completo la lógica de suspensión y cambio de plan (4.4.6)
- [ ] **Método de acceso:** SSH/Telnet CLI + SNMP (recomendado) vs. NETCONF/NBI del vendor
- [ ] **4.4.9 WiFi/TR-069:** ¿en alcance ahora o Fase 5? (recomendado: Fase 5)
- [ ] Confirmar que la **app móvil para técnicos** queda descartada (o se mueve a Fase 5)

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

| Componente    | Tecnología            | Versión | Uso                                            |
| ------------- | --------------------- | ------- | ---------------------------------------------- |
| Lenguaje      | Python                | 3.12+   | Runtime principal                              |
| Framework API | FastAPI               | 0.111+  | REST + WebSocket                               |
| ORM           | SQLAlchemy            | 2.0+    | Modelos y queries                              |
| Migraciones   | Alembic               | 1.13+   | Control de esquema BD                          |
| Validación    | Pydantic v2           | 2.7+    | Schemas + Settings                             |
| Auth          | python-jose + passlib | —       | JWT + bcrypt                                   |
| Cifrado       | cryptography (Fernet) | 42+     | Credenciales de routers                        |
| RouterOS API  | librouteros           | 3.2+    | Comunicación con routers RouterOS              |
| NetFlow       | Parser propio (v9)    | —       | Colector "Traffic Flow" alternativo al polling |
| Jobs async    | Celery + Redis        | 5.3+    | Cron, alertas, colector                        |
| WebSockets    | FastAPI WebSocket     | —       | Tráfico en tiempo real                         |
| PDF           | WeasyPrint            | 62+     | Reportes + RIDE SRI                            |
| Excel         | openpyxl              | 3.1+    | Exportación de reportes                        |
| Firma XML     | signxml               | 3.2+    | Facturas electrónicas SRI                      |
| SOAP SRI      | zeep                  | 4.2+    | Comunicación SRI                               |
| Notif. SMS/WA | Twilio SDK            | —       | Alertas a clientes                             |
| Email         | FastAPI-Mail          | —       | Notificaciones SMTP                            |
| Tests         | pytest + httpx        | —       | Unit + integration tests                       |
| Linting       | Ruff + Black          | —       | Calidad de código                              |

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

### Módulo OLT / ONU (Fase 4.4)

> ⚠️ **No iniciado** — stack de diseño para el módulo que reemplaza a la app móvil.
> La app móvil (React Native + Expo) queda descartada; si se retoma, va a Fase 5.

| Componente          | Tecnología                   | Uso                                            |
| ------------------- | ---------------------------- | ---------------------------------------------- |
| Acceso CLI OLT      | scrapli[asyncssh]            | SSH/Telnet a OLTs multi-vendor                 |
| Parsing CLI         | ntc-templates / textfsm      | Estructurar salida de comandos por vendor      |
| Lecturas rápidas    | pysnmp                       | Estado ONU, rx/tx power, octetos               |
| Plantillas comandos | Jinja2                       | Comandos de aprovisionamiento por vendor       |
| Series de señal     | PostgreSQL (particiones/mes) | Historial óptico de ONUs (`onu_signal_sample`) |
| Tiempo real         | FastAPI WebSocket            | Online/offline y eventos LOS (`/ws/olt/{id}`)  |
| Mapa de planta      | Leaflet + react-leaflet      | OLTs, splitters y ONUs georreferenciados       |
| Colector (opcional) | Servicio propio `olt-poller` | Polling SNMP masivo si supera al worker Celery |

### Infraestructura y DevOps

| Componente           | Tecnología                        | Uso                        |
| -------------------- | --------------------------------- | -------------------------- |
| Contenedores         | Docker + Docker Compose           | Dev y producción           |
| Proxy inverso        | Nginx                             | SSL, routing, static files |
| CI/CD                | GitHub Actions                    | Lint, tests, build         |
| Conectividad routers | ZeroTier VPN                      | Túnel seguro a los routers |
| Secretos             | python-dotenv + Pydantic Settings | Variables de entorno       |
| Monitoreo servidor   | Uptime Kuma (self-hosted)         | Health checks internos     |
