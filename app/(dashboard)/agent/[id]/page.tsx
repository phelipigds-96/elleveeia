import { getAgent } from '@/lib/services/agents'
import { AgentForm } from '../components/agent-form'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function EditAgentPage({ params }: { params: { id: string } }) {
  const agent = await getAgent(params.id)

  if (!agent) {
    redirect('/agent')
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Editar Agente</h1>
        <p className="text-muted-foreground">Altere as configurações, personalidade e instruções do seu agente.</p>
      </div>

      <AgentForm initialData={agent} />
    </div>
  )
}
