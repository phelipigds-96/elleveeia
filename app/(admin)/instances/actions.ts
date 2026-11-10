'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/service'
import { requirePlatformAdmin } from '@/lib/services/platform/admin'
import {
  getGlobalEvolutionConfig,
  saveGlobalEvolutionConfig,
  fetchServerInstances,
  createEvolutionInstanceOnServer,
  deleteEvolutionInstanceOnServer,
  getEvolutionWhatsAppStatus,
  getEvolutionWhatsAppQrCode,
  restartEvolutionWhatsApp,
  disconnectEvolutionWhatsApp,
} from '@/lib/services/whatsapp-evolution'

export interface CompanyInstanceItem {
  companyId: string
  companyName: string
  companySlug: string
  companyPlan: string
  instanceName: string
  hasIntegration: boolean
  isDedicatedServer: boolean
  customApiUrl?: string
  status: 'open' | 'connecting' | 'close' | 'disconnected' | 'not_created' | 'unassigned'
  phoneNumber?: string
  profileName?: string
  lastConnectedAt?: string | null
}

export interface AdminInstancesOverview {
  globalConfig: {
    apiUrl: string
    apiKey: string
    isConfigured: boolean
  }
  serverStatus: {
    online: boolean
    totalServerInstances: number
    error?: string
  }
  companies: CompanyInstanceItem[]
}

/**
 * Obtém a visão geral de instâncias da plataforma para o SuperAdmin.
 */
export async function getAdminInstancesDataAction(): Promise<AdminInstancesOverview> {
  await requirePlatformAdmin()
  const adminClient = createAdminClient()

  // 1. Configuração global da Evolution
  const globalConfig = await getGlobalEvolutionConfig()

  // 2. Tenta listar instâncias ativas direto no servidor da Evolution API
  let serverOnline = false
  let serverInstancesMap = new Map<string, any>()
  let serverError: string | undefined

  if (globalConfig.isConfigured) {
    const serverRes = await fetchServerInstances({
      apiUrl: globalConfig.apiUrl,
      apiKey: globalConfig.apiKey,
    })
    if (serverRes.success) {
      serverOnline = true
      serverRes.instances.forEach((inst: any) => {
        const name = inst.name || inst.instanceName || inst.instance?.instanceName
        if (name) {
          serverInstancesMap.set(String(name).toLowerCase(), inst)
        }
      })
    } else {
      serverError = serverRes.error
    }
  }

  // 3. Busca todas as empresas cadastradas
  const { data: companies, error: compErr } = await adminClient
    .from('companies')
    .select('id, name, slug, plan, created_at')
    .order('name', { ascending: true })

  if (compErr) {
    throw new Error(`Falha ao buscar empresas: ${compErr.message}`)
  }

  // 4. Busca integrações de WhatsApp cadastradas
  const { data: integrations, error: intErr } = await adminClient
    .from('integrations')
    .select('id, company_id, config, credentials, status, last_connected_at')
    .eq('type', 'whatsapp_evolution')

  const integrationsByCompany = new Map<string, any>()
  if (integrations) {
    integrations.forEach((item) => {
      integrationsByCompany.set(item.company_id, item)
    })
  }

  // 5. Monta a lista unificada
  const items: CompanyInstanceItem[] = (companies || []).map((comp) => {
    const integ = integrationsByCompany.get(comp.id)
    const instanceName = (integ?.config?.instance_name || '').trim()
    const customApiUrl = integ?.config?.api_url
    const isDedicatedServer = Boolean(customApiUrl && customApiUrl !== globalConfig.apiUrl)

    let status: CompanyInstanceItem['status'] = 'unassigned'
    let phoneNumber: string | undefined
    let profileName: string | undefined

    if (!instanceName) {
      status = 'unassigned'
    } else if (!serverOnline) {
      // Se o servidor estiver offline ou não configurado
      status = 'disconnected'
    } else {
      // Procura a instância no mapa retornado pela Evolution API
      const liveInst = serverInstancesMap.get(instanceName.toLowerCase())
      if (!liveInst) {
        status = 'not_created'
      } else {
        const rawState = (
          liveInst.connectionStatus ||
          liveInst.state ||
          liveInst.instance?.state ||
          liveInst.status ||
          'close'
        ).toLowerCase()

        if (rawState === 'open' || rawState === 'connected') {
          status = 'open'
        } else if (rawState === 'connecting') {
          status = 'connecting'
        } else {
          status = 'close'
        }

        phoneNumber = liveInst.owner || liveInst.number || liveInst.phone || liveInst.instance?.owner
        profileName = liveInst.profileName || liveInst.name || liveInst.instance?.profileName
      }
    }

    return {
      companyId: comp.id,
      companyName: comp.name,
      companySlug: comp.slug,
      companyPlan: comp.plan || 'Starter',
      instanceName,
      hasIntegration: Boolean(integ),
      isDedicatedServer,
      customApiUrl,
      status,
      phoneNumber,
      profileName,
      lastConnectedAt: integ?.last_connected_at,
    }
  })

  return {
    globalConfig,
    serverStatus: {
      online: serverOnline,
      totalServerInstances: serverInstancesMap.size,
      error: serverError,
    },
    companies: items,
  }
}

/**
 * Salva as configurações globais da Evolution API.
 */
export async function saveGlobalEvolutionConfigAction(params: {
  apiUrl: string
  apiKey: string
}): Promise<{ success: boolean; error?: string }> {
  await requirePlatformAdmin()
  const res = await saveGlobalEvolutionConfig(params)
  revalidatePath('/instances')
  revalidatePath('/integrations')
  return res
}

/**
 * Testa a conexão com o servidor Evolution API.
 */
export async function testGlobalEvolutionConnectionAction(params: {
  apiUrl: string
  apiKey: string
}): Promise<{ success: boolean; totalInstances?: number; error?: string }> {
  await requirePlatformAdmin()
  const res = await fetchServerInstances(params)
  if (!res.success) {
    return { success: false, error: res.error }
  }
  return { success: true, totalInstances: res.instances.length }
}

/**
 * Vincula ou altera o nome da instância de uma empresa na tabela integrations.
 */
export async function linkCompanyInstanceAction(params: {
  companyId: string
  instanceName: string
  customApiUrl?: string
  customApiKey?: string
}): Promise<{ success: boolean; error?: string }> {
  await requirePlatformAdmin()
  const adminClient = createAdminClient()

  const cleanInstance = params.instanceName.trim()
  if (!cleanInstance) {
    return { success: false, error: 'O nome da instância não pode ser vazio.' }
  }

  const { data: existing } = await adminClient
    .from('integrations')
    .select('id, config, credentials')
    .eq('company_id', params.companyId)
    .eq('type', 'whatsapp_evolution')
    .maybeSingle()

  const configObj: any = {
    ...(existing?.config || {}),
    instance_name: cleanInstance,
  }
  if (params.customApiUrl?.trim()) {
    configObj.api_url = params.customApiUrl.trim().replace(/\/+$/, '')
  } else if (configObj.api_url && !params.customApiUrl) {
    // Remove custom url se deixado em branco
    delete configObj.api_url
  }

  const credentialsObj: any = {
    ...(existing?.credentials || {}),
  }
  if (params.customApiKey?.trim()) {
    credentialsObj.api_key = params.customApiKey.trim()
  } else if (credentialsObj.api_key && !params.customApiKey) {
    delete credentialsObj.api_key
  }

  if (existing) {
    const { error: updErr } = await adminClient
      .from('integrations')
      .update({
        status: 'active',
        config: configObj,
        credentials: credentialsObj,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (updErr) return { success: false, error: updErr.message }
  } else {
    const { error: insErr } = await adminClient
      .from('integrations')
      .insert({
        company_id: params.companyId,
        type: 'whatsapp_evolution',
        name: 'WhatsApp Evolution API',
        status: 'active',
        config: configObj,
        credentials: credentialsObj,
      })

    if (insErr) return { success: false, error: insErr.message }
  }

  revalidatePath('/instances')
  revalidatePath('/integrations')
  return { success: true }
}

/**
 * Desvincula a instância da empresa (remove integração).
 */
export async function unlinkCompanyInstanceAction(params: {
  companyId: string
}): Promise<{ success: boolean; error?: string }> {
  await requirePlatformAdmin()
  const adminClient = createAdminClient()

  const { error } = await adminClient
    .from('integrations')
    .delete()
    .eq('company_id', params.companyId)
    .eq('type', 'whatsapp_evolution')

  if (error) return { success: false, error: error.message }

  revalidatePath('/instances')
  revalidatePath('/integrations')
  return { success: true }
}

/**
 * Cria a instância fisicamente no servidor Evolution API e já a vincula à empresa.
 */
export async function createEvolutionInstanceAction(params: {
  companyId: string
  instanceName: string
  webhookUrl?: string
}): Promise<{ success: boolean; error?: string; data?: any }> {
  await requirePlatformAdmin()

  const cleanInstance = params.instanceName.trim()
  if (!cleanInstance) {
    return { success: false, error: 'Informe um nome para a instância.' }
  }

  // 1. Cria a instância no servidor Evolution
  const serverRes = await createEvolutionInstanceOnServer({
    instanceName: cleanInstance,
    webhookUrl: params.webhookUrl,
  })

  // Se retornou erro e não for "already exists"
  if (!serverRes.success) {
    const errorMsg = serverRes.error || ''
    const isAlreadyExists =
      errorMsg.toLowerCase().includes('already in use') ||
      errorMsg.toLowerCase().includes('already exists') ||
      errorMsg.toLowerCase().includes('409')

    if (!isAlreadyExists) {
      return { success: false, error: serverRes.error }
    }
  }

  // 2. Vincula à empresa
  const linkRes = await linkCompanyInstanceAction({
    companyId: params.companyId,
    instanceName: cleanInstance,
  })

  if (!linkRes.success) {
    return { success: false, error: `Instância criada na Evolution, mas falhou ao vincular: ${linkRes.error}` }
  }

  revalidatePath('/instances')
  revalidatePath('/integrations')
  return { success: true, data: serverRes.data }
}

/**
 * Exclui a instância fisicamente do servidor Evolution API.
 */
export async function deleteEvolutionInstanceFromServerAction(params: {
  companyId?: string
  instanceName: string
}): Promise<{ success: boolean; error?: string }> {
  await requirePlatformAdmin()

  const deleteRes = await deleteEvolutionInstanceOnServer({
    instanceName: params.instanceName,
  })

  if (!deleteRes.success) {
    return deleteRes
  }

  if (params.companyId) {
    await unlinkCompanyInstanceAction({ companyId: params.companyId })
  }

  revalidatePath('/instances')
  revalidatePath('/integrations')
  return { success: true }
}

/**
 * Obtém o QR Code da instância selecionada para o SuperAdmin visualizar ou auxiliar o cliente.
 */
export async function getInstanceQrCodeAction(companyId: string) {
  await requirePlatformAdmin()
  return await getEvolutionWhatsAppQrCode(companyId)
}

/**
 * Reinicia a instância do WhatsApp.
 */
export async function restartInstanceAction(companyId: string) {
  await requirePlatformAdmin()
  const res = await restartEvolutionWhatsApp(companyId)
  revalidatePath('/instances')
  return res
}

/**
 * Desconecta (logout) a instância do WhatsApp.
 */
export async function disconnectInstanceAction(companyId: string) {
  await requirePlatformAdmin()
  const res = await disconnectEvolutionWhatsApp(companyId)
  revalidatePath('/instances')
  return res
}
