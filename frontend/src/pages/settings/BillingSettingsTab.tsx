import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { getSystemSettings } from '@/services/systemSettings'
import { BillingGeneralForm } from './BillingGeneralForm'
import { SuspensionSettingsForm } from './SuspensionSettingsForm'
import { PaymentMethodsSettingsForm } from './PaymentMethodsSettingsForm'

type StatusSetter = (msg: { type: 'success' | 'error'; text: string } | null) => void

type SubTab = 'billing' | 'suspension' | 'payment_methods'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'billing', label: 'Ajustes' },
  { id: 'suspension', label: 'Suspensión' },
  { id: 'payment_methods', label: 'Método de Pago' },
]

export function BillingSettingsTab({ isAdmin, setStatusMessage }: { isAdmin: boolean; setStatusMessage: StatusSetter }) {
  const [subTab, setSubTab] = useState<SubTab>('billing')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSystemSettings,
    enabled: isAdmin,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['system-settings'] })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap gap-1 p-1 bg-secondary/30 rounded-xl border border-secondary/50 max-w-max">
        {SUB_TABS.map((sub) => (
          <button
            key={sub.id}
            onClick={() => { setSubTab(sub.id); setStatusMessage(null) }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${subTab === sub.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <div className="glass-card p-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {subTab === 'billing' && (
            <BillingGeneralForm data={data.billing} onSaved={invalidate} setStatusMessage={setStatusMessage} />
          )}
          {subTab === 'suspension' && (
            <SuspensionSettingsForm data={data.suspension} onSaved={invalidate} setStatusMessage={setStatusMessage} />
          )}
          {subTab === 'payment_methods' && (
            <PaymentMethodsSettingsForm data={data.catalogs} onSaved={invalidate} setStatusMessage={setStatusMessage} />
          )}
        </>
      )}
    </div>
  )
}
