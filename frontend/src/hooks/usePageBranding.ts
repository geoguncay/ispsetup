/**
 * usePageBranding — sincroniza el título, la meta descripción y el favicon del
 * documento con los datos de la empresa (nombre y logo configurados en Ajustes).
 */
import { useEffect } from 'react'
import { getLogoUrl } from '@/lib/utils'
import defaultIcon from '@/assets/icon.svg'

const DEFAULT_TITLE = 'ISP SETUP — ISP Management'
const DEFAULT_DESCRIPTION = 'ISP SETUP — Gestión centralizada para ISP con routers MikroTik'
// Nombres de placeholder que trae el registro de empresa por defecto (aún no editado por el usuario).
const PLACEHOLDER_NAMES = ['Mi ISP', 'Mi WISP']

interface BrandingCompany {
  name?: string | null
  logo_url?: string | null
}

function resolveCompanyName(name: string | null | undefined): string | null {
  if (!name || PLACEHOLDER_NAMES.includes(name)) return null
  return name
}

function setFavicon(href: string) {
  const link =
    document.querySelector<HTMLLinkElement>("link[rel~='icon']") ??
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
  // El logo de la empresa puede ser png/jpg/webp/svg — se quita `type` para que
  // el navegador infiera el formato en vez de arrastrar el `image/png` fijo del HTML base.
  link.removeAttribute('type')
  link.href = href
}

function setMetaDescription(content: string) {
  const meta =
    document.querySelector<HTMLMetaElement>("meta[name='description']") ??
    document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'description' }))
  meta.content = content
}

export function usePageBranding(company: BrandingCompany | null | undefined) {
  const name = resolveCompanyName(company?.name)
  const logoUrl = company?.logo_url || null

  useEffect(() => {
    document.title = name ? `${name} — Panel ISP` : DEFAULT_TITLE
    setMetaDescription(name ? `Panel de gestión de red ISP de ${name}.` : DEFAULT_DESCRIPTION)
    setFavicon(logoUrl ? getLogoUrl(logoUrl) : defaultIcon)
  }, [name, logoUrl])
}
