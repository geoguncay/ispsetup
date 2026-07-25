#!/bin/sh
set -e

echo "[entrypoint] Generando clients.conf inicial desde Postgres..."
python3 /opt/clients_sync.py

echo "[entrypoint] Iniciando sincronizador en segundo plano (cada 30s)..."
python3 /opt/clients_sync.py --watch-only &

echo "[entrypoint] Iniciando freeradius..."
exec freeradius -f -l stdout
