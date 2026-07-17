"""Aplica los modos operativos de un Gateway en RouterOS de forma idempotente."""
import logging

from librouteros.query import Key

from app.core.config import settings
from app.models.gateway import Gateway
from app.services.mikrotik.address_list import get_clean_list_name
from app.services.mikrotik.gateway_pool import gateway_pool

logger = logging.getLogger(__name__)


class GatewayConfigurationError(RuntimeError):
    """La configuración solicitada no pudo aplicarse de forma segura."""


def _nms_ip() -> str:
    if not settings.NMS_SERVER_IP:
        raise GatewayConfigurationError(
            "Configure NMS_SERVER_IP en el backend antes de habilitar Accounting, Traffic Flow o Radius."
        )
    return settings.NMS_SERVER_IP


def _set_hotspot_radius(api, enabled: bool) -> None:
    for profile in list(api.path('/ip/hotspot/profile')):
        entry_id = profile.get('.id')
        if entry_id:
            list(api('/ip/hotspot/profile/set', **{
                '.id': entry_id,
                'use-radius': 'yes' if enabled else 'no',
                'radius-accounting': 'yes' if enabled else 'no',
            }))


def _set_radius_entry(api, service: str) -> None:
    nms_ip = _nms_ip()
    if not settings.RADIUS_SECRET:
        raise GatewayConfigurationError(
            "Configure RADIUS_SECRET en el backend antes de seleccionar un modo Radius."
        )

    existing = list(
        api.path('/radius').select().where(Key('address') == nms_ip)
    )
    params = {
        'address': nms_ip,
        'secret': settings.RADIUS_SECRET,
        'service': service,
        'disabled': 'no',
    }
    if existing:
        list(api('/radius/set', **{'.id': existing[0]['.id'], **params}))
    else:
        list(api('/radius/add', **params))


def _disable_managed_radius(api) -> None:
    if not settings.NMS_SERVER_IP:
        return
    existing = list(
        api.path('/radius').select().where(Key('address') == settings.NMS_SERVER_IP)
    )
    for entry in existing:
        list(api('/radius/set', **{'.id': entry['.id'], 'disabled': 'yes'}))


def configure_security(api, security_mode: str) -> None:
    """Configura autenticación local/API o Radius para PPP y Hotspot."""
    radius_service = None
    if security_mode == 'ppp_radius':
        radius_service = 'ppp'
    elif security_mode == 'hotspot_radius':
        radius_service = 'hotspot'

    if radius_service:
        _set_radius_entry(api, radius_service)
    else:
        _disable_managed_radius(api)

    ppp_radius = security_mode == 'ppp_radius'
    hotspot_radius = security_mode == 'hotspot_radius'
    list(api('/ppp/aaa/set', **{
        'use-radius': 'yes' if ppp_radius else 'no',
        'accounting': 'yes' if security_mode in ('ppp_api', 'ppp_radius') else 'no',
    }))
    _set_hotspot_radius(api, hotspot_radius)


def _ensure_traffic_flow_target(api) -> None:
    nms_ip = _nms_ip()
    existing = list(
        api.path('/ip/traffic-flow/target').select().where(Key('dst-address') == nms_ip)
    )
    params = {
        'dst-address': nms_ip,
        'port': str(settings.TRAFFIC_FLOW_PORT),
        'version': '9',
        'disabled': 'no',
    }
    if existing:
        list(api('/ip/traffic-flow/target/set', **{'.id': existing[0]['.id'], **params}))
    else:
        list(api('/ip/traffic-flow/target/add', **params))


def configure_traffic_accounting(api, traffic_accounting: str) -> None:
    """Activa Accounting v6 o Traffic Flow y desactiva el mecanismo alternativo."""
    nms_ip = _nms_ip()
    if traffic_accounting == 'accounting_v6':
        list(api('/ip/traffic-flow/set', enabled='no'))
        list(api('/ip/accounting/set', enabled='yes'))
        list(api('/ip/accounting/web-access/set', **{
            'accessible-via-web': 'yes',
            'address': f'{nms_ip}/32',
        }))
        return

    list(api('/ip/accounting/set', enabled='no'))
    list(api('/ip/accounting/web-access/set', **{'accessible-via-web': 'no'}))
    list(api('/ip/traffic-flow/set', enabled='yes'))
    _ensure_traffic_flow_target(api)


def _ensure_named_resource(api, path: str, add_command: str, name: str, params: dict) -> None:
    existing = list(api.path(path).select().where(Key('name') == name))
    if existing:
        list(api(add_command.replace('/add', '/set'), **{'.id': existing[0]['.id'], **params}))
    else:
        list(api(add_command, name=name, **params))


def _ensure_mangle_rule(api, comment: str, params: dict) -> None:
    existing = list(
        api.path('/ip/firewall/mangle').select().where(Key('comment') == comment)
    )
    if existing:
        list(api('/ip/firewall/mangle/set', **{'.id': existing[0]['.id'], **params}))
    else:
        list(api('/ip/firewall/mangle/add', comment=comment, **params))


def ensure_pcq_parent_rules(api, address_list: str) -> None:
    """Verifica tipos PCQ, marcado de paquetes y reglas parentales de Queue Tree."""
    _ensure_named_resource(
        api, '/queue/type', '/queue/type/add', 'isp_pcq_upload',
        {'kind': 'pcq', 'pcq-classifier': 'src-address'},
    )
    _ensure_named_resource(
        api, '/queue/type', '/queue/type/add', 'isp_pcq_download',
        {'kind': 'pcq', 'pcq-classifier': 'dst-address'},
    )
    _ensure_mangle_rule(api, 'ISP NMS PCQ upload', {
        'chain': 'forward',
        'src-address-list': address_list,
        'action': 'mark-packet',
        'new-packet-mark': 'isp_pcq_upload',
        'passthrough': 'no',
        'disabled': 'no',
    })
    _ensure_mangle_rule(api, 'ISP NMS PCQ download', {
        'chain': 'forward',
        'dst-address-list': address_list,
        'action': 'mark-packet',
        'new-packet-mark': 'isp_pcq_download',
        'passthrough': 'no',
        'disabled': 'no',
    })
    _ensure_named_resource(
        api, '/queue/tree', '/queue/tree/add', 'isp_pcq_upload',
        {'parent': 'global', 'packet-mark': 'isp_pcq_upload', 'queue': 'isp_pcq_upload', 'disabled': 'no'},
    )
    _ensure_named_resource(
        api, '/queue/tree', '/queue/tree/add', 'isp_pcq_download',
        {'parent': 'global', 'packet-mark': 'isp_pcq_download', 'queue': 'isp_pcq_download', 'disabled': 'no'},
    )


def configure_speed_control(api, gateway: Gateway) -> None:
    if gateway.speed_control_type == 'pcq_addresslist':
        ensure_pcq_parent_rules(api, get_clean_list_name(gateway.address_list))
        return

    for comment in ('ISP NMS PCQ upload', 'ISP NMS PCQ download'):
        entries = list(
            api.path('/ip/firewall/mangle').select().where(Key('comment') == comment)
        )
        for entry in entries:
            list(api('/ip/firewall/mangle/set', **{'.id': entry['.id'], 'disabled': 'yes'}))
    for name in ('isp_pcq_upload', 'isp_pcq_download'):
        entries = list(api.path('/queue/tree').select().where(Key('name') == name))
        for entry in entries:
            list(api('/queue/tree/set', **{'.id': entry['.id'], 'disabled': 'yes'}))


def apply_gateway_configuration(gateway: Gateway, changed_fields: set[str]) -> None:
    """Aplica únicamente los modos que cambiaron en la petición de actualización."""
    configurable = {'security_mode', 'traffic_accounting', 'speed_control_type'}
    changes = configurable.intersection(changed_fields)
    if not changes:
        return

    try:
        with gateway_pool.connect_to(gateway) as api:
            if 'security_mode' in changes:
                configure_security(api, gateway.security_mode)
            if 'traffic_accounting' in changes:
                configure_traffic_accounting(api, gateway.traffic_accounting)
            if 'speed_control_type' in changes:
                configure_speed_control(api, gateway)
    except GatewayConfigurationError:
        raise
    except Exception as exc:
        logger.exception('No se pudo configurar el Gateway %s', gateway.name)
        raise GatewayConfigurationError(str(exc)) from exc
