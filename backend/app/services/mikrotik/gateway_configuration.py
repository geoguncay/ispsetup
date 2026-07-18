"""Aplica los modos operativos de un Gateway en RouterOS de forma idempotente."""
import logging

from librouteros.query import Key

from app.core.config import settings
from app.models.gateway import Gateway
from app.services.mikrotik.address_list import get_clean_list_name, get_suspend_list_name
from app.services.mikrotik.gateway_resources import get_gateway_resource_config
from app.services.mikrotik.gateway_pool import gateway_pool
from app.services.mikrotik.queue import get_clean_parent_name

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


def _disable_traffic_flow_target(api) -> None:
    nms_ip = settings.NMS_SERVER_IP
    if not nms_ip:
        return
    existing = list(
        api.path('/ip/traffic-flow/target').select().where(Key('dst-address') == nms_ip)
    )
    for entry in existing:
        list(api('/ip/traffic-flow/target/set', **{'.id': entry['.id'], 'disabled': 'yes'}))


def _routeros_major_version(api) -> int | None:
    resources = list(api('/system/resource/print'))
    if not resources:
        return None
    version = str(resources[0].get('version', '')).split('.', maxsplit=1)[0]
    return int(version) if version.isdigit() else None


def _missing_accounting_menu(exc: Exception) -> bool:
    message = str(exc).lower()
    return 'no such command' in message or 'no such command prefix' in message


def configure_traffic_accounting(api, traffic_accounting: str) -> None:
    """Activa el modo de accounting seleccionado y desactiva los mecanismos alternativos."""
    routeros_major = _routeros_major_version(api)
    if traffic_accounting == 'accounting_v6':
        nms_ip = _nms_ip()
        if routeros_major is not None and routeros_major >= 7:
            raise GatewayConfigurationError(
                'Accounting solamente está disponible en RouterOS 6.x. Seleccione Traffic Flow para RouterOS 7.x.'
            )
        list(api('/ip/traffic-flow/set', enabled='no'))
        try:
            list(api('/ip/accounting/set', enabled='yes'))
            list(api('/ip/accounting/web-access/set', **{
                'accessible-via-web': 'yes',
                'address': f'{nms_ip}/32',
            }))
        except Exception as exc:
            if _missing_accounting_menu(exc):
                raise GatewayConfigurationError(
                    'Este Gateway no soporta IP Accounting. Seleccione Traffic Flow.'
                ) from exc
            raise
        return

    if traffic_accounting in ('queue_accounting', 'none'):
        if routeros_major is None or routeros_major < 7:
            try:
                list(api('/ip/accounting/set', enabled='no'))
                list(api('/ip/accounting/web-access/set', **{'accessible-via-web': 'no'}))
            except Exception as exc:
                if not _missing_accounting_menu(exc):
                    raise
        list(api('/ip/traffic-flow/set', enabled='no'))
        _disable_traffic_flow_target(api)
        return

    # /ip/accounting fue retirado de RouterOS 7. Solo intentamos desactivarlo
    # en V6 o cuando el Gateway no informa una versión reconocible.
    _nms_ip()
    if routeros_major is None or routeros_major < 7:
        try:
            list(api('/ip/accounting/set', enabled='no'))
            list(api('/ip/accounting/web-access/set', **{'accessible-via-web': 'no'}))
        except Exception as exc:
            if not _missing_accounting_menu(exc):
                raise
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


def ensure_pcq_parent_rules(api, address_list: str, names: dict | None = None) -> None:
    """Verifica tipos PCQ, marcado de paquetes y reglas parentales de Queue Tree."""
    names = names or {
        'pcq_upload_type': 'pcq_upload',
        'pcq_download_type': 'pcq_download',
        'upload_packet_mark': 'pcq_upload',
        'download_packet_mark': 'pcq_download',
        'upload_queue_tree': 'pcq_upload',
        'download_queue_tree': 'pcq_download',
        'upload_mangle_comment': 'ISP NMS PCQ upload',
        'download_mangle_comment': 'ISP NMS PCQ download',
    }
    _ensure_named_resource(
        api, '/queue/type', '/queue/type/add', names['pcq_upload_type'],
        {'kind': 'pcq', 'pcq-classifier': 'src-address'},
    )
    _ensure_named_resource(
        api, '/queue/type', '/queue/type/add', names['pcq_download_type'],
        {'kind': 'pcq', 'pcq-classifier': 'dst-address'},
    )
    _ensure_mangle_rule(api, names['upload_mangle_comment'], {
        'chain': 'forward',
        'src-address-list': address_list,
        'action': 'mark-packet',
        'new-packet-mark': names['upload_packet_mark'],
        'passthrough': 'no',
        'disabled': 'no',
    })
    _ensure_mangle_rule(api, names['download_mangle_comment'], {
        'chain': 'forward',
        'dst-address-list': address_list,
        'action': 'mark-packet',
        'new-packet-mark': names['download_packet_mark'],
        'passthrough': 'no',
        'disabled': 'no',
    })
    _ensure_named_resource(
        api, '/queue/tree', '/queue/tree/add', names['upload_queue_tree'],
        {'parent': 'global', 'packet-mark': names['upload_packet_mark'], 'queue': names['pcq_upload_type'], 'disabled': 'no'},
    )
    _ensure_named_resource(
        api, '/queue/tree', '/queue/tree/add', names['download_queue_tree'],
        {'parent': 'global', 'packet-mark': names['download_packet_mark'], 'queue': names['pcq_download_type'], 'disabled': 'no'},
    )


def configure_speed_control(api, gateway: Gateway) -> None:
    names = get_gateway_resource_config(gateway)['speed_control']
    if gateway.speed_control_type == 'pcq_addresslist':
        ensure_pcq_parent_rules(api, names['client_address_list'], names)
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
    configurable = {'security_mode', 'traffic_accounting', 'speed_control_type', 'resource_config'}
    changes = configurable.intersection(changed_fields)
    if not changes:
        return

    try:
        with gateway_pool.connect_to(gateway) as api:
            if 'security_mode' in changes:
                configure_security(api, gateway.security_mode)
            if 'traffic_accounting' in changes:
                configure_traffic_accounting(api, gateway.traffic_accounting)
            if {'speed_control_type', 'resource_config'}.intersection(changes):
                configure_speed_control(api, gateway)
    except GatewayConfigurationError:
        raise
    except Exception as exc:
        logger.exception('No se pudo configurar el Gateway %s', gateway.name)
        raise GatewayConfigurationError(str(exc)) from exc


def migrate_gateway_resource_names(gateway: Gateway, old_config: dict) -> None:
    """Renombra recursos administrados y conserva sus entradas al cambiar la configuración."""
    new_config = get_gateway_resource_config(gateway)
    old_security = old_config['security']
    new_security = new_config['security']
    old_speed = old_config['speed_control']
    new_speed = new_config['speed_control']

    try:
        with gateway_pool.connect_to(gateway) as api:
            list_key = Key('list')
            for old_name, new_name in (
                (old_security['suspend_list'], new_security['suspend_list']),
                (old_speed['client_address_list'], new_speed['client_address_list']),
            ):
                if old_name == new_name:
                    continue
                for entry in list(api.path('/ip/firewall/address-list').select().where(list_key == old_name)):
                    list(api('/ip/firewall/address-list/set', **{'.id': entry['.id'], 'list': new_name}))

            for path, set_command, keys in (
                ('/queue/type', '/queue/type/set', ('pcq_upload_type', 'pcq_download_type')),
                ('/queue/tree', '/queue/tree/set', ('upload_queue_tree', 'download_queue_tree')),
            ):
                for key in keys:
                    old_name, new_name = old_speed[key], new_speed[key]
                    if old_name == new_name:
                        continue
                    entries = list(api.path(path).select().where(Key('name') == old_name))
                    for entry in entries:
                        list(api(set_command, **{'.id': entry['.id'], 'name': new_name}))

            for comment_key, mark_key in (
                ('upload_mangle_comment', 'upload_packet_mark'),
                ('download_mangle_comment', 'download_packet_mark'),
            ):
                old_comment = old_speed[comment_key]
                entries = list(
                    api.path('/ip/firewall/mangle').select().where(Key('comment') == old_comment)
                )
                for entry in entries:
                    list(api('/ip/firewall/mangle/set', **{
                        '.id': entry['.id'],
                        'comment': new_speed[comment_key],
                        'new-packet-mark': new_speed[mark_key],
                    }))
    except Exception as exc:
        logger.exception('No se pudieron migrar nombres de recursos en %s', gateway.name)
        raise GatewayConfigurationError(str(exc)) from exc


def _remove_entries(api, path: str, remove_command: str, predicate) -> int:
    removed = 0
    for entry in list(api.path(path)):
        entry_id = entry.get('.id')
        if entry_id and predicate(entry):
            list(api(remove_command, **{'.id': entry_id}))
            removed += 1
    return removed


def cleanup_gateway_configuration(
    gateway: Gateway,
    client_ips: list[str],
    ppp_usernames: list[str],
    ppp_profile_names: list[str],
) -> dict[str, int]:
    """Elimina de RouterOS únicamente recursos identificables administrados por el NMS."""
    summary = {
        'address_list_entries': 0,
        'simple_queues': 0,
        'pcq_rules': 0,
        'ppp_secrets': 0,
        'ppp_profiles': 0,
        'traffic_targets': 0,
        'radius_clients': 0,
    }
    targets = {f'{ip}/32' for ip in client_ips}
    configured_resources = get_gateway_resource_config(gateway)
    managed_lists = {
        configured_resources['speed_control']['client_address_list'],
        configured_resources['security']['suspend_list'],
    }
    parent_name = configured_resources['speed_control']['parent_queue']
    uses_parent_queue = (
        configured_resources['speed_control']['simple_queue_structure'] == 'parented'
    )

    try:
        with gateway_pool.connect_to(gateway) as api:
            # Autenticación creada por el NMS.
            list(api('/ppp/aaa/set', **{'use-radius': 'no', 'accounting': 'no'}))
            _set_hotspot_radius(api, False)
            if settings.NMS_SERVER_IP:
                summary['radius_clients'] = _remove_entries(
                    api,
                    '/radius',
                    '/radius/remove',
                    lambda entry: entry.get('address') == settings.NMS_SERVER_IP,
                )

            # Exportadores de tráfico del NMS. Accounting no existe en RouterOS 7.
            remaining_traffic_targets = list(api.path('/ip/traffic-flow/target'))
            if settings.NMS_SERVER_IP:
                summary['traffic_targets'] = _remove_entries(
                    api,
                    '/ip/traffic-flow/target',
                    '/ip/traffic-flow/target/remove',
                    lambda entry: entry.get('dst-address') == settings.NMS_SERVER_IP
                    and str(entry.get('port', settings.TRAFFIC_FLOW_PORT)) == str(settings.TRAFFIC_FLOW_PORT),
                )
                remaining_traffic_targets = [
                    entry for entry in remaining_traffic_targets
                    if not (
                        entry.get('dst-address') == settings.NMS_SERVER_IP
                        and str(entry.get('port', settings.TRAFFIC_FLOW_PORT)) == str(settings.TRAFFIC_FLOW_PORT)
                    )
                ]
            if not remaining_traffic_targets:
                list(api('/ip/traffic-flow/set', enabled='no'))
            try:
                list(api('/ip/accounting/set', enabled='no'))
                list(api('/ip/accounting/web-access/set', **{'accessible-via-web': 'no'}))
            except Exception as exc:
                if not _missing_accounting_menu(exc):
                    raise

            # Clientes estáticos, listas y control de velocidad.
            summary['simple_queues'] += _remove_entries(
                api,
                '/queue/simple',
                '/queue/simple/remove',
                lambda entry: entry.get('target') in targets
                or (uses_parent_queue and entry.get('name') == parent_name),
            )
            summary['address_list_entries'] = _remove_entries(
                api,
                '/ip/firewall/address-list',
                '/ip/firewall/address-list/remove',
                lambda entry: entry.get('list') in managed_lists
                and entry.get('address') in client_ips,
            )
            for lease in list(api.path('/ip/dhcp-server/lease')):
                if lease.get('address') in client_ips and lease.get('.id'):
                    list(api('/ip/dhcp-server/lease/set', **{
                        '.id': lease['.id'],
                        'rate-limit': '0/0',
                    }))

            summary['pcq_rules'] += _remove_entries(
                api,
                '/queue/tree',
                '/queue/tree/remove',
                lambda entry: entry.get('name') in {
                    configured_resources['speed_control']['upload_queue_tree'],
                    configured_resources['speed_control']['download_queue_tree'],
                },
            )
            summary['pcq_rules'] += _remove_entries(
                api,
                '/ip/firewall/mangle',
                '/ip/firewall/mangle/remove',
                lambda entry: entry.get('comment') in {
                    configured_resources['speed_control']['upload_mangle_comment'],
                    configured_resources['speed_control']['download_mangle_comment'],
                },
            )
            summary['pcq_rules'] += _remove_entries(
                api,
                '/queue/type',
                '/queue/type/remove',
                lambda entry: entry.get('name') in {
                    configured_resources['speed_control']['pcq_upload_type'],
                    configured_resources['speed_control']['pcq_download_type'],
                },
            )

            # Usuarios y perfiles PPPoE registrados desde el NMS.
            usernames = set(ppp_usernames)
            profile_names = set(ppp_profile_names)
            _remove_entries(
                api,
                '/ppp/active',
                '/ppp/active/remove',
                lambda entry: entry.get('name') in usernames,
            )
            summary['ppp_secrets'] = _remove_entries(
                api,
                '/ppp/secret',
                '/ppp/secret/remove',
                lambda entry: entry.get('name') in usernames,
            )
            summary['ppp_profiles'] = _remove_entries(
                api,
                '/ppp/profile',
                '/ppp/profile/remove',
                lambda entry: entry.get('name') in profile_names,
            )
    except Exception as exc:
        logger.exception('No se pudo limpiar la configuración del Gateway %s', gateway.name)
        raise GatewayConfigurationError(str(exc)) from exc

    return summary
