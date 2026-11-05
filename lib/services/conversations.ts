'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireActiveCompany } from '@/lib/services/platform/tenant-access'
import { sendManualMessageInternal, type SendMessageResult } from './conversations-internal'

export type { SendMessageResult }

export interface ConversationServiceOptions {
  supabaseClient?: any
  adminClient?: any
  limit?: number
  offset?: number
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim())
}

const ALLOWED_STATUSES = ['open', 'closed', 'human'] as const
type ConversationStatus = (typeof ALLOWED_STATUSES)[number]

interface ConversationAuthContext {
  userId: string
  companyId: string
  supabase: any
}

/**
 * Resolve a identidade, empresa e status de ciclo de vida do tenant
 * estritamente no servidor a partir da sessão autenticada.
 * 
 * Regras estritas:
 * 1. Não confia em parâmetros fornecidos pelo cliente/navegador para companyId ou userId.
 * 2. Valida o status do tenant através de requireActiveCompany (fail-closed se suspenso, cancelado ou inexistente).
 * 3. Retorna null em caso de falha de autenticação ou tenant inativo.
 */
async function getAuthConversationContext(
  options?: ConversationServiceOptions
): Promise<ConversationAuthContext | null> {
  let supabase: any
  try {
    supabase = options?.supabaseClient || createClient()
  } catch {
    supabase = options?.supabaseClient
  }

  if (!supabase) return null

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    const user = authData?.user
    if (authError || !user) return null

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !profile?.company_id) return null

    // Validar ciclo de vida do tenant (fail-closed se suspenso, cancelado ou inválido)
    await requireActiveCompany(profile.company_id, {
      adminClient: options?.adminClient
    })

    return {
      userId: user.id,
      companyId: profile.company_id,
      supabase
    }
  } catch {
    return null
  }
}

export async function getCompanyId(options?: ConversationServiceOptions): Promise<string | null> {
  const context = await getAuthConversationContext(options)
  return context?.companyId ?? null
}

export async function getConversations(
  filter = 'all',
  search = '',
  options?: ConversationServiceOptions
): Promise<any[]> {
  const context = await getAuthConversationContext(options)
  if (!context) return []

  const { supabase, companyId } = context

  const allowedFilters = ['all', 'open', 'closed', 'human']
  if (filter && !allowedFilters.includes(filter)) {
    return []
  }

  let matchedCustomerIds: string[] | null = null
  if (search && typeof search === 'string' && search.trim().length > 0) {
    const sanitized = search.trim().replace(/[%_\\]/g, '\\$&')
    const { data: matchedCustomers, error: custError } = await supabase
      .from('customers')
      .select('id')
      .eq('company_id', companyId)
      .or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
      .limit(100)

    if (custError || !matchedCustomers || matchedCustomers.length === 0) {
      return []
    }
    matchedCustomerIds = matchedCustomers.map((c: any) => c.id)
  }

  let query = supabase
    .from('conversations')
    .select('*, customers(*)')
    .eq('company_id', companyId)

  if (filter === 'open' || filter === 'closed' || filter === 'human') {
    query = query.eq('status', filter)
  }

  if (matchedCustomerIds !== null) {
    query = query.in('customer_id', matchedCustomerIds)
  }

  query = query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  // Bounded query: padrão 50, teto máximo rígido de 50 registros por consulta
  const safeLimit = Math.min(Math.max(1, options?.limit ?? 50), 50)
  if (options?.offset && options.offset > 0) {
    query = query.range(options.offset, options.offset + safeLimit - 1)
  } else {
    query = query.limit(safeLimit)
  }

  const { data, error } = await query

  if (error || !data) {
    console.error('Error fetching conversations:', error)
    return []
  }

  return data
}

export async function getConversation(
  id: string,
  options?: ConversationServiceOptions
): Promise<any | null> {
  if (!isValidUuid(id)) {
    return null
  }

  const context = await getAuthConversationContext(options)
  if (!context) return null

  const { supabase, companyId } = context

  const { data, error } = await supabase
    .from('conversations')
    .select('*, customers(*)')
    .eq('id', id.trim())
    .eq('company_id', companyId)
    .maybeSingle()

  if (error || !data) return null
  return data
}

export async function getMessages(
  conversationId: string,
  options?: ConversationServiceOptions
): Promise<any[]> {
  if (!isValidUuid(conversationId)) {
    return []
  }

  const context = await getAuthConversationContext(options)
  if (!context) return []

  const { supabase, companyId } = context
  const cleanId = conversationId.trim()

  // Defesa em profundidade: verificar que a conversa existe e pertence ao tenant
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', cleanId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (convError || !conv) {
    return []
  }

  const safeLimit = Math.min(Math.max(1, options?.limit ?? 100), 500)

  let query = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', cleanId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (options?.offset && options.offset > 0) {
    query = query.range(options.offset, options.offset + safeLimit - 1)
  } else {
    query = query.limit(safeLimit)
  }

  const { data, error } = await query
  if (error || !data) return []
  return data
}

export interface SendMessageOptions {
  clientMessageId?: string
  supabaseClient?: any
  adminClient?: any
  userId?: string
  companyId?: string
}

/**
 * Server Action pública de envio manual invocada pela interface.
 * 
 * Regras de segurança de identidade e isolamento de camada:
 * - Trata todos os parâmetros recebidos como dados não confiáveis do navegador.
 * - userId e companyId são ESTRITAMENTE derivados da sessão autenticada e do perfil consultado no servidor.
 * - Valores de companyId, userId ou adminClient passados externamente são sumariamente descartados.
 * - Aceita opcionalmente clientMessageId para proteção contra cliques duplos.
 * - A lógica interna privilegiada foi extraída para lib/services/conversations-internal.ts (módulo sem 'use server').
 */
export async function sendMessage(
  conversationId: string, 
  content: string,
  untrustedOptions?: SendMessageOptions
): Promise<SendMessageResult> {
  if (!content || !content.trim()) {
    return {
      success: false,
      error: 'O conteúdo da mensagem não pode ser vazio.',
      code: 'INVALID_CONTENT',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  let supabase: any
  try {
    supabase = untrustedOptions?.supabaseClient || createClient()
  } catch {
    supabase = untrustedOptions?.supabaseClient
  }

  if (!supabase) {
    return {
      success: false,
      error: 'Falha ao inicializar contexto de autenticação.',
      code: 'CLIENT_INIT_FAILED',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  // 1. Identidade do usuário: ESTRITAMENTE da sessão autenticada
  // Valores passados em untrustedOptions.userId são SUMARIAMENTE IGNORADOS
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData?.user
  if (authError || !user) {
    return {
      success: false,
      error: 'Usuário não autenticado.',
      code: 'UNAUTHORIZED',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }
  const authenticatedUserId = user.id

  // 2. Empresa do usuário: ESTRITAMENTE dos dados de perfil consultados no servidor
  // Valores passados em untrustedOptions.companyId são SUMARIAMENTE IGNORADOS
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', authenticatedUserId)
    .single()

  const authenticatedCompanyId = profile?.company_id
  if (profileError || !authenticatedCompanyId) {
    return {
      success: false,
      error: 'Empresa do usuário não identificada.',
      code: 'COMPANY_NOT_FOUND',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  // 3. Cliente administrativo: SEMPRE instanciado pelo servidor
  // untrustedOptions.adminClient NUNCA é aceito de chamadores externos
  const { createAdminClient } = await import('@/lib/supabase/service')
  const serverAdminClient = createAdminClient()

  const clientMessageId = typeof untrustedOptions?.clientMessageId === 'string' && untrustedOptions.clientMessageId.trim()
    ? untrustedOptions.clientMessageId.trim()
    : undefined

  // Delega para o serviço interno com identidade estritamente validada
  return sendManualMessageInternal(conversationId, content, {
    userId: authenticatedUserId,
    companyId: authenticatedCompanyId,
    clientMessageId,
    supabaseClient: supabase,
    adminClient: serverAdminClient
  })
}

export async function updateConversationStatus(
  conversationId: string,
  status: string,
  options?: ConversationServiceOptions
): Promise<boolean> {
  if (!isValidUuid(conversationId)) {
    return false
  }

  if (!ALLOWED_STATUSES.includes(status as ConversationStatus)) {
    return false
  }

  const context = await getAuthConversationContext(options)
  if (!context) return false

  const { supabase, companyId } = context
  const cleanId = conversationId.trim()

  const updateData: any = {
    status,
    updated_at: new Date().toISOString()
  }

  if (status === 'closed') {
    updateData.closed_at = new Date().toISOString()
  } else {
    updateData.closed_at = null
  }

  const { data, error } = await supabase
    .from('conversations')
    .update(updateData)
    .eq('id', cleanId)
    .eq('company_id', companyId)
    .select('id')

  if (error) {
    console.error('Error updating status:', error)
    return false
  }

  if (!data || data.length === 0) {
    return false
  }

  try {
    revalidatePath('/conversations')
  } catch {
    // revalidatePath pode falhar fora do contexto de requisição HTTP Next.js
  }

  return true
}

export async function markAsRead(
  conversationId: string,
  options?: ConversationServiceOptions
): Promise<boolean> {
  if (!isValidUuid(conversationId)) {
    return false
  }

  const context = await getAuthConversationContext(options)
  if (!context) return false

  const { supabase, companyId } = context
  const cleanId = conversationId.trim()

  const { data, error } = await supabase
    .from('conversations')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('id', cleanId)
    .eq('company_id', companyId)
    .select('id')

  if (error) {
    console.error('Error marking conversation as read:', error)
    return false
  }

  if (!data || data.length === 0) {
    return false
  }

  return true
}
