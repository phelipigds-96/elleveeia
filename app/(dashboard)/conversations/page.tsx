import PainelClient from "./components/painel-client"
import {
  getConversationsList,
  getConversationMessages,
  getAgentProfileContext,
  getChatOperationsContextAction,
} from "./actions"

export const dynamic = 'force-dynamic'

export const metadata = {
  title: "Atendimento Omnichannel | Ellevee IA",
  description: "Painel de atendimento e conversas em tempo real via Supabase Realtime",
}

export default async function ConversationsPage() {
  // Carga base inicial realizada no servidor (RSC) com perfil do atendente, conversas, motivos de finalização e respostas rápidas
  const [currentUser, initialConversations, chatOps] = await Promise.all([
    getAgentProfileContext(),
    getConversationsList(),
    getChatOperationsContextAction(),
  ])
  const initialSelectedId = initialConversations.length > 0 ? initialConversations[0].id : null
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
      />
    </div>
  )
}
