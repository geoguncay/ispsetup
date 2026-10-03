/**
 * App.tsx — Router principal de la aplicación.
 */
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { Router } from '@/pages/RouterPage'
import { LoadBalancerPage } from '@/pages/LoadBalancerPage'
import { LoadBalancerProfilePage } from '@/pages/LoadBalancerProfilePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ClientsPage } from '@/pages/ClientsPage'
import { ClientProfilePage } from '@/pages/ClientProfilePage'
import { PlansPage } from '@/pages/PlansPage'
import { RouterProfilePage } from '@/pages/RouterProfilePage'
import { CustomServicesPage } from '@/pages/CustomServicesPage'
import { InvoicesPage } from '@/pages/InvoicesPage'
import { PaymentsPage } from '@/pages/PaymentsPage'
import { RevenueReportPage, ClientsReportPage, ConsumptionReportPage, OverdueReportPage } from '@/pages/ReportsPage'
import { TrafficPage } from '@/pages/TrafficPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { ProvidersPage } from '@/pages/ProvidersPage'
import { SettingsPage } from '@/pages/SettingsPage'



const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/** /reports (y el antiguo /reports?tab=x) → /reports/<tab>, por defecto Ingresos. */
function ReportsRedirect() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  const valid = ['revenue', 'clients', 'consumption', 'overdue', 'traffic']
  return <Navigate to={`/reports/${tab && valid.includes(tab) ? tab : 'revenue'}`} replace />
}

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
          <Route path="/routers" element={<Router />} />
          <Route path="/routers/:id" element={<RouterProfilePage />} />
          <Route path="/load-balancers" element={<LoadBalancerPage />} />
          <Route path="/load-balancers/:id" element={<LoadBalancerProfilePage />} />
          <Route path="/traffic" element={<Navigate to="/reports/traffic" replace />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientProfilePage />} />
          <Route path="/subscribers/stats" element={<Navigate to="/reports/clients" replace />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/custom-services" element={<CustomServicesPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/reports" element={<ReportsRedirect />} />
          <Route path="/reports/revenue" element={<RevenueReportPage />} />
          <Route path="/reports/clients" element={<ClientsReportPage />} />
          <Route path="/reports/traffic" element={<TrafficPage />} />
          <Route path="/reports/consumption" element={<ConsumptionReportPage />} />
          <Route path="/reports/overdue" element={<OverdueReportPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit-logs" element={<Navigate to="/settings" replace />} />
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
