import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { getPlatformAgentsList, AGENT_BLUEPRINTS } from "@/lib/services/platform/agents"
import AgentsClientView from "@/components/agents/agents-client-view"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminAgentsPage() {
  try {
    await requirePlatformAdmin()
  } catch (err: any) {
    console.warn("[AgentsPage] Acesso não-operador à visualização de agentes:", err?.message)
  }

  const agents = await getPlatformAgentsList()

  return <AgentsClientView initialAgents={agents} blueprints={AGENT_BLUEPRINTS} />
}
