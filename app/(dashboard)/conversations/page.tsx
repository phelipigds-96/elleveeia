import PainelClient from "./components/painel-client"
import { getConversationsList, getConversationMessages } from "./actions"

export const metadata = {
  title: "Atendimento Omnichannel | Ellevee IA",
  description: "Painel de atendimento e conversas em tempo real via Supabase Realtime",
}

export default async function ConversationsPage() {
  // Carga base inicial realizada estritamente no servidor (RSC)
  const initialConversations = await getConversationsList()
  const initialSelectedId = initialConversations.length > 0 ? initialConversations[0].id : null
  const initialMessages = initialSelectedId ? await getConversationMessages(initialSelectedId) : []

  return (
    <div className="h-[calc(100vh-6.5rem)] w-full">
      <PainelClient
        initialConversations={initialConversations}
        initialMessages={initialMessages}
        initialSelectedId={initialSelectedId}
      />
    </div>
  )
}
