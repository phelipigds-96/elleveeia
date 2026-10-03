'use server'

import { createAdminClient } from '@/lib/supabase/service'

// Proteção Básica SSRF (Server-Side Request Forgery)
function isSafeUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    // Apenas HTTP/HTTPS
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    
    const hostname = url.hostname
    // Bloqueia IPs locais ou de metadados de nuvem comuns
    const forbiddenPatterns = [
      /^localhost$/,
      /^127\.\d+\.\d+\.\d+$/,
      /^10\.\d+\.\d+\.\d+$/,
      /^192\.168\.\d+\.\d+$/,
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,
      /^169\.254\.169\.254$/, // AWS / GCP Metadata
      /^::1$/
    ]
    return !forbiddenPatterns.some(pattern => pattern.test(hostname))
  } catch {
    return false
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(id)
    return response
  } catch (error) {
    clearTimeout(id)
    throw error
  }
}

export async function sendOutboundMessage(companyId: string, messagePayload: any) {
  const supabase = createAdminClient()
  
  // 1. Busca a integração n8n ativa da empresa
  const { data: integration } = await supabase.from('integrations')
    .select('*')
    .eq('company_id', companyId)
    .eq('type', 'n8n')
    .eq('status', 'active')
    .single()

  if (!integration || !integration.config?.webhook_url) {
    // Sem integração ativa, simplesmente ignora o disparo sem quebrar a plataforma
    return { success: false, reason: 'no_integration' }
  }

  const url = integration.config.webhook_url
  const secret = integration.credentials?.webhook_secret

  if (!isSafeUrl(url)) {
    await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', messagePayload.event_id, 'failed', 'Unsafe URL detected (SSRF Protection)')
    return { success: false, reason: 'unsafe_url' }
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    if (secret) {
      headers['x-ellevee-api-key'] = secret // Header padronizado para n8n validar
    }

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(messagePayload)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`)
    }

    // Sucesso - Registra auditoria e heartbeats
    await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', messagePayload.event_id, 'success')
    
    await supabase.from('integrations').update({
      last_connected_at: new Date().toISOString(),
      last_event_at: new Date().toISOString()
    }).eq('id', integration.id)

    return { success: true }

  } catch (error: any) {
    console.error(`[N8N Outbound Error] ${error.message}`)
    await logIntegrationEvent(supabase, companyId, integration.id, 'outbound', 'message.send', messagePayload.event_id, 'failed', error.message)
    return { success: false, reason: 'fetch_error', error: error.message }
  }
}

// Utilitário para log transacional
async function logIntegrationEvent(supabase: any, companyId: string, integrationId: string, direction: string, eventType: string, eventId: string, status: string, errorMessage?: string) {
  await supabase.from('integration_events').insert({
    company_id: companyId,
    integration_id: integrationId,
    direction,
    event_type: eventType,
    event_id: eventId,
    status,
    error_message: errorMessage || null
  })
}

// Endpoint interno usado pela tela de Integrações para validar a URL antes de salvar
export async function testN8nConnection(url: string, secret: string) {
  if (!isSafeUrl(url)) {
    return { success: false, message: 'URL bloqueada por políticas de segurança.' }
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (secret) headers['x-ellevee-api-key'] = secret

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_id: `test-${Date.now()}`,
        event_type: 'connection.test',
        timestamp: new Date().toISOString()
      })
    }, 5000)

    if (response.ok) {
      return { success: true, message: 'Conexão estabelecida com sucesso!' }
    } else {
      return { success: false, message: `O n8n retornou erro: HTTP ${response.status}` }
    }
  } catch (error: any) {
    return { success: false, message: `Falha ao alcançar o n8n: ${error.message}` }
  }
}
