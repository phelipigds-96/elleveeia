import PainelClient from "./components/painel-client"
import { getConversationsList, getConversationMessages, getAgentProfileContext } from "./actions"

export const metadata = {
  title: "Atendimento Omnichannel | Ellevee IA",
  description: "Painel de atendimento e conversas em tempo real via Supabase Realtime",
}

export default async function ConversationsPage() {
  // Carga base inicial realizada no servidor (RSC) com perfil do atendente e conversas filtradas por RBAC
  const [currentUser, initialConversations] = await Promise.all([
    getAgentProfileContext(),
    getConversationsList(),
  ])
  const initialSelectedId = initialConversations.length > 0 ? initialConversations[0].id : null
  const initialMessages = initialSelectedId ? await getConversationMessages(initialSelectedId) : []

  return (
    <div className="flex h-[calc(100vh-6.5rem)] min-h-0 w-full flex-col">
      <PainelClient
        initialConversations={initialConversations}
        initialMessages={initialMessages}
        initialSelectedId={initialSelectedId}
        currentUser={currentUser}
      />
    </div>
  )
}
