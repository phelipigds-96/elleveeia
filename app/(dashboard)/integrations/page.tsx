import { getN8nIntegration, getInboundWebhookInfo } from '@/lib/services/integrations'
import { requireCompanyAdmin } from '@/lib/services/auth/guard'
import { getEvolutionWhatsAppStatus } from '@/lib/services/whatsapp-evolution'
import { N8nConfigCard } from './components/n8n-config-card'
import { WhatsAppCard } from './components/whatsapp-card'
import { WhatsAppOfficialCard } from './components/whatsapp-official-card'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  await requireCompanyAdmin()
  const [n8nData, inboundData, whatsAppStatus] = await Promise.all([
    getN8nIntegration(),
    getInboundWebhookInfo(),
    getEvolutionWhatsAppStatus().catch(() => ({
      configured: false,
      state: 'disconnected' as const,
    })),
  ])

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Integrações & Canais</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie a conexão dos seus números de WhatsApp e canais de atendimento com a Ellevee.
        </p>
      </div>

      {/* Seção 1: Canais de WhatsApp */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Canais de Atendimento (WhatsApp)</h2>
          <p className="text-xs text-muted-foreground">
            Escolha o método de conexão para o envio e recepção de mensagens da sua empresa.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <WhatsAppCard initialStatus={whatsAppStatus} />
          <WhatsAppOfficialCard />
        </div>
      </div>

      {/* Seção 2: Automação e Orquestradores */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Automação & Orquestração</h2>
          <p className="text-xs text-muted-foreground">
            Configure webhooks e fluxos externos para roteamento avançado via n8n.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <N8nConfigCard initialData={n8nData} inboundData={inboundData} />
        </div>
      </div>
    </div>
  )
}
