'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'
import { getCompanyId } from '@/lib/services/conversations'
import { testN8nConnection } from '@/lib/services/n8n-service'

export async function getInboundWebhookInfo() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return null

  // 1. Busca primeiro a chave automática mais recente da empresa
  const { data: autoKey } = await supabase
    .from('api_keys')
    .select('key')
    .eq('company_id', companyId)
    .eq('description', 'Chave Automatica Webhook')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (autoKey?.key) {
    return { token: autoKey.key }
  }

  // 2. Fallback: Se não houver chave com descrição automática, busca qualquer chave existente da empresa
  const { data: fallbackKey } = await supabase
    .from('api_keys')
    .select('key')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fallbackKey?.key) {
    return { token: fallbackKey.key }
  }

  // 3. Se não existir nenhuma, gera automaticamente
  try {
    const adminSupabase = createAdminClient()
    const generatedKey = 'ell_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    const { data: newKey } = await adminSupabase
      .from('api_keys')
      .insert({
        company_id: companyId,
        key: generatedKey,
        description: 'Chave Automatica Webhook'
      })
      .select('key')
      .single()

    return { token: newKey?.key || generatedKey }
  } catch (err: any) {
    console.error('[getInboundWebhookInfo] Falha ao auto-gerar chave:', err.message)
    return null
  }
}

/**
 * Rotaciona de forma segura o token de entrada do Webhook.
 * Invalida exclusivamente as chaves automáticas da empresa autenticada,
 * preservando integrações manuais e sem alterar a configuração de saída n8n.
 */
export async function rotateInboundWebhookToken(): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const companyId = await getCompanyId()
    if (!companyId) {
      return { success: false, error: 'Sessão expirada ou não autorizado.' }
    }

    const adminSupabase = createAdminClient()

    // 1. Gera novo token no padrão ell_ seguido de 24 hexadecimais
    const generatedKey = 'ell_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)

    // 2. Invalida somente as chaves automáticas anteriores desta empresa
    const { error: deleteError } = await adminSupabase
      .from('api_keys')
      .delete()
      .eq('company_id', companyId)
      .eq('description', 'Chave Automatica Webhook')

    if (deleteError) {
      console.error('[rotateInboundWebhookToken] Falha ao invalidar token anterior:', deleteError.message)
      return { success: false, error: 'Falha ao invalidar token anterior.' }
    }

    // 3. Persiste a nova chave
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
      console.error('[rotateInboundWebhookToken] Falha ao persistir nova chave:', insertError.message)
      return { success: false, error: 'Falha ao registrar novo token.' }
    }

    // Logging seguro sem expor tokens
    console.log(`[rotateInboundWebhookToken] Token de webhook rotacionado com sucesso para company:${companyId}`)

    revalidatePath('/integrations')
    return { success: true, token: newKey?.key || generatedKey }
  } catch (err: any) {
    console.error('[rotateInboundWebhookToken] Erro inesperado:', err.message)
    return { success: false, error: err.message || 'Erro inesperado ao renovar token.' }
  }
}

export async function getN8nIntegration() {
  const supabase = createClient()
  const companyId = await getCompanyId()
  if (!companyId) return null

  const { data } = await supabase.from('integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'n8n')
    .single()

  if (data) {
    // Hide secret
    if (data.credentials?.webhook_secret) {
      data.credentials.webhook_secret = '••••••••••••••••'
    }
  }

  return data
}

export async function saveN8nIntegration(url: string, secret: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const companyId = await getCompanyId()
    if (!companyId) return { success: false, error: 'Sessão expirada. Faça login novamente.' }

    // Executa o teste de conexão antes de persistir
    const testResult = await testN8nConnection(url, secret)
    if (!testResult.success) {
      return { success: false, error: testResult.message }
    }

    const { data: existing } = await supabase.from('integrations')
      .select('id, credentials')
      .eq('company_id', companyId)
      .eq('type', 'n8n')
      .single()

    const finalSecret = secret === '••••••••••••••••' && existing?.credentials?.webhook_secret 
      ? existing.credentials.webhook_secret 
      : secret

    if (existing) {
      const { error: updateError } = await supabase.from('integrations').update({
        config: { webhook_url: url },
        credentials: { webhook_secret: finalSecret },
        status: 'active',
        name: 'n8n Workflow',
        updated_at: new Date().toISOString()
      }).eq('id', existing.id)

      if (updateError) {
        return { success: false, error: `Erro ao atualizar integração: ${updateError.message}` }
      }
    } else {
      const { error: insertError } = await supabase.from('integrations').insert({
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

    revalidatePath('/integrations')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro inesperado ao salvar integração.' }
  }
}

export async function disconnectN8n(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const companyId = await getCompanyId()
    if (!companyId) return { success: false, error: 'Sessão expirada. Faça login novamente.' }

    const { error: deleteError } = await supabase.from('integrations')
      .delete()
      .eq('company_id', companyId)
      .eq('type', 'n8n')

    if (deleteError) {
      return { success: false, error: `Erro ao desconectar: ${deleteError.message}` }
    }

    revalidatePath('/integrations')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao desconectar.' }
  }
}
