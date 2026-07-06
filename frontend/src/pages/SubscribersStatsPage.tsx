/**
 * SubscribersStatsPage — Visualización de estadísticas generales e informes de suscriptores.
 */
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Users, UserCheck, UserMinus, UserX, RefreshCw, BarChart2, PieChart, Activity, ShieldAlert, TrendingUp, ArrowRight } from 'lucide-react'
import { PieChart as RechartsPieChart, Pie, Cell, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api from '@/services/api'

interface ClientStats {
  total: number
  connected: number
  disconnected: number
  suspended: number
}

interface Client {
  id: string
  name: string
  connection_type: 'static' | 'pppoe'
  active: boolean
  plan_activo: { id: string; name: string; price: number } | null
  created_at?: string
}

interface ClientsResponse {
  items: Client[]
  total: number
}

export function SubscribersStatsPage() {
  const navigate = useNavigate()
  const [subscribersViewMode, setSubscribersViewMode] = useState<'status' | 'growth'>('status')

  // Query 1: Obtener estadísticas simplificadas de clientes
  const { data: clientStats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery<ClientStats>({
    queryKey: ['subscribers-stats-counters'],
    queryFn: async () => {
      const { data } = await api.get('/users/stats')
      return data
    },
    refetchInterval: 60_000,
  })

  // Query 2: Obtener todos los clientes (hasta 1000) para hacer agregaciones más avanzadas
  const { data: clientsData, isLoading: clientsLoading, isError: clientsError, refetch: refetchClients } = useQuery<ClientsResponse>({
    queryKey: ['subscribers-stats-aggregation'],
    queryFn: async () => {
      const { data } = await api.get('/clients', { params: { limit: 1000 } })
      return data
    },
  })

  const isLoading = statsLoading || clientsLoading
  const isError = statsError || clientsError

  const handleRefresh = () => {
    refetchStats()
    refetchClients()
  }

  // Agregación de datos de clientes si están cargados
  const clientsList = clientsData?.items || []

  // 1. Datos para distribución por estado
  const statusChartData = [
    { name: 'Conectados', value: clientStats?.connected || 0, color: '#10b981' },
    { name: 'Desconectados', value: clientStats?.disconnected || 0, color: '#0ea5e9' },
    { name: 'Suspendidos', value: clientStats?.suspended || 0, color: '#f59e0b' },
  ].filter(item => item.value > 0) // Filtrar vacíos para evitar errores gráficos

  // Si no hay datos reales cargados pero no hay errores, usar datos de stats directamente
  const hasStatusData = statusChartData.length > 0

  // 2. Datos para popularidad de planes
  const planCounts: Record<string, number> = {}
  clientsList.forEach((c) => {
    const planName = c.plan_activo?.name || 'Sin Plan'
    planCounts[planName] = (planCounts[planName] || 0) + 1
  })
  const planChartData = Object.entries(planCounts)
    .map(([name, value]) => ({ name, clientes: value }))
    .sort((a, b) => b.clientes - a.clientes)

  // 3. Datos para tipo de conexión
  const typeCounts = { static: 0, pppoe: 0 }
  clientsList.forEach((c) => {
    if (c.connection_type === 'static') {
      typeCounts.static += 1
    } else {
      typeCounts.pppoe += 1
    }
  })
  const typeChartData = [
    { name: 'IP Estática', value: typeCounts.static, color: '#3b82f6' },
    { name: 'PPPoE', value: typeCounts.pppoe, color: '#8b5cf6' },
  ].filter(item => item.value > 0)

  // 4. Datos para crecimiento mensual de suscriptores
  const monthlyGrowthData = useMemo(() => {
    if (clientsList.length === 0) return []

    // Agrupar por año y mes
    const monthlyGroups: Record<string, number> = {}
    clientsList.forEach((c) => {
      if (!c.created_at) return
      try {
        const date = new Date(c.created_at)
        if (isNaN(date.getTime())) return

        // Formato: AAAA-MM
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const key = `${year}-${month}`
        monthlyGroups[key] = (monthlyGroups[key] || 0) + 1
      } catch {
        // Ignorar fechas inválidas
      }
    })

    // Ordenar cronológicamente
    const sortedMonths = Object.keys(monthlyGroups).sort()

    let cumulativeCount = 0
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

    return sortedMonths.map((monthKey) => {
      const [year, monthStr] = monthKey.split('-')
      const monthIdx = parseInt(monthStr, 10) - 1
      const label = `${monthNames[monthIdx]} ${year}`
      const registrations = monthlyGroups[monthKey]
      cumulativeCount += registrations
      return {
        label,
        nuevos: registrations,
        acumulado: cumulativeCount,
      }
    })
  }, [clientsList])

  const statValue = (v: number | undefined) => isLoading ? '—' : (v ?? 0)

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Estadísticas de Suscriptores</h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="btn-secondary"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizar datos
        </button>
      </div>

      {isError ? (
        <div className="glass-card p-12 text-center max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto border border-red-500/25">
            <ShieldAlert className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">Error al cargar las estadísticas</h3>
          <p className="text-muted-foreground text-sm">
            Ocurrió un error al obtener la información de los suscriptores desde el servidor. Por favor, reintenta.
          </p>
          <button onClick={handleRefresh} className="btn-primary mx-auto">
            Reintentar
          </button>
        </div>
      ) : (!isLoading && !clientsLoading && clientStats?.total === 0) ? (
        <div className="glass-card p-12 text-center max-w-xl mx-auto space-y-5 animate-fade-in border border-border/40">
          <div className="w-16 h-16 bg-brand-500/10 rounded-full flex items-center justify-center mx-auto border border-brand-500/20">
            <Users className="w-8 h-8 text-brand-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-foreground">No hay estadísticas disponibles</h3>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              Aún no hay clientes registrados en la plataforma. Registra tus suscriptores de forma manual o impórtalos para ver métricas de conexión y gráficos.
            </p>
          </div>
          <button
            onClick={() => navigate('/clients')}
            className="btn-primary flex items-center gap-1.5 mx-auto cursor-pointer"
          >
            Registrar o Importar Clientes <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <>
          {/* KPI Cards Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Total Suscriptores',
                value: statValue(clientStats?.total),
                icon: Users,
                color: 'text-violet-400',
                bg: 'bg-violet-900/20',
                border: 'border-violet-800/30',
              },
              {
                label: 'Clientes Conectados',
                value: statValue(clientStats?.connected),
                icon: UserCheck,
                color: 'text-emerald-400',
                bg: 'bg-emerald-900/20',
                border: 'border-emerald-800/30',
              },
              {
                label: 'Clientes Desconectados',
                value: statValue(clientStats?.disconnected),
                icon: UserMinus,
                color: 'text-sky-400',
                bg: 'bg-sky-900/20',
                border: 'border-sky-800/30',
              },
              {
                label: 'Clientes Suspendidos',
                value: statValue(clientStats?.suspended),
                icon: UserX,
                color: 'text-orange-400',
                bg: 'bg-orange-900/20',
                border: 'border-orange-800/30',
              },
            ].map(({ label, value, icon: Icon, color, bg, border }) => (
              <div key={label} className={`rounded-xl border ${border} ${bg} p-4 backdrop-blur-sm`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center border ${border}`}>
                    <Icon className={`w-4 h-4 ${color}`} />
                  </div>
                </div>
                {isLoading ? (
                  <div className="h-9 w-16 bg-white/5 animate-pulse rounded" />
                ) : (
                  <p className={`text-3xl font-bold ${color}`}>{value}</p>
                )}
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart: Status Distribution & Growth */}
            <div className="glass-card p-5 flex flex-col h-[350px]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {subscribersViewMode === 'status' ? (
                    <PieChart className="w-4 h-4 text-brand-400" />
                  ) : (
                    <TrendingUp className="w-4 h-4 text-brand-400" />
                  )}
                  <h2 className="text-sm font-semibold text-foreground">Estado de Suscriptores</h2>
                </div>
                <div className="flex bg-secondary/50 rounded-lg p-0.5 border border-border/60">
                  <button
                    onClick={() => setSubscribersViewMode('status')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all duration-200 ${subscribersViewMode === 'status'
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    Distribución
                  </button>
                  <button
                    onClick={() => setSubscribersViewMode('growth')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all duration-200 ${subscribersViewMode === 'growth'
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                      }`}
                  >
                    Crecimiento
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 relative">
                {isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : subscribersViewMode === 'status' ? (
                  !hasStatusData ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                      Sin datos de estado para graficar.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={statusChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {statusChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="rgba(255,255,255,0.05)" />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(30, 41, 59, 0.9)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontFamily: 'sans-serif',
                            fontSize: '12px'
                          }}
                        />
                        <Legend
                          verticalAlign="bottom"
                          height={36}
                          formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                        />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  )
                ) : (
                  monthlyGrowthData.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                      Sin registros de suscriptores para graficar crecimiento.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlyGrowthData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                        <defs>
                          <linearGradient id="growthGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.05)" />
                        <XAxis
                          dataKey="label"
                          stroke="rgba(255, 255, 255, 0.3)"
                          tick={{ fontSize: 10, fill: 'rgba(255, 255, 255, 0.5)' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          stroke="rgba(255, 255, 255, 0.3)"
                          tick={{ fontSize: 10, fill: 'rgba(255, 255, 255, 0.5)' }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(30, 41, 59, 0.9)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontFamily: 'sans-serif',
                            fontSize: '12px'
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="acumulado"
                          stroke="#10b981"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#growthGradient)"
                          name="Total Suscriptores"
                        />
                        <Area
                          type="monotone"
                          dataKey="nuevos"
                          stroke="#3b82f6"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          fill="none"
                          name="Nuevos Registros"
                        />
                        <Legend
                          verticalAlign="bottom"
                          height={36}
                          formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )
                )}
              </div>
            </div>

            {/* Bar Chart: Plan Popularity */}
            <div className="glass-card p-5 flex flex-col h-[350px]">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-brand-400" />
                <h2 className="text-sm font-semibold text-foreground">Planes Más Populares</h2>
              </div>
              <div className="flex-1 min-h-0 relative">
                {isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : planChartData.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    No hay clientes con planes asignados.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={planChartData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.05)" />
                      <XAxis
                        dataKey="name"
                        stroke="rgba(255, 255, 255, 0.3)"
                        tick={{ fontSize: 10, fill: 'rgba(255, 255, 255, 0.5)' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="rgba(255, 255, 255, 0.3)"
                        tick={{ fontSize: 10, fill: 'rgba(255, 255, 255, 0.5)' }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                        contentStyle={{
                          backgroundColor: 'rgba(30, 41, 59, 0.9)',
                          borderColor: 'rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontFamily: 'sans-serif',
                          fontSize: '12px'
                        }}
                      />
                      <Bar dataKey="clientes" fill="#8b5cf6" radius={[4, 4, 0, 0]}>
                        {planChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={`url(#planGradient)`} />
                        ))}
                      </Bar>
                      <defs>
                        <linearGradient id="planGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#c084fc" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        </linearGradient>
                      </defs>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Third Row: Connection Type Distribution */}
          <div className="grid grid-cols-1 gap-6">
            <div className="glass-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-brand-400" />
                <h2 className="text-sm font-semibold text-foreground">Métodos de Conexión</h2>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-24">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : typeChartData.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  Sin métodos de conexión registrados.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  {/* Left Column: Progress bars */}
                  <div className="space-y-4">
                    {typeChartData.map((item) => {
                      const percentage = clientStats?.total ? Math.round((item.value / clientStats.total) * 100) : 0
                      return (
                        <div key={item.name} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-foreground flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                              {item.name}
                            </span>
                            <span className="text-muted-foreground">{item.value} ({percentage}%)</span>
                          </div>
                          <div className="w-full bg-white/5 rounded-full h-2.5 overflow-hidden border border-white/5">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${percentage}%`, backgroundColor: item.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Right Column: Donut Mini-Chart */}
                  <div className="h-[120px] flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={typeChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={30}
                          outerRadius={45}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {typeChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="rgba(255,255,255,0.05)" />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(30, 41, 59, 0.9)',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '11px'
                          }}
                        />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
