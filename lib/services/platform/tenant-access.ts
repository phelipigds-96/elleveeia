import type { CompanyStatus, CompanyPlanTier } from './companies'

// ==============================================================================
// TIPAGENS E CÓDIGOS DE ERRO DE CONTROLE DE ACESSO DE TENANTS
// ==============================================================================

export type TenantAccessErrorCode =
  | 'INVALID_COMPANY_ID'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_PROVISIONING'
  | 'TENANT_SUSPENDED'
  | 'TENANT_CANCELLED'
  | 'TENANT_STATUS_UNAVAILABLE'

/**
 * Erro operacional tipado para bloqueios de ciclo de vida e controle de acesso a tenants.
 * 
 * Regras de segurança:
 * - Mensagem pública segura e padronizada (sem vazar dados de infraestrutura, credenciais ou SQL).
 * - suspensionReason preservado exclusivamente em propriedade do objeto de erro para auditoria
 *   e consumo interno autorizado, sem vazar na mensagem genérica.
 */
export class TenantAccessError extends Error {
  readonly code: TenantAccessErrorCode
  readonly statusCode: 400 | 403 | 404 | 503
  readonly companyId?: string
  readonly suspensionReason?: string | null

  constructor(
    message: string,
    code: TenantAccessErrorCode,
    statusCode: 400 | 403 | 404 | 503,
    companyId?: string,
    suspensionReason?: string | null
  ) {
    super(message)
    this.name = 'TenantAccessError'
    this.code = code
    this.statusCode = statusCode
    this.companyId = companyId
    this.suspensionReason = suspensionReason || null

    Object.setPrototypeOf(this, TenantAccessError.prototype)
  }
}

export interface RequireTenantAccessOptions {
  /**
   * Se habilitado explicitamente, autoriza a execução mesmo para tenants em status 'provisioning'.
   * Uso restrito a workers e pipelines de implantação/provisionamento.
   */
  allowProvisioning?: boolean

  /**
   * Cliente Supabase privilegiado opcional para injeção controlada em testes unitários ou transações internas.
   */
  adminClient?: any
}

export interface ActiveCompanyContext {
  id: string
  name: string
  status: CompanyStatus
  planTier: CompanyPlanTier
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ==============================================================================
// SERVIÇO CENTRAL DE CONTROLE DE ACESSO OPERACIONAL DE TENANTS
// ==============================================================================

/**
 * Valida se uma empresa está ativa e autorizada a executar operações comerciais,
 * invocar modelos de linguagem (LLMs), emitir orçamentos ou enviar mensagens externas.
 * 
 * Regras estritas:
 * 1. Exclusivamente server-side com fail-closed incondicional.
 * 2. Validação sintática rigorosa de UUID antes de qualquer acesso a banco.
 * 3. Consulta direta e em tempo real à tabela `companies` sem camada de cache.
 * 4. Projeção estrita de colunas (`id, name, status, suspension_reason, plan_tier`), nunca `SELECT *`.
 * 5. Rejeição de status forjado ou fornecido externamente pelo chamador.
 * 6. Operação estritamente de leitura (read-only), sem efeitos colaterais no banco de dados.
 * 
 * @throws {TenantAccessError} Bloqueios operacionais com códigos tipados e status HTTP coerentes.
 */
export async function requireActiveCompany(
  companyId: string,
  options?: RequireTenantAccessOptions
): Promise<ActiveCompanyContext> {
  // 1. Validação sintática estrita do identificador da empresa
  if (!companyId || typeof companyId !== 'string' || !UUID_REGEX.test(companyId.trim())) {
    throw new TenantAccessError(
      'Identificador de empresa inválido: deve ser um UUID válido.',
      'INVALID_COMPANY_ID',
      400,
      typeof companyId === 'string' ? companyId : undefined
    )
  }

  const cleanCompanyId = companyId.trim()

  // 2. Obtenção do cliente de infraestrutura seguro no servidor
  let adminClient = options?.adminClient
  if (!adminClient) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/service')
      adminClient = createAdminClient()
    } catch {
      // Fail-closed em caso de indisponibilidade de cliente
      throw new TenantAccessError(
        'Falha de infraestrutura ao verificar status da empresa.',
        'TENANT_STATUS_UNAVAILABLE',
        503,
        cleanCompanyId
      )
    }
  }

  // 3. Consulta em tempo real à tabela `companies` (projeção restrita, sem SELECT *)
  let queryResult: any
  try {
    queryResult = await adminClient
      .from('companies')
      .select('id, name, status, suspension_reason, plan_tier')
      .eq('id', cleanCompanyId)
      .maybeSingle()
  } catch {
    // Fail-closed em caso de erro não tratado do driver ou timeout
    throw new TenantAccessError(
      'Falha de infraestrutura ao verificar status da empresa.',
      'TENANT_STATUS_UNAVAILABLE',
      503,
      cleanCompanyId
    )
  }

  const { data: company, error: companyError } = queryResult || {}

  if (companyError) {
    // Fail-closed em caso de erro retornado pelo banco (PostgREST/Postgres)
    throw new TenantAccessError(
      'Falha de infraestrutura ao verificar status da empresa.',
      'TENANT_STATUS_UNAVAILABLE',
      503,
      cleanCompanyId
    )
  }

  if (!company) {
    throw new TenantAccessError(
      `Empresa não encontrada: '${cleanCompanyId}'.`,
      'TENANT_NOT_FOUND',
      404,
      cleanCompanyId
    )
  }

  const status = company.status as CompanyStatus

  // 4. Avaliação determinística do status da empresa
  switch (status) {
    case 'active':
      return {
        id: company.id,
        name: company.name,
        status: 'active',
        planTier: company.plan_tier as CompanyPlanTier
      }

    case 'provisioning':
      if (options?.allowProvisioning === true) {
        return {
          id: company.id,
          name: company.name,
          status: 'provisioning',
          planTier: company.plan_tier as CompanyPlanTier
        }
      }
      throw new TenantAccessError(
        'Operação comercial bloqueada: empresa em fase de implantação (provisioning).',
        'TENANT_PROVISIONING',
        403,
        cleanCompanyId
      )

    case 'suspended':
      throw new TenantAccessError(
        'Operação comercial bloqueada: acesso da empresa suspenso pela plataforma.',
        'TENANT_SUSPENDED',
        403,
        cleanCompanyId,
        company.suspension_reason || null
      )

    case 'cancelled':
      throw new TenantAccessError(
        'Operação comercial bloqueada: contrato da empresa cancelado.',
        'TENANT_CANCELLED',
        403,
        cleanCompanyId
      )

    default:
      // Fail-closed caso o banco contenha qualquer status desconhecido ou corrompido
      throw new TenantAccessError(
        'Falha de infraestrutura ao verificar status da empresa.',
        'TENANT_STATUS_UNAVAILABLE',
        503,
        cleanCompanyId
      )
  }
}
