'use server'

import { createClient } from '@/lib/supabase/server'
import { runAgentEngine } from './engine'
import { getCompanyId } from '@/lib/services/conversations'

export async function testAgentEngine(agentId: string, conversationId: string, message: string) {
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Não autorizado')

  // Chama o engine diretamente (wrapper)
  return await runAgentEngine({
    companyId,
    agentId,
    conversationId,
    userMessage: message
  })
}

export async function getTestContext() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return null

  const { data: agents } = await supabase.from('agents').select('*').eq('company_id', companyId)
  const { data: conversations } = await supabase.from('conversations').select('*, customers(name)').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(10)

  return { agents: agents || [], conversations: conversations || [] }
}
