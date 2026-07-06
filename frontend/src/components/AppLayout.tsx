/**
 * AppLayout — Layout principal con sidebar y header.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard, Router, Users,
  LogOut, Menu, X, ChevronDown, ChevronRight, Activity, Settings, Network,
  Zap, Building, Sliders, BarChart2, Receipt, DollarSign, Package, Truck,
  Bell,
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
    roles: ['admin', 'technician'],
    items: [
      { to: '/gateways', icon: Router, label: 'Gateways' },
      { to: '/traffic', icon: Activity, label: 'Tráfico' },
    ]
  },
  {
    label: 'Suscriptores',
    icon: Users,
    roles: ['admin', 'technician'],
    items: [
      { to: '/clients', icon: Users, label: 'Clientes' },
      { to: '/subscribers/stats', icon: BarChart2, label: 'Estadísticas' },
    ]
  },
  {
    label: 'Servicios',
    icon: Zap,
    roles: ['admin', 'technician'],
    items: [
      { to: '/plans', icon: Zap, label: 'Planes' },
      { to: '/custom-services', icon: Sliders, label: 'Personalizado' },
    ]
  },
  {
    label: 'Facturación',
    icon: Receipt,
    roles: ['admin', 'technician'],
    items: [
      { to: '/invoices', icon: Receipt, label: 'Facturas' },
      { to: '/payments', icon: DollarSign, label: 'Pagos' },
    ]
  },
  {
    label: 'Inventario',
    icon: Package,
    roles: ['admin', 'technician'],
    items: [
      { to: '/inventory', icon: Package, label: 'Stock' },
      { to: '/providers', icon: Truck, label: 'Proveedores' },
    ]
  },
  {
    to: '/settings',
    icon: Settings,
    label: 'Ajustes',
    roles: ['admin']
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

interface Company {
  name: string
  logo_url?: string | null
}

interface SidebarProps {
  mobile?: boolean
  setSidebarOpen: (open: boolean) => void
  company: Company | undefined
  pathname: string
  visibleNavItems: NavItem[]
  networkMenuOpen: boolean
  setNetworkMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  subscribersMenuOpen: boolean
  setSubscribersMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  servicesMenuOpen: boolean
  setServicesMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  billingMenuOpen: boolean
  setBillingMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  inventoryMenuOpen: boolean
  setInventoryMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
}

function SidebarContent({
  mobile = false,
  setSidebarOpen,
  company,
  pathname,
  visibleNavItems,
  networkMenuOpen, setNetworkMenuOpen,
  subscribersMenuOpen, setSubscribersMenuOpen,
  servicesMenuOpen, setServicesMenuOpen,
  billingMenuOpen, setBillingMenuOpen,
  inventoryMenuOpen, setInventoryMenuOpen,
}: SidebarProps) {
  return (
    <aside
      className={`
        ${mobile ? 'fixed inset-y-0 left-0 z-50 w-64 shadow-2xl' : 'hidden lg:flex w-60'}
        flex-col bg-surface-50 border-r border-border
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
        {company && company.name !== "Mi ISP" ? (
          <>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden bg-brand-600 shadow-lg shadow-brand-600/30 flex-shrink-0">
              {company.logo_url ? (
                <img src={getLogoUrl(company.logo_url)} className="w-full h-full object-cover" alt="Logo" />
              ) : (
                <Building className="w-4 h-4 text-white" strokeWidth={2.5} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm truncate">{company.name}</p>
              <p className="text-xs text-muted-foreground truncate">NMS</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shadow-lg shadow-brand-600/30 flex-shrink-0">
              <Network className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm truncate">ISP</p>
              <p className="text-xs text-muted-foreground">NMS</p>
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
        {visibleNavItems.filter(item => 'items' in item || item.label !== 'Ajustes').map((item) => {
          if ('items' in item) {
            const hasActiveChild = item.items.some(sub => pathname.startsWith(sub.to))
            const isMenuOpen =
              item.label === 'Dispositivos'
                ? networkMenuOpen
                : item.label === 'Suscriptores'
                ? subscribersMenuOpen
                : item.label === 'Servicios'
                ? servicesMenuOpen
                : item.label === 'Facturación'
                ? billingMenuOpen
                : inventoryMenuOpen
            const toggleMenu = () => {
              if (item.label === 'Dispositivos') {
                setNetworkMenuOpen(prev => !prev)
              } else if (item.label === 'Suscriptores') {
                setSubscribersMenuOpen(prev => !prev)
              } else if (item.label === 'Servicios') {
                setServicesMenuOpen(prev => !prev)
              } else if (item.label === 'Facturación') {
                setBillingMenuOpen(prev => !prev)
              } else if (item.label === 'Inventario') {
                setInventoryMenuOpen(prev => !prev)
              }
            }
            const Icon = item.icon
            return (
              <div key={item.label} className="space-y-0.5">
                <button
                  onClick={toggleMenu}
                  className={`w-full nav-item flex items-center justify-between ${hasActiveChild ? 'text-primary bg-primary/5' : ''}`}
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
                        className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-all duration-200 cursor-pointer ${isActive ? 'text-primary bg-primary/10 border border-primary/20 font-semibold' : ''}`}
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

      {/* Ajustes pinned at bottom */}
      {visibleNavItems.some(item => !('items' in item) && item.label === 'Ajustes') && (
        <div className="p-3 border-t border-border">
          <NavLink
            to="/settings"
            id="nav-ajustes"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            <span>Ajustes</span>
          </NavLink>
        </div>
      )}
    </aside>
  )
}

export function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [networkMenuOpen, setNetworkMenuOpen] = useState(
    location.pathname.startsWith('/gateways') || location.pathname.startsWith('/traffic')
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
  const [inventoryMenuOpen, setInventoryMenuOpen] = useState(
    location.pathname.startsWith('/inventory') || location.pathname.startsWith('/providers')
  )
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const notificationsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const path = location.pathname
    const raf = requestAnimationFrame(() => {
      if (path.startsWith('/gateways') || path.startsWith('/traffic')) setNetworkMenuOpen(true)
      if (path.startsWith('/clients') || path.startsWith('/subscribers')) setSubscribersMenuOpen(true)
      if (path.startsWith('/plans') || path.startsWith('/custom-services')) setServicesMenuOpen(true)
      if (path.startsWith('/invoices') || path.startsWith('/payments')) setBillingMenuOpen(true)
      if (path.startsWith('/inventory') || path.startsWith('/providers')) setInventoryMenuOpen(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [location.pathname])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  useEffect(() => {
    if (!user || !user.inactivity_timeout || user.inactivity_timeout <= 0) {
      return
    }

    const timeoutMs = user.inactivity_timeout * 60 * 1000
    let timerId: ReturnType<typeof setTimeout> | undefined

    const resetTimer = () => {
      if (timerId) clearTimeout(timerId)
      timerId = setTimeout(() => {
        handleLogout()
      }, timeoutMs)
    }

    resetTimer()

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
    (item) => !item.roles || (user && item.roles.includes(user.role))
  )

  const sidebarProps: Omit<SidebarProps, 'mobile'> = {
    setSidebarOpen,
    company,
    pathname: location.pathname,
    visibleNavItems,
    networkMenuOpen, setNetworkMenuOpen,
    subscribersMenuOpen, setSubscribersMenuOpen,
    servicesMenuOpen, setServicesMenuOpen,
    billingMenuOpen, setBillingMenuOpen,
    inventoryMenuOpen, setInventoryMenuOpen,
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar desktop */}
      <SidebarContent {...sidebarProps} />

      {/* Sidebar mobile overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <SidebarContent mobile {...sidebarProps} />
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-4 px-4 py-3 border-b border-border bg-surface-100">
          <button
            id="sidebar-toggle"
            onClick={() => setSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {/* Notifications bell */}
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen(prev => !prev)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                title="Notificaciones"
              >
                <Bell className="w-4 h-4" />
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-surface-50 border border-border rounded-xl shadow-lg z-50">
                  <div className="p-3 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground">Notificaciones</h3>
                  </div>
                  <div className="py-8 text-sm text-muted-foreground text-center">
                    No hay notificaciones nuevas
                  </div>
                </div>
              )}
            </div>
            {/* Separator */}
            <div className="w-px h-6 bg-border bg-gray-600" />

            {/* Profile dropdown */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                id="profile-btn"
                onClick={() => setProfileOpen(prev => !prev)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-secondary/40 transition-colors"
              >
                <div className="w-7 h-7 rounded-full flex-shrink-0 overflow-hidden">
                  {user?.avatar_url ? (
                    <img
                      src={getLogoUrl(user.avatar_url)}
                      className="w-full h-full object-cover"
                      alt="Avatar"
                    />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center ${user?.role === 'admin' ? 'bg-brand-700' : user?.role === 'technician' ? 'bg-emerald-600' : 'bg-slate-600'}`}>
                      <span className="text-xs font-bold text-white uppercase">
                        {user?.name?.[0] ?? '?'}
                      </span>
                    </div>
                  )}
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`} />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-surface-50 border border-border rounded-xl shadow-lg z-50">
                  <div className="p-1.5 space-y-0.5">
                    <NavLink
                      to="/profile"
                      onClick={() => setProfileOpen(false)}
                      className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors ${isActive ? 'text-primary bg-primary/10' : ''}`}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      <span>Perfil</span>
                    </NavLink>
                    <button
                      type="button"
                      id="logout-btn"
                      onClick={() => { setProfileOpen(false); handleLogout() }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cerrar sesión</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
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
