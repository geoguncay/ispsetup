/**
 * Zustand store de autenticación.
 * Persiste tokens en localStorage y mantiene el estado del usuario en memoria.
 */
import { create } from 'zustand'
import api from '@/services/api'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'admin' | 'technician' | 'viewer'
  active: boolean
  inactivity_timeout?: number
  avatar_url?: string | null
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean

  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem('access_token'),
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true })
    try {
      const { data } = await api.post('/auth/login', { email, password })
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)

      // Cargar perfil del usuario
      const { data: me } = await api.get('/auth/me')
      set({ user: me, isAuthenticated: true })
    } finally {
      set({ isLoading: false })
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // Si falla el logout en servidor, limpiamos de todas formas
    } finally {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false })
    }
  },

  fetchMe: async () => {
    if (!localStorage.getItem('access_token')) return
    try {
      const { data } = await api.get('/auth/me')
      set({ user: data, isAuthenticated: true })
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false })
    }
  },
}))
