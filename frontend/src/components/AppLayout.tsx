/**
 * AppLayout — Layout principal con sidebar y header.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Wifi, LayoutDashboard, Router, Users,
  LogOut, Menu, X, ChevronDown, ChevronRight, Activity, Settings, Network,
  Zap, Building, Sliders, BarChart2, Receipt, DollarSign,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import api from '@/services/api'

interface NavLinkItem {
  to: string
  icon: React.ComponentType<any>
  label: string
}

interface NavGroupItem {
  label: string
  icon: React.ComponentType<any>
  roles?: string[]
  items: NavLinkItem[]
}

type NavItem = (NavLinkItem & { roles?: string[] }) | NavGroupItem

const navItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  {
    label: 'Dispositivos',
    icon: Network,
    roles: ['admin', 'tecnico'],
    items: [
      { to: '/routers', icon: Router, label: 'Routers' },
      { to: '/traffic', icon: Activity, label: 'Tráfico' },
    ]
  },
  {
    label: 'Suscriptores',
    icon: Users,
    roles: ['admin', 'tecnico'],
    items: [
      { to: '/clients', icon: Users, label: 'Clientes' },
      { to: '/subscribers/stats', icon: BarChart2, label: 'Estadísticas' },
    ]
  },
  {
    label: 'Servicios',
    icon: Zap,
    roles: ['admin', 'tecnico'],
    items: [
      { to: '/plans', icon: Zap, label: 'Planes' },
      { to: '/custom-services', icon: Sliders, label: 'Personalizado' },
    ]
  },
  {
    label: 'Facturación',
    icon: Receipt,
    roles: ['admin', 'tecnico'],
    items: [
      { to: '/invoices', icon: Receipt, label: 'Facturas' },
      { to: '/payments', icon: DollarSign, label: 'Caja y Cobros' },
    ]
  },
]

export const getLogoUrl = (url: string | null | undefined): string => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url
  }
  const apiHost = import.meta.env.VITE_API_URL || ''
  return `${apiHost}${url}`
}

export function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [networkMenuOpen, setNetworkMenuOpen] = useState(
    location.pathname.startsWith('/routers') || location.pathname.startsWith('/traffic')
  )
  const [subscribersMenuOpen, setSubscribersMenuOpen] = useState(
    location.pathname.startsWith('/clients') || location.pathname.startsWith('/subscribers')
  )
  const [servicesMenuOpen, setServicesMenuOpen] = useState(
    location.pathname.startsWith('/plans') || location.pathname.startsWith('/custom-services')
  )
  const [billingMenuOpen, setBillingMenuOpen] = useState(
    location.pathname.startsWith('/invoices') || location.pathname.startsWith('/payments')
  )

  useEffect(() => {
    if (location.pathname.startsWith('/routers') || location.pathname.startsWith('/traffic')) {
      setNetworkMenuOpen(true)
    }
    if (location.pathname.startsWith('/clients') || location.pathname.startsWith('/subscribers')) {
      setSubscribersMenuOpen(true)
    }
    if (location.pathname.startsWith('/plans') || location.pathname.startsWith('/custom-services')) {
      setServicesMenuOpen(true)
    }
    if (location.pathname.startsWith('/invoices') || location.pathname.startsWith('/payments')) {
      setBillingMenuOpen(true)
    }
  }, [location.pathname])

  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const { data } = await api.get('/company')
      return data
    },
    staleTime: 5 * 60 * 1000,
  })

  const handleLogout = useCallback(async () => {
    await logout()
    navigate('/login')
  }, [logout, navigate])

  // Inactivity timeout logic
  useEffect(() => {
    if (!user || !user.inactivity_timeout || user.inactivity_timeout <= 0) {
      return
    }

    const timeoutMs = user.inactivity_timeout * 60 * 1000
    let timerId: any

    const resetTimer = () => {
      if (timerId) clearTimeout(timerId)
      timerId = setTimeout(() => {
        handleLogout()
      }, timeoutMs)
    }

    // Set initial timer
    resetTimer()

    // Add event listeners
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove']
    events.forEach((event) => {
      window.addEventListener(event, resetTimer)
    })

    return () => {
      if (timerId) clearTimeout(timerId)
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer)
      })
    }
  }, [user, handleLogout])

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
        {company && company.nombre !== "Mi WISP" ? (
          <>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden bg-brand-600 shadow-lg shadow-brand-600/30 flex-shrink-0">
              {company.logo_url ? (
                <img src={getLogoUrl(company.logo_url)} className="w-full h-full object-cover" alt="Logo" />
              ) : (
                <Building className="w-4 h-4 text-white" strokeWidth={2.5} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm truncate">{company.nombre}</p>
              <p className="text-xs text-muted-foreground truncate">ISP Management</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shadow-lg shadow-brand-600/30 flex-shrink-0">
              <Network className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm truncate">ISP Platform</p>
              <p className="text-xs text-muted-foreground">Management</p>
            </div>
          </>
        )}
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
        {visibleNavItems.map((item) => {
          if ('items' in item) {
            const hasActiveChild = item.items.some(sub => location.pathname.startsWith(sub.to))
            const isMenuOpen =
              item.label === 'Dispositivos'
                ? networkMenuOpen
                : item.label === 'Suscriptores'
                ? subscribersMenuOpen
                : item.label === 'Servicios'
                ? servicesMenuOpen
                : billingMenuOpen
            const toggleMenu = () => {
              if (item.label === 'Dispositivos') {
                setNetworkMenuOpen(!networkMenuOpen)
              } else if (item.label === 'Suscriptores') {
                setSubscribersMenuOpen(!subscribersMenuOpen)
              } else if (item.label === 'Servicios') {
                setServicesMenuOpen(!servicesMenuOpen)
              } else if (item.label === 'Facturación') {
                setBillingMenuOpen(!billingMenuOpen)
              }
            }
            const Icon = item.icon
            return (
              <div key={item.label} className="space-y-0.5">
                <button
                  onClick={toggleMenu}
                  className={`w-full nav-item flex items-center justify-between ${hasActiveChild ? 'text-primary bg-primary/5' : ''
                    }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{item.label}</span>
                  </div>
                  {isMenuOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform duration-200" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform duration-200" />
                  )}
                </button>
                {isMenuOpen && (
                  <div className="pl-4 border-l border-border/50 ml-5 space-y-0.5 mt-0.5">
                    {item.items.map((sub) => (
                      <NavLink
                        key={sub.to}
                        to={sub.to}
                        id={`nav-${sub.label.toLowerCase()}`}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-all duration-200 cursor-pointer ${isActive ? 'text-primary bg-primary/10 border border-primary/20 font-semibold' : ''
                          }`}
                      >
                        <sub.icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{sub.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          } else {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                id={`nav-${item.label.toLowerCase()}`}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            )
          }
        })}
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
          <div className="flex items-center gap-2 min-w-0">
            {company && company.nombre !== "Mi WISP" ? (
              <>
                {company.logo_url ? (
                  <img src={getLogoUrl(company.logo_url)} className="w-5 h-5 rounded object-cover flex-shrink-0" alt="Logo" />
                ) : (
                  <Building className="w-4 h-4 text-brand-400 flex-shrink-0" />
                )}
                <span className="font-semibold text-foreground text-sm truncate">{company.nombre}</span>
              </>
            ) : (
              <>
                <Network className="w-4 h-4 text-brand-400 flex-shrink-0" />
                <span className="font-semibold text-foreground text-sm">ISP Platform</span>
              </>
            )}
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
