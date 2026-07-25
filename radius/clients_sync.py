#!/usr/bin/env python3
"""Genera /etc/raddb/clients.conf a partir de la tabla `gateways` en Postgres.

Cada Gateway con security_mode en ('ppp_radius', 'hotspot_radius') y un
radius_secret_encrypted configurado se agrega como cliente NAS de FreeRADIUS,
con el mismo secreto (cifrado con Fernet) que la plataforma usa para
configurar el `/radius` del router MikroTik. Ver
backend/app/services/mikrotik/gateway_configuration.py.
"""
import os
import signal
import subprocess
import sys
import time

import psycopg2
from cryptography.fernet import Fernet, InvalidToken

DATABASE_URL = os.environ["DATABASE_URL"]
FERNET_KEY = os.environ["FERNET_KEY"]
CLIENTS_CONF_PATH = "/etc/raddb/clients.conf"
POLL_SECONDS = 30

_fernet = Fernet(FERNET_KEY.encode())


def _fetch_radius_gateways() -> list[tuple[str, str, str]]:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT name, ip, radius_secret_encrypted
                FROM gateways
                WHERE active = true
                  AND security_mode IN ('ppp_radius', 'hotspot_radius')
                  AND radius_secret_encrypted IS NOT NULL
                """
            )
            return cur.fetchall()
    finally:
        conn.close()


def _sanitize_client_name(name: str, fallback: str) -> str:
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in name).strip("_")
    return cleaned or fallback.replace(".", "_")


def render_clients_conf() -> str:
    rows = _fetch_radius_gateways()
    blocks = []
    seen_names: set[str] = set()
    for name, ip, secret_encrypted in rows:
        try:
            secret = _fernet.decrypt(secret_encrypted.encode()).decode()
        except (InvalidToken, AttributeError, ValueError):
            print(f"[clients_sync] No se pudo desencriptar el secreto del Gateway {name!r}; se omite.", file=sys.stderr)
            continue
        if not secret:
            continue

        base_name = _sanitize_client_name(name, ip)
        client_name = base_name
        suffix = 2
        while client_name in seen_names:
            client_name = f"{base_name}_{suffix}"
            suffix += 1
        seen_names.add(client_name)

        blocks.append(
            f"client {client_name} {{\n"
            f"    ipaddr = {ip}\n"
            f"    secret = {secret}\n"
            f"}}\n"
        )

    header = (
        "# Generado automáticamente por clients_sync.py — NO editar a mano.\n"
        "# Se regenera cada 30s a partir de la tabla `gateways` de ISP SETUP.\n\n"
    )
    return header + "\n".join(blocks)


def _reload_radiusd() -> None:
    # FreeRADIUS 3.x no relee clients.conf con SIGHUP (solo módulos y virtual
    # servers); la única forma confiable de aplicar cambios de clientes es
    # reiniciar el proceso. Se manda SIGTERM (apagado limpio) y se deja que la
    # política `restart: unless-stopped` de docker-compose relance el
    # contenedor, que vuelve a ejecutar entrypoint.sh (sync inicial + arranque).
    try:
        pids = subprocess.check_output(["pidof", "freeradius"]).split()
    except subprocess.CalledProcessError:
        print("[clients_sync] freeradius aún no está corriendo; se aplicará al iniciar.")
        return
    for pid in pids:
        os.kill(int(pid), signal.SIGTERM)
    print("[clients_sync] clients.conf actualizado; reiniciando freeradius para aplicar cambios.")


def sync_once() -> None:
    new_content = render_clients_conf()
    old_content = ""
    if os.path.exists(CLIENTS_CONF_PATH):
        with open(CLIENTS_CONF_PATH) as f:
            old_content = f.read()
    if new_content == old_content:
        return
    with open(CLIENTS_CONF_PATH, "w") as f:
        f.write(new_content)
    _reload_radiusd()


def _sync_with_retries(attempts: int = 10, delay: float = 3.0) -> None:
    for attempt in range(1, attempts + 1):
        try:
            sync_once()
            return
        except psycopg2.OperationalError as exc:
            print(f"[clients_sync] Postgres no disponible aún ({exc}); reintento {attempt}/{attempts}...", file=sys.stderr)
            time.sleep(delay)
    print("[clients_sync] No se pudo conectar a Postgres tras varios intentos.", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if "--watch-only" in sys.argv:
        while True:
            time.sleep(POLL_SECONDS)
            try:
                sync_once()
            except Exception as exc:
                print(f"[clients_sync] Error al sincronizar clients.conf: {exc}", file=sys.stderr)
        return

    _sync_with_retries()


if __name__ == "__main__":
    main()
