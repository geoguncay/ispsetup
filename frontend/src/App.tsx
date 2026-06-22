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
import { ClientsPage } from '@/pages/ClientsPage'
import { ClientProfilePage } from '@/pages/ClientProfilePage'
import { PlansPage } from '@/pages/PlansPage'
import { RouterProfilePage } from '@/pages/RouterProfilePage'
import { TrafficPage } from '@/pages/TrafficPage'
import { CustomServicesPage } from '@/pages/CustomServicesPage'
import { SubscribersStatsPage } from '@/pages/SubscribersStatsPage'
import { InvoicesPage } from '@/pages/InvoicesPage'
import { PaymentsPage } from '@/pages/PaymentsPage'



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
          <Route path="/routers/:id" element={<RouterProfilePage />} />
          <Route path="/traffic" element={<TrafficPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientProfilePage />} />
          <Route path="/subscribers/stats" element={<SubscribersStatsPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/custom-services" element={<CustomServicesPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/profile" element={<ProfilePage />} />

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
