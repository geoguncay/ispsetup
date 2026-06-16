/**
 * Zustand store para las configuraciones locales de la interfaz.
 */
import { create } from 'zustand'

interface SettingsState {
  hideIps: boolean
  toggleHideIps: () => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hideIps: localStorage.getItem('hide_ips') === 'true',
  toggleHideIps: () => set((state) => {
    const newVal = !state.hideIps
    localStorage.setItem('hide_ips', String(newVal))
    return { hideIps: newVal }
  }),
}))
