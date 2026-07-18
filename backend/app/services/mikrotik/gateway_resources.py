"""Resolución centralizada de nombres de recursos RouterOS por gateway."""
from copy import deepcopy


DEFAULT_RESOURCE_CONFIG = {
    "security": {
        "suspend_list": "isp_suspendidos",
    },
    "traffic": {},
    "speed_control": {
        "simple_queue_structure": "parented",
        "parent_queue": "isp_padre",
        "simple_queue_upload_type": "default-small",
        "simple_queue_download_type": "default-small",
        "client_address_list": "isp_clientes",
        "client_queue_name_template": "{client_name}",
        "dhcp_comment_template": "{client_name} - {plan_name}",
        "pcq_upload_type": "isp_pcq_upload",
        "pcq_download_type": "isp_pcq_download",
        "upload_packet_mark": "isp_pcq_upload",
        "download_packet_mark": "isp_pcq_download",
        "upload_queue_tree": "isp_pcq_upload",
        "download_queue_tree": "isp_pcq_download",
        "upload_mangle_comment": "ISP NMS PCQ upload",
        "download_mangle_comment": "ISP NMS PCQ download",
    },
}


def get_gateway_resource_config(gateway) -> dict:
    """Devuelve configuración completa, incluyendo fallbacks de gateways legados."""
    resolved = deepcopy(DEFAULT_RESOURCE_CONFIG)
    stored = getattr(gateway, "resource_config", None) or {}
    for section in resolved:
        values = stored.get(section)
        if isinstance(values, dict):
            resolved[section].update({key: value for key, value in values.items() if value})

    # Los campos anteriores siguen siendo la fuente para registros aún no migrados.
    if not stored:
        if getattr(gateway, "suspend_list", None):
            resolved["security"]["suspend_list"] = gateway.suspend_list.strip()
        if getattr(gateway, "parent_queue", None):
            legacy_parent = gateway.parent_queue.strip()
            resolved["speed_control"]["parent_queue"] = (
                legacy_parent if legacy_parent.startswith("isp_") else f"isp_padre_{legacy_parent}"
            )
        if getattr(gateway, "address_list", None):
            legacy_list = gateway.address_list.strip()
            resolved["speed_control"]["client_address_list"] = (
                legacy_list if legacy_list.startswith("isp_") else f"isp_clientes_{legacy_list}"
            )
    return resolved


def resource_name(gateway, section: str, key: str) -> str:
    return get_gateway_resource_config(gateway)[section][key]


def render_resource_template(template: str, **values: str) -> str:
    """Renderiza solo marcadores conocidos; una plantilla inválida conserva el fallback."""
    try:
        return template.format(**values).strip()
    except (KeyError, ValueError):
        return values.get("client_name", "").strip()
