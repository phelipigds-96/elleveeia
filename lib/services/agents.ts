'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCompanyId } from '@/lib/services/conversations'

export async function listAgents() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return []

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to list agents:', error)
    return []
  }

  return data
}

export async function getAgent(id: string) {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return null

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (error) {
    console.error('Failed to get agent:', error)
    return null
  }

  return data
}

export async function createAgent(params: {
  name: string
  segment: string
  personality: string
  instructions: string
  is_active: boolean
}) {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Não autorizado')

  if (!params.name.trim()) throw new Error('O nome do agente é obrigatório.')

  const { data, error } = await supabase.from('agents').insert({
    company_id: companyId,
    name: params.name,
    segment: params.segment,
    personality: params.personality,
    instructions: params.instructions,
    is_active: params.is_active
  }).select().single()

  if (error) throw new Error(`Falha ao criar agente: ${error.message}`)

  revalidatePath('/agent')
  return data
}

export async function updateAgent(id: string, params: {
  name: string
  segment: string
  personality: string
  instructions: string
  is_active: boolean
}) {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Não autorizado')

  if (!params.name.trim()) throw new Error('O nome do agente é obrigatório.')

  const { data, error } = await supabase.from('agents').update({
    name: params.name,
    segment: params.segment,
    personality: params.personality,
    instructions: params.instructions,
    is_active: params.is_active,
    updated_at: new Date().toISOString()
  })
  .eq('id', id)
  .eq('company_id', companyId)
  .select().single()

  if (error) throw new Error(`Falha ao atualizar agente: ${error.message}`)

  revalidatePath('/agent')
  return data
}

export async function toggleAgentStatus(id: string, currentStatus: boolean) {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Não autorizado')

  const { error } = await supabase.from('agents').update({
    is_active: !currentStatus,
    updated_at: new Date().toISOString()
  })
  .eq('id', id)
  .eq('company_id', companyId)

  if (error) throw new Error(`Falha ao alterar status do agente: ${error.message}`)

  revalidatePath('/agent')
}

export async function deleteAgent(id: string) {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Não autorizado')

  const { error } = await supabase.from('agents')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId)

  if (error) throw new Error(`Falha ao excluir agente: ${error.message}`)

  revalidatePath('/agent')
}
