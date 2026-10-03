import { getN8nIntegration } from '@/lib/services/integrations'
import { N8nConfigCard } from './components/n8n-config-card'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  const n8nData = await getN8nIntegration()

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Integrações</h1>
        <p className="text-muted-foreground">Gerencie a comunicação do Ellevee com canais e orquestradores externos.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <N8nConfigCard initialData={n8nData} />
      </div>
    </div>
  )
}
