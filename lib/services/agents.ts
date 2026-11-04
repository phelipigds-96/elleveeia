'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'

export interface AgentActionOptions {
  supabaseClient?: any
  adminClient?: any
}

function resolveSupabase(options?: AgentActionOptions) {
  try {
    return options?.supabaseClient || createClient()
  } catch {
    return options?.supabaseClient || null
  }
}

async function getAuthenticatedProfile(supabase: any) {
  if (!supabase) return null
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return null
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()
  if (profErr || !profile) return null
  return profile
}

export async function listAgents(options?: AgentActionOptions) {
  const supabase = resolveSupabase(options)
  const profile = await getAuthenticatedProfile(supabase)
  if (!profile?.company_id) return []

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to list agents:', error)
    return []
  }

  return data || []
}

export async function getAgent(id: string, options?: AgentActionOptions) {
  const supabase = resolveSupabase(options)
  const profile = await getAuthenticatedProfile(supabase)
  if (!profile?.company_id) return null

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .single()

  if (error) {
    console.error('Failed to get agent:', error)
    return null
  }

  return data
}

export async function createAgent(
  params: {
    name: string
    segment?: string | null
    personality?: string | null
    instructions?: string | null
    provider?: string
    model?: string
    is_active?: boolean
  },
  options?: AgentActionOptions
) {
  try {
    const supabase = resolveSupabase(options)
    if (!supabase) return { error: 'Falha ao inicializar contexto de autenticação.' }

    const profile = await getAuthenticatedProfile(supabase)
    if (!profile?.company_id) return { error: 'Sessão inválida ou empresa não localizada.' }

    // RBAC: apenas administradores da empresa podem criar agentes
    if (!['admin', 'owner'].includes(profile.role)) {
      return { error: 'Não autorizado: apenas administradores podem criar agentes.' }
    }

    // 1. Validação do ciclo de vida da empresa (fail-closed incondicional)
    await requireActiveCompany(profile.company_id, { adminClient: options?.adminClient })

    if (!params.name || !params.name.trim()) {
      return { error: 'O nome do agente é obrigatório.' }
    }

    // 2. Verificação de limite comercial (max_agents)
    const { data: limits } = await supabase
      .from('company_limits')
      .select('max_agents')
      .eq('company_id', profile.company_id)
      .maybeSingle()

    const maxAgents = limits?.max_agents ?? 1

    const { data: currentAgents } = await supabase
      .from('agents')
      .select('id')
      .eq('company_id', profile.company_id)

    if ((currentAgents?.length || 0) >= maxAgents) {
      return {
        error: `Limite de agentes atingido (${maxAgents}). Faça upgrade do plano para criar mais agentes.`,
        code: 'LIMIT_EXCEEDED'
      }
    }

    // 3. Persistência do novo agente
    const { data, error } = await supabase.from('agents').insert({
      company_id: profile.company_id,
      name: params.name.trim(),
      segment: params.segment || null,
      personality: params.personality || null,
      instructions: params.instructions || null,
      provider: params.provider || 'openai',
      model: params.model || 'gpt-4o-mini',
      is_active: params.is_active ?? true
    }).select().single()

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    try {
      revalidatePath('/agent')
    } catch {}

    return { data }
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      return { error: err.message, code: err.code }
    }
    return { error: `Erro interno: ${err.message}` }
  }
}

export async function updateAgent(
  id: string,
  params: {
    name: string
    segment?: string | null
    personality?: string | null
    instructions?: string | null
    provider?: string
    model?: string
    is_active?: boolean
  },
  options?: AgentActionOptions
) {
  try {
    const supabase = resolveSupabase(options)
    if (!supabase) return { error: 'Falha ao inicializar contexto de autenticação.' }

    const profile = await getAuthenticatedProfile(supabase)
    if (!profile?.company_id) return { error: 'Não autorizado' }

    // RBAC: apenas administradores da empresa podem atualizar agentes
    if (!['admin', 'owner'].includes(profile.role)) {
      return { error: 'Não autorizado: apenas administradores podem atualizar agentes.' }
    }

    // 1. Validação do ciclo de vida da empresa (fail-closed incondicional)
    await requireActiveCompany(profile.company_id, { adminClient: options?.adminClient })

    if (!params.name || !params.name.trim()) {
      return { error: 'O nome do agente é obrigatório.' }
    }

    // 2. Verificação de propriedade e proteção contra manipulação cross-tenant
    const { data: existingAgent, error: getErr } = await supabase
      .from('agents')
      .select('id, company_id')
      .eq('id', id)
      .maybeSingle()

    if (getErr || !existingAgent) {
      return { error: 'Agente não encontrado.' }
    }

    if (existingAgent.company_id !== profile.company_id) {
      return { error: 'Não autorizado: o agente não pertence à sua empresa.' }
    }

    // 3. Atualização do agente com escopo restrito à empresa do usuário autenticado
    const { data, error } = await supabase.from('agents').update({
      name: params.name.trim(),
      segment: params.segment || null,
      personality: params.personality || null,
      instructions: params.instructions || null,
      provider: params.provider || 'openai',
      model: params.model || 'gpt-4o-mini',
      is_active: params.is_active,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .select().single()

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    try {
      revalidatePath('/agent')
    } catch {}

    return { data }
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      return { error: err.message, code: err.code }
    }
    return { error: `Erro interno: ${err.message}` }
  }
}

export async function toggleAgentStatus(
  id: string,
  currentStatus: boolean,
  options?: AgentActionOptions
) {
  try {
    const supabase = resolveSupabase(options)
    if (!supabase) return { error: 'Falha ao inicializar contexto de autenticação.' }

    const profile = await getAuthenticatedProfile(supabase)
    if (!profile?.company_id) return { error: 'Não autorizado' }

    // RBAC: apenas administradores da empresa podem alterar status de agentes
    if (!['admin', 'owner'].includes(profile.role)) {
      return { error: 'Não autorizado: apenas administradores podem alterar status de agentes.' }
    }

    // 1. Validação do ciclo de vida da empresa (fail-closed incondicional)
    await requireActiveCompany(profile.company_id, { adminClient: options?.adminClient })

    // 2. Verificação de propriedade e proteção contra manipulação cross-tenant
    const { data: existingAgent, error: getErr } = await supabase
      .from('agents')
      .select('id, company_id')
      .eq('id', id)
      .maybeSingle()

    if (getErr || !existingAgent) {
      return { error: 'Agente não encontrado.' }
    }

    if (existingAgent.company_id !== profile.company_id) {
      return { error: 'Não autorizado: o agente não pertence à sua empresa.' }
    }

    // 3. Atualização de status com escopo restrito
    const { error } = await supabase.from('agents').update({
      is_active: !currentStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('company_id', profile.company_id)

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    try {
      revalidatePath('/agent')
    } catch {}

    return { success: true }
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      return { error: err.message, code: err.code }
    }
    return { error: `Erro interno: ${err.message}` }
  }
}

export async function deleteAgent(id: string, options?: AgentActionOptions) {
  try {
    const supabase = resolveSupabase(options)
    if (!supabase) return { error: 'Falha ao inicializar contexto de autenticação.' }

    const profile = await getAuthenticatedProfile(supabase)
    if (!profile?.company_id) return { error: 'Não autorizado' }

    // RBAC: apenas administradores da empresa podem excluir agentes
    if (!['admin', 'owner'].includes(profile.role)) {
      return { error: 'Não autorizado: apenas administradores podem excluir agentes.' }
    }

    // 1. Validação do ciclo de vida da empresa (fail-closed incondicional)
    await requireActiveCompany(profile.company_id, { adminClient: options?.adminClient })

    // 2. Verificação de propriedade e proteção contra manipulação cross-tenant
    const { data: existingAgent, error: getErr } = await supabase
      .from('agents')
      .select('id, company_id')
      .eq('id', id)
      .maybeSingle()

    if (getErr || !existingAgent) {
      return { error: 'Agente não encontrado.' }
    }

    if (existingAgent.company_id !== profile.company_id) {
      return { error: 'Não autorizado: o agente não pertence à sua empresa.' }
    }

    // 3. Exclusão segura com escopo restrito
    const { error } = await supabase.from('agents')
      .delete()
      .eq('id', id)
      .eq('company_id', profile.company_id)

    if (error) return { error: `Falha no Supabase: ${error.message}` }

    try {
      revalidatePath('/agent')
    } catch {}

    return { success: true }
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      return { error: err.message, code: err.code }
    }
    return { error: `Erro interno: ${err.message}` }
  }
}
