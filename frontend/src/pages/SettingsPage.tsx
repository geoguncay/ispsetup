/**
 * SettingsPage — Página exclusiva para configuraciones globales (Routers, Datos de la Empresa, Facturación, Suspensión, Métodos de Pago, Usuarios y Alertas).
 */
import { useState } from 'react'
import { SlidersHorizontal, Building, Router, Receipt, Shield, Bell, Plug, Cog, ClipboardList, Menu, X } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Navigate } from 'react-router-dom'
import { useToast } from '@/hooks/useToast'
import { ToastContainer } from '@/components/Toast'
import { CompanySettingsTab } from '@/pages/settings/CompanySettingsTab'
import { RouterSettingsTab } from '@/pages/settings/RouterSettingsTab'
import { BillingAndCollectionsTab } from '@/pages/settings/BillingAndCollectionsTab'
import { SecurityAndAccessTab } from '@/pages/settings/SecurityAndAccessTab'
import { Notifications } from '@/pages/settings/Notifications'
import { IntegrationsTab } from '@/pages/settings/IntegrationsTab'
import { SystemSettingsTab } from '@/pages/settings/SystemSettingsTab'
import { LogsSettingsTab } from '@/pages/settings/LogsSettingsTab'

type TabType = 'company' | 'billing_collections' | 'router' | 'security_access' | 'notifications_alerts' | 'integrations' | 'system' | 'logs'
type NavItem = { id: TabType; icon: React.ComponentType<{ className?: string }>; label: string }
type StatusMessage = { type: 'success' | 'error'; text: string } | null

const NAV_ITEMS: NavItem[] = [
  { id: 'company', icon: Building, label: 'Datos de la Empresa' },
  { id: 'router', icon: Router, label: 'Router' },
  { id: 'billing_collections', icon: Receipt, label: 'Facturación' },
  { id: 'security_access', icon: Shield, label: 'Seguridad' },
  { id: 'notifications_alerts', icon: Bell, label: 'Notificaciones' },
  { id: 'integrations', icon: Plug, label: 'Integraciones' },
  { id: 'system', icon: Cog, label: 'Sistema' },
  { id: 'logs', icon: ClipboardList, label: 'Logs' },
]

function SettingsNav({ activeTab, onSelect }: { activeTab: TabType; onSelect: (id: TabType) => void }) {
  return (
    <nav className="glass-card p-2 space-y-1">
      {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
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
  )
}

export function SettingsPage() {
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.role === 'admin'

  const [activeTab, setActiveTab] = useState<TabType>('company')
  const [navOpen, setNavOpen] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  // Redirigir si no es administrador
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />
  }

  const activeLabel = NAV_ITEMS.find(i => i.id === activeTab)?.label ?? ''

  const selectTab = (id: TabType) => {
    setActiveTab(id)
    setNavOpen(false)
  }

  const setStatusMessage = (msg: StatusMessage) => {
    if (msg) addToast(msg.text, msg.type)
  }

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Ajustes del ISP</h1>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left Sidebar (desktop) ──────────────────────────────────────── */}
        <aside className="hidden lg:block w-56 flex-shrink-0 sticky top-6">
          <SettingsNav activeTab={activeTab} onSelect={selectTab} />
        </aside>

        {/* ── Left Sidebar (mobile drawer) ────────────────────────────────── */}
        {navOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setNavOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 w-64 shadow-2xl bg-surface-50 border-r border-border flex flex-col lg:hidden">
              <div className="flex items-center justify-between px-4 py-4 border-b border-border">
                <span className="font-semibold text-sm text-foreground">Ajustes</span>
                <button
                  onClick={() => setNavOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <SettingsNav activeTab={activeTab} onSelect={selectTab} />
              </div>
            </aside>
          </>
        )}

        {/* ── Right Content Panel ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Breadcrumb / Section title */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button
              onClick={() => setNavOpen(true)}
              className="lg:hidden -ml-1 p-1 text-muted-foreground hover:text-foreground"
            >
              <Menu className="w-4 h-4" />
            </button>
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Ajustes</span>
            <span>/</span>
            <span className="text-foreground font-medium">{activeLabel}</span>
          </div>

          {activeTab === 'company' && (
            <CompanySettingsTab setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'router' && (
            <RouterSettingsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'billing_collections' && (
            <BillingAndCollectionsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'security_access' && (
            <SecurityAndAccessTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'notifications_alerts' && (
            <Notifications isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'integrations' && (
            <IntegrationsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'system' && (
            <SystemSettingsTab isAdmin={isAdmin} setStatusMessage={setStatusMessage} />
          )}

          {activeTab === 'logs' && <LogsSettingsTab />}
        </div>
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  )
}
