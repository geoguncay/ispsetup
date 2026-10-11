import { useEffect, useRef, type MutableRefObject } from 'react'
import type { AddToast } from './types'

/**
 * Detecta cambios de estado que llegaron por el worker automático (no por una acción
 * manual del usuario en esta misma pestaña) y muestra un toast. Las acciones manuales
 * marcan `suppressAutoToastRef` para evitar el aviso duplicado.
 */
export function useClientStateChangeToasts(
  client: any,
  addToast: AddToast,
  suppressAutoToastRef: MutableRefObject<boolean>,
) {
  const prevClientStateRef = useRef<{ active: boolean; scheduled_suspension: string | null; scheduled_reactivation: string | null } | null>(null)

  useEffect(() => {
    if (!client) return
    const prev = prevClientStateRef.current
    const current = {
      active: client.active,
      scheduled_suspension: client.scheduled_suspension ?? null,
      scheduled_reactivation: client.scheduled_reactivation ?? null,
    }

    if (prev && !suppressAutoToastRef.current) {
      if (prev.active && !current.active && prev.scheduled_suspension && !current.scheduled_suspension) {
        addToast('La suspensión programada se aplicó automáticamente.', 'warning')
      } else if (!prev.active && current.active && prev.scheduled_reactivation && !current.scheduled_reactivation) {
        addToast('El cliente se reactivó automáticamente según lo programado.', 'success')
      }
    }

    suppressAutoToastRef.current = false
    prevClientStateRef.current = current
  }, [client])
}
