export type PlatformRole = 'superadmin' | 'support_operator' | 'billing_admin'

export interface PlatformOperator {
  id: string
  email: string
  fullName: string
  role: PlatformRole
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PlatformOperatorContext {
  user: {
    id: string
    email: string
  }
  operator: PlatformOperator
}

export class PlatformAuthError extends Error {
  statusCode: 401 | 403 | 500
  code: string

  constructor(message: string, statusCode: 401 | 403 | 500, code: string) {
    super(message)
    this.name = 'PlatformAuthError'
    this.statusCode = statusCode
    this.code = code
  }
}

export interface RequirePlatformAdminOptions {
  client?: any
  adminClient?: any
  requiredRoles?: PlatformRole[]
}

/**
 * Função central de autorização para o núcleo de governança da plataforma Ellevee IA.
 * 
 * Política de autorização:
 * - Restritiva por padrão: se `requiredRoles` não for especificado, APENAS `superadmin` é autorizado.
 * - Se `requiredRoles` for especificado, APENAS os papéis explicitamente contidos no array são autorizados.
 * - Lista vazia de papéis `[]` ou papel desconhecido resulta em bloqueio (fail-closed, 403).
 * - Operadores inativos (`active !== true`) são estritamente bloqueados (403).
 * - Identidade e papel são validados exclusivamente no servidor contra `public.platform_admins`.
 * - Não expõe o `adminClient` no contexto retornado, preservando o isolamento do client privilegiado.
 */
export async function requirePlatformAdmin(
  options: RequirePlatformAdminOptions = {}
): Promise<PlatformOperatorContext> {
  // 1. Obter o cliente autenticado (injetado via opções ou padrão do servidor)
  let supabase = options.client
  if (!supabase) {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      supabase = createClient()
    } catch (err: any) {
      throw new PlatformAuthError('Falha ao inicializar contexto de autenticação.', 401, 'AUTH_CONTEXT_MISSING')
    }
  }

  // 2. Validar sessão/token Supabase exclusivamente no servidor (nunca confiar em params do cliente)
  let authUser: { id: string; email?: string } | null = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) {
      throw new PlatformAuthError('Não autenticado. Sessão inválida ou expirada.', 401, 'UNAUTHENTICATED')
    }
    authUser = data.user
  } catch (err: any) {
    if (err instanceof PlatformAuthError) throw err
    throw new PlatformAuthError('Falha ao validar sessão de usuário.', 401, 'UNAUTHENTICATED')
  }

  if (!authUser) {
    throw new PlatformAuthError('Não autenticado. Sessão inválida ou expirada.', 401, 'UNAUTHENTICATED')
  }

  const userId = authUser.id

  // 3. Consultar platform_admins usando o client de backend confiável (Service Role)
  let adminClient = options.adminClient
  if (!adminClient) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/service')
      adminClient = createAdminClient()
    } catch (err: any) {
      throw new PlatformAuthError('Falha de infraestrutura: chave administrativa indisponível no servidor.', 500, 'INTERNAL_CONFIG_ERROR')
    }
  }

  let record: any = null
  try {
    const { data, error } = await adminClient
      .from('platform_admins')
      .select('id, email, full_name, role, active, created_at, updated_at')
      .eq('id', userId)
      .single()

    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('Row not found')) {
        // Usuário autenticado, mas NÃO está cadastrado como operador da plataforma
        throw new PlatformAuthError('Acesso negado: usuário não é um operador da plataforma.', 403, 'FORBIDDEN_NOT_OPERATOR')
      }
      // Erro de infraestrutura / banco não pode ser tratado como sucesso nem vazar para bypass
      throw new PlatformAuthError(`Falha interna ao verificar credenciais da plataforma: ${error.message}`, 500, 'INTERNAL_ERROR')
    }
    record = data
  } catch (err: any) {
    if (err instanceof PlatformAuthError) throw err
    throw new PlatformAuthError(`Erro interno ao consultar base de operadores: ${err.message}`, 500, 'INTERNAL_ERROR')
  }

  if (!record) {
    throw new PlatformAuthError('Acesso negado: operador não encontrado.', 403, 'FORBIDDEN_NOT_OPERATOR')
  }

  // 4. Confirmar que active = true
  if (record.active !== true) {
    throw new PlatformAuthError('Acesso negado: operador da plataforma desativado.', 403, 'FORBIDDEN_OPERATOR_INACTIVE')
  }

  // 5. Validar papel do operador no registro do banco
  const validRoles: PlatformRole[] = ['superadmin', 'support_operator', 'billing_admin']
  if (!validRoles.includes(record.role)) {
    throw new PlatformAuthError(`Papel de operador desconhecido ou inválido: ${record.role}`, 403, 'FORBIDDEN_INVALID_ROLE')
  }

  // 6. Política restritiva por padrão:
  // - Se requiredRoles não for informado (undefined), somente 'superadmin' é autorizado.
  // - Se requiredRoles for informado, somente os papéis explicitamente listados são autorizados.
  // - Se requiredRoles for lista vazia [], nenhum papel é autorizado (fail-closed).
  const effectiveAllowedRoles: PlatformRole[] =
    options.requiredRoles === undefined ? ['superadmin'] : options.requiredRoles

  if (
    !Array.isArray(effectiveAllowedRoles) ||
    effectiveAllowedRoles.length === 0 ||
    !effectiveAllowedRoles.includes(record.role)
  ) {
    throw new PlatformAuthError(
      `Acesso negado: o papel '${record.role}' não possui permissão para esta operação.`,
      403,
      'FORBIDDEN_INSUFFICIENT_PERMISSIONS'
    )
  }

  // 7. Retornar contexto tipado, limpo e seguro do operador (sem expor adminClient ou segredos)
  return {
    user: {
      id: userId,
      email: authUser.email || record.email
    },
    operator: {
      id: record.id,
      email: record.email,
      fullName: record.full_name,
      role: record.role,
      active: record.active,
      createdAt: record.created_at,
      updatedAt: record.updated_at
    }
  }
}

// ------------------------------------------------------------------------------
// RE-EXPORTAÇÃO DO SERVIÇO CENTRAL DE AUDITORIA E GOVERNANÇA (COMPATIBILIDADE)
// ------------------------------------------------------------------------------

export {
  PlatformAuditError,
  logPlatformAudit,
  executeAuditedAction,
  sanitizePayload,
  isSensitiveKey,
  sanitizeValue,
  type LogPlatformAuditParams,
  type PlatformAuditEventAction,
  type PlatformAuditStatus
} from './audit'

