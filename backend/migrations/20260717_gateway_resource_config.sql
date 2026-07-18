BEGIN;

ALTER TABLE gateways
    ADD COLUMN IF NOT EXISTS resource_config JSONB;

UPDATE gateways
SET resource_config = jsonb_build_object(
    'security', jsonb_build_object(
        'suspend_list', COALESCE(NULLIF(TRIM(suspend_list), ''), 'isp_suspendidos')
    ),
    'traffic', '{}'::jsonb,
    'speed_control', jsonb_build_object(
        'simple_queue_structure', 'parented',
        'parent_queue', CASE
            WHEN NULLIF(TRIM(parent_queue), '') IS NULL THEN 'isp_padre'
            WHEN LEFT(TRIM(parent_queue), 4) = 'isp_' THEN TRIM(parent_queue)
            ELSE 'isp_padre_' || TRIM(parent_queue)
        END,
        'simple_queue_upload_type', 'default-small',
        'simple_queue_download_type', 'default-small',
        'client_address_list', CASE
            WHEN NULLIF(TRIM(address_list), '') IS NULL THEN 'isp_clientes'
            WHEN LEFT(TRIM(address_list), 4) = 'isp_' THEN TRIM(address_list)
            ELSE 'isp_clientes_' || TRIM(address_list)
        END,
        'client_queue_name_template', '{client_name}',
        'dhcp_comment_template', '{client_name} - {plan_name}',
        'pcq_upload_type', 'isp_pcq_upload',
        'pcq_download_type', 'isp_pcq_download',
        'upload_packet_mark', 'isp_pcq_upload',
        'download_packet_mark', 'isp_pcq_download',
        'upload_queue_tree', 'isp_pcq_upload',
        'download_queue_tree', 'isp_pcq_download',
        'upload_mangle_comment', 'ISP NMS PCQ upload',
        'download_mangle_comment', 'ISP NMS PCQ download'
    )
)
WHERE resource_config IS NULL;

UPDATE gateways
SET resource_config = jsonb_set(
    resource_config,
    '{speed_control}',
    jsonb_build_object(
        'simple_queue_structure', 'parented',
        'simple_queue_upload_type', 'default-small',
        'simple_queue_download_type', 'default-small'
    ) || COALESCE(resource_config->'speed_control', '{}'::jsonb),
    true
)
WHERE resource_config IS NOT NULL;

ALTER TABLE system_settings
    DROP COLUMN IF EXISTS parent_queues,
    DROP COLUMN IF EXISTS address_lists,
    DROP COLUMN IF EXISTS suspend_lists,
    DROP COLUMN IF EXISTS colas_padre;

COMMIT;
