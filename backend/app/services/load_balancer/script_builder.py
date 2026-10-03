"""
Generador de scripts RouterOS para configuraciones de balanceo de carga (PCC / Failover).

Genera una lista de comandos estructurados (path + parámetros), lista para ejecutarse
directamente contra la API de RouterOS con el mismo patrón que el resto de
`app/services/router/*` (ver `script_runner.apply_built_script`). El texto en formato
de script RouterOS que se muestra en la UI y se guarda en el historial se deriva de
esa misma lista de comandos, así ambos nunca pueden quedar desincronizados.

Notas de compatibilidad RouterOS (verificadas contra un RB4011 en RouterOS 7.15):
- `per-connection-classifier` solo acepta un resto entero único (p. ej. `5/3`), NO un
  rango (`5/0-3`) — para dar más peso a un enlace se necesitan varias reglas de
  mark-connection, una por cada "resto" que le corresponde.
- Desde RouterOS v7, un `new-routing-mark` debe existir primero como tabla de ruteo
  (`/routing/table add fib`) antes de poder usarse en mangle o en rutas.
- Desde RouterOS v7, `/ip/route` ya no tiene la propiedad `routing-mark`: se renombró
  a `routing-table`.
- Sin una regla de NAT (`masquerade`) por cada interfaz WAN, el tráfico que sale por
  ese enlace conserva la IP privada de la LAN y el ISP lo descarta — el router se
  queda sin salida a internet aunque el ruteo esté bien. Hay que agregarla siempre.
"""
import math
from dataclasses import dataclass
from functools import reduce

# Tope de reglas de mark-connection que el PCC ponderado puede generar (suma de los
# pesos ya reducidos por su máximo común divisor). Si los pesos elegidos superan esto,
# se pide usar una proporción más simple en vez de generar cientos de reglas.
_MAX_PCC_SLOTS = 32


@dataclass
class WanLink:
    interface: str
    gateway: str
    weight: int = 1   # PCC: proporción relativa de tráfico frente a los demás enlaces
    priority: int = 0  # Failover: orden de preferencia (0 = principal)


@dataclass
class BuiltScript:
    commands: list[tuple[str, dict]]
    algorithm: str

    @property
    def text(self) -> str:
        lines = [f"# Generado por ISPSETUP — balanceo {self.algorithm.upper()}"]
        for path, params in self.commands:
            rendered_params = " ".join(f'{key}="{value}"' for key, value in params.items())
            lines.append(f"{path} {rendered_params}".strip())
        return "\n".join(lines)


class ScriptBuilderError(Exception):
    """La configuración de enlaces WAN no permite generar un script de balanceo válido."""


def _validate_links(wan_links: list[WanLink]) -> None:
    if len(wan_links) < 2:
        raise ScriptBuilderError("Se requieren al menos 2 enlaces WAN para balancear carga")
    interfaces = [link.interface for link in wan_links]
    if len(interfaces) != len(set(interfaces)):
        raise ScriptBuilderError("No se puede repetir la misma interfaz en varios enlaces WAN")


def _reduced_weights(wan_links: list[WanLink]) -> list[int]:
    """Pesos reducidos por su máximo común divisor, para generar el mínimo de reglas
    posible manteniendo la misma proporción (p. ej. [10, 10, 2] -> [5, 5, 1])."""
    weights = [max(1, link.weight) for link in wan_links]
    common = reduce(math.gcd, weights)
    return [w // common for w in weights]


def _build_pcc_commands(wan_links: list[WanLink]) -> list[tuple[str, dict]]:
    """
    PCC (Per Connection Classifier): cada conexión nueva se clasifica por un resto
    `both-addresses-and-ports:N/i` y se marca para salir por un WAN específico — las
    conexiones ya existentes mantienen su WAN. `weight` reparte el tráfico asignando
    más restos (una regla de mark-connection por resto) al enlace con mayor peso —
    RouterOS no acepta un rango de restos en una sola regla.
    """
    weights = _reduced_weights(wan_links)
    total_weight = sum(weights)
    if total_weight > _MAX_PCC_SLOTS:
        raise ScriptBuilderError(
            f"Los pesos elegidos generarían {total_weight} reglas de marcado (máximo {_MAX_PCC_SLOTS}). "
            "Usa una proporción más simple entre los enlaces, por ejemplo 1, 2, 3 en vez de números grandes."
        )

    commands: list[tuple[str, dict]] = []

    # Desde RouterOS v7, cada routing-mark debe existir primero como tabla de ruteo.
    # Nota: `/routing/table` no admite `comment` (no aparece en el schema real del
    # equipo) — la tabla se identifica por su `name` con el prefijo "ispsetup-".
    for idx in range(1, len(wan_links) + 1):
        commands.append((
            "/routing/table/add",
            {
                "name": f"ispsetup-wan{idx}",
                "fib": "yes",
            },
        ))

    slot = 0
    for idx, (link, weight) in enumerate(zip(wan_links, weights), start=1):
        for _ in range(weight):
            commands.append((
                "/ip/firewall/mangle/add",
                {
                    "chain": "prerouting",
                    "in-interface": link.interface,
                    "connection-mark": "no-mark",
                    "per-connection-classifier": f"both-addresses-and-ports:{total_weight}/{slot}",
                    "action": "mark-connection",
                    "new-connection-mark": f"wan{idx}-conn",
                    "passthrough": "yes",
                    "comment": f"ISPSETUP PCC WAN{idx} ({link.interface})",
                },
            ))
            slot += 1

    for idx, link in enumerate(wan_links, start=1):
        commands.append((
            "/ip/firewall/mangle/add",
            {
                "chain": "prerouting",
                "connection-mark": f"wan{idx}-conn",
                "action": "mark-routing",
                "new-routing-mark": f"ispsetup-wan{idx}",
                "passthrough": "no",
                "comment": f"ISPSETUP PCC WAN{idx} ({link.interface})",
            },
        ))

    for idx, link in enumerate(wan_links, start=1):
        commands.append((
            "/ip/route/add",
            {
                "dst-address": "0.0.0.0/0",
                "gateway": link.gateway,
                "routing-table": f"ispsetup-wan{idx}",
                "distance": "1",
                "comment": f"ISPSETUP PCC WAN{idx} ({link.interface})",
            },
        ))

    # Rutas de respaldo fuera de las marcas de ruteo, por si el chequeo de interfaz
    # local falla antes de que una conexión reciba una marca.
    for idx, link in enumerate(wan_links, start=1):
        commands.append((
            "/ip/route/add",
            {
                "dst-address": "0.0.0.0/0",
                "gateway": link.gateway,
                "distance": str(idx),
                "check-gateway": "ping",
                "comment": f"ISPSETUP PCC WAN{idx} fallback ({link.interface})",
            },
        ))

    # Sin masquerade, el tráfico que sale por cada WAN conserva la IP privada de la
    # LAN y el ISP lo descarta — sin esto el router se queda sin internet aunque el
    # ruteo esté perfecto.
    for idx, link in enumerate(wan_links, start=1):
        commands.append((
            "/ip/firewall/nat/add",
            {
                "chain": "srcnat",
                "action": "masquerade",
                "out-interface": link.interface,
                "comment": f"ISPSETUP PCC WAN{idx} ({link.interface})",
            },
        ))

    return commands


def _build_failover_commands(wan_links: list[WanLink]) -> list[tuple[str, dict]]:
    """Una ruta por defecto por enlace, ordenadas por `priority` con distancias
    escalonadas y verificación activa del gateway (`check-gateway=ping`)."""
    ordered = sorted(wan_links, key=lambda link: link.priority)
    commands: list[tuple[str, dict]] = []
    for idx, link in enumerate(ordered, start=1):
        role = "principal" if idx == 1 else f"respaldo {idx - 1}"
        commands.append((
            "/ip/route/add",
            {
                "dst-address": "0.0.0.0/0",
                "gateway": link.gateway,
                "distance": str(idx),
                "check-gateway": "ping",
                "comment": f"ISPSETUP Failover {role} ({link.interface})",
            },
        ))

    # Igual que en PCC: sin masquerade por cada WAN, el tráfico que sale por el
    # enlace de respaldo conserva la IP privada de la LAN y el ISP lo descarta.
    for idx, link in enumerate(ordered, start=1):
        commands.append((
            "/ip/firewall/nat/add",
            {
                "chain": "srcnat",
                "action": "masquerade",
                "out-interface": link.interface,
                "comment": f"ISPSETUP Failover WAN{idx} ({link.interface})",
            },
        ))

    return commands


def build_script(algorithm: str, wan_links: list[WanLink]) -> BuiltScript:
    _validate_links(wan_links)
    if algorithm == "pcc":
        return BuiltScript(commands=_build_pcc_commands(wan_links), algorithm=algorithm)
    if algorithm == "failover":
        return BuiltScript(commands=_build_failover_commands(wan_links), algorithm=algorithm)
    raise ScriptBuilderError(f"Algoritmo de balanceo desconocido: {algorithm}")
