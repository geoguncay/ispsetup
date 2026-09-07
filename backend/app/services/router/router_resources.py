"""Resolución centralizada de nombres de recursos RouterOS por router."""
from copy import deepcopy


DEFAULT_RESOURCE_CONFIG = {
    "security": {
        "suspend_list": "suspendidos",
    },
    "traffic": {},
    "speed_control": {
        "simple_queue_structure": "parented",
        "parent_queue": "isp_padre",
        "simple_queue_upload_type": "default-small",
        "simple_queue_download_type": "default-small",
        "client_address_list": "isp_clientes",
        "client_queue_name_template": "{plan_name} |{client_name}",
        "dhcp_comment_template": "{plan_name} | {client_name}",
        "pcq_upload_type": "pcq_upload",
        "pcq_download_type": "pcq_download",
        "upload_packet_mark": "pcq_upload",
        "download_packet_mark": "pcq_download",
        "upload_queue_tree": "pcq_upload",
        "download_queue_tree": "pcq_download",
        "upload_mangle_comment": "PCQ upload",
        "download_mangle_comment": "PCQ download",
    },
}


def get_router_resource_config(router) -> dict:
    """Devuelve configuración completa, incluyendo fallbacks de routers legados."""
    resolved = deepcopy(DEFAULT_RESOURCE_CONFIG)
    stored = getattr(router, "resource_config", None) or {}
    for section in resolved:
        values = stored.get(section)
        if isinstance(values, dict):
            resolved[section].update({key: value for key, value in values.items() if value})

    # Los campos anteriores siguen siendo la fuente para registros aún no migrados.
    if not stored:
        if getattr(router, "suspend_list", None):
            resolved["security"]["suspend_list"] = router.suspend_list.strip()
        if getattr(router, "parent_queue", None):
            legacy_parent = router.parent_queue.strip()
            resolved["speed_control"]["parent_queue"] = (
                legacy_parent if legacy_parent.startswith("isp_") else f"Clients{legacy_parent}"
            )
        if getattr(router, "address_list", None):
            legacy_list = router.address_list.strip()
            resolved["speed_control"]["client_address_list"] = (
                legacy_list if legacy_list.startswith("isp_") else f"clients{legacy_list}"
            )
    return resolved


def resource_name(router, section: str, key: str) -> str:
    return get_router_resource_config(router)[section][key]


def render_resource_template(template: str, **values: str) -> str:
    """Renderiza solo marcadores conocidos; una plantilla inválida conserva el fallback."""
    try:
        return template.format(**values).strip()
    except (KeyError, ValueError):
        return values.get("client_name", "").strip()
