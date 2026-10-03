import { getConversations } from '@/lib/services/conversations'
import { ConversationsClient } from './components/conversations-client'

export const dynamic = 'force-dynamic' // Ensure it doesn't cache stale chats

export default async function ConversationsPage() {
  // Fetch initial all conversations to hydrate the client
  const initialConversations = await getConversations('all', '')

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 sm:-m-8">
      {/* Remove default layout padding to make the hub full-bleed */}
      <ConversationsClient initialConversations={initialConversations} />
    </div>
  )
}
