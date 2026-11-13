import PainelClient from "./components/painel-client"
import {
  getConversationsList,
  getConversationMessages,
  getAgentProfileContext,
  getChatOperationsContextAction,
  getCompanyWorkflowStagesAction,
} from "./actions"

export const dynamic = 'force-dynamic'

export const metadata = {
  title: "Atendimento Omnichannel | Ellevee IA",
  description: "Painel de atendimento e conversas em tempo real via Supabase Realtime",
}

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams?: { id?: string }
}) {
  // Carga base inicial realizada no servidor (RSC) com perfil do atendente, conversas, motivos de finalização, respostas rápidas e etapas de funil
  const [currentUser, initialConversations, chatOps, initialWorkflowStages] = await Promise.all([
    getAgentProfileContext(),
    getConversationsList(),
    getChatOperationsContextAction(),
    getCompanyWorkflowStagesAction(),
  ])
  const requestedId = typeof searchParams?.id === 'string' ? searchParams.id.trim() : ''
  const matchedRequested = requestedId
    ? initialConversations.find((c: any) => c.id === requestedId)
    : undefined
  const initialSelectedId =
    matchedRequested?.id ??
    (initialConversations.length > 0 ? initialConversations[0].id : null)
  const initialMessages = initialSelectedId ? await getConversationMessages(initialSelectedId) : []

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <PainelClient
        initialConversations={initialConversations}
        initialMessages={initialMessages}
        initialSelectedId={initialSelectedId}
        currentUser={currentUser}
        initialCloseReasons={chatOps.closeReasons}
        requireCloseReason={chatOps.requireCloseReason}
        initialQuickReplies={chatOps.quickReplies}
        initialWorkflowStages={initialWorkflowStages}
      />
    </div>
  )
}
