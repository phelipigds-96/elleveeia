import { listAgents } from '@/lib/services/agents'
import { AgentsList } from './components/agents-list'
import { Bot } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const agents = await listAgents()

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agentes</h1>
          <p className="text-muted-foreground">Crie e configure os agentes de IA da sua empresa.</p>
        </div>
        <Link
          href="/agent/new"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
        >
          + Novo agente
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center bg-card">
          <Bot className="h-12 w-12 text-muted-foreground opacity-50 mb-4" />
          <h3 className="font-semibold text-lg">Você ainda não possui agentes</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-sm">
            Crie seu primeiro agente de IA para começar a configurar o atendimento da sua empresa.
          </p>
          <Link
            href="/agent/new"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2"
          >
            Criar primeiro agente
          </Link>
        </div>
      ) : (
        <AgentsList initialAgents={agents} />
      )}
    </div>
  )
}
