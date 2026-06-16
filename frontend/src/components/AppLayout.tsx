/**
 * AppLayout — Layout principal con sidebar y header.
 */
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Wifi, LayoutDashboard, Router, Users, Bell,
  LogOut, Menu, X, ChevronDown, Activity, Settings, Eye, EyeOff, Network,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useSettingsStore } from '@/stores/settingsStore'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/routers', icon: Router, label: 'Routers', roles: ['admin', 'tecnico'] },
  { to: '/users', icon: Users, label: 'Usuarios', roles: ['admin'] },
  { to: '/alerts', icon: Bell, label: 'Alertas' },
]

export function AppLayout() {
  const { user, logout } = useAuthStore()
  const { hideIps, toggleHideIps } = useSettingsStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const visibleNavItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.rol))
  )

  const Sidebar = ({ mobile = false }) => (
    <aside
      className={`
        ${mobile ? 'fixed inset-y-0 left-0 z-50 w-64 shadow-2xl' : 'hidden lg:flex w-60'}
        flex-col bg-surface-50 border-r border-border
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shadow-lg shadow-brand-600/30">
          <Network className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground text-sm truncate">ISP Platform</p>
          <p className="text-xs text-muted-foreground">Management</p>
        </div>
        {mobile && (
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            id={`nav-${label.toLowerCase()}`}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      <div className="p-3 border-t border-border">
        <div className="glass-card p-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-700 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white uppercase">
              {user?.nombre?.[0] ?? '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{user?.nombre}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.rol}</p>
          </div>
          <button
            id="toggle-ips-btn"
            onClick={toggleHideIps}
            title={hideIps ? 'Mostrar IPs' : 'Ocultar IPs'}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors mr-1"
          >
            {hideIps ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <NavLink
            id="profile-btn"
            to="/profile"
            title="Configuración de Perfil y Empresa"
            className={({ isActive }) => `p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors ${isActive ? 'text-primary bg-primary/10' : ''}`}
          >
            <Settings className="w-4 h-4" />
          </NavLink>
          <button
            id="logout-btn"
            onClick={handleLogout}
            title="Cerrar sesión"
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar desktop */}
      <Sidebar />

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <Sidebar mobile />
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header mobile */}
        <header className="flex items-center gap-4 px-4 py-3 border-b border-border bg-surface-100 lg:hidden">
          <button
            id="sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-brand-400" />
            <span className="font-semibold text-foreground text-sm">ISP Platform</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
