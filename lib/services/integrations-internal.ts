import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'
import { testN8nConnectionInternal } from '@/lib/services/n8n-internal'

export interface IntegrationInternalOptions {
  supabaseClient?: any
  adminClient?: any
}

function resolveSupabase(options?: IntegrationInternalOptions) {
  try {
    return options?.supabaseClient || createClient()
  } catch {
    return options?.supabaseClient || null
  }
}

/**
 * Resolução defensiva da sessão autenticada e verificação de perfil/RBAC administrativo.
 * Garante que company_id e role provenham estritamente do contexto de sessão do servidor,
 * rejeitando qualquer tentativa de injeção ou spoofing pelo cliente.
 */
async function resolveAdminSession(supabase: any) {
  if (!supabase) {
    return { ok: false, error: 'Contexto de autenticação inválido.', status: 401 } as const
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { ok: false, error: 'Usuário não autenticado.', status: 401 } as const
  }

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()

  if (profErr || !profile?.company_id) {
    return { ok: false, error: 'Perfil de empresa não localizado.', status: 403 } as const
  }

  if (!['admin', 'owner'].includes(profile.role)) {
    return { 
      ok: false, 
      error: 'Não autorizado: apenas administradores podem gerenciar integrações.', 
      status: 403 
    } as const
  }

  return { 
    ok: true, 
    user, 
    profile, 
    companyId: profile.company_id as string 
  } as const
}

/**
 * Módulo interno: obtém as informações do webhook de entrada (inbound).
 * Protegido por autenticação, RBAC administrativo e validação de ciclo de vida do tenant.
 */
export async function getInboundWebhookInfoInternal(
  options?: IntegrationInternalOptions
): Promise<{ token: string } | null> {
  const supabase = resolveSupabase(options)
  const session = await resolveAdminSession(supabase)
  if (!session.ok) return null

  const companyId = session.companyId

  // Validação de ciclo de vida do tenant (Fail-closed)
  try {
    await requireActiveCompany(companyId, { adminClient: options?.adminClient })
  } catch (err: any) {
    console.warn(`[getInboundWebhookInfo] Acesso bloqueado para tenant '${companyId}':`, err.message)
    return null
  }

  // 1. Busca primeiro a chave automática mais recente da empresa com ordenação determinística
  const { data: autoKey, error: autoErr } = await supabase
    .from('api_keys')
    .select('key')
    .eq('company_id', companyId)
    .eq('description', 'Chave Automatica Webhook')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!autoErr && autoKey?.key) {
    return { token: autoKey.key }
  }

  // 2. Fallback: Se não houver chave com descrição automática, busca qualquer chave existente da empresa
  const { data: fallbackKey, error: fallbackErr } = await supabase
    .from('api_keys')
    .select('key')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!fallbackErr && fallbackKey?.key) {
    return { token: fallbackKey.key }
  }

  // 3. Se não existir nenhuma, auto-gera a chave sob governança administrativa
  try {
    const adminSupabase = options?.adminClient || createAdminClient()
    const generatedKey = 'ell_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    
    const { data: newKey, error: insertError } = await adminSupabase
      .from('api_keys')
      .insert({
        company_id: companyId,
        key: generatedKey,
        description: 'Chave Automatica Webhook'
      })
      .select('key')
      .single()

    if (insertError) {
      // Se colidir com índice único parcial em race condition de inicialização, busca a chave vencedora
      if (insertError.code === '23505' || (insertError.message && insertError.message.includes('unique'))) {
        const { data: winnerKey } = await adminSupabase
          .from('api_keys')
          .select('key')
          .eq('company_id', companyId)
          .eq('description', 'Chave Automatica Webhook')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (winnerKey?.key) {
          return { token: winnerKey.key }
        }
      }
      console.error('[getInboundWebhookInfo] Falha ao auto-gerar chave:', insertError.message)
      return null
    }

    return { token: newKey?.key || generatedKey }
  } catch (err: any) {
    console.error('[getInboundWebhookInfo] Exceção ao auto-gerar chave:', err.message)
    return null
  }
}

/**
 * Módulo interno: rotaciona de forma atômica e segura o token de entrada do Webhook.
 * 
 * Garantia de Atomicidade:
 * - Em vez de DELETE seguido de INSERT (que deixaria o tenant desprovido de token caso o INSERT falhasse),
 *   executa um UPDATE in-place da chave automática existente.
 * - Caso a atualização falhe por qualquer motivo no banco de dados, o token anterior NÃO é perdido.
 * - Se existirem chaves duplicadas (oriundas de concorrência prévia), as excedentes são podadas
 *   apenas APÓS a confirmação de sucesso do UPDATE.
 * - Se não houver chave prévia, insere uma nova com verificação explícita de erro.
 */
export async function rotateInboundWebhookTokenInternal(
  options?: IntegrationInternalOptions
): Promise<{ success: boolean; token?: string; error?: string; code?: string }> {
  try {
    const supabase = resolveSupabase(options)
    const session = await resolveAdminSession(supabase)
    if (!session.ok) {
      return { success: false, error: session.error }
    }

    const companyId = session.companyId

    // 0. Validação de ciclo de vida do tenant (Fail-closed)
    try {
      await requireActiveCompany(companyId, { adminClient: options?.adminClient })
    } catch (err: any) {
      return { 
        success: false, 
        error: err.message, 
        code: err.code || 'TENANT_NOT_ACTIVE' 
      }
    }

    // 1. Obtenção do cliente administrativo apenas após autorização comprovada
    const adminSupabase = options?.adminClient || createAdminClient()

    // 2. Gera novo token no padrão ell_ seguido de 24 hexadecimais
    const generatedKey = 'ell_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)

    // 2.1. Execução via RPC transacional no PostgreSQL se disponível (garantia atômica estrutural)
    if (typeof adminSupabase.rpc === 'function') {
      try {
        const { data: rpcToken, error: rpcErr } = await adminSupabase.rpc('rotate_company_webhook_key', {
          p_company_id: companyId,
          p_new_key: generatedKey
        })
        if (!rpcErr && rpcToken) {
          console.log(`[rotateInboundWebhookToken] Token rotacionado via RPC transacional para company:${companyId}`)
          try { revalidatePath('/integrations') } catch {}
          return { success: true, token: rpcToken }
        }
      } catch {
        // Fallback para operação a nível de aplicação se a RPC ainda não tiver sido criada no banco
      }
    }

    // 3. Consulta chaves automáticas existentes da empresa com ordenação determinística
    const { data: existingAutoKeys, error: fetchError } = await adminSupabase
      .from('api_keys')
      .select('id, key')
      .eq('company_id', companyId)
      .eq('description', 'Chave Automatica Webhook')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (fetchError) {
      console.error('[rotateInboundWebhookToken] Falha ao consultar chaves automáticas:', fetchError.message)
      return { success: false, error: 'Falha ao consultar chaves de webhook.' }
    }

    let finalToken = generatedKey

    if (existingAutoKeys && existingAutoKeys.length > 0) {
      // 4. ATUALIZAÇÃO ATÔMICA IN-PLACE:
      // O token existente é atualizado sem deleção prévia. Se o update falhar, o token antigo permanece intacto.
      const targetKey = existingAutoKeys[0]
      const { data: updatedKey, error: updateError } = await adminSupabase
        .from('api_keys')
        .update({
          key: generatedKey
        })
        .eq('id', targetKey.id)
        .eq('company_id', companyId)
        .select('key')
        .single()

      if (updateError) {
        console.error('[rotateInboundWebhookToken] Falha ao atualizar chave (token anterior preservado):', updateError.message)
        return { success: false, error: 'Falha ao atualizar token de webhook.' }
      }

      finalToken = updatedKey?.key || generatedKey

      // 5. Limpeza de registros duplicados remanescentes de rotações concorrentes anteriores (se houver)
      if (existingAutoKeys.length > 1) {
        const extraIds = existingAutoKeys.slice(1).map((k: { id: string }) => k.id)
        const { error: pruneErr } = await adminSupabase
          .from('api_keys')
          .delete()
          .in('id', extraIds)
          .eq('company_id', companyId)
          .eq('description', 'Chave Automatica Webhook')

        if (pruneErr) {
          console.warn('[rotateInboundWebhookToken] Advertência na limpeza de chaves duplicadas:', pruneErr.message)
        }
      }
    } else {
      // 6. Caso o tenant ainda não possua nenhuma chave automática cadastrada
      const { data: newKey, error: insertError } = await adminSupabase
        .from('api_keys')
        .insert({
          company_id: companyId,
          key: generatedKey,
          description: 'Chave Automatica Webhook'
        })
        .select('key')
        .single()

      if (insertError) {
        // Se colidir com o índice único parcial em concorrência de inicialização, busca a chave vencedora
        if (insertError.code === '23505' || (insertError.message && insertError.message.includes('unique'))) {
          const { data: winnerKey } = await adminSupabase
            .from('api_keys')
            .select('key')
            .eq('company_id', companyId)
            .eq('description', 'Chave Automatica Webhook')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (winnerKey?.key) {
            return { success: true, token: winnerKey.key }
          }
        }
        console.error('[rotateInboundWebhookToken] Falha ao persistir nova chave:', insertError.message)
        return { success: false, error: 'Falha ao registrar novo token.' }
      }

      finalToken = newKey?.key || generatedKey
    }

    // Logging seguro sem expor tokens
    console.log(`[rotateInboundWebhookToken] Token de webhook rotacionado com sucesso para company:${companyId}`)

    try {
      revalidatePath('/integrations')
    } catch {
      // Ignora erro fora de contexto Next.js
    }

    return { success: true, token: finalToken }
  } catch (err: any) {
    const safeMessage = err.message ? err.message.replace(/ell_[a-f0-9]{24}/gi, '[REDACTED]') : 'Erro inesperado ao renovar token.'
    console.error('[rotateInboundWebhookToken] Erro inesperado:', safeMessage)
    return { success: false, error: safeMessage }
  }
}

/**
 * Módulo interno: consulta a configuração da integração n8n para a empresa autenticada.
 * O segredo é mascarado antes do envio ao cliente.
 */
export async function getN8nIntegrationInternal(options?: IntegrationInternalOptions) {
  const supabase = resolveSupabase(options)
  const session = await resolveAdminSession(supabase)
  if (!session.ok) return null

  const companyId = session.companyId

  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'n8n')
    .maybeSingle()

  if (error) {
    console.error('[getN8nIntegration] Erro ao carregar integração:', error.message)
    return null
  }

  if (data) {
    // Mascara o segredo para segurança do cliente
    if (data.credentials?.webhook_secret) {
      data.credentials.webhook_secret = '••••••••••••••••'
    }
  }

  return data
}

/**
 * Módulo interno: salva ou atualiza a integração com o n8n.
 */
export async function saveN8nIntegrationInternal(
  url: string, 
  secret: string, 
  options?: IntegrationInternalOptions
): Promise<{ success: boolean; error?: string; code?: string }> {
  try {
    const supabase = resolveSupabase(options)
    const session = await resolveAdminSession(supabase)
    if (!session.ok) {
      return { success: false, error: session.error }
    }

    const companyId = session.companyId

    // 0. Validação de ciclo de vida do tenant (Fail-closed)
    try {
      await requireActiveCompany(companyId, { adminClient: options?.adminClient })
    } catch (err: any) {
      return { 
        success: false, 
        error: err.message, 
        code: err.code || 'TENANT_NOT_ACTIVE' 
      }
    }

    // 1. Busca integração existente para preservar segredo já cadastrado caso mascarado
    const { data: existing, error: selectErr } = await supabase
      .from('integrations')
      .select('id, credentials')
      .eq('company_id', companyId)
      .eq('type', 'n8n')
      .maybeSingle()

    if (selectErr) {
      return { success: false, error: `Erro ao verificar integração existente: ${selectErr.message}` }
    }

    const finalSecret = secret === '••••••••••••••••' && existing?.credentials?.webhook_secret 
      ? existing.credentials.webhook_secret 
      : secret

    // 2. Executa o teste de conexão protegido pelo módulo interno
    const testResult = await testN8nConnectionInternal(url, finalSecret)
    if (!testResult.success) {
      return { success: false, error: testResult.message }
    }

    // 3. Persistência com isolamento garantido por company_id
    if (existing) {
      const { error: updateError } = await supabase
        .from('integrations')
        .update({
          config: { webhook_url: url },
          credentials: { webhook_secret: finalSecret },
          status: 'active',
          name: 'n8n Workflow',
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .eq('company_id', companyId) // Isolamento estrito de tenant

      if (updateError) {
        return { success: false, error: `Erro ao atualizar integração: ${updateError.message}` }
      }
    } else {
      const { error: insertError } = await supabase
        .from('integrations')
        .insert({
          company_id: companyId,
          type: 'n8n',
          name: 'n8n Workflow',
          status: 'active',
          config: { webhook_url: url },
          credentials: { webhook_secret: finalSecret }
        })

      if (insertError) {
        return { success: false, error: `Erro ao salvar integração: ${insertError.message}` }
      }
    }

    try {
      revalidatePath('/integrations')
    } catch {
      // Ignora erro fora de contexto Next.js
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro inesperado ao salvar integração.' }
  }
}

/**
 * Módulo interno: desconecta a integração n8n da empresa autenticada.
 */
export async function disconnectN8nInternal(
  options?: IntegrationInternalOptions
): Promise<{ success: boolean; error?: string; code?: string }> {
  try {
    const supabase = resolveSupabase(options)
    const session = await resolveAdminSession(supabase)
    if (!session.ok) {
      return { success: false, error: session.error }
    }

    const companyId = session.companyId

    // 0. Validação de ciclo de vida do tenant (Fail-closed)
    try {
      await requireActiveCompany(companyId, { adminClient: options?.adminClient })
    } catch (err: any) {
      return { 
        success: false, 
        error: err.message, 
        code: err.code || 'TENANT_NOT_ACTIVE' 
      }
    }

    // 1. Exclusão segura vinculada ao tenant autenticado
    const { error: deleteError } = await supabase
      .from('integrations')
      .delete()
      .eq('company_id', companyId)
      .eq('type', 'n8n')

    if (deleteError) {
      return { success: false, error: `Erro ao desconectar: ${deleteError.message}` }
    }

    try {
      revalidatePath('/integrations')
    } catch {
      // Ignora erro fora de contexto Next.js
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao desconectar.' }
  }
}
