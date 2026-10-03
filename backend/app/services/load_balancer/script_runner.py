"""
Ejecuta scripts de balanceo generados por plantilla (PCC/Failover) contra un
balanceador RouterOS, reutilizando el mismo pool de conexión que Router (ver
app.services.router.router_pool).

Nota: la ejecución de scripts .rsc arbitrarios pegados por el usuario fue
retirada deliberadamente de la plataforma — esa operación se hace solo
entrando al equipo por Winbox, directamente.
"""
import logging

from app.services.load_balancer.script_builder import BuiltScript
from app.services.router.router_pool import router_pool

logger = logging.getLogger(__name__)

_TAG = "ISPSETUP"


class LoadBalancerScriptError(Exception):
    """El script no pudo aplicarse de forma segura en el balanceador."""


def _cleanup_previous_application(api) -> None:
    """
    Elimina las reglas de mangle, rutas y tablas de ruteo que una aplicación
    anterior de ISPSETUP haya dejado en el equipo, para que volver a aplicar
    (o cambiar de algoritmo) reemplace la configuración en vez de ir
    acumulando reglas duplicadas. No falla si no encuentra nada — la primera
    aplicación en un equipo nuevo simplemente no tiene qué limpiar.

    Orden: rutas y NAT primero (pueden referenciar una tabla de ruteo), luego las
    reglas de mangle, y las tablas de ruteo al final.
    """
    for route in list(api("/ip/route/print")):
        if _TAG in (route.get("comment") or ""):
            list(api("/ip/route/remove", **{".id": route[".id"]}))

    for nat_rule in list(api("/ip/firewall/nat/print")):
        if _TAG in (nat_rule.get("comment") or ""):
            list(api("/ip/firewall/nat/remove", **{".id": nat_rule[".id"]}))

    for rule in list(api("/ip/firewall/mangle/print")):
        if _TAG in (rule.get("comment") or ""):
            list(api("/ip/firewall/mangle/remove", **{".id": rule[".id"]}))

    for table in list(api("/routing/table/print")):
        if str(table.get("name", "")).startswith("ispsetup-"):
            list(api("/routing/table/remove", **{".id": table[".id"]}))


def apply_built_script(load_balancer, built: BuiltScript) -> None:
    """
    Limpia lo que una aplicación anterior haya dejado y ejecuta, comando por
    comando, el script generado por plantilla (ver script_builder.build_script).
    Cada comando ya viene estructurado como (path, parámetros), así que se
    aplica directo contra la API — no requiere interpretar texto RouterOS.
    """
    try:
        with router_pool.connect_to(load_balancer) as api:
            _cleanup_previous_application(api)
            for path, params in built.commands:
                list(api(path, **params))
    except Exception as exc:
        logger.exception("No se pudo aplicar el script de balanceo en %s", load_balancer.name)
        raise LoadBalancerScriptError(str(exc)) from exc
