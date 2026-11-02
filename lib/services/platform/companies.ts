import { requirePlatformAdmin } from './admin'
import { executeAuditedAction } from './audit'

// ==============================================================================
// TIPAGENS DO DIRETÓRIO ADMINISTRATIVO DE EMPRESAS (SAAS MULTI-TENANT)
// ==============================================================================

export type CompanyStatus = 'provisioning' | 'active' | 'suspended' | 'cancelled'
export type CompanyPlanTier = 'trial' | 'standard' | 'pro' | 'enterprise'

export const VALID_COMPANY_STATUSES: readonly CompanyStatus[] = [
  'provisioning',
  'active',
  'suspended',
  'cancelled'
] as const

export const VALID_COMPANY_PLAN_TIERS: readonly CompanyPlanTier[] = [
  'trial',
  'standard',
  'pro',
  'enterprise'
] as const

export const DEFAULT_PAGE = 1
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface PlatformCompanyLimitsSummary {
  maxAgents: number
  maxMonthlyMessages: number
  maxMonthlyQuotes: number
  maxCatalogItems: number
  allowedLlmProviders: string[]
}

export interface PlatformCompanyListItem {
  id: string
  name: string
  slug: string
  status: CompanyStatus
  planTier: CompanyPlanTier
  createdAt: string
  limits: PlatformCompanyLimitsSummary | null
}

export interface ListPlatformCompaniesOptions {
  client?: any
  adminClient?: any
  page?: number
  limit?: number
  status?: CompanyStatus
  planTier?: CompanyPlanTier
}

export interface ListPlatformCompaniesResult {
  companies: PlatformCompanyListItem[]
  pagination: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

export interface PlatformProvisioningJobSummary {
  id: string
  currentStep: string
  status: 'running' | 'success' | 'failed'
  retryCount: number
  createdAt: string
  updatedAt: string
}

export interface PlatformCompanyDetails {
  id: string
  name: string
  slug: string
  status: CompanyStatus
  suspensionReason: string | null
  planTier: CompanyPlanTier
  createdAt: string
  limits: PlatformCompanyLimitsSummary | null
  provisioningJob: PlatformProvisioningJobSummary | null
}

export interface GetPlatformCompanyDetailsOptions {
  client?: any
  adminClient?: any
}

export interface UpdatePlatformCompanyInput {
  name?: string
  slug?: string
  reason?: string
  [key: string]: any
}

export interface UpdatePlatformCompanyOptions {
  client?: any
  adminClient?: any
  ipAddress?: string | null
  userAgent?: string | null
}

export interface UpdatePlatformCompanyResult {
  company: {
    id: string
    name: string
    slug: string
    status: CompanyStatus
    planTier: CompanyPlanTier
    createdAt: string
  }
  updated: boolean
}

// ==============================================================================
// SERVIÇOS SERVER-SIDE DE CONSULTA ADMINISTRATIVA DE EMPRESAS
// ==============================================================================

/**
 * Lista empresas cadastradas na plataforma com filtros e paginação segura.
 * 
 * Regras de segurança e governança:
 * - Exclusivamente server-side.
 * - Exige autorização restritiva via requirePlatformAdmin (somente superadmin por padrão).
 * - Seleção explícita de colunas seguras (nunca select('*')).
 * - Validação estrita de limites de paginação e valores de filtros contra o schema real.
 * - Não expõe segredos, tokens, chaves de API, credenciais ou conversas.
 * - Operação estritamente de leitura (read-only).
 */
export async function listPlatformCompanies(
  options: ListPlatformCompaniesOptions = {}
): Promise<ListPlatformCompaniesResult> {
  // 1. Autorização centralizada: bloqueia não-superadmins, usuários comuns e operadores inativos
  await requirePlatformAdmin({
    client: options.client,
    adminClient: options.adminClient,
    requiredRoles: ['superadmin']
  })

  // 2. Validação e sanitização da paginação
  const page =
    typeof options.page === 'number' && Number.isInteger(options.page) && options.page >= 1
      ? options.page
      : DEFAULT_PAGE

  const limit =
    typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit >= 1
      ? Math.min(options.limit, MAX_LIMIT)
      : DEFAULT_LIMIT

  const offset = (page - 1) * limit

  // 3. Validação estrita dos filtros
  if (options.status && !VALID_COMPANY_STATUSES.includes(options.status)) {
    throw new Error(
      `Filtro de status inválido: '${options.status}'. Valores válidos: ${VALID_COMPANY_STATUSES.join(', ')}`
    )
  }

  if (options.planTier && !VALID_COMPANY_PLAN_TIERS.includes(options.planTier)) {
    throw new Error(
      `Filtro de plano inválido: '${options.planTier}'. Valores válidos: ${VALID_COMPANY_PLAN_TIERS.join(', ')}`
    )
  }

  // 4. Inicializar cliente administrativo de backend seguro
  let adminClient = options.adminClient
  if (!adminClient) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/service')
      adminClient = createAdminClient()
    } catch (err: any) {
      throw new Error(`Falha de infraestrutura ao obter cliente de banco: ${err.message}`)
    }
  }

  // 5. Montagem da consulta com seleção explícita de colunas (sem select('*'))
  let query = adminClient
    .from('companies')
    .select('id, name, slug, status, plan_tier, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (options.status) {
    query = query.eq('status', options.status)
  }

  if (options.planTier) {
    query = query.eq('plan_tier', options.planTier)
  }

  query = query.range(offset, offset + limit - 1)

  const { data: companiesRows, count, error: companiesError } = await query

  if (companiesError) {
    throw new Error(`Falha ao listar empresas da plataforma: ${companiesError.message}`)
  }

  const rawCompanies = companiesRows || []
  const totalCount = typeof count === 'number' ? count : rawCompanies.length
  const totalPages = Math.ceil(totalCount / limit) || 1

  // 6. Buscar limites contratados correspondentes às empresas retornadas
  const companyIds = rawCompanies.map((c: any) => c.id)
  const limitsMap = new Map<string, PlatformCompanyLimitsSummary>()

  if (companyIds.length > 0) {
    const { data: limitsRows, error: limitsError } = await adminClient
      .from('company_limits')
      .select('company_id, max_agents, max_monthly_messages, max_monthly_quotes, max_catalog_items, allowed_llm_providers')
      .in('company_id', companyIds)

    if (limitsError) {
      throw new Error(`Falha ao consultar limites das empresas: ${limitsError.message}`)
    }

    if (limitsRows) {
      for (const lim of limitsRows) {
        limitsMap.set(lim.company_id, {
          maxAgents: lim.max_agents,
          maxMonthlyMessages: lim.max_monthly_messages,
          maxMonthlyQuotes: lim.max_monthly_quotes,
          maxCatalogItems: lim.max_catalog_items,
          allowedLlmProviders: Array.isArray(lim.allowed_llm_providers) ? lim.allowed_llm_providers : ['gemini']
        })
      }
    }
  }

  // 7. Mapear retorno seguro com tipagem administrativa
  const companies: PlatformCompanyListItem[] = rawCompanies.map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as CompanyStatus,
    planTier: row.plan_tier as CompanyPlanTier,
    createdAt: row.created_at,
    limits: limitsMap.get(row.id) || null
  }))

  return {
    companies,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  }
}

/**
 * Consulta os detalhes administrativos completos de uma empresa específica.
 * 
 * Retorna dados cadastrais permitidos, status, plano, cotas configuradas e resumo de provisionamento.
 * Retorna `null` caso a empresa não exista ou o identificador seja inválido.
 * 
 * Regras de segurança:
 * - Exige autorização restritiva via requirePlatformAdmin.
 * - Validação estrita de formato UUID.
 * - Seleção explícita de colunas, omitindo error_log e dados sensíveis.
 * - Operação estritamente de leitura (read-only).
 */
export async function getPlatformCompanyDetails(
  companyId: string,
  options: GetPlatformCompanyDetailsOptions = {}
): Promise<PlatformCompanyDetails | null> {
  // 1. Autorização centralizada: bloqueia não-superadmins, usuários comuns e operadores inativos
  await requirePlatformAdmin({
    client: options.client,
    adminClient: options.adminClient,
    requiredRoles: ['superadmin']
  })

  // 2. Validação sintática do identificador (UUID)
  if (!companyId || typeof companyId !== 'string' || !UUID_REGEX.test(companyId.trim())) {
    return null
  }

  const cleanCompanyId = companyId.trim()

  // 3. Inicializar cliente administrativo de backend seguro
  let adminClient = options.adminClient
  if (!adminClient) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/service')
      adminClient = createAdminClient()
    } catch (err: any) {
      throw new Error(`Falha de infraestrutura ao obter cliente de banco: ${err.message}`)
    }
  }

  // 4. Buscar dados cadastrais da empresa com seleção explícita de colunas
  const { data: company, error: companyError } = await adminClient
    .from('companies')
    .select('id, name, slug, status, suspension_reason, plan_tier, created_at')
    .eq('id', cleanCompanyId)
    .maybeSingle()

  if (companyError) {
    throw new Error(`Falha ao consultar empresa na plataforma: ${companyError.message}`)
  }

  if (!company) {
    return null
  }

  // 5. Buscar limites e cotas configuradas para a empresa
  const { data: limitsData, error: limitsError } = await adminClient
    .from('company_limits')
    .select('max_agents, max_monthly_messages, max_monthly_quotes, max_catalog_items, allowed_llm_providers')
    .eq('company_id', cleanCompanyId)
    .maybeSingle()

  if (limitsError) {
    throw new Error(`Falha ao consultar limites da empresa: ${limitsError.message}`)
  }

  // 6. Buscar resumo do job de provisionamento mais recente (omitindo logs de erro e segredos)
  const { data: jobData, error: jobError } = await adminClient
    .from('provisioning_jobs')
    .select('id, current_step, status, retry_count, created_at, updated_at')
    .eq('company_id', cleanCompanyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (jobError) {
    throw new Error(`Falha ao consultar histórico de implantação da empresa: ${jobError.message}`)
  }

  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    status: company.status as CompanyStatus,
    suspensionReason: company.suspension_reason || null,
    planTier: company.plan_tier as CompanyPlanTier,
    createdAt: company.created_at,
    limits: limitsData
      ? {
          maxAgents: limitsData.max_agents,
          maxMonthlyMessages: limitsData.max_monthly_messages,
          maxMonthlyQuotes: limitsData.max_monthly_quotes,
          maxCatalogItems: limitsData.max_catalog_items,
          allowedLlmProviders: Array.isArray(limitsData.allowed_llm_providers)
            ? limitsData.allowed_llm_providers
            : ['gemini']
        }
      : null,
    provisioningJob: jobData
      ? {
          id: jobData.id,
          currentStep: jobData.current_step,
          status: jobData.status,
          retryCount: jobData.retry_count,
          createdAt: jobData.created_at,
          updatedAt: jobData.updated_at
        }
      : null
  }
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ALLOWED_UPDATE_KEYS = new Set(['name', 'slug', 'reason'])

/**
 * Atualiza exclusivamente os dados cadastrais básicos (name e slug) de uma empresa existente.
 * 
 * Regras de governança e segurança:
 * - Exige autorização de Superadministrador (requirePlatformAdmin).
 * - Não permite alteração de status, plan_tier, suspension_reason ou limites.
 * - Validação sintática rigorosa de UUID, name e slug.
 * - Tratamento preventivo e em runtime de duplicidade de slug (unique constraint).
 * - Auditoria obrigatória (executeAuditedAction) com evento 'company.updated' registrando as alterações.
 * - Preserva comportamento de consistência: se a auditoria pós-persistência falhar, informa claramente que
 *   a operação foi concluída e não foi revertida automaticamente.
 */
export async function updatePlatformCompany(
  companyId: string,
  input: UpdatePlatformCompanyInput,
  options: UpdatePlatformCompanyOptions = {}
): Promise<UpdatePlatformCompanyResult> {
  // 1. Autorização centralizada: restrita ao papel superadmin
  const operatorContext = await requirePlatformAdmin({
    client: options.client,
    adminClient: options.adminClient,
    requiredRoles: ['superadmin']
  })

  // 2. Validação sintática do identificador da empresa
  if (!companyId || typeof companyId !== 'string' || !UUID_REGEX.test(companyId.trim())) {
    throw new Error(`Identificador de empresa inválido: '${companyId}'. Deve ser um UUID válido.`)
  }
  const cleanCompanyId = companyId.trim()

  // 3. Validação estrita do payload (rejeição de campos não cadastrais ou adicionais)
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Payload de atualização inválido. Esperado um objeto JSON.')
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_UPDATE_KEYS.has(key)) {
      if (key === 'status') {
        throw new Error("Alteração do campo 'status' não é permitida neste serviço.")
      }
      if (key === 'plan_tier' || key === 'planTier') {
        throw new Error("Alteração do campo 'plan_tier' não é permitida neste serviço.")
      }
      if (key === 'limits' || key === 'company_limits' || key === 'max_agents') {
        throw new Error("Alteração de limites não é permitida neste serviço.")
      }
      throw new Error(
        `Campo não permitido para atualização cadastral: '${key}'. Apenas 'name' e 'slug' podem ser alterados.`
      )
    }
  }

  if (input.name === undefined && input.slug === undefined) {
    throw new Error("Pelo menos um dos campos ('name' ou 'slug') deve ser informado para atualização.")
  }

  // 4. Validação de 'name' quando fornecido
  let trimmedName: string | undefined = undefined
  if (input.name !== undefined) {
    if (typeof input.name !== 'string') {
      throw new Error("O nome da empresa deve ser um texto válido.")
    }
    trimmedName = input.name.trim()
    if (trimmedName.length < 2) {
      throw new Error("O nome da empresa não pode ser vazio e deve conter pelo menos 2 caracteres.")
    }
    if (trimmedName.length > 100) {
      throw new Error("O nome da empresa excede o tamanho máximo de 100 caracteres.")
    }
  }

  // 5. Validação e normalização de 'slug' quando fornecido
  let normalizedSlug: string | undefined = undefined
  if (input.slug !== undefined) {
    if (typeof input.slug !== 'string') {
      throw new Error("O slug da empresa deve ser um texto válido.")
    }
    normalizedSlug = input.slug.trim().toLowerCase()
    if (!normalizedSlug) {
      throw new Error("O slug da empresa não pode ser vazio.")
    }
    if (!SLUG_REGEX.test(normalizedSlug)) {
      throw new Error(
        `Slug inválido: '${input.slug}'. O slug deve conter apenas letras minúsculas, números e hífens, sem hífens consecutivos no início ou no fim.`
      )
    }
    if (normalizedSlug.length > 80) {
      throw new Error("O slug da empresa excede o tamanho máximo de 80 caracteres.")
    }
  }

  // 6. Obter cliente administrativo de backend seguro
  let adminClient = options.adminClient
  if (!adminClient) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/service')
      adminClient = createAdminClient()
    } catch (err: any) {
      throw new Error(`Falha de infraestrutura ao obter cliente de banco: ${err.message}`)
    }
  }

  // 7. Consultar empresa existente para verificar existência e valores atuais
  const { data: existingCompany, error: findError } = await adminClient
    .from('companies')
    .select('id, name, slug, status, plan_tier, created_at')
    .eq('id', cleanCompanyId)
    .maybeSingle()

  if (findError) {
    throw new Error(`Falha ao consultar empresa para atualização: ${findError.message}`)
  }

  if (!existingCompany) {
    throw new Error(`Empresa não encontrada: '${cleanCompanyId}'.`)
  }

  // 8. Verificar se houve alteração real
  const nameChanged = trimmedName !== undefined && trimmedName !== existingCompany.name
  const slugChanged = normalizedSlug !== undefined && normalizedSlug !== existingCompany.slug

  if (!nameChanged && !slugChanged) {
    return {
      company: {
        id: existingCompany.id,
        name: existingCompany.name,
        slug: existingCompany.slug,
        status: existingCompany.status as CompanyStatus,
        planTier: existingCompany.plan_tier as CompanyPlanTier,
        createdAt: existingCompany.created_at
      },
      updated: false
    }
  }

  // 9. Verificar se o slug conflita com outra empresa
  if (slugChanged && normalizedSlug) {
    const { data: slugConflict, error: conflictError } = await adminClient
      .from('companies')
      .select('id')
      .eq('slug', normalizedSlug)
      .maybeSingle()

    if (conflictError) {
      throw new Error(`Falha ao verificar disponibilidade do slug: ${conflictError.message}`)
    }

    if (slugConflict && slugConflict.id !== cleanCompanyId) {
      throw new Error(`O slug '${normalizedSlug}' já está em uso por outra empresa.`)
    }
  }

  // 10. Executar a atualização cadastral sob auditoria obrigatória (executeAuditedAction)
  const updatePayload: { name?: string; slug?: string } = {}
  if (nameChanged) updatePayload.name = trimmedName
  if (slugChanged) updatePayload.slug = normalizedSlug

  const changesSummary: Record<string, any> = {}
  if (nameChanged) changesSummary.name = { from: existingCompany.name, to: trimmedName }
  if (slugChanged) changesSummary.slug = { from: existingCompany.slug, to: normalizedSlug }

  return await executeAuditedAction(
    operatorContext,
    {
      action: 'company.updated',
      targetCompanyId: cleanCompanyId,
      reason: input.reason?.trim() || null,
      ipAddress: options.ipAddress || null,
      userAgent: options.userAgent || null,
      payloadSummary: {
        changes: changesSummary
      }
    },
    async () => {
      const { data: updatedRow, error: updateError } = await adminClient
        .from('companies')
        .update(updatePayload)
        .eq('id', cleanCompanyId)
        .select('id, name, slug, status, plan_tier, created_at')
        .single()

      if (updateError) {
        if (updateError.code === '23505' || updateError.message?.includes('companies_slug_key')) {
          throw new Error(`O slug '${normalizedSlug}' já está em uso por outra empresa.`)
        }
        throw new Error(`Falha ao atualizar dados cadastrais da empresa: ${updateError.message}`)
      }

      const row = updatedRow || {
        ...existingCompany,
        ...updatePayload
      }

      return {
        company: {
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status as CompanyStatus,
          planTier: row.plan_tier as CompanyPlanTier,
          createdAt: row.created_at
        },
        updated: true
      }
    },
    adminClient
  )
}
