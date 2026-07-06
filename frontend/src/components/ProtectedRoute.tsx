/**
 * ProtectedRoute: guarda de rutas que redirige a /login si no está autenticado.
 * Opcionalmente verifica roles.
 */
import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

interface ProtectedRouteProps {
  roles?: Array<'admin' | 'technician' | 'viewer'>
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Token existe pero el perfil aún no cargó (fetchMe en curso)
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">Acceso denegado</h1>
          <p className="text-muted-foreground">No tienes permisos para ver esta página.</p>
        </div>
      </div>
    )
  }

  return <Outlet />
}
