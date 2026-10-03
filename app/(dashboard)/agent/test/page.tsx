import { getTestContext } from '@/lib/services/agent/actions'
import { TestPlayground } from './components/test-playground'

export const dynamic = 'force-dynamic'

export default async function AgentTestPage() {
  const context = await getTestContext()

  if (!context) {
    return <div>Não autorizado.</div>
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Agent Playground</h1>
        <p className="text-muted-foreground">Área interna e protegida para testar e auditar o Agent Engine localmente.</p>
      </div>

      <TestPlayground agents={context.agents} conversations={context.conversations} />
    </div>
  )
}
