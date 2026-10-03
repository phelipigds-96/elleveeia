import { AgentForm } from '../components/agent-form'

export default function NewAgentPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Novo Agente</h1>
        <p className="text-muted-foreground">Configure um novo cérebro de inteligência artificial para o seu atendimento.</p>
      </div>

      <AgentForm />
    </div>
  )
}
