/**
 * App.tsx — Router principal de la aplicación.
 */
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useAuthStore } from '@/stores/authStore'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { RoutersPage } from '@/pages/RoutersPage'
import { ProfilePage } from '@/pages/ProfilePage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function AppContent() {
  const { fetchMe, isAuthenticated } = useAuthStore()

  useEffect(() => {
    // Carga el perfil del usuario si hay token al iniciar la app
    if (isAuthenticated) {
      fetchMe()
    }
  }, [])

  return (
    <Routes>
      {/* Ruta pública */}
      <Route path="/login" element={<LoginPage />} />

      {/* Rutas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/routers" element={<RoutersPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {/* Páginas de fases futuras — placeholder */}
          <Route path="/users" element={
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              Gestión de usuarios — próximamente
            </div>
          } />
          <Route path="/alerts" element={
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              Panel de alertas — próximamente (Fase 3)
            </div>
          } />
        </Route>
      </Route>

      {/* Redirect raíz */}
      <Route path="/" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
