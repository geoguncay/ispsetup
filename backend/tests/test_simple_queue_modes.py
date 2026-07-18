from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services.mikrotik.queue import (
    apply_simple_queue_structure,
    sync_client_queue,
)


def _gateway(structure: str = 'standalone', upload: str = 'cake', download: str = 'cake'):
    return SimpleNamespace(
        name='Gateway CAKE',
        speed_control=True,
        speed_control_type='simple_queues',
        resource_config={
            'speed_control': {
                'simple_queue_structure': structure,
                'simple_queue_upload_type': upload,
                'simple_queue_download_type': download,
                'parent_queue': 'isp_padre',
                'client_queue_name_template': '{client_name}',
            },
        },
    )


def _connection(api):
    connection = MagicMock()
    connection.__enter__.return_value = api
    return connection


def test_standalone_queue_is_created_without_parent(monkeypatch):
    api = MagicMock()
    api.path.return_value.select.return_value.where.return_value = []
    monkeypatch.setattr(
        'app.services.mikrotik.queue.gateway_pool.connect_to',
        MagicMock(return_value=_connection(api)),
    )

    sync_client_queue(
        gateway=_gateway(),
        client_name='Cliente Uno',
        ip='192.0.2.10',
        speed_up=10000,
        speed_down=20000,
        plan_name='Plan 20M',
    )

    add_calls = [call for call in api.call_args_list if call.args[0] == '/queue/simple/add']
    assert len(add_calls) == 1
    params = add_calls[0].kwargs
    assert params['name'] == 'Cliente Uno'
    assert params['target'] == '192.0.2.10/32'
    assert params['queue'] == 'cake/cake'
    assert 'parent' not in params


def test_standalone_transition_detaches_existing_client_queues(monkeypatch):
    api = MagicMock()

    def path_entries(path):
        if path == '/queue/type':
            return [{'name': 'cake'}]
        if path == '/queue/simple':
            return [
                {'.id': '*1', 'target': '192.0.2.10/32', 'parent': 'isp_padre'},
                {'.id': '*2', 'target': '198.51.100.20/32', 'parent': 'otra'},
            ]
        return []

    api.path.side_effect = path_entries
    monkeypatch.setattr(
        'app.services.mikrotik.queue.gateway_pool.connect_to',
        MagicMock(return_value=_connection(api)),
    )

    apply_simple_queue_structure(_gateway(), ['192.0.2.10'])

    api.assert_any_call(
        '/queue/simple/set',
        **{'.id': '*1', 'queue': 'cake/cake', 'parent': 'none'},
    )
    changed_ids = [call.kwargs.get('.id') for call in api.call_args_list if call.args[0] == '/queue/simple/set']
    assert '*2' not in changed_ids


def test_parented_transition_assigns_configured_parent(monkeypatch):
    gateway = _gateway('parented', 'default-small', 'default-small')
    api = MagicMock()

    def path_entries(path):
        if path == '/queue/type':
            return [{'name': 'default-small'}]
        if path == '/queue/simple':
            return [{'.id': '*1', 'target': '192.0.2.10/32', 'parent': 'none'}]
        return []

    api.path.side_effect = path_entries
    monkeypatch.setattr(
        'app.services.mikrotik.queue.get_or_create_parent_queue',
        MagicMock(return_value='isp_padre'),
    )
    monkeypatch.setattr(
        'app.services.mikrotik.queue.gateway_pool.connect_to',
        MagicMock(return_value=_connection(api)),
    )

    apply_simple_queue_structure(gateway, ['192.0.2.10'])

    api.assert_any_call(
        '/queue/simple/set',
        **{'.id': '*1', 'queue': 'default-small/default-small', 'parent': 'isp_padre'},
    )


def test_queue_types_must_exist_before_applying_structure(monkeypatch):
    api = MagicMock()
    api.path.side_effect = lambda path: [{'name': 'default-small'}] if path == '/queue/type' else []
    monkeypatch.setattr(
        'app.services.mikrotik.queue.gateway_pool.connect_to',
        MagicMock(return_value=_connection(api)),
    )

    with pytest.raises(ValueError, match='cake'):
        apply_simple_queue_structure(_gateway(), [])

    assert not any(call.args[0] == '/queue/simple/set' for call in api.call_args_list)
