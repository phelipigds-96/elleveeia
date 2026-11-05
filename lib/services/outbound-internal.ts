import 'server-only'
import { createAdminClient } from '@/lib/supabase/service'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim())
}

export const SUPPORTED_OUTBOUND_CHANNELS = ['whatsapp', 'instagram', 'chat', 'web', 'email'] as const
export type SupportedOutboundChannel = typeof SUPPORTED_OUTBOUND_CHANNELS[number]

export const MAX_IDEMPOTENCY_KEY_LENGTH = 128
export const MAX_CONTENT_LENGTH = 65536
export const MAX_PAYLOAD_BYTES = 262144
export const MAX_METADATA_BYTES = 65536
export const MAX_RECIPIENT_LENGTH = 64

export type OutboundSenderType = 'agent' | 'human' | 'system'

export interface PrepareOutboundMessageParams {
  companyId: string
  conversationId: string
  content: string
  senderType: OutboundSenderType
  idempotencyKey: string
  senderId?: string | null
  messageType?: string
  metadata?: Record<string, any> | null
  channel?: string | null
  recipient?: string | null
  payload?: Record<string, any> | null
}

export type PrepareOutboundMessageResult =
  | {
      success: true
      duplicate: false
      messageId: string
      outboxId: string
      status: string
    }
  | {
      success: true
      duplicate: true
      messageId: string
      outboxId: string
      status: string
    }
  | {
      success: false
      error: string
      code: string
      messageId?: undefined
      outboxId?: undefined
    }

/**
 * Prepara atomicamente uma mensagem de saída na tabela `messages` e seu respectivo registro
 * na tabela `message_outbox` em uma única transação no PostgreSQL.
 * 
 * Regras de Arquitetura:
 * - Server-only: nunca exposto diretamente ao cliente.
 * - Não efetua chamadas externas (n8n, Evolution API, WhatsApp).
 * - Valida tenant ativo, propriedade da conversa e deduplicação estrita por idempotencyKey.
 * - Suporta tanto mensagens de IA (agent), humanas (human) quanto de sistema (system).
 * - Concorrência segura (ACID): previne SQLSTATE 23505 e garante consistência em requisições paralelas.
 * - Verificação de identidade e limites prévios de tamanho.
 */
export async function prepareOutboundMessage(
  params: PrepareOutboundMessageParams,
  options?: { adminClient?: any }
): Promise<PrepareOutboundMessageResult> {
  const {
    companyId,
    conversationId,
    content,
    senderType,
    idempotencyKey,
    senderId = null,
    messageType = 'text',
    metadata = null,
    channel = null,
    recipient = null,
    payload = null
  } = params

  // 1. Validações Sintáticas de Entrada e Limites (F-03)
  if (!isValidUuid(companyId)) {
    return {
      success: false,
      code: 'INVALID_COMPANY_ID',
      error: 'Identificador da empresa inválido.'
    }
  }

  if (!isValidUuid(conversationId)) {
    return {
      success: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'Identificador da conversa inválido.'
    }
  }

  if (!content || !content.trim()) {
    return {
      success: false,
      code: 'INVALID_CONTENT',
      error: 'O conteúdo da mensagem não pode ser vazio.'
    }
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return {
      success: false,
      code: 'CONTENT_TOO_LONG',
      error: `O conteúdo da mensagem excede o limite de ${MAX_CONTENT_LENGTH} caracteres.`
    }
  }

  if (!idempotencyKey || !idempotencyKey.trim()) {
    return {
      success: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      error: 'A chave de idempotência é obrigatória.'
    }
  }

  if (idempotencyKey.trim().length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return {
      success: false,
      code: 'IDEMPOTENCY_KEY_TOO_LONG',
      error: `A chave de idempotência excede o limite de ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres.`
    }
  }

  if (!['agent', 'human', 'system'].includes(senderType)) {
    return {
      success: false,
      code: 'INVALID_SENDER_TYPE',
      error: `sender_type inválido (${senderType}). Aceitos: agent, human, system.`
    }
  }

  // 1.1 Validação de Identidade do Remetente no TypeScript (F-02)
  if (senderType === 'human') {
    if (!senderId) {
      return {
        success: false,
        code: 'SENDER_ID_REQUIRED_FOR_HUMAN',
        error: 'Identificador do operador (senderId) é obrigatório para mensagens humanas.'
      }
    }
    if (!isValidUuid(senderId)) {
      return {
        success: false,
        code: 'INVALID_SENDER_ID',
        error: 'Identificador do remetente (senderId) inválido.'
      }
    }
  } else if (senderType === 'system') {
    if (senderId) {
      return {
        success: false,
        code: 'SYSTEM_SENDER_ID_MUST_BE_NULL',
        error: 'Mensagens do tipo system não podem definir senderId.'
      }
    }
  } else if (senderType === 'agent') {
    if (senderId) {
      return {
        success: false,
        code: 'AGENT_SENDER_ID_MUST_BE_NULL',
        error: 'Mensagens do tipo agent não podem definir senderId na tabela messages (sender_id referencia perfis).'
      }
    }
  }

  // 1.2 Validações de limites de Payload e Metadata (F-03)
  if (payload !== null && payload !== undefined) {
    try {
      const payloadStr = JSON.stringify(payload)
      if (Buffer.byteLength(payloadStr, 'utf8') > MAX_PAYLOAD_BYTES) {
        return {
          success: false,
          code: 'PAYLOAD_TOO_LARGE',
          error: `O payload excede o limite de ${MAX_PAYLOAD_BYTES} bytes.`
        }
      }
    } catch {
      return {
        success: false,
        code: 'INVALID_PAYLOAD',
        error: 'Payload fornecido não é serializável em JSON válido.'
      }
    }
  }

  if (metadata !== null && metadata !== undefined) {
    try {
      const metaStr = JSON.stringify(metadata)
      if (Buffer.byteLength(metaStr, 'utf8') > MAX_METADATA_BYTES) {
        return {
          success: false,
          code: 'METADATA_TOO_LARGE',
          error: `O metadata excede o limite de ${MAX_METADATA_BYTES} bytes.`
        }
      }
    } catch {
      return {
        success: false,
        code: 'INVALID_METADATA',
        error: 'Metadata fornecido não é serializável em JSON válido.'
      }
    }
  }

  // 1.3 Validação de Canal e Destinatário (F-03)
  const normChannel = channel ? channel.trim().toLowerCase() : null
  if (normChannel) {
    if (normChannel.length > 32 || !(SUPPORTED_OUTBOUND_CHANNELS as readonly string[]).includes(normChannel)) {
      return {
        success: false,
        code: 'INVALID_CHANNEL',
        error: 'Canal inválido ou não suportado.'
      }
    }
  }

  if (recipient !== null && recipient !== undefined && recipient.trim() !== '') {
    const normRecipient = recipient.trim()
    if (normRecipient.length > MAX_RECIPIENT_LENGTH) {
      return {
        success: false,
        code: 'INVALID_RECIPIENT',
        error: `Destinatário excede o limite de ${MAX_RECIPIENT_LENGTH} caracteres.`
      }
    }
    const targetChannel = normChannel || 'whatsapp'
    if (targetChannel === 'whatsapp') {
      if (!/^\+?[0-9]{7,32}$/.test(normRecipient)) {
        return {
          success: false,
          code: 'INVALID_RECIPIENT',
          error: 'Número de telefone do destinatário inválido para o canal WhatsApp.'
        }
      }
    }
  }

  const supabase = options?.adminClient || createAdminClient()

  // 2. Validação central do ciclo de vida do tenant (Fail-closed)
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      return {
        success: false,
        code: err.code,
        error: err.message
      }
    }
    return {
      success: false,
      code: 'TENANT_CHECK_FAILED',
      error: err.message || 'Falha ao verificar autorização da empresa.'
    }
  }

  // 3. Execução Atômica via RPC PostgreSQL (Single-Transaction ACID)
  try {
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('create_outbound_message_atomic', {
      p_company_id: companyId,
      p_conversation_id: conversationId,
      p_sender_type: senderType,
      p_content: content.trim(),
      p_idempotency_key: idempotencyKey.trim(),
      p_sender_id: senderId,
      p_message_type: messageType,
      p_metadata: metadata || null,
      p_channel: normChannel,
      p_recipient: recipient ? recipient.trim() : null,
      p_payload: payload || null
    })

    if (rpcErr) {
      // Proteção de privacidade: logar apenas metadados técnicos, sem vazar payload ou conteúdo
      console.error(`[prepareOutboundMessage] Erro na RPC para tenant ${companyId}, conv ${conversationId}:`, rpcErr.message || rpcErr.code)
      return {
        success: false,
        code: 'DB_RPC_ERROR',
        error: `Falha na execução da transação no banco: ${rpcErr.message || JSON.stringify(rpcErr)}`
      }
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData

    if (!row) {
      return {
        success: false,
        code: 'EMPTY_RPC_RESPONSE',
        error: 'Resposta vazia retornada pelo banco de dados.'
      }
    }

    // Se houve rejeição lógica validada pela função PL/pgSQL
    if (row.error_reason) {
      const reasonCodeMap: Record<string, string> = {
        company_id_required: 'INVALID_COMPANY_ID',
        conversation_id_required: 'INVALID_CONVERSATION_ID',
        content_required: 'INVALID_CONTENT',
        content_too_long: 'CONTENT_TOO_LONG',
        idempotency_key_required: 'INVALID_IDEMPOTENCY_KEY',
        idempotency_key_too_long: 'IDEMPOTENCY_KEY_TOO_LONG',
        payload_too_large: 'PAYLOAD_TOO_LARGE',
        metadata_too_large: 'METADATA_TOO_LARGE',
        invalid_sender_type: 'INVALID_SENDER_TYPE',
        sender_id_required_for_human: 'SENDER_ID_REQUIRED_FOR_HUMAN',
        sender_profile_not_found: 'SENDER_PROFILE_NOT_FOUND',
        sender_tenant_mismatch: 'SENDER_TENANT_MISMATCH',
        system_sender_id_must_be_null: 'SYSTEM_SENDER_ID_MUST_BE_NULL',
        agent_sender_id_must_be_null: 'AGENT_SENDER_ID_MUST_BE_NULL',
        agent_not_found: 'AGENT_NOT_FOUND',
        agent_tenant_mismatch: 'AGENT_TENANT_MISMATCH',
        agent_not_active: 'AGENT_NOT_ACTIVE',
        invalid_agent_id_format: 'INVALID_AGENT_ID_FORMAT',
        invalid_channel: 'INVALID_CHANNEL',
        invalid_recipient: 'INVALID_RECIPIENT',
        missing_recipient_phone: 'RECIPIENT_MISSING',
        company_not_found: 'TENANT_NOT_FOUND',
        conversation_not_found: 'CONVERSATION_NOT_FOUND',
        conversation_tenant_mismatch: 'CROSS_TENANT_FORBIDDEN',
        concurrent_conflict_retry_required: 'CONCURRENT_CONFLICT_RETRY_REQUIRED'
      }

      const code = reasonCodeMap[row.error_reason] || (
        row.error_reason.startsWith('company_not_active:') ? 'TENANT_NOT_ACTIVE' : 'PREPARE_REJECTED'
      )

      return {
        success: false,
        code,
        error: `Operação rejeitada pelo banco: ${row.error_reason}`
      }
    }

    // Se for mensagem duplicada pela chave de idempotência
    if (row.duplicate) {
      return {
        success: true,
        duplicate: true,
        messageId: row.message_id,
        outboxId: row.outbox_id,
        status: row.status
      }
    }

    // Se for inserida com sucesso
    if (row.was_inserted) {
      return {
        success: true,
        duplicate: false,
        messageId: row.message_id,
        outboxId: row.outbox_id,
        status: row.status
      }
    }

    return {
      success: false,
      code: 'UNEXPECTED_OUTCOME',
      error: 'Resultado inesperado na preparação da mensagem de saída.'
    }

  } catch (err: any) {
    console.error(`[prepareOutboundMessage] Exceção inesperada para tenant ${companyId}:`, err.message || 'unknown')
    return {
      success: false,
      code: 'UNEXPECTED_EXCEPTION',
      error: err.message || 'Exceção não tratada na preparação da mensagem.'
    }
  }
}
