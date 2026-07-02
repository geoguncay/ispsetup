/**
 * SettingsPage — Página exclusiva para configuraciones globales (MikroTik, Datos de la Empresa, Facturación, Suspensión, Métodos de Pago, Usuarios y Alertas).
 */
import { useState } from 'react'
import { SlidersHorizontal, CheckCircle2, XCircle, Building, Users, Bell, Router, Receipt, ClipboardList } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Navigate } from 'react-router-dom'
import { GeneralSettingsTab } from '@/pages/settings/GeneralSettingsTab'
import { CompanySettingsTab } from '@/pages/settings/CompanySettingsTab'
import { GatewaySettingsTab } from '@/pages/settings/GatewaySettingsTab'
import { BillingSettingsTab } from '@/pages/settings/BillingSettingsTab'
import { UsersSettingsTab } from '@/pages/settings/UsersSettingsTab'
import { LogsSettingsTab } from '@/pages/settings/LogsSettingsTab'

type TabType = 'general' | 'company' | 'gateway' | 'users' | 'alerts' | 'billing' | 'logs'
type NavItem = { id: TabType; icon: React.ComponentType<{ className?: string }>; label: string }
type StatusMessage = { type: 'success' | 'error'; text: string } | null

const NAV_ITEMS: NavItem[] = [
  { id: 'general', icon: SlidersHorizontal, label: 'Generales' },
  { id: 'company', icon: Building, label: 'Datos de la Empresa' },
  { id: 'gateway', icon: Router, label: 'Gateway' },
  { id: 'billing', icon: Receipt, label: 'Facturación' },
  { id: 'users', icon: Users, label: 'Operadores' },
  { id: 'alerts', icon: Bell, label: 'Alertas' },
  { id: 'logs', icon: ClipboardList, label: 'Logs' },
]

export function SettingsPage() {
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.rol === 'admin'

  const [activeTab, setActiveTab] = useState<TabType>('general')
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null)

  // Redirigir si no es administrador
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  const activeLabel = NAV_ITEMS.find(i => i.id === activeTab)?.label ?? ''

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Ajustes del ISP</h1>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
        <aside className="w-56 flex-shrink-0 sticky top-6">
          <nav className="glass-card p-2 space-y-1">
            {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => { setActiveTab(id); setStatusMessage(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer text-left ${activeTab === id
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                  }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Right Content Panel ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Breadcrumb / Section title */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Ajustes</span>
            <span>/</span>
            <span className="text-foreground font-medium">{activeLabel}</span>
          </div>

          {/* Status Alert */}
          {statusMessage && (
            <div
              className={`rounded-xl p-4 flex items-start gap-3 border ${statusMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-destructive/10 border-destructive/30 text-destructive'
                }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <p className="text-sm font-medium">{statusMessage.text}</p>
            </div>
          )}

          {activeTab === 'general' && (
            <GeneralSettingsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'company' && (
            <CompanySettingsTab setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'gateway' && (
            <GatewaySettingsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'billing' && (
            <BillingSettingsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'users' && (
            <UsersSettingsTab setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'alerts' && (
            <div className="glass-card p-12 text-center max-w-xl mx-auto space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto border border-amber-500/25 animate-pulse">
                <Bell className="w-8 h-8 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Centro de Alertas</h3>
              <p className="text-muted-foreground text-sm">
                Panel consolidado de notificaciones de estado de enrutadores, latencia alta, y eventos del sistema. Próximamente.
              </p>
            </div>
          )}

          {activeTab === 'logs' && <LogsSettingsTab />}
        </div>
      </div>
    </div>
  )
}
