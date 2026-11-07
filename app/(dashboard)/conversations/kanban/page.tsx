import { createClient } from "@/lib/supabase/server"
import KanbanPanelClient from "../components/kanban-panel-client"

export const dynamic = "force-dynamic"

type StageRow = {
  id: string
  workflow_id: string
  name: string
  position: number
  stage_type: string
  is_active: boolean
}

type ConversationRow = {
  id: string
  customer_name: string | null
  customer_phone: string | null
  channel: string | null
  status: string | null
  workflow_stage_id: string | null
  created_at: string | null
}

export default async function ConversationsKanbanPage() {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-ellevee-stone bg-white text-sm text-ellevee-ink-muted">
        Sessão expirada. Entre novamente para acessar o funil.
      </div>
    )
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  const companyId = profile?.company_id

  if (!companyId) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-ellevee-stone bg-white text-sm text-ellevee-ink-muted">
        Nenhuma empresa vinculada ao seu usuário.
      </div>
    )
  }

  const [workflowsRes, stagesRes, conversationsRes] = await Promise.all([
    supabase
      .from("workflows")
      .select("id, name, is_default, is_active")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true }),
    supabase
      .from("workflow_stages")
      .select("id, workflow_id, name, position, stage_type, is_active")
      .eq("company_id", companyId)
      .order("position", { ascending: true }),
    supabase
      .from("conversations")
      .select("id, customer_name, customer_phone, channel, status, workflow_stage_id, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(300),
  ])

  const workflows = (workflowsRes.data || []) as any[]
  const stages = (stagesRes.data || []) as StageRow[]
  const conversations = (conversationsRes.data || []) as ConversationRow[]

  const defaultWorkflow =
    workflows.find((w) => w.is_default && w.is_active) ||
    workflows.find((w) => w.is_active) ||
    workflows[0] ||
    null

  const visibleStages = stages
    .filter((s) => !defaultWorkflow || s.workflow_id === defaultWorkflow.id)
    .filter((s) => s.is_active !== false)
    .sort((a, b) => a.position - b.position)

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ellevee-ink">
            Funil de atendimento
          </h1>
          <p className="mt-1 text-meta text-ellevee-ink-muted">
            {defaultWorkflow ? defaultWorkflow.name : "Nenhum workflow configurado"}
            {" · "}
            {conversations.length} conversa(s)
          </p>
        </div>
        <a
          href="/conversations"
          className="focus-ring rounded-lg border border-ellevee-stone bg-white px-3 py-2 text-meta text-ellevee-ink transition-colors hover:bg-ellevee-ivory"
        >
          Ver lista de conversas
        </a>
      </div>

      <KanbanPanelClient stages={visibleStages} conversations={conversations} />
    </div>
  )
}
