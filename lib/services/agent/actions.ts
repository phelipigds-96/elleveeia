'use server'

import { createClient } from '@/lib/supabase/server'
import { runAgentEngine } from './engine'
import { getCompanyId } from '@/lib/services/conversations'

export async function testAgentEngine(agentId: string, conversationId: string, message: string) {
  try {
    const companyId = await getCompanyId()
    if (!companyId) return { success: false, error: 'Sessão inválida ou empresa não localizada. Refaça o login.' }

    return await runAgentEngine({
      companyId,
      agentId,
      conversationId,
      userMessage: message
    })
  } catch (err: any) {
    return { success: false, error: `Erro no servidor: ${err.message}`, details: err.stack }
  }
}

export async function getTestContext() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return null

  const { data: agents } = await supabase.from('agents').select('*').eq('company_id', companyId)
  const { data: conversations } = await supabase.from('conversations').select('*, customers(name)').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(10)

  return { agents: agents || [], conversations: conversations || [] }
}
