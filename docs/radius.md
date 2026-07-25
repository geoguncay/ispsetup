# RADIUS (Accounting)

## Qué hace y qué NO hace

Esta plataforma incluye un servidor **FreeRADIUS de solo Accounting** (contenedor
`freeradius` en `docker-compose.yml`). Recibe los paquetes de Accounting
(inicio/fin/interim de sesión) que un Gateway MikroTik envía cuando su modo de
Seguridad es **"PPP / Accounting Radius"** o **"Hotspot / Accounting Radius"**, y
los registra en archivos `detail` (uno por Gateway, rotados por día) dentro del
volumen `freeradius_acct`.

**Este servidor no gestiona autenticación de usuarios.** No hay ningún usuario ni
contraseña cargados en él: cualquier Access-Request (autenticación) que le llegue
será rechazado por defecto.

- **PPP / Accounting Radius es seguro de usar hoy.** En RouterOS, `/ppp/aaa
use-radius=yes` primero busca al usuario en el secreto **local**
  (`/ppp/secret`, que esta plataforma ya sincroniza con cada cliente PPPoE) y
  solo consulta RADIUS si no encuentra coincidencia local. Como todos los
  clientes ya tienen su secreto local, la autenticación sigue funcionando
  exactamente igual que hoy; lo único nuevo es que además se envía Accounting a
  este servidor.
- **Hotspot / Accounting Radius NO es seguro de usar todavía.** Esta plataforma
  no gestiona usuarios de Hotspot localmente, así que `use-radius=yes` en el
  perfil Hotspot enviaría autenticación real a un servidor que solo hace
  Accounting → **todos los usuarios Hotspot serían rechazados**. No selecciones
  este modo a menos que ya resuelvas la autenticación Hotspot por otro medio
  (por ejemplo, un FreeRADIUS externo con usuarios reales). La UI muestra una
  advertencia si lo seleccionas.

## Arquitectura

```
Gateway MikroTik  ──UDP 1812/1813──▶  contenedor freeradius  ──▶  /var/log/freeradius/radacct/<ip>/detail-YYYYMMDD
```

- El **secreto RADIUS es propio de cada Gateway** (no uno global): se configura
  en Ajustes de Gateway ▸ Seguridad, cifrado con Fernet igual que el resto de
  credenciales de la plataforma.
- La **IP del servidor ISPSETUP** (a la que apuntan los Gateways) es global y se
  configura en Ajustes ▸ Integraciones ▸ RADIUS. Debe ser una IP alcanzable
  desde la red de todos los Gateways (LAN, VPN o ZeroTier del host donde corre
  Docker) — la misma dirección que ya usa Traffic Flow.
- El contenedor `freeradius` genera su propio `clients.conf` (la lista de NAS
  autorizados) leyendo directamente la tabla `gateways` de Postgres
  (`radius/clients_sync.py`): solo incluye los Gateways cuyo `security_mode`
  sea `ppp_radius`/`hotspot_radius` y tengan un secreto configurado, y
  desencripta ese secreto con el mismo `FERNET_KEY` del backend.

## Seguridad de red

- **No expongas los puertos 1812/1813 UDP a Internet.** RADIUS clásico solo
  ofusca la contraseña (cuando aplica) con el shared secret + MD5; el resto
  del paquete viaja sin cifrar. Mantén estos puertos accesibles solo desde la
  red donde están los Gateways (LAN, VPN o ZeroTier), nunca en un puerto
  públicamente enrutable.
- El secreto de cada Gateway se guarda cifrado en la base de datos (nunca en
  texto plano) y nunca se vuelve a mostrar en la UI una vez guardado (el
  diálogo solo indica "(configurado)").

## Puesta en marcha

1. **Ajustes ▸ Integraciones ▸ RADIUS**: define la IP del servidor ISPSETUP
   (alcanzable desde los Gateways).
2. **Ajustes de Gateway ▸ Seguridad** (por cada Gateway que use Radius):
   selecciona "PPP / Accounting Radius", genera un secreto fuerte
   (`openssl rand -hex 32`) y guárdalo. Al guardar, la plataforma configura el
   `/radius` del router MikroTik automáticamente.
3. Levanta el servidor:
   ```bash
   docker compose up -d freeradius
   ```
4. Verifica el arranque y que `clients.conf` incluya el Gateway:
   ```bash
   docker compose logs -f freeradius
   docker compose exec freeradius cat /etc/raddb/clients.conf
   ```
5. Inspecciona el Accounting recibido:
   ```bash
   docker compose exec freeradius sh -c "ls /var/log/freeradius/radacct/"
   docker compose exec freeradius sh -c "tail -f /var/log/freeradius/radacct/*/detail-*"
   ```

## Rotar o quitar el secreto de un Gateway

- **Rotar**: cambia el secreto en Ajustes de Gateway ▸ Seguridad y guarda. Se
  aplica al MikroTik de inmediato. El contenedor `freeradius` detecta el
  cambio en `gateways` dentro de ~30s y **se reinicia automáticamente**
  (FreeRADIUS no relee `clients.conf` con una señal en caliente; por eso el
  sincronizador reinicia el proceso y `restart: unless-stopped` relanza el
  contenedor con la configuración nueva — es un corte de unos segundos, solo
  en el Accounting, no en la conectividad de los clientes).
- **Quitar**: cambia el modo de Seguridad del Gateway a uno que no sea Radius;
  el Gateway deja de enviarse en `clients.conf` en el siguiente ciclo de
  sincronización.
