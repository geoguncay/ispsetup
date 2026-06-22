# ISP Platform — Especificación y Documentación de la API

Esta documentación describe todos los endpoints, esquemas de datos y flujos de integración disponibles en la API de la plataforma WISP.

## Información General

- **Base URL**: `http://localhost:8000/api`
- **Formato de datos**: JSON (`Content-Type: application/json`)
- **Autenticación**: JSON Web Tokens (JWT) mediante cabecera HTTP Bearer:
  ```http
  Authorization: Bearer <access_token>
  ```
- **Documentación Interactiva (Swagger UI)**: `http://localhost:8000/api/docs`

## 🔐 Módulo de Autenticación (`/auth`)

Maneja el ciclo de vida de la sesión del usuario.

### 1. Iniciar Sesión (Login)
- **Ruta**: `POST /auth/login`
- **Petición**:
  ```json
  {
    "email": "admin@email.com",
    "password": "t3PXeS4tnt"
  }
  ```
- **Respuesta (`200 OK`)**:
  ```json
  {
    "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsIn...",
    "token_type": "bearer"
  }
  ```

### 2. Refrescar Token
- **Ruta**: `POST /auth/refresh`
- **Petición**:
  ```json
  {
    "refresh_token": "eyJhbGciOiJIUzI1NiIsIn..."
  }
  ```
- **Respuesta (`200 OK`)**: Nuevo par de tokens (Access y Refresh).

### 3. Obtener Usuario Actual
- **Ruta**: `GET /auth/me`
- **Cabecera**: Requiere token
- **Respuesta (`200 OK`)**:
  ```json
  {
    "id": "ad96dd1b-da81-449a-9952-b7529a07ae1b",
    "nombre": "Geo",
    "email": "admin@email.com",
    "rol": "admin",
    "activo": true,
    "created_at": "2026-06-21T18:02:43Z"
  }
  ```

---

## 👤 Módulo de Clientes (`/clients`)

Gestión y control de red de los suscriptores.

### 1. Listar Clientes
- **Ruta**: `GET /clients`
- **Parámetros Query** (Opcionales):
  - `search`: Busca por nombre, cédula o teléfono.
  - `router_id` / `plan_id` / `site_id`: Filtrado por enrutador, plan o sitio.
  - `activo`: `true` (activos) o `false` (suspendidos).
  - `tipo`: `static` (IP estática) o `pppoe`.
  - `skip` / `limit`: Paginación.
- **Respuesta (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "bc11b931-152e-4b4b-91cc-a12da9f9393a",
        "nombre": "Juan Perez",
        "cedula": "1724024888",
        "telefono": "0999999999",
        "direccion": "Sector La Mariscal",
        "activo": true,
        "tipo": "static",
        "router_nombre": "Router Quito Central",
        "site_nombre": "Torre Central",
        "static_ip": { "ip": "192.168.10.15", "mac": "00:1A:2B:3C:4D:5E" },
        "plan_activo": { "id": "uuid", "nombre": "Plan Fibra 50 Mbps", "precio": 22.40 }
      }
    ],
    "total": 1
  }
  ```

### 2. Crear Cliente
- **Ruta**: `POST /clients`
- **Petición**:
  ```json
  {
    "nombre": "Maria Gomez",
    "cedula": "0926079971",
    "telefono": "0988888888",
    "direccion": "Av. Carlos Julio Arosemena",
    "router_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3d4f8f",
    "plan_id": "c76b92a4-47b2-4d0a-9d93-ef72da9a3c9b",
    "tipo": "static",
    "ip": "192.168.10.20",
    "mac": "00:1A:2B:3C:4D:6F"
  }
  ```
- **Respuesta (`201 Created`)**: El objeto del cliente recién creado.

### 3. Suspender / Reactivar Cliente
- **Suspender**: `POST /clients/{client_id}/suspend?motivo=Falta%20de%20pago`
  - Bloquea la navegación del cliente en el MikroTik (firewall address list) y registra el log.
- **Reactivar**: `POST /clients/{client_id}/reactivate`
  - Desbloquea la navegación del cliente en el MikroTik.

---

## 📡 Módulo de Routers / Dispositivos (`/routers`)

Gestión de enrutadores MikroTik e integración API.

### 1. Listar Enrutadores
- **Ruta**: `GET /routers`
- **Respuesta (`200 OK`)**:
  ```json
  [
    {
      "id": "1fc98b91-b5f1-4634-b618-ed365276acd8",
      "nombre": "Router Quito Central",
      "ip": "192.168.191.16",
      "puerto_api": 8728,
      "usuario_api": "admin",
      "activo": true,
      "site_nombre": "Torre Central",
      "status": "online",
      "uptime": "2d 4h 12m",
      "ros_version": "7.12"
    }
  ]
  ```

### 2. Sincronizar Cola Padre (Parent Queue)
- **Obtener Cola Padre**: `GET /routers/{router_id}/parent-queue`
- **Configurar Cola Padre**: `POST /routers/{router_id}/parent-queue`
  - Body:
    ```json
    {
      "nombre": "Cola_Padre_General",
      "limit_up_mbps": 100,
      "limit_down_mbps": 100
    }
    ```

---

## 📍 Módulo de Sitios / Ubicaciones (`/sites`)

Permite segmentar y estructurar la red física y lógica en Nodos o Sitios.

### 1. Listar Sitios
- **Ruta**: `GET /sites`
- **Respuesta (`200 OK`)**:
  ```json
  [
    {
      "id": "c2b0b1a0-4b1a-4c2b-8a8b-1a2b3c4d5e6f",
      "nombre": "Torre Central",
      "created_at": "2026-06-21T18:02:43Z"
    }
  ]
  ```

### 2. Crear Sitio
- **Ruta**: `POST /sites`
- **Petición**:
  ```json
  {
    "nombre": "Nodo Norte"
  }
  ```

---

## ⚡ Módulo de Planes de Internet (`/plans`)

Define los anchos de banda y tarifas mensuales.

### 1. Crear Plan
- **Ruta**: `POST /plans`
- **Petición**:
  ```json
  {
    "nombre": "Plan Fibra 100 Mbps",
    "velocidad_down_mbps": 100,
    "velocidad_up_mbps": 50,
    "precio": 35.00
  }
  ```

---

## 📊 Monitoreo de Tráfico en Tiempo Real (WebSockets)

Para obtener métricas en tiempo real de consumo de los clientes y del router de manera reactiva:

### 1. Establecer Conexión WS
- **URL**: `ws://localhost:8000/api/traffic/ws/{router_id}?token=<access_token>`
- **Comportamiento**: 
  - El colector consulta cada 2 segundos el MikroTik y envía un payload JSON broadcast con las tasas de descarga (`rx_rate`) y subida (`tx_rate`) de todas las colas e interfaces conectadas.
- **Formato del Mensaje Recibido**:
  ```json
  {
    "timestamp": "2026-06-21T18:33:00Z",
    "clients": [
      {
        "cliente_id": "bc11b931-152e-4b4b-91cc-a12da9f9393a",
        "rx_rate": 1540280,  // bits por segundo (b/s)
        "tx_rate": 450200
      }
    ]
  }
  ```

## 📋 Listado Completo de Endpoints por Módulos

A continuación se detalla la lista de todos los endpoints registrados en el servidor FastAPI divididos por módulos:

### Módulo de Autenticación
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/auth/login` | `POST` | Iniciar sesión |
| `/api/auth/refresh` | `POST` | Refrescar tokens JWT |
| `/api/auth/logout` | `POST` | Cerrar sesión e invalidar refresh token |
| `/api/auth/me` | `GET` | Obtener perfil del usuario autenticado |
| `/api/auth/setup` | `POST` | Inicializar administrador |

### Módulo de Usuarios
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/users` | `GET` | Listar usuarios |
| `/api/users` | `POST` | Registrar nuevo usuario |
| `/api/users/stats` | `GET` | Obtener estadísticas generales de usuarios |
| `/api/users/me` | `GET` | Obtener perfil del usuario actual |
| `/api/users/{user_id}` | `GET` | Detalle del usuario |
| `/api/users/{user_id}` | `PUT` | Editar usuario |
| `/api/users/{user_id}` | `DELETE` | Eliminar/dar de baja usuario |

### Módulo de Dispositivos / Routers
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/routers` | `GET` | Listar enrutadores activos |
| `/api/routers` | `POST` | Registrar enrutador |
| `/api/routers/test-connection` | `POST` | Probar conexión con credenciales temporales |
| `/api/routers/{router_id}` | `GET` | Detalle del router |
| `/api/routers/{router_id}` | `PUT` | Editar router |
| `/api/routers/{router_id}` | `DELETE` | Eliminar router |
| `/api/routers/{router_id}/status` | `GET` | Estado en tiempo real del router |
| `/api/routers/{router_id}/test-connection` | `POST` | Probar conexión a router guardado |
| `/api/routers/{router_id}/address-lists` | `GET` | Obtener listas de direcciones MikroTik |
| `/api/routers/{router_id}/import-clients` | `POST` | Importar clientes desde address-list |
| `/api/routers/{router_id}/queues` | `GET` | Obtener colas MikroTik |
| `/api/routers/{router_id}/parent-queue` | `GET` | Consultar cola padre |
| `/api/routers/{router_id}/parent-queue` | `POST` | Configurar cola padre |
| `/api/routers/{router_id}/sync-pppoe-profiles` | `POST` | Sincronizar perfiles PPPoE |
| `/api/routers/{router_id}/pppoe-profiles` | `GET` | Listar perfiles PPPoE locales |
| `/api/routers/{router_id}/pppoe-sessions` | `GET` | Listar sesiones PPPoE activas |
| `/api/routers/{router_id}/pppoe-sessions/{username}` | `DELETE` | Desconectar sesión PPPoE (Kick) |

### Módulo de Compañía
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/company` | `GET` | Consultar datos del WISP |
| `/api/company` | `PUT` | Actualizar información de la empresa |
| `/api/company/logo` | `POST` | Cargar logotipo de la empresa |

### Módulo de Clientes
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/clients` | `GET` | Listar clientes (con filtros y paginación) |
| `/api/clients` | `POST` | Registrar cliente |
| `/api/clients/{client_id}` | `GET` | Detalle del cliente |
| `/api/clients/{client_id}` | `PUT` | Editar cliente |
| `/api/clients/{client_id}` | `DELETE` | Eliminar cliente |
| `/api/clients/{client_id}/plans` | `GET` | Historial de planes del cliente |
| `/api/clients/{client_id}/assign-plan` | `POST` | Asignar nuevo plan al cliente |
| `/api/clients/{client_id}/sync-router` | `POST` | Forzar sincronización MikroTik |
| `/api/clients/{client_id}/toggle-queue` | `POST` | Activar/desactivar limitación de velocidad |
| `/api/clients/{client_id}/suspend` | `POST` | Suspender cliente |
| `/api/clients/{client_id}/reactivate` | `POST` | Reactivar cliente |
| `/api/clients/{client_id}/suspensions` | `GET` | Historial de suspensiones |
| `/api/clients/{client_id}/payments` | `GET` | Historial de pagos |
| `/api/clients/{client_id}/tickets` | `GET` | Listar tickets de soporte |
| `/api/clients/{client_id}/tickets` | `POST` | Registrar ticket de soporte |
| `/api/clients/{client_id}/traffic` | `GET` | Estadísticas históricas de tráfico |

### Módulo de Planes
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/plans` | `GET` | Listar planes |
| `/api/plans` | `POST` | Registrar plan |
| `/api/plans/{plan_id}` | `GET` | Detalle del plan |
| `/api/plans/{plan_id}` | `PUT` | Editar plan |
| `/api/plans/{plan_id}` | `DELETE` | Eliminar plan |

### Módulo de Tráfico
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/traffic/ws/{router_id}` | `WebSocket` | Suscripción de tráfico en vivo |
| `/api/traffic/client/{client_id}` | `GET` | Historial de tráfico de cliente |
| `/api/traffic/router/{router_id}` | `GET` | Historial de tráfico de interfaces de router |

### Módulo de Servicios Personalizados
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/custom-services` | `GET` | Listar servicios |
| `/api/custom-services` | `POST` | Registrar nuevo servicio |
| `/api/custom-services/{service_id}` | `GET` | Detalle del servicio |
| `/api/custom-services/{service_id}` | `PUT` | Editar servicio |
| `/api/custom-services/{service_id}` | `DELETE` | Eliminar servicio |

### Módulo de Sitios / Ubicaciones
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/sites` | `GET` | Listar sitios de red |
| `/api/sites` | `POST` | Registrar sitio de red |

### Módulo de Salud
| Endpoint | Método | Descripción |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Chequeo de estado de salud de la API |

---
