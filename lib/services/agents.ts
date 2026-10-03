'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getCompanyId(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
  return profile?.company_id
}

export async function listAgents() {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)
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

  return data || []
}

export async function getAgent(id: string) {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)
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
  provider: string
  model: string
  is_active: boolean
}) {
  try {
    const supabase = createClient()
    const companyId = await getCompanyId(supabase)
    if (!companyId) return { error: 'Sessão inválida ou empresa não localizada.' }

    if (!params.name.trim()) return { error: 'O nome do agente é obrigatório.' }

    const { data, error } = await supabase.from('agents').insert({
      company_id: companyId,
      name: params.name,
      segment: params.segment || null,
      personality: params.personality || null,
      instructions: params.instructions || null,
      provider: params.provider || 'openai',
      model: params.model || 'gpt-4o-mini',
      is_active: params.is_active
    }).select().single()

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    revalidatePath('/agent')
    return { data }
  } catch (err: any) {
    return { error: `Erro interno: ${err.message}` }
  }
}

export async function updateAgent(id: string, params: {
  name: string
  segment: string
  personality: string
  instructions: string
  provider: string
  model: string
  is_active: boolean
}) {
  try {
    const supabase = createClient()
    const companyId = await getCompanyId(supabase)
    if (!companyId) return { error: 'Não autorizado' }

    if (!params.name.trim()) return { error: 'O nome do agente é obrigatório.' }

    const { data, error } = await supabase.from('agents').update({
      name: params.name,
      segment: params.segment || null,
      personality: params.personality || null,
      instructions: params.instructions || null,
      provider: params.provider || 'openai',
      model: params.model || 'gpt-4o-mini',
      is_active: params.is_active,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('company_id', companyId)
    .select().single()

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    revalidatePath('/agent')
    return { data }
  } catch (err: any) {
    return { error: `Erro interno: ${err.message}` }
  }
}

export async function toggleAgentStatus(id: string, currentStatus: boolean) {
  try {
    const supabase = createClient()
    const companyId = await getCompanyId(supabase)
    if (!companyId) return { error: 'Não autorizado' }

    const { error } = await supabase.from('agents').update({
      is_active: !currentStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('company_id', companyId)

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    revalidatePath('/agent')
    return { success: true }
  } catch (err: any) {
    return { error: `Erro interno: ${err.message}` }
  }
}

export async function deleteAgent(id: string) {
  try {
    const supabase = createClient()
    const companyId = await getCompanyId(supabase)
    if (!companyId) return { error: 'Não autorizado' }

    const { error } = await supabase.from('agents')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    revalidatePath('/agent')
    return { success: true }
  } catch (err: any) {
    return { error: `Erro interno: ${err.message}` }
  }
}
