import { getConversations } from '@/lib/services/conversations'
import { getCompanyWorkflows } from '@/lib/services/workflows/workflows'
import { ConversationsClient } from './components/conversations-client'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ConversationsPage() {
  const supabase = createClient()
  const { data: userData } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', userData.user?.id).single()
  const companyId = profile?.company_id

  const initialConversations = await getConversations('all', '')
  const workflows = companyId ? await getCompanyWorkflows() : []

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 sm:-m-8">
      <ConversationsClient initialConversations={initialConversations} initialWorkflows={workflows} companyId={companyId} />
    </div>
  )
}
