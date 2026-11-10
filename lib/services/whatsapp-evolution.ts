import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/service'

export interface WhatsAppStatusResult {
  configured: boolean
  state: 'open' | 'connecting' | 'close' | 'disconnected' | 'not_configured'
  instanceName?: string
  phoneNumber?: string
  profileName?: string
  profilePictureUrl?: string
  error?: string
}

export interface WhatsAppQrCodeResult {
  success: boolean
  state: 'open' | 'connecting' | 'close' | 'disconnected'
  base64?: string
  pairingCode?: string
  error?: string
}

export interface GlobalEvolutionConfig {
  apiUrl: string
  apiKey: string
  isConfigured: boolean
}

/**
 * Busca a configuração global do servidor Evolution API.
 * 1. Procura na empresa do SuperAdmin ('ellevee-admin' ou nome '%Admin%')
 * 2. Fallback para variáveis de ambiente (EVOLUTION_API_URL, EVOLUTION_API_KEY)
 */
export async function getGlobalEvolutionConfig(): Promise<GlobalEvolutionConfig> {
  const adminClient = createAdminClient()
  let apiUrl = process.env.EVOLUTION_API_URL || ''
  let apiKey = process.env.EVOLUTION_API_KEY || ''

  try {
    // 1. Procura pela empresa Ellevee Admin
    const { data: adminCompany } = await adminClient
      .from('companies')
      .select('id')
      .or('slug.eq.ellevee-admin,name.ilike.%Admin%')
      .limit(1)
      .maybeSingle()

    if (adminCompany?.id) {
      const { data: integration } = await adminClient
        .from('integrations')
        .select('config, credentials')
        .eq('company_id', adminCompany.id)
        .eq('type', 'whatsapp_evolution')
        .maybeSingle()

      if (integration?.config?.api_url) {
        apiUrl = integration.config.api_url
      }
      if (integration?.credentials?.api_key) {
        apiKey = integration.credentials.api_key
      }
    }

    // Se ainda não achou no admin, tenta pegar de qualquer registro ativo com api_url
    if (!apiUrl || !apiKey) {
      const { data: anyIntegration } = await adminClient
        .from('integrations')
        .select('config, credentials')
        .eq('type', 'whatsapp_evolution')
        .not('config->api_url', 'is', null)
        .limit(1)
        .maybeSingle()

      if (anyIntegration?.config?.api_url && !apiUrl) {
        apiUrl = anyIntegration.config.api_url
      }
      if (anyIntegration?.credentials?.api_key && !apiKey) {
        apiKey = anyIntegration.credentials.api_key
      }
    }
  } catch (err) {
    console.warn('[WhatsAppEvolution] Falha ao consultar configuração global no banco:', err)
  }

  const cleanUrl = apiUrl.trim().replace(/\/+$/, '')
  const cleanKey = apiKey.trim()

  return {
    apiUrl: cleanUrl,
    apiKey: cleanKey,
    isConfigured: Boolean(cleanUrl && cleanKey),
  }
}

/**
 * Salva as configurações globais da Evolution API (SuperAdmin).
 * Vincula à empresa do SuperAdmin ('ellevee-admin').
 */
export async function saveGlobalEvolutionConfig(params: {
  apiUrl: string
  apiKey: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const adminClient = createAdminClient()
    const cleanUrl = params.apiUrl.trim().replace(/\/+$/, '')
    const cleanKey = params.apiKey.trim()

    if (!cleanUrl || !cleanKey) {
      return { success: false, error: 'URL e API Key da Evolution API são obrigatórias.' }
    }

    // 1. Localiza ou seleciona o ID da empresa admin
    let { data: adminCompany } = await adminClient
      .from('companies')
      .select('id')
      .or('slug.eq.ellevee-admin,name.ilike.%Admin%')
      .limit(1)
      .maybeSingle()

    if (!adminCompany?.id) {
      // Fallback: pega a primeira empresa existente
      const { data: firstCompany } = await adminClient
        .from('companies')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!firstCompany?.id) {
        return { success: false, error: 'Nenhuma empresa encontrada para associar a configuração global.' }
      }
      adminCompany = firstCompany
    }

    // 2. Salva na tabela integrations
    const { data: existing } = await adminClient
      .from('integrations')
      .select('id, config, credentials')
      .eq('company_id', adminCompany.id)
      .eq('type', 'whatsapp_evolution')
      .maybeSingle()

    if (existing) {
      const { error: updErr } = await adminClient
        .from('integrations')
        .update({
          status: 'active',
          config: {
            ...(existing.config || {}),
            api_url: cleanUrl,
          },
          credentials: {
            ...(existing.credentials || {}),
            api_key: cleanKey,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updErr) return { success: false, error: updErr.message }
    } else {
      const { error: insErr } = await adminClient
        .from('integrations')
        .insert({
          company_id: adminCompany.id,
          type: 'whatsapp_evolution',
          name: 'WhatsApp Evolution API (Global)',
          status: 'active',
          config: {
            api_url: cleanUrl,
            instance_name: 'default',
          },
          credentials: {
            api_key: cleanKey,
          },
        })

      if (insErr) return { success: false, error: insErr.message }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao salvar configuração global da Evolution API.' }
  }
}

/**
 * Resolve o contexto da Evolution API para um tenant específico ou para o usuário logado.
 */
export async function resolveEvolutionContext(targetCompanyId?: string) {
  let companyId: string | null = targetCompanyId || null

  if (!companyId) {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('company_id')
          .eq('id', user.id)
          .maybeSingle()

        if (profile?.company_id) {
          companyId = profile.company_id
        }
      }
    } catch (err) {
      console.warn('[WhatsAppEvolution] Falha ao obter usuário auth:', err)
    }
  }

  // 1. Obtém a configuração global do servidor
  const global = await getGlobalEvolutionConfig()
  let apiUrl = global.apiUrl
  let apiKey = global.apiKey
  let instanceName = ''
  let hasSpecificIntegration = false

  const adminClient = createAdminClient()

  // 2. Se temos companyId, busca a instância vinculada à empresa
  if (companyId) {
    const { data: integration } = await adminClient
      .from('integrations')
      .select('config, credentials, status')
      .eq('company_id', companyId)
      .eq('type', 'whatsapp_evolution')
      .maybeSingle()

    if (integration) {
      hasSpecificIntegration = true
      if (integration.config?.instance_name) {
        instanceName = integration.config.instance_name
      }
      // Se a empresa tiver uma URL ou chave própria (dedicada), sobrepõe a global
      if (integration.config?.api_url) {
        apiUrl = integration.config.api_url
      }
      if (integration.credentials?.api_key) {
        apiKey = integration.credentials.api_key
      }
    }
  }

  const isConfigured = Boolean(apiUrl && apiKey && instanceName)

  return {
    companyId,
    apiUrl: apiUrl.trim().replace(/\/+$/, ''),
    apiKey: apiKey.trim(),
    instanceName: instanceName.trim(),
    isConfigured,
    hasSpecificIntegration,
  }
}

/**
 * Retorna as configurações atuais da Evolution API (compatibilidade legada).
 */
export async function getEvolutionConfig() {
  const ctx = await resolveEvolutionContext()
  return {
    apiUrl: ctx.apiUrl,
    apiKey: ctx.apiKey,
    instanceName: ctx.instanceName,
    isConfigured: ctx.isConfigured,
  }
}

/**
 * Salva as configurações da Evolution API para a empresa (SuperAdmin ou legada).
 */
export async function saveEvolutionConfig(params: {
  apiUrl: string
  apiKey: string
  instanceName?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Usuário não autenticado.' }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) {
      return { success: false, error: 'Perfil de empresa não localizado.' }
    }

    const companyId = profile.company_id
    const adminClient = createAdminClient()

    const cleanUrl = params.apiUrl.trim().replace(/\/+$/, '')
    const cleanKey = params.apiKey.trim()
    const cleanInstance = params.instanceName?.trim() || 'default'

    if (!cleanUrl || !cleanKey) {
      return { success: false, error: 'URL e API Key da Evolution API são obrigatórias.' }
    }

    const { data: existing } = await adminClient
      .from('integrations')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', 'whatsapp_evolution')
      .maybeSingle()

    if (existing) {
      const { error: updErr } = await adminClient
        .from('integrations')
        .update({
          status: 'active',
          config: {
            api_url: cleanUrl,
            instance_name: cleanInstance,
          },
          credentials: {
            api_key: cleanKey,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updErr) {
        return { success: false, error: `Falha ao atualizar: ${updErr.message}` }
      }
    } else {
      const { error: insErr } = await adminClient
        .from('integrations')
        .insert({
          company_id: companyId,
          type: 'whatsapp_evolution',
          name: 'WhatsApp Evolution API',
          status: 'active',
          config: {
            api_url: cleanUrl,
            instance_name: cleanInstance,
          },
          credentials: {
            api_key: cleanKey,
          },
        })

      if (insErr) {
        return { success: false, error: `Falha ao salvar: ${insErr.message}` }
      }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao salvar configuração da Evolution API.' }
  }
}

/**
 * Consulta o status atual da conexão do WhatsApp na Evolution API.
 */
export async function getEvolutionWhatsAppStatus(targetCompanyId?: string): Promise<WhatsAppStatusResult> {
  const ctx = await resolveEvolutionContext(targetCompanyId)

  if (!ctx.apiUrl || !ctx.apiKey) {
    return {
      configured: false,
      state: 'not_configured',
      instanceName: ctx.instanceName,
      error: 'Evolution API não configurada no ambiente do servidor.',
    }
  }

  if (!ctx.instanceName) {
    return {
      configured: false,
      state: 'not_configured',
      instanceName: '',
      error: 'Instância do WhatsApp aguardando vinculação pelo administrador.',
    }
  }

  const { apiUrl, apiKey, instanceName } = ctx

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 404) {
        return {
          configured: true,
          state: 'disconnected',
          instanceName,
        }
      }
      return {
        configured: true,
        state: 'disconnected',
        instanceName,
        error: `Evolution API retornou status HTTP ${response.status}`,
      }
    }

    const data = await response.json()
    const rawState = (data?.instance?.state || data?.state || data?.status || 'close').toLowerCase()

    let normalizedState: 'open' | 'connecting' | 'close' | 'disconnected' = 'disconnected'
    if (rawState === 'open' || rawState === 'connected') {
      normalizedState = 'open'
    } else if (rawState === 'connecting') {
      normalizedState = 'connecting'
    }

    let phoneNumber: string | undefined
    let profileName: string | undefined
    let profilePictureUrl: string | undefined

    if (normalizedState === 'open') {
      try {
        const fetchController = new AbortController()
        const fetchTimeout = setTimeout(() => fetchController.abort(), 4000)

        const fetchRes = await fetch(`${apiUrl}/instance/fetchInstances?instanceName=${instanceName}`, {
          headers: { apikey: apiKey },
          signal: fetchController.signal,
          cache: 'no-store',
        })
        clearTimeout(fetchTimeout)

        if (fetchRes.ok) {
          const fetchList = await fetchRes.json()
          const instData = Array.isArray(fetchList)
            ? fetchList.find((i: any) => i.name === instanceName || i.instanceName === instanceName)
            : fetchList?.instance

          if (instData) {
            phoneNumber = instData.owner || instData.number || instData.phone
            profileName = instData.profileName || instData.name
            profilePictureUrl = instData.profilePictureUrl
          }
        }
      } catch (e) {
        // Ignora erro secundário de detalhes
      }
    }

    return {
      configured: true,
      state: normalizedState,
      instanceName,
      phoneNumber,
      profileName,
      profilePictureUrl,
    }
  } catch (err: any) {
    console.error('[WhatsAppEvolution] Erro ao consultar connectionState:', err)
    return {
      configured: true,
      state: 'disconnected',
      instanceName,
      error: err?.message || 'Falha ao conectar com a Evolution API.',
    }
  }
}

/**
 * Solicita a geração do QR Code para conexão do WhatsApp na Evolution API.
 */
export async function getEvolutionWhatsAppQrCode(targetCompanyId?: string): Promise<WhatsAppQrCodeResult> {
  const ctx = await resolveEvolutionContext(targetCompanyId)

  if (!ctx.apiUrl || !ctx.apiKey) {
    return {
      success: false,
      state: 'disconnected',
      error: 'Evolution API não configurada no servidor. Contate o suporte.',
    }
  }

  if (!ctx.instanceName) {
    return {
      success: false,
      state: 'disconnected',
      error: 'Instância do WhatsApp não configurada para sua empresa. Contate o suporte.',
    }
  }

  const { apiUrl, apiKey, instanceName } = ctx

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)

    const response = await fetch(`${apiUrl}/instance/connect/${instanceName}`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        success: false,
        state: 'disconnected',
        error: `Falha ao gerar QR Code (HTTP ${response.status}).`,
      }
    }

    const data = await response.json()

    // Se já estiver conectado
    const state = (data?.instance?.state || data?.state || '').toLowerCase()
    if (state === 'open' || state === 'connected') {
      return {
        success: true,
        state: 'open',
      }
    }

    let base64 = data?.base64 || data?.qrcode?.base64 || data?.code
    if (base64 && !base64.startsWith('data:')) {
      base64 = `data:image/png;base64,${base64}`
    }

    const pairingCode = data?.pairingCode || data?.qrcode?.pairingCode

    if (!base64 && !pairingCode) {
      return {
        success: false,
        state: 'disconnected',
        error: 'O servidor não retornou imagem de QR Code válida.',
      }
    }

    return {
      success: true,
      state: 'connecting',
      base64,
      pairingCode,
    }
  } catch (err: any) {
    console.error('[WhatsAppEvolution] Erro ao gerar connect/QR Code:', err)
    return {
      success: false,
      state: 'disconnected',
      error: err?.message || 'Falha ao obter QR Code da Evolution API.',
    }
  }
}

/**
 * Desconecta (logout) a instância de WhatsApp na Evolution API.
 */
export async function disconnectEvolutionWhatsApp(targetCompanyId?: string): Promise<{ success: boolean; error?: string }> {
  const ctx = await resolveEvolutionContext(targetCompanyId)

  if (!ctx.apiUrl || !ctx.apiKey || !ctx.instanceName) {
    return { success: false, error: 'Evolution API não configurada.' }
  }

  const { apiUrl, apiKey, instanceName } = ctx

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(`${apiUrl}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: {
        apikey: apiKey,
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { success: false, error: `Falha ao desconectar (HTTP ${response.status}).` }
    }

    return { success: true }
  } catch (err: any) {
    console.error('[WhatsAppEvolution] Erro ao desconectar:', err)
    return { success: false, error: err?.message || 'Erro ao desconectar WhatsApp.' }
  }
}

/**
 * Reinicia a instância do WhatsApp na Evolution API para destravar conexões.
 */
export async function restartEvolutionWhatsApp(targetCompanyId?: string): Promise<{ success: boolean; error?: string }> {
  const ctx = await resolveEvolutionContext(targetCompanyId)

  if (!ctx.apiUrl || !ctx.apiKey || !ctx.instanceName) {
    return { success: false, error: 'Evolution API não configurada.' }
  }

  const { apiUrl, apiKey, instanceName } = ctx

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(`${apiUrl}/instance/restart/${instanceName}`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { success: false, error: `Falha ao reiniciar (HTTP ${response.status}).` }
    }

    return { success: true }
  } catch (err: any) {
    console.error('[WhatsAppEvolution] Erro ao reiniciar:', err)
    return { success: false, error: err?.message || 'Erro ao reiniciar WhatsApp.' }
  }
}

/**
 * Lista todas as instâncias existentes no servidor Evolution API.
 */
export async function fetchServerInstances(params?: { apiUrl?: string; apiKey?: string }): Promise<{
  success: boolean
  instances: any[]
  error?: string
}> {
  const global = await getGlobalEvolutionConfig()
  const apiUrl = params?.apiUrl || global.apiUrl
  const apiKey = params?.apiKey || global.apiKey

  if (!apiUrl || !apiKey) {
    return { success: false, instances: [], error: 'Servidor Evolution API não configurado.' }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(`${apiUrl}/instance/fetchInstances`, {
      method: 'GET',
      headers: {
        apikey: apiKey,
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { success: false, instances: [], error: `Servidor retornou HTTP ${response.status}` }
    }

    const data = await response.json()
    const list = Array.isArray(data) ? data : data?.instances || []
    return { success: true, instances: list }
  } catch (err: any) {
    return { success: false, instances: [], error: err?.message || 'Falha ao buscar instâncias do servidor.' }
  }
}

/**
 * Cria uma nova instância na Evolution API via POST /instance/create.
 */
export async function createEvolutionInstanceOnServer(params: {
  instanceName: string
  webhookUrl?: string
  apiUrl?: string
  apiKey?: string
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const global = await getGlobalEvolutionConfig()
  const apiUrl = (params.apiUrl || global.apiUrl).trim().replace(/\/+$/, '')
  const apiKey = (params.apiKey || global.apiKey).trim()
  const cleanInstance = params.instanceName.trim()

  if (!apiUrl || !apiKey) {
    return { success: false, error: 'URL ou API Key da Evolution API não configuradas.' }
  }
  if (!cleanInstance) {
    return { success: false, error: 'Nome da instância não pode ser vazio.' }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const defaultWebhook = appUrl ? `${appUrl.replace(/\/+$/, '')}/api/webhooks/messages` : ''
    const webhookUrl = params.webhookUrl || defaultWebhook

    const bodyPayload: any = {
      instanceName: cleanInstance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }

    if (webhookUrl) {
      bodyPayload.webhook = webhookUrl
      bodyPayload.webhook_by_events = false
      bodyPayload.events = [
        'MESSAGES_UPSERT',
        'CONNECTION_UPDATE',
      ]
    }

    const response = await fetch(`${apiUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const msg = data?.message || data?.error || `HTTP ${response.status}`
      return { success: false, error: `Erro na criação: ${Array.isArray(msg) ? msg.join(', ') : msg}` }
    }

    return { success: true, data }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao contatar a Evolution API.' }
  }
}

/**
 * Deleta uma instância na Evolution API via DELETE /instance/delete/:instanceName.
 */
export async function deleteEvolutionInstanceOnServer(params: {
  instanceName: string
  apiUrl?: string
  apiKey?: string
}): Promise<{ success: boolean; error?: string }> {
  const global = await getGlobalEvolutionConfig()
  const apiUrl = (params.apiUrl || global.apiUrl).trim().replace(/\/+$/, '')
  const apiKey = (params.apiKey || global.apiKey).trim()
  const cleanInstance = params.instanceName.trim()

  if (!apiUrl || !apiKey || !cleanInstance) {
    return { success: false, error: 'Parâmetros insuficientes para exclusão.' }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(`${apiUrl}/instance/delete/${cleanInstance}`, {
      method: 'DELETE',
      headers: { apikey: apiKey },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { success: false, error: `Falha ao deletar (HTTP ${response.status}).` }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao deletar instância na Evolution API.' }
  }
}
