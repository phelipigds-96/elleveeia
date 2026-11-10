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

/**
 * Resolve as credenciais da Evolution API para o tenant.
 * Primeiro busca no ambiente (.env), com fallback ou customização por empresa no banco.
 */
async function resolveEvolutionContext() {
  let companyId: string | null = null

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

  const adminClient = createAdminClient()
  let instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'default'
  let apiUrl = process.env.EVOLUTION_API_URL || ''
  let apiKey = process.env.EVOLUTION_API_KEY || ''

  // Se tiver companyId, verifica se a empresa tem uma integração dedicada cadastrada
  if (companyId) {
    const { data: integration } = await adminClient
      .from('integrations')
      .select('config, credentials, status')
      .eq('company_id', companyId)
      .eq('type', 'whatsapp_evolution')
      .maybeSingle()

    if (integration) {
      if (integration.config?.instance_name) {
        instanceName = integration.config.instance_name
      }
      if (integration.config?.api_url) {
        apiUrl = integration.config.api_url
      }
      if (integration.credentials?.api_key) {
        apiKey = integration.credentials.api_key
      }
    }
  }

  return {
    companyId,
    apiUrl: apiUrl.trim().replace(/\/+$/, ''),
    apiKey: apiKey.trim(),
    instanceName: instanceName.trim(),
  }
}

/**
 * Consulta o status atual da conexão do WhatsApp na Evolution API.
 */
export async function getEvolutionWhatsAppStatus(): Promise<WhatsAppStatusResult> {
  const { apiUrl, apiKey, instanceName } = await resolveEvolutionContext()

  if (!apiUrl || !apiKey) {
    return {
      configured: false,
      state: 'not_configured',
      instanceName,
      error: 'Evolution API não configurada no ambiente do servidor.',
    }
  }

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
      // Se a instância não existe ainda, retorna desconectado
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

    // Tentar obter informações do perfil / número conectado
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
export async function getEvolutionWhatsAppQrCode(): Promise<WhatsAppQrCodeResult> {
  const { apiUrl, apiKey, instanceName } = await resolveEvolutionContext()

  if (!apiUrl || !apiKey) {
    return {
      success: false,
      state: 'disconnected',
      error: 'Evolution API não configurada no ambiente do servidor.',
    }
  }

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
export async function disconnectEvolutionWhatsApp(): Promise<{ success: boolean; error?: string }> {
  const { apiUrl, apiKey, instanceName } = await resolveEvolutionContext()

  if (!apiUrl || !apiKey) {
    return { success: false, error: 'Evolution API não configurada.' }
  }

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
export async function restartEvolutionWhatsApp(): Promise<{ success: boolean; error?: string }> {
  const { apiUrl, apiKey, instanceName } = await resolveEvolutionContext()

  if (!apiUrl || !apiKey) {
    return { success: false, error: 'Evolution API não configurada.' }
  }

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
