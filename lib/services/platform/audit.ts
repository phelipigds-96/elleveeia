import type { PlatformOperatorContext } from './admin'

// ==============================================================================
// TIPAGENS DE AUDITORIA E EVENTOS DE GOVERNANÇA SAAS
// ==============================================================================

export type PlatformAuditEventAction =
  | 'company.created'
  | 'company.updated'
  | 'company.suspended'
  | 'company.reactivated'
  | 'company.cancelled'
  | 'company.plan_changed'
  | 'company.limits_changed'
  | 'operator.created'
  | 'operator.updated'
  | 'operator.deactivated'
  | 'provisioning.started'
  | 'provisioning.completed'
  | 'provisioning.failed'
  | (string & {})

export type PlatformAuditStatus = 'success' | 'failed'

export interface LogPlatformAuditParams {
  actorId: string
  actorEmail: string
  action: PlatformAuditEventAction
  targetCompanyId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  payloadSummary?: Record<string, any> | null
  reason?: string | null
  status?: PlatformAuditStatus
  errorMessage?: string | null
}

export class PlatformAuditError extends Error {
  code: string
  operationExecuted: boolean
  auditRecorded: boolean
  originalError?: any

  constructor(
    message: string,
    options: {
      code?: string
      operationExecuted?: boolean
      auditRecorded?: boolean
      originalError?: any
    } = {}
  ) {
    super(message)
    this.name = 'PlatformAuditError'
    this.code = options.code || 'AUDIT_WRITE_FAILED'
    this.operationExecuted = options.operationExecuted ?? false
    this.auditRecorded = options.auditRecorded ?? false
    this.originalError = options.originalError
  }
}

// ==============================================================================
// SANITIZAÇÃO DE DADOS, CREDENCIAIS E CONVERSAS
// ==============================================================================

const SENSITIVE_KEY_PATTERNS = [
  'password', 'senha', 'passphrase', 'pwd',
  'token', 'secret', 'apikey', 'api_key', 'key_hash',
  'jwt', 'authorization', 'bearer', 'credit_card', 'card_number', 'cvv', 'cvc',
  'access_token', 'refresh_token', 'private_key', 'service_role', 'cookie',
  'set-cookie', 'session', 'cpf', 'rg', 'ssn'
]

const CHAT_OR_PROMPT_KEYS = [
  'messages', 'conversation_history', 'chat_transcript', 'transcript',
  'messages_history', 'prompt', 'system_prompt', 'full_prompt', 'raw_prompt',
  'llm_response', 'raw_response', 'completion_text'
]

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  // Verificação de chaves que terminam ou contêm _key (ex: openai_key, google_key, api_key)
  if (lower.endsWith('_key') || lower.startsWith('key_') || lower.includes('_key_')) {
    return true
  }
  return SENSITIVE_KEY_PATTERNS.some(pattern => {
    if (lower === pattern) return true
    if (lower.includes(pattern)) {
      if (pattern === 'card' && (lower.includes('cardinality') || lower.includes('card_type'))) return false
      if (pattern === 'token' && lower.includes('token_count')) return false
      if (pattern === 'session' && (lower.includes('session_timeout') || lower.includes('session_count'))) return false
      return true
    }
    return false
  })
}

export function isChatOrPromptKey(key: string): boolean {
  const lower = key.toLowerCase()
  return CHAT_OR_PROMPT_KEYS.some(pattern => lower === pattern || lower.includes(pattern))
}

export function sanitizeValue(val: any): any {
  if (typeof val === 'string') {
    const trimmed = val.trim()
    // Detecção de Bearer token
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      return '[REDACTED_BEARER_TOKEN]'
    }
    // Detecção de JWT estruturado (3 partes separadas por ponto começando com eyJ)
    if (trimmed.startsWith('eyJ') && trimmed.split('.').length === 3) {
      return '[REDACTED_JWT]'
    }
    // Detecção de padrões de API keys conhecidas
    if (/^sk_[a-zA-Z0-9_-]{20,}/.test(trimmed) || /^AIzaSy[a-zA-Z0-9_-]{33}/.test(trimmed) || /^whsec_[a-zA-Z0-9_-]{20,}/.test(trimmed)) {
      return '[REDACTED_API_KEY]'
    }
    // Detecção de headers de cookie
    if (trimmed.includes('sb-') && trimmed.includes('-auth-token')) {
      return '[REDACTED_COOKIE]'
    }
    // Detecção de números de cartão de crédito (13 a 19 dígitos)
    if (/^\b(?:\d[ -]*?){13,19}\b$/.test(trimmed)) {
      return '[REDACTED_CREDIT_CARD]'
    }
    // Truncamento de strings excessivamente longas para evitar exfiltração acidental
    if (trimmed.length > 2000) {
      return `[TRUNCATED_TEXT: ${trimmed.slice(0, 100)}... (${trimmed.length} chars)]`
    }
  }
  return val
}

export function sanitizePayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return sanitizeValue(payload)
  if (Array.isArray(payload)) return payload.map(sanitizePayload)

  const sanitized: Record<string, any> = {}
  for (const [key, val] of Object.entries(payload)) {
    // 1. Chaves que indicam histórico de conversas ou prompts completos
    if (isChatOrPromptKey(key)) {
      if (Array.isArray(val)) {
        sanitized[key] = `[REDACTED_CHAT_TRANSCRIPT: ${val.length} itens omitidos por política de privacidade]`
      } else if (typeof val === 'string') {
        sanitized[key] = `[REDACTED_PROMPT_CONTENT: ${val.length} caracteres omitidos por política de privacidade]`
      } else {
        sanitized[key] = '[REDACTED_CONVERSATION_PAYLOAD]'
      }
      continue
    }

    // 2. Chaves sensíveis (senhas, segredos, chaves de API, etc.)
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]'
    } else if (val && typeof val === 'object') {
      sanitized[key] = sanitizePayload(val)
    } else {
      sanitized[key] = sanitizeValue(val)
    }
  }
  return sanitized
}

// ==============================================================================
// REGISTRO DE AUDITORIA CENTRALIZADO
// ==============================================================================

/**
 * Registra eventos administrativos na tabela imutável `public.platform_audit_logs`.
 * Módulo exclusivamente server-side.
 * Sanitiza recursivamente o payload antes da persistência.
 * Lança PlatformAuditError em caso de falha de gravação (garantia de fail-closed).
 */
export async function logPlatformAudit(
  params: LogPlatformAuditParams,
  customAdminClient?: any
): Promise<void> {
  let adminClient = customAdminClient
  if (!adminClient) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/service')
      adminClient = createAdminClient()
    } catch (err: any) {
      throw new PlatformAuditError(
        'Falha de infraestrutura ao inicializar cliente administrativo de auditoria.',
        { code: 'AUDIT_CLIENT_UNAVAILABLE', originalError: err }
      )
    }
  }

  const sanitizedSummary = params.payloadSummary ? sanitizePayload(params.payloadSummary) : null

  try {
    const { error } = await adminClient.from('platform_audit_logs').insert({
      actor_id: params.actorId,
      actor_email: params.actorEmail,
      action: params.action,
      target_company_id: params.targetCompanyId || null,
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
      payload_summary: sanitizedSummary,
      reason: params.reason || null,
      status: params.status || 'success',
      error_message: params.errorMessage || null
    })

    if (error) {
      throw new PlatformAuditError(
        `Falha crítica ao gravar log de auditoria da plataforma: ${error.message}`,
        { code: 'AUDIT_WRITE_FAILED', originalError: error }
      )
    }
  } catch (err: any) {
    if (err instanceof PlatformAuditError) throw err
    throw new PlatformAuditError(
      `Falha inesperada ao registrar auditoria da plataforma: ${err.message}`,
      { code: 'AUDIT_WRITE_FAILED', originalError: err }
    )
  }
}

// ==============================================================================
// EXECUÇÃO AUDITADA COM CONSISTÊNCIA DE OPERAÇÕES SENSÍVEIS
// ==============================================================================

/**
 * Executa uma operação administrativa sensível vinculada ao contexto do operador autenticado.
 * 
 * Garantias de consistência:
 * 1. O ator da auditoria é obtido obrigatoriamente do `PlatformOperatorContext` (impossibilitando spoofing).
 * 2. Se a operação de negócio falhar, registra a falha com `status: 'failed'` na auditoria e preserva o erro original.
 * 3. Se a operação de negócio for concluída, a auditoria de sucesso é OBRIGATÓRIA.
 * 4. Se a gravação da auditoria pós-operação falhar, lança `PlatformAuditError` sinalizando:
 *    - `operationExecuted: true` (a operação foi executada no banco e NÃO foi revertida automaticamente)
 *    - `auditRecorded: false` (o registro falhou)
 *    E NUNCA retorna sucesso administrativo para o chamador.
 * 
 * Nota arquitetural de transação:
 * Como chamadas HTTP REST do Supabase Client são independentes, para operações onde a mutação
 * e o log de auditoria precisem de atomicidade rígida do PostgreSQL (rollback atômico), recomenda-se
 * o uso de Stored Procedure (RPC) transacional ou Transactional Outbox Pattern no banco de dados.
 */
export async function executeAuditedAction<T>(
  context: PlatformOperatorContext,
  auditConfig: {
    action: PlatformAuditEventAction
    targetCompanyId?: string | null
    payloadSummary?: Record<string, any> | null
    reason?: string | null
    ipAddress?: string | null
    userAgent?: string | null
  },
  operation: () => Promise<T>,
  customAdminClient?: any
): Promise<T> {
  let operationResult: T

  // 1. Executa a operação de negócio
  try {
    operationResult = await operation()
  } catch (opError: any) {
    // Operação de negócio falhou: tenta registrar a falha na auditoria preservando o erro original
    try {
      await logPlatformAudit({
        actorId: context.operator.id,
        actorEmail: context.operator.email,
        action: auditConfig.action,
        targetCompanyId: auditConfig.targetCompanyId,
        payloadSummary: auditConfig.payloadSummary,
        reason: auditConfig.reason,
        ipAddress: auditConfig.ipAddress,
        userAgent: auditConfig.userAgent,
        status: 'failed',
        errorMessage: opError.message || String(opError)
      }, customAdminClient)
    } catch (auditErr: any) {
      console.error('Falha secundária ao registrar auditoria de operação que falhou:', auditErr)
    }
    // Preserva e relança o erro original da operação de negócio
    throw opError
  }

  // 2. Operação de negócio foi bem-sucedida. Gravação de auditoria é OBRIGATÓRIA.
  try {
    await logPlatformAudit({
      actorId: context.operator.id,
      actorEmail: context.operator.email,
      action: auditConfig.action,
      targetCompanyId: auditConfig.targetCompanyId,
      payloadSummary: auditConfig.payloadSummary,
      reason: auditConfig.reason,
      ipAddress: auditConfig.ipAddress,
      userAgent: auditConfig.userAgent,
      status: 'success'
    }, customAdminClient)
  } catch (auditError: any) {
    // Falha no registro da auditoria após conclusão da operação de negócio
    throw new PlatformAuditError(
      `Operação '${auditConfig.action}' foi executada no banco de dados, mas o registro de auditoria falhou (${auditError.message}). Atenção: a ação administrativa NÃO foi revertida automaticamente.`,
      {
        code: 'AUDIT_WRITE_FAILED',
        operationExecuted: true,
        auditRecorded: false,
        originalError: auditError
      }
    )
  }

  return operationResult
}
