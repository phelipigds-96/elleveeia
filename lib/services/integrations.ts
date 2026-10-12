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

  // 1. Busca chave existente para a empresa
  const { data: existingKey } = await supabase
    .from('api_keys')
    .select('key')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingKey?.key) {
    return { token: existingKey.key }
  }

  // 2. Se nao existir nenhuma, gera automaticamente
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
  } catch (err) {
    console.error('[getInboundWebhookInfo] Falha ao auto-gerar chave:', err)
    return null
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
