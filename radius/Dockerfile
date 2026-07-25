# Servidor RADIUS de Accounting bundled para ISP SETUP.
# Genera clients.conf dinámicamente desde la tabla `gateways` de la
# plataforma (ver clients_sync.py) en lugar de una lista estática de NAS.
FROM freeradius/freeradius-server:3.2.6

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --no-cache-dir psycopg2-binary cryptography \
    && rm -rf /var/lib/apt/lists/*

COPY clients_sync.py /opt/clients_sync.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /opt/clients_sync.py

ENTRYPOINT ["/entrypoint.sh"]
