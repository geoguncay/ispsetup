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
>
> **Nota de actualización (2026-10-10):** Se alineó el roadmap con lo construido en las
> últimas semanas, que no tenía fase asignada: **Balanceadores de carga MikroTik**
> (PCC/Failover), **Mapas de radio y fibra** (APs, PtP/PtMP, enlaces editables, clusters,
> capas y buscador), **`Client.medium`**, **Reportes** reorganizados como grupo del menú
> con una página por reporte, y un **Dashboard** rehecho sobre `GET /api/dashboard/*`
> (resumen agregado, alertas derivadas, tendencia de ingresos, actividad y mini-mapa).
> `SubscribersStatsPage` y `AuditLogsPage` ya no existen. Ver "Módulos adicionales".
>
> **Nota de actualización (2026-11-14):** Auditoría del producto contra los **12 requisitos
> funcionales** (ver "Matriz de cumplimiento" al final de la Fase 4): 3 cumplidos, 3 parciales
> y 6 pendientes. Cambios de alcance: (1) **RADIUS se reintegra** — la 3.5 se reabre porque
> ahora sí hay caso de uso (control de tráfico *PPPoE-RADIUS*, corte por mora vía RADIUS y
> coordinación con fibra/BNG); (2) nueva **3.6 WireGuard** (VPN junto a ZeroTier); (3) los
> avisos y recordatorios de cobro pasan a **WhatsApp únicamente, con Meta Cloud API**
> (nueva 4.5; sustituye a Twilio/SMS); (4) nuevas **4.6 Contratos y documentos** y
> **4.7 Cash Desk**; (5) **4.8 Cobranza con IA queda como "Próximamente"** (solo placeholder);
> (6) el **Portal de clientes se difiere a la Fase 5** (no planeado por ahora); (7) **Decisiones tomadas:**
> OLT/ONU con **módulo propio** (sin depender de SmartOLT SaaS) y con **TR-069 incluido** (4.4.9, ya no es
> Fase 5); WireGuard con **ISPSETUP como hub**; documentos con **almacenamiento configurable local o S3**.
> 4.2 (SRI) mantiene su alcance.

---

## Estructura del monorepo

```
isp-platform/
├── backend/
│   ├── app/
│   │   ├── api/              # Routers FastAPI por módulo (clients, routers,
│   │   │                     #   load_balancers, sites, inventory, suppliers,
│   │   │                     #   custom_services, audit_logs, zerotier, traffic,
│   │   │                     #   reports, map_topology, dashboard, …)
│   │   ├── models/           # Modelos SQLAlchemy
│   │   ├── schemas/          # Pydantic schemas
│   │   ├── services/         # Lógica de negocio
│   │   │   ├── router/       # librouteros — queues, PPPoE, firewall
│   │   │   ├── load_balancer/# Health, scripts PCC/Failover y runner sobre RouterOS
│   │   │   ├── reports/      # Queries + export PDF (ReportLab) y Excel (openpyxl)
│   │   │   ├── dashboard.py  # Agregados del dashboard (COUNT/SUM/GROUP BY)
│   │   │   ├── netflow/      # Colector + parser NetFlow v9 (modo "Traffic Flow")
│   │   │   ├── zerotier/     # Cliente ZeroTier Central API
│   │   │   ├── olt/          # Drivers OLT/ONU por vendor (SSH/Telnet + SNMP) — pendiente (Fase 4.4)
│   │   │   ├── notifications/
│   │   │   │   └── whatsapp/ # Proveedor Meta Cloud API: plantillas, envío, webhook — pendiente (Fase 4.5)
│   │   │   ├── radius/       # Sync usuarios/atributos a FreeRADIUS, CoA, ingesta radacct — pendiente (Fase 3.5)
│   │   │   ├── wireguard/    # Claves, peers y scripts RouterOS de la VPN WireGuard — pendiente (Fase 3.6)
│   │   │   ├── documents/    # Contratos (PDF desde plantilla) y almacenamiento local/S3 configurable — pendiente (Fase 4.6)
│   │   │   ├── tr069/        # Cliente de la NBI de GenieACS: gestión del equipo del cliente — pendiente (Fase 4.4.9)
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
│   │   ├── pages/            # Vistas por módulo:
│   │   │                     #   dashboard/ (secciones + hooks del resumen),
│   │   │                     #   reports/ (una página por reporte + shared.tsx),
│   │   │                     #   maps/ (radio y fibra), settings/ (pestañas:
│   │   │                     #   Company, Security, Integrations, Logs, …)
│   │   ├── hooks/            # Custom hooks
│   │   ├── stores/           # Zustand stores
│   │   ├── services/         # Llamadas a la API
│   │   └── lib/              # Utils, validaciones Zod
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   └── Dockerfile
├── docs/
│   ├── olt.md                # Matriz de vendors, flujo de aprovisionamiento
│   │                         #   ONU, seguridad de red y tabla de niveles ópticos
│   ├── radius.md             # (Fase 3.5) Atributos, CoA, migración por router
│   ├── wireguard.md          # (Fase 3.6) Topología hub, provisión de routers y peers
│   ├── whatsapp.md           # (Fase 4.5) Alta en Meta, plantillas y webhook
│   └── tr069.md              # (Fase 4.4.9) ACS, perfiles por modelo y aprovisionamiento
├── radius/                   # (Fase 3.5) Configuración FreeRADIUS (rlm_sql → PostgreSQL)
├── docker-compose.yml        # incluye netflow-collector, zerotier (+ radius, wireguard)
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
- [x] Notificación al cliente al suspender y reactivar — **hoy solo SMS vía Twilio** (`twilio_service.py`); migra a **WhatsApp con Meta Cloud API** en la Fase 4.5, donde Twilio se retira
- [x] UI: botón suspender/reactivar con modal de confirmación + historial de suspensiones

---

## Fase 3 — Monitoreo, tráfico y PPPoE

**Duración estimada:** 4–5 semanas  
**Objetivo:** Dashboard de monitoreo en tiempo real, sistema de alertas operativo y gestión completa de sesiones PPPoE.

### 3.1 Monitoreo en tiempo real

- [x] Colector de tráfico: polling RouterOS API cada 5 s → guardar en tabla `traffic_samples` (PostgreSQL particionado por mes)
- [x] **Modo alternativo "Traffic Flow" (no estaba en el plan original):** colector NetFlow v9 standalone (`netflow-collector`, servicio propio en `docker-compose.yml`) que recibe UDP del router y escribe en el mismo `traffic_samples` / canal Redis — se elige por Router vía `traffic_accounting` (`polling` vs `traffic_flow`), sin cambios en los endpoints de consumo
- [x] WebSocket endpoint `/ws/traffic/{router_id}` — push de métricas al frontend
- [x] UI: gráficos de tráfico en tiempo real por router (Recharts) en **Reportes ▸ Tráfico** (`TrafficReportPage`); el dashboard principal solo muestra el resumen agregado, no tráfico en vivo
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
- [ ] Canales de notificación: email (SMTP) + webhook configurable (Slack, Telegram, etc.) + WhatsApp al personal (reutiliza el proveedor de 4.5)
- [ ] UI: panel de alertas activas + historial + gestión de reglas
- [~] **Parcial (2026-10-10):** el dashboard y la campana de notificaciones muestran alertas **derivadas al vuelo** de datos existentes (routers/balanceadores caídos, facturas vencidas, stock bajo, suspensiones por ejecutar, clientes sin ubicación) vía `GET /api/dashboard/summary`. No hay reglas configurables, umbrales, historial ni canales de notificación: eso sigue pendiente arriba

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

### 3.5 RADIUS (reintegración) — ~~descartada 2026-09-06~~, **reabierta 2026-11-14**

**Estado: no iniciado.** **Duración estimada:** 4–6 semanas.

**Motivo de la reapertura:** el requisito de producto «Control de tráfico: Simple Queue,
PPPoE Simple Queue y **PPPoE Radius**» y la coordinación de cortes y cambios de plan con la
fibra (OLT/BNG, 4.4) sí necesitan RADIUS. El alcance es distinto al descartado: **AAA para
PPPoE** (autenticación, autorización, CoA) con accounting acotado. **Siguen fuera Hotspot
y venta por fichas.** El código anterior sigue en git (commits `06c4cc0` y `258636a`; retirado
en `3fefb0f`): usarlo solo como referencia, no revertir.

**Principios de diseño**

- **Opcional por Router:** `security_mode` gana `ppp_radius` junto a `ppp_api` (que no se toca). Migración gradual y reversible router por router.
- **PostgreSQL como backend** de FreeRADIUS (`rlm_sql`): un solo almacén, sin sincronizar archivos.
- **Reutilizar lo existente:** el corte por mora sigue usando el address-list `suspendidos` y sus reglas de firewall.
- **Una sola fuente de consumo:** NetFlow (Traffic Flow) sigue siendo la fuente de tráfico; RADIUS aporta sesiones, IP asignada y trazabilidad.

#### 3.5.1 Infraestructura (1 sem)

- [ ] Servicio `radius` (FreeRADIUS 3.x + `rlm_sql_postgresql`) en `docker-compose.yml` bajo `--profile radius`; UDP 1812/1813 y 3799 (CoA) solo por red interna o VPN, nunca a Internet
- [ ] Migración idempotente de tablas estándar: `radcheck`, `radreply`, `radusergroup`, `radgroupreply`, `radacct`, `radpostauth`, `nas`
- [ ] `Router.radius_secret_encrypted` (Fernet) y alta/baja automática del NAS en `nas` al crear/eliminar un Router
- [ ] Ajustes ▸ Integraciones ▸ RADIUS: habilitar, estado del servicio, IP del servidor (reusa `SystemSettings.ispsetup_server_ip`)

#### 3.5.2 Autenticación y autorización PPPoE (1–2 sem)

- [ ] `services/radius/sync.py`: `PPPoESecret` → `radcheck`; plan/perfil → `radreply`/`radgroupreply` (`Mikrotik-Rate-Limit`, `Framed-IP-Address` o `Framed-Pool`)
- [ ] Alta, edición, baja de cliente PPPoE y cambio de plan sincronizan RADIUS, con reintentos vía la cola `RouterSyncQueue` existente
- [ ] Configuración RouterOS por API: `/radius add`, `/ppp aaa set use-radius=yes accounting=yes interim-update=…`; retirar secrets locales al migrar
- [ ] Nuevo valor **PPPoE-RADIUS** en `speed_control_type` (hoy `simple_queues`): RouterOS crea la cola dinámica desde `Mikrotik-Rate-Limit`. Convive con Simple Queue estática y PPPoE local (los tres modos del requisito)
- [ ] **Corte por mora vía RADIUS:** `radreply` con `Mikrotik-Address-List := suspendidos` (reusa reglas actuales) o `Reject`, según un ajuste `suspension_method`; la reactivación lo revierte
- [ ] Tests con RADIUS simulado y `radtest` en CI

#### 3.5.3 CoA y accounting (2 sem)

- [ ] CoA / Disconnect-Request (RFC 5176) al suspender, reactivar o cambiar plan con sesión activa (sustituye al cierre de sesión por API cuando el router usa RADIUS)
- [ ] Worker de ingesta de `radacct`: sesiones activas e históricas, IP asignada, MAC (`Calling-Station-Id`), bytes
- [ ] UI: Dispositivos ▸ RADIUS (estado, NAS) y pestaña «Sesiones» en el perfil del cliente (historial y trazabilidad IP ↔ cliente)
- [ ] Alerta derivada «RADIUS caído» en el dashboard
- [ ] Retención configurable de `radacct` (purga > 12 meses, como `traffic_samples`)

#### 3.5.4 Migración y cierre (1 sem)

- [ ] Herramienta de migración por router con *dry-run*, verificación de sesiones y **rollback** a `ppp_api`
- [ ] Runbook de caída de RADIUS (las sesiones activas se mantienen, las nuevas no autentican) y opción de segundo servidor
- [ ] `docs/radius.md`, SVG en `architecture/` y actualizar el README

**Decisiones a confirmar:** modo por router vs. global (recomendado: por router); método de corte (address-list vs. reject); si la OLT termina PPPoE o el BNG sigue siendo MikroTik (se cruza con 4.4.6).

#### Historial: descartada el 2026-09-06

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

### 3.6 Integración WireGuard (VPN) — **nuevo**

**Estado: no iniciado.** **Duración estimada:** 2–3 semanas.

Complementa a ZeroTier (3.4): mismo objetivo (túnel seguro hacia routers y servidor, evitar
CGNAT) usando **WireGuard nativo de RouterOS 7**, sin depender de un servicio externo.
Ambas VPN conviven; el Router elige a cuál se vincula.

**Modos**

- **A (DECIDIDO 2026-11-14): ISPSETUP como hub.** El servidor levanta `wg0` y los routers y técnicos son peers.
- **B (fuera de alcance):** unirse como peer a una VPN WireGuard ajena. Solo se conserva la importación opcional de un `.conf` existente como utilidad.

#### 3.6.1 Servidor

- [ ] Servicio `wireguard` en `docker-compose.yml` bajo `--profile wireguard` (`NET_ADMIN`, UDP 51820; en Linux `network_mode: host` como el perfil `zerotier`)
- [ ] Configuración: endpoint público, puerto, subred de la VPN, DNS, keepalive y `wg_enabled`; clave privada del servidor cifrada con **Fernet**, nunca en logs
- [ ] Modelo `WireGuardPeer`: nombre, tipo (router / técnico / servidor), `public_key`, clave privada y preshared cifradas (solo si las generó el sistema), IP asignada, `allowed_ips`, estado, último handshake, `router_id` opcional
- [ ] `services/wireguard/`: generación de claves X25519 con `cryptography` (sin depender de binarios), asignación de la siguiente IP libre, render de `wg0.conf` y aplicación con `wg syncconf` sin cortar peers

#### 3.6.2 Provisión de routers

- [ ] Generar el **script RouterOS 7** de cada peer (`/interface wireguard`, `/interface wireguard peers`, `/ip address`, regla de firewall) para copiar y pegar, o aplicarlo por API si el router ya es alcanzable
- [ ] `Router.wireguard_peer_id`: vínculo opcional; al vincularlo autocompleta la IP (igual que ZeroTier)
- [ ] Health-check: cruzar el handshake de WireGuard con el ping a RouterOS para distinguir `tunnel_down` (extiende 3.4)

#### 3.6.3 Peers de técnicos y UI

- [ ] Peer de técnico: `.conf` descargable y código QR para laptops y móviles; revocar y rotar claves
- [ ] Ajustes ▸ Integraciones ▸ WireGuard: configuración, estado de la interfaz, tabla de peers (handshake, rx/tx), alta y revocación, descarga de config o script, importación opcional de un `.conf` existente

#### 3.6.4 Seguridad y calidad

- [ ] Configuración y claves privadas visibles una sola vez al generarlas; altas y revocaciones en `AuditLog`
- [ ] Tests del render de configuración y de la asignación de IPs (sin kernel WireGuard); `docs/wireguard.md`

**Decisión (2026-11-14, varios routers): modo A, ISPSETUP como hub.** Topología en estrella con un peer por router; las altas, revocaciones, IPs y scripts RouterOS se automatizan desde el panel; los routers detrás de CGNAT funcionan porque inician la conexión (`persistent-keepalive`); por defecto cada router solo ve al servidor (`AllowedIPs` aislados). El modo B queda para quien ya tenga un hub WireGuard propio: ISPSETUP sería un peer más y los peers del hub se seguirían administrando a mano. Riesgo del hub: punto único de fallo (mitigable con un segundo hub más adelante).

**Pendiente de definir:** subred (por ejemplo `10.77.0.0/24`); puerto UDP expuesto; si el servidor está detrás de NAT (requiere reenvío del puerto).

---

## Módulos adicionales implementados (fuera del alcance original)

Estos módulos surgieron durante el desarrollo y no tenían fase asignada en el plan inicial. Se documentan aquí para que el roadmap quede alineado con el producto real.

- [x] **Sites**: agrupación de Routers por ubicación/nodo (ver 1.3)
- [x] **Inventario**: modelo `InventoryItem` (stock, alerta de mínimo, precio compra/venta, categoría, modelo) + `Supplier` (proveedores) + `ProductCategory`; endpoints `inventory_api.py` / `suppliers_api.py`; UI de inventario y proveedores (`InventoryPage`, `ProvidersPage`)
- [x] **Servicios personalizados** (`CustomService`): cargos recurrentes o puntuales fuera de los planes de internet (nombre, precio, impuestos, recurrente/no) — extiende la facturación de la Fase 4.1
- [x] **Datos de empresa** (`Company`): RUC, dirección, teléfono, logo y fondo de login, editable desde Ajustes ▸ Empresa — cubre parte de lo que la Fase 4.2 preveía como variable de entorno estática (RUC ahora vive en BD, no solo en `.env`)
- [x] **Auditoría** (`AuditLog`): registro de acciones (usuario, acción, entidad, detalle, IP) con endpoint y UI en **Ajustes ▸ Logs** (`audit_logs_api.py`, `settings/LogsSettingsTab`; la antigua `AuditLogsPage` se eliminó y `/audit-logs` redirige a Ajustes)
- [x] **Tickets de soporte**: implementado como se previó en 2.1 (perfil de cliente), con modelo `ClientTicket` propio (prioridad/estado) y endpoints anidados en `/clients/{id}/tickets`
- [x] ~~**Panel de estadísticas de suscriptores** (`SubscribersStatsPage`)~~ — **eliminado** (commit `b026438`): su contenido quedó absorbido por **Reportes ▸ Clientes**; `/subscribers/stats` redirige a `/reports/clients`
- [x] **Balanceadores de carga MikroTik** (`LoadBalancer`, commit `7eca77e`): alta con credenciales Fernet, balanceo **PCC / Failover** generado como script RouterOS y aplicado con registro de ejecuciones (`LoadBalancerScriptRun`), estado por health check (Celery, 30 s, mismo esquema `online/offline/tunnel_down` que los routers), monitoreo de interfaces WAN cada 5 s (`LoadBalancerInterfaceSample`, snapshot en Redis + WebSocket `/load-balancers/ws/{id}`); UI en `LoadBalancerPage` / `LoadBalancerProfilePage`
- [x] **Mapas de radio y fibra** (commits `f8f2397`, `a386927`): `/maps/radio` y `/maps/fiber` con capas conmutables (routers, clientes, y en radio APs y PtP), clusters, buscador y edición de ubicación arrastrando marcadores. En radio: `MapAccessPoint` (rol `ap` / `station`) y `MapLink` (`kind`: `ptp` o `ap` = PtMP) con modales de alta/edición; endpoints `/map/access-points`, `/map/links`, `/map/ptp`, `/map/locations/*` (`map_topology_api.py`)
- [x] **`Client.medium`** (`radio` | `fiber` | `unspecified`): medio físico de última milla, separado de `access_method` (`static` | `pppoe`, ruta de aprovisionamiento MikroTik). Informativo por ahora; ver 4.4.6
- [x] **Dashboard** (`pages/dashboard/`, `api/dashboard_api.py`): resumen real en vez de los 2 endpoints iniciales. `GET /api/dashboard/summary` (infra por estado, clientes por medio/método, red de radio, finanzas **solo admin**, alertas derivadas y puntos del mini-mapa, todo con agregados SQL), `GET /api/dashboard/revenue-trend` (solo admin) y `GET /api/dashboard/activity` (auditoría para admin; suspensiones/reactivaciones para el resto). Reemplaza al endpoint `/users/stats`, que clasificaba "desconectados" con un hash del UUID del cliente. **Limitación conocida:** no muestra clientes "conectados/desconectados" porque no hay fuente barata en BD (las sesiones PPPoE solo se consultan en vivo al router); requeriría cachear sesiones desde un worker

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
- [x] **Facturación prepago y pospago** (no estaba en el plan original): `Client.billing_type` (`forward` = prepago, `backward` = pospago), visible en el perfil del cliente; la generación automática y el prorrateo respetan el tipo
- [ ] Cash Desk completo (apertura/cierre, egresos, arqueo) — ver 4.7

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
- [ ] Enviar el RIDE (PDF) también **por WhatsApp** como documento, con plantilla de 4.5 (el envío automático al cliente es parte del requisito de facturación electrónica)

### 4.3 Reportes

- [x] Reporte de ingresos: por período (mes/trimestre/año, agregado en Python), por plan, por sitio (`GET /reports/revenue`)
- [x] Reporte de clientes: activos, suspendidos, nuevos por mes y "bajas" (planes con `estado="cancelado"`, proxy honesto — no existe un evento formal de baja separado de la suspensión), con evolución mensual sin huecos (`GET /reports/clients`)
- [x] Reporte de consumo: top consumidores, promedio por plan, horas pico — agregado en SQL sobre `traffic_samples` (no se trae la tabla completa a memoria) (`GET /reports/consumption`)
- [x] Reporte de mora: facturas `status="overdue"`, días de mora, monto y clientes totales (`GET /reports/overdue`)
- [x] Export PDF con **ReportLab** (no WeasyPrint — se usó la librería que ya trae el repo para los recibos de pago, `services/pdf_generator.py`, para no sumar una dependencia nueva) con logo/nombre de la empresa
- [x] Export Excel con **openpyxl**, tablas con encabezado y totales (`services/reports/excel_export.py`)
- [x] UI: grupo **Reportes** en el menú lateral con una página por reporte bajo `/reports/*` (`pages/reports/`: Ingresos con detalle por período, Clientes, Tráfico, Consumo y Mora), filtros de fecha y `group_by`, gráficos Recharts, botones de descarga PDF/Excel (mismo patrón `blob` + `<a download>` que el recibo de pago). Las piezas comunes viven en `pages/reports/shared.tsx`; `/reports` redirige a `/reports/revenue`

### 4.4 Módulo OLT / ONU GPON (reemplaza la app móvil — estilo SmartOLT)

> **Requisitos 11 y 12 (Wireless/Fibra y SmartOLT):** la parte wireless ya está cubierta
> (mapa de radio, Simple Queue/PPPoE). La fibra con OLT depende de este módulo.
> **Decisión (2026-11-14): módulo propio**, sin integrar SmartOLT SaaS; el requisito de
> «controlar y administrar las OLTs» se cubre con este módulo y la gestión del equipo del
> cliente con TR-069 (4.4.9, incluido). Con RADIUS reintegrado (3.5), el control de tráfico
> PPPoE de los clientes de fibra puede pasar por RADIUS.

**Estado: no iniciado.** Sustituye a la antigua "app móvil para técnicos". Objetivo:
gestión completa de fibra — registro de OLTs multi-vendor, aprovisionamiento de ONUs,
perfiles de velocidad/VLAN, monitoreo de señal óptica, diagnósticos y enganche con el
ciclo de vida del cliente (alta, cambio de plan, suspensión).

**Duración estimada:** 10–14 semanas (1 dev) para OLT/ONU + 3–5 semanas para TR-069 (4.4.9), entregable por sub-fases.

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
- [ ] Ampliar el `FiberMapPage` existente (`/maps/fiber`, hoy solo routers y clientes con `medium="fiber"`) con OLTs, splitters y ONUs; color por señal/estado

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
- [ ] Si no: log de eventos mínimo en este módulo + notificación por los canales existentes (WhatsApp de 4.5 / email)

#### 4.4.8 Docs, infra y CI (transversal)

- [ ] `docs/olt.md`: matriz de vendors/comandos, flujo de aprovisionamiento, seguridad de red (VLAN de gestión, nunca exponer telnet/SNMP a Internet), tabla de referencia de niveles ópticos
- [ ] Deps nuevas en `requirements.txt`: `scrapli[asyncssh]`, `pysnmp`, `jinja2`, `ntc-templates`/`textfsm`
- [ ] (Opcional) contenedor `olt-poller` dedicado en `docker-compose.yml` (como `netflow-collector`) si el polling SNMP pesa; si no, sólo workers Celery
- [ ] CI: tests de driver por vendor con **fixtures de salida CLI grabada** (sin OLT real)
- [ ] SVG en `architecture/` para el flujo OLT ↔ ISPSETUP ↔ ONU; actualizar diagrama entidad-relación

#### 4.4.9 Gestión del equipo del cliente — TR-069 (en alcance, decidido 2026-11-14) (3–5 sem)

- [ ] Servicio `genieacs` (ACS de código abierto + MongoDB) en `docker-compose.yml` bajo `--profile tr069`; CWMP (7547) accesible solo desde la red de clientes o VLAN de gestión y por HTTPS; NBI (7557) y UI (3000) solo internas
- [ ] `services/tr069/`: cliente de la NBI de GenieACS (`httpx`): listar equipos, leer parámetros, `setParameterValues`, reinicio, refresco y diagnósticos
- [ ] Modelo `CpeDevice`: serial, OUI, modelo, firmware, última conexión, IP; vínculo con `Client` y `ONU` por serial
- [ ] Perfiles por modelo: mapa de parámetros TR-098 (`InternetGatewayDevice.*`) o TR-181 (`Device.*`), porque cambian según el fabricante; *provisions* de GenieACS para aprovisionamiento inicial (WiFi, credenciales PPPoE)
- [ ] URL del ACS entregada al equipo por OMCI desde la OLT o por DHCP opción 43; credenciales de conexión únicas por equipo
- [ ] Endpoints: estado del equipo, cambiar WiFi (SSID/clave/canal), reiniciar, credenciales PPPoE, diagnósticos (ping/traceroute)
- [ ] UI: pestaña «Equipo del cliente» en el perfil (estado WAN/LAN, WiFi, dispositivos conectados, firmware y acciones remotas)
- [ ] Seguridad: claves WiFi y PPPoE nunca en logs, cambios auditados en `AuditLog`, permisos por rol y límite de tasa
- [ ] Pruebas con respuestas de ACS simuladas; `docs/tr069.md`
- (Alternativa descartada como base: WiFi solo por OMCI desde la OLT; depende del vendor y es más limitado, queda como complemento posible)
- **Función principal en ISPSETUP:** gestión remota del equipo del cliente sin visita técnica — pestaña «Equipo del cliente» en el perfil (estado WAN/LAN, WiFi, dispositivos conectados, firmware), cambio de SSID/clave, reinicio, diagnósticos (ping/traceroute) y aprovisionamiento de credenciales PPPoE en la ONU
- **Cuándo es necesario:** solo si las ONUs operan en **modo router** y hay volumen de tickets de WiFi o visitas evitables; si todas van en *bridge* con router propio del cliente, no hace falta. Requiere un ACS (GenieACS, vía su API NBI, o el TR-069 de SmartOLT si el plan lo incluye) alcanzable desde la red del cliente por HTTPS y la URL del ACS configurada en la ONU (OMCI o DHCP opción 43). Se construye **después** del *vertical slice* de 4.4.1–4.4.2

#### Decisiones a confirmar antes de arrancar

- [ ] **Vendors/modelos prioritarios** (Huawei MA56xx, ZTE C320, V-SOL, C-Data, BDCOM…) — define el primer driver y la matriz de comandos. En Ecuador V-SOL / C-Data / Huawei son los más comunes
- [ ] **Topología:** ¿la OLT es L2 puro y el BNG sigue siendo un router MikroTik, o la OLT termina PPPoE/IPoE? — cambia por completo la lógica de suspensión y cambio de plan (4.4.6)
- [x] **SmartOLT (SaaS) vs. módulo propio — DECIDIDO (2026-11-14): módulo propio.** No se integra SmartOLT, para evitar la dependencia, la suscripción y que los datos de red pasen por un tercero. Contrapartida asumida: mantener los drivers por vendor y las 10–14 semanas de desarrollo. Mitigación: arrancar con un solo vendor (*vertical slice*), mantener estable la ABC `OLTDriver` y probar con fixtures de salida CLI grabada; si algún día se quisiera SmartOLT, entraría como un driver más detrás de `OLTDriver`
- [ ] **Método de acceso:** SSH/Telnet CLI + SNMP (recomendado) vs. NETCONF/NBI del vendor
- [x] **4.4.9 WiFi/TR-069 — DECIDIDO: en alcance** (ya no es Fase 5). Se construye tras el *vertical slice* de 4.4.1–4.4.2; ver 4.4.9
- [ ] Confirmar que la **app móvil para técnicos** queda descartada (o se mueve a Fase 5)

### 4.5 Avisos y cobranza por WhatsApp — Meta Cloud API — **nuevo**

**Estado: no iniciado.** **Duración estimada:** 3–4 semanas. **Alcance:** los avisos y
recordatorios de cobro se envían **únicamente por WhatsApp**. Twilio y el SMS se retiran
(hoy: `services/notifications/twilio_service.py` y `TWILIO_*` en `config.py`/`.env.example`).
Ya existen los ajustes `billing_payment_reminders`, `billing_reminder_frequency_days`,
`billing_notify_new_invoice` y `suspension_notify_*`; el worker que los use es lo que falta.

#### 4.5.0 Alta en Meta (empezar de inmediato, en paralelo — es el cuello de botella)

- [ ] Cuenta de Meta Business verificada, número dedicado de WhatsApp Business y app de desarrollador
- [ ] Token permanente (usuario del sistema), `WABA_ID` y `PHONE_NUMBER_ID`
- [ ] Plantillas en español enviadas a aprobación (categoría *utility* para cobros): recordatorio previo, vence hoy, factura vencida, aviso de corte, suspensión, reactivación, pago recibido, factura nueva. La aprobación tarda de horas a días

#### 4.5.1 Núcleo (1 sem)

- [ ] `services/notifications/whatsapp/`: interfaz `WhatsAppProvider` (`send_template`, `send_text`) + implementación `MetaCloudProvider` con `httpx`; versión de la Graph API configurable
- [ ] Configuración: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`; el token se guarda cifrado con Fernet en `SystemSettings`; documentar en `.env.example`
- [ ] Modelos: `WhatsAppTemplate` (nombre, idioma, categoría, estado de aprobación, variables) y `WhatsAppMessage` (cliente, plantilla, dirección entrante/saliente, estado en cola/enviado/entregado/leído/fallido, `wamid`, error, fechas); marca de baja `Client.whatsapp_opt_out`
- [ ] Webhook `GET/POST /api/whatsapp/webhook`: verificación del desafío, validación de `X-Hub-Signature-256`, estados de entrega, idempotencia por `wamid` y **mensajes entrantes guardados sin procesar** (base de 4.8)
- [ ] Normalizar teléfonos a E.164 (`core/validators.py`) y reporte de clientes con número inválido
- [ ] Envío por Celery con límite de tasa, reintentos con *backoff* y mapeo de los errores de Meta a mensajes legibles

#### 4.5.2 Avisos y recordatorios (1–2 sem)

- [ ] Worker `billing_reminders` (Celery Beat) con `billing_reminder_frequency_days`: X días antes, el día del vencimiento y N días después; sin duplicados; se detiene al registrar el pago
- [ ] Eventos: factura nueva, pago recibido (con el recibo PDF como documento), aviso previo al corte, suspensión, aplazamiento y reactivación (reemplaza las llamadas a `send_suspension_notification` en `workers/suspension.py`)
- [ ] **Avisos masivos** (mantenimientos, promociones, cortes de red) segmentados por sitio, router o plan; las promociones requieren consentimiento (*opt-in*) del cliente
- [ ] Baja automática cuando el cliente responde «BAJA»/«STOP»
- [ ] UI: Ajustes ▸ Notificaciones (credenciales, estado del webhook, plantillas y su aprobación, interruptores, mensaje de prueba); pestaña «WhatsApp» en el perfil del cliente con el historial; botón «Enviar recordatorio» en facturas
- [ ] Retirar Twilio (`twilio_service.py`, variables y dependencia); tests con la API de Meta simulada; `docs/whatsapp.md`

**Riesgos:** plantillas rechazadas (mantener el texto informativo, sin lenguaje promocional en cobros); calidad del número (bloqueos bajan el límite de envío); teléfonos sucios en clientes importados.

### 4.6 Contratos y documentos — **nuevo**

**Estado: no iniciado.** **Duración estimada:** 2–3 semanas. Hoy `DocumentsTab.tsx` es una
maqueta con datos de ejemplo y subida simulada, sin backend.

- [ ] Modelos `DocumentTemplate` (plantilla de contrato con variables: cliente, plan, dirección, precio, fechas, empresa) y `ClientDocument` (cliente, tipo contrato/cédula/croquis/otro, nombre, ruta, tamaño, mime, hash SHA-256, subido por, fecha, versión)
- [ ] **Almacenamiento configurable (decidido):** interfaz `StorageBackend` (`save`, `open`, `delete`, `exists`, URL temporal) con dos implementaciones elegibles en Ajustes ▸ Documentos ▸ Almacenamiento: **local** (volumen Docker `/data/documents`) o **S3 compatible** (`boto3`, `endpoint_url` configurable para AWS, MinIO, Wasabi, Backblaze, DigitalOcean Spaces). Parámetros S3: endpoint, región, bucket, prefijo, *access key* y *secret* (este cifrado con Fernet), cifrado en reposo opcional y botón «Probar conexión». `ClientDocument` guarda `storage_backend` y `storage_key`, así cambiar de backend no rompe los documentos ya subidos; migración entre backends como herramienta opcional. Bucket privado y descargas siempre autenticadas (streaming o URL prefirmada de corta vida). **Nunca en la BD**; validar tipo y tamaño y sanear nombres de archivo
- [ ] Endpoints: `POST/GET/DELETE /clients/{id}/documents` con descarga autenticada y `POST /clients/{id}/contract` que genera el PDF desde la plantilla (ReportLab, patrón de `pdf_generator.py`) con datos de `Company` y del cliente
- [ ] Generar el contrato al activar el plan y una nueva versión al cambiar de plan
- [ ] Contrato firmado: subir el escaneo (alcance mínimo). Firma electrónica o aceptación por WhatsApp: opcional, fuera del alcance inicial
- [ ] Enviar el contrato al cliente por WhatsApp como documento (depende de 4.5)
- [ ] UI: reemplazar los datos simulados de `DocumentsTab.tsx`; gestión de plantillas en Ajustes ▸ Documentos
- [ ] Auditoría de subidas y borrados; solo el rol `admin` elimina

### 4.7 Cash Desk (caja) — **nuevo**

**Estado: parcial.** **Duración estimada:** 2 semanas. Existe la caja del día de solo lectura
(`GET /payments/daily-cash`, `PaymentsPage`) con totales por método y recibo PDF. Falta la
operación de caja.

- [ ] Modelos `CashSession` (apertura: usuario, monto inicial; cierre: monto contado, diferencia, notas) y `CashMovement` (tipo ingreso/egreso/ajuste, categoría, monto, método, concepto, usuario, `payment_id` opcional, `session_id`)
- [ ] Endpoints: abrir y cerrar caja, registrar ingreso o egreso manual, arqueo (esperado vs. contado), listado por fecha y usuario
- [ ] Un pago en efectivo genera su movimiento en la sesión abierta del usuario; opción de exigir caja abierta para registrar efectivo
- [ ] Reporte de cierre de caja en PDF/Excel (patrones de 4.3) y diferencias por usuario
- [ ] UI en `PaymentsPage`: apertura/cierre, egresos, arqueo y permisos por rol
- [ ] Auditoría de cierres y ajustes

### 4.8 Cobranza con IA — **Próximamente**

**Estado: diferido.** Solo se entrega un *placeholder*; no se construye la IA ahora.

- [ ] Tarjeta «Cobranza con IA — Próximamente» (deshabilitada, con descripción) en Ajustes ▸ Integraciones
- [x] *(cubierto por 4.5.1)* webhook verificado y mensajes entrantes persistidos: es toda la base técnica que la IA necesitará

**Diseño futuro (no implementar todavía):** modelos `Conversation` y `PaymentProof`; clasificación
de intención (pago, promesa, reclamo, consulta, soporte); lectura de comprobantes con un modelo de
visión (monto, fecha, banco, referencia, titular); cola de revisión humana en el panel; promesas de
pago que aplazan el corte; ticket automático para reclamos. **Regla de seguridad:** la IA nunca
confirma un pago por sí sola — se valida contra el banco (conciliación) o lo aprueba una persona;
detección de referencias duplicadas y auditoría completa.

**Decisión pendiente:** confiar en el comprobante o validar contra el banco (cambia el diseño).

### Matriz de cumplimiento de requisitos (2026-11-14)

| # | Requisito | Estado | Dónde se completa |
|---|---|---|---|
| 1 | Cortes automáticos | ✅ Cumple | 2.4 (+ corte vía RADIUS en 3.5.2) |
| 2 | Cobranza 24/7 por WhatsApp con IA | ❌ Pendiente | 4.5 (WhatsApp) y 4.8 (IA, «Próximamente») |
| 3 | Avisos y recordatorios | 🟡 Parcial | 4.5 (solo WhatsApp) |
| 4 | Facturación electrónica | ❌ Pendiente | 4.2 (+ RIDE por WhatsApp) |
| 5 | Facturación prepago y pospago | ✅ Cumple | 4.1 |
| 6 | Cash Desk | 🟡 Parcial | 4.7 |
| 7 | Portal de clientes | ⏸ Diferido | Fase 5 |
| 8 | Inventarios | ✅ Cumple | Módulos adicionales |
| 9 | Contratos y documentos | ❌ Pendiente | 4.6 |
| 10 | Control de tráfico (Simple Queue, PPPoE, PPPoE-RADIUS) | 🟡 Parcial | 3.5 (PPPoE-RADIUS) |
| 11 | Wireless y fibra (Simple Queue, PPPoE, SmartOLT) | 🟡 Parcial | 3.5 y 4.4 |
| 12 | SmartOLT / gestión de OLTs | ❌ Pendiente | 4.4 (módulo propio, sin SmartOLT SaaS) |
| — | VPN WireGuard (adicional) | ❌ Pendiente | 3.6 (ISPSETUP como hub) |
| — | TR-069 / equipo del cliente (adicional) | ❌ Pendiente | 4.4.9 |

**Orden sugerido y dependencias**

| Etapa | Ítem | Duración | Depende de |
|---|---|---|---|
| 0 | 4.5.0 Alta en Meta y plantillas | Inmediato, en paralelo | Verificación del negocio |
| 1 | 4.5.1–4.5.2 WhatsApp | 3–4 sem | Plantillas aprobadas |
| 1 | 4.7 Cash Desk | 2 sem | — |
| 2 | 4.6 Contratos y documentos | 2–3 sem | 4.5 para el envío |
| 2 | 3.6 WireGuard | 2–3 sem | — |
| 3 | 3.5 RADIUS | 4–6 sem | Decisiones de 3.5 |
| 3 | 4.2 SRI | 3–4 sem | Certificado `.p12` y ambiente |
| 4 | 4.4.1–4.4.8 OLT/ONU (módulo propio) | 10–14 sem | Vendor prioritario y topología (3.5) |
| 5 | 4.4.9 TR-069 | 3–5 sem | *Vertical slice* de 4.4.1–4.4.2 |
| — | 4.8 Cobranza con IA | Diferido | 4.5 |

## Fase 5 — Diferido

- [ ] **Portal de clientes** (generar tickets de soporte y pagar facturas): **no planeado por ahora**. Hoy los tickets los crea el personal desde el perfil del cliente. Si se retoma: autenticación de clientes separada de `User`, pasarela de pago y enlaces de acceso por WhatsApp (4.5)
- [ ] App móvil para técnicos (descartada en 4.4; se retoma aquí solo si hace falta)
- ~~Gestión WiFi / TR-069~~ — movido a 4.4.9 y **en alcance** (decidido 2026-11-14)

## Decisiones de arquitectura clave

### Seguridad

- Contraseñas de routers cifradas con **Fernet** (clave maestra en variable de entorno, nunca en BD)
- Passwords de usuarios con **bcrypt** (cost factor 12)
- Certificados `.p12` SRI referenciados por ruta en filesystem seguro, nunca en BD
- Refresh tokens almacenados en Redis con TTL de 7 días; access tokens con TTL de 15 min
- Rate limiting en endpoints de auth (10 intentos/min por IP)
- Token de WhatsApp (Meta), secretos RADIUS por router y claves privadas de WireGuard cifrados con **Fernet**; nunca en logs ni en respuestas de la API
- Webhook de WhatsApp: validar `X-Hub-Signature-256` con el *app secret* antes de procesar; idempotencia por `wamid`
- RADIUS (UDP 1812/1813/3799) y WireGuard solo por red interna o VPN; el panel de documentos de clientes nunca sirve archivos sin autenticación

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
| Notif. WhatsApp | Meta Cloud API (httpx) | —     | Avisos y cobro por WhatsApp (4.5); Twilio se retira |
| RADIUS        | FreeRADIUS 3 + rlm_sql_postgresql | — | AAA PPPoE, CoA y accounting (3.5)           |
| VPN WireGuard | cryptography (X25519) + wg    | —       | Túneles a routers y técnicos (3.6)             |
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
| ACS TR-069          | GenieACS + MongoDB           | Gestión remota del equipo del cliente (4.4.9)  |

### Infraestructura y DevOps

| Componente           | Tecnología                        | Uso                        |
| -------------------- | --------------------------------- | -------------------------- |
| Contenedores         | Docker + Docker Compose           | Dev y producción           |
| Proxy inverso        | Nginx                             | SSL, routing, static files |
| CI/CD                | GitHub Actions                    | Lint, tests, build         |
| Conectividad routers | ZeroTier VPN y/o WireGuard        | Túnel seguro a los routers |
| Secretos             | python-dotenv + Pydantic Settings | Variables de entorno       |
| Monitoreo servidor   | Uptime Kuma (self-hosted)         | Health checks internos     |