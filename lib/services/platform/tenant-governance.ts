import { createAdminClient } from '@/lib/supabase/service'

export type QuotaStatus = 'ok' | 'warning' | 'exceeded'

export interface ModelPricingRate {
  prefix: string
  provider: 'openai' | 'gemini' | 'other'
  inputPer1MUsd: number
  outputPer1MUsd: number
}

/**
 * Tabela determinística de preços estimados por 1 milhão de tokens (USD).
 * Ordenada dos prefixos mais específicos para os mais genéricos.
 */
export const LLM_MODEL_PRICING_PER_1M: ModelPricingRate[] = [
  { prefix: 'gpt-4.1-nano', provider: 'openai', inputPer1MUsd: 0.10, outputPer1MUsd: 0.40 },
  { prefix: 'gpt-4.1-mini', provider: 'openai', inputPer1MUsd: 0.40, outputPer1MUsd: 1.60 },
  { prefix: 'gpt-4.1', provider: 'openai', inputPer1MUsd: 2.00, outputPer1MUsd: 8.00 },
  { prefix: 'gpt-4o-mini', provider: 'openai', inputPer1MUsd: 0.15, outputPer1MUsd: 0.60 },
  { prefix: 'gpt-4o', provider: 'openai', inputPer1MUsd: 2.50, outputPer1MUsd: 10.00 },
  { prefix: 'o4-mini', provider: 'openai', inputPer1MUsd: 1.10, outputPer1MUsd: 4.40 },
  { prefix: 'o3-mini', provider: 'openai', inputPer1MUsd: 1.10, outputPer1MUsd: 4.40 },
  { prefix: 'gemini-2.5-pro', provider: 'gemini', inputPer1MUsd: 1.25, outputPer1MUsd: 10.00 },
  { prefix: 'gemini-2.5-flash', provider: 'gemini', inputPer1MUsd: 0.30, outputPer1MUsd: 2.50 },
  { prefix: 'gemini-2.0-flash', provider: 'gemini', inputPer1MUsd: 0.10, outputPer1MUsd: 0.40 },
  { prefix: 'gemini-1.5-pro', provider: 'gemini', inputPer1MUsd: 1.25, outputPer1MUsd: 5.00 },
  { prefix: 'gemini-1.5-flash', provider: 'gemini', inputPer1MUsd: 0.075, outputPer1MUsd: 0.30 },
]

const DEFAULT_PROVIDER_PRICING: Record<string, { inputPer1MUsd: number; outputPer1MUsd: number }> = {
  openai: { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60 },
  gemini: { inputPer1MUsd: 0.30, outputPer1MUsd: 2.50 },
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DEFAULT_USD_TO_BRL_RATE = 5.8

export function isMissingSchemaFeatureError(error: any): boolean {
  if (!error) return false
  const code = String(error.code || '')
  const msg = String(error.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === '42703' ||
    code === '42883' ||
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  )
}

function safeCreateAdminClient(): any | null {
  try {
    return createAdminClient()
  } catch {
    return null
  }
}

export function resolveModelPricing(provider?: string | null, model?: string | null) {
  const normalizedModel = String(model || '').trim().toLowerCase()
  const normalizedProvider = String(provider || '').trim().toLowerCase()

  const matched = LLM_MODEL_PRICING_PER_1M.find((entry) => normalizedModel.startsWith(entry.prefix))
  if (matched) {
    return {
      inputPer1MUsd: matched.inputPer1MUsd,
      outputPer1MUsd: matched.outputPer1MUsd,
    }
  }

  return DEFAULT_PROVIDER_PRICING[normalizedProvider] || DEFAULT_PROVIDER_PRICING.openai
}

/**
 * Calcula custo estimado em USD com precisão de 6 casas decimais (padrão NUMERIC(12,6)).
 */
export function estimateLlmCostUsd(
  provider?: string | null,
  model?: string | null,
  promptTokens?: number | null,
  completionTokens?: number | null
): number {
  const safePrompt = Math.max(0, Number(promptTokens) || 0)
  const safeCompletion = Math.max(0, Number(completionTokens) || 0)
  if (safePrompt === 0 && safeCompletion === 0) return 0

  const rates = resolveModelPricing(provider, model)
  const rawCost =
    (safePrompt / 1_000_000) * rates.inputPer1MUsd +
    (safeCompletion / 1_000_000) * rates.outputPer1MUsd

  return Math.round(rawCost * 1_000_000) / 1_000_000
}

/**
 * Política Soft-Quota (Etapa 3B): avalia consumo sem bloquear respostas automáticas em produção.
 */
export function evaluateQuotaStatus(used: number, limit: number): {
  used: number
  limit: number
  usagePercent: number
  status: QuotaStatus
} {
  const safeUsed = Math.max(0, Number(used) || 0)
  const safeLimit = Math.max(0, Number(limit) || 0)

  if (safeLimit <= 0) {
    return {
      used: safeUsed,
      limit: safeLimit,
      usagePercent: 0,
      status: 'ok',
    }
  }

  const rawPct = (safeUsed / safeLimit) * 100
  const usagePercent = Math.round(rawPct * 10) / 10
  const status: QuotaStatus =
    safeUsed >= safeLimit ? 'exceeded' : usagePercent >= 80 ? 'warning' : 'ok'

  return {
    used: safeUsed,
    limit: safeLimit,
    usagePercent,
    status,
  }
}

export const ADDON_PACKAGE_SIZES = [1000, 5000, 10000, 15000] as const
export type AddonPackageSize = (typeof ADDON_PACKAGE_SIZES)[number]

export const DEFAULT_ADDON_UNIT_PRICE_BRL = 0.04
export const DEFAULT_OVERAGE_UNIT_PRICE_BRL = 0.07

export function getCurrentBillingMonth(date: Date = new Date()): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Contagem justa (Etapa 3D): apenas mensagens enviadas pela plataforma (IA ou atendente humano)
 * consomem franquia/excedente, evitando cobrança por flood de mensagens enviadas pelo cliente final.
 */
export function isOutboundSentSenderType(senderType?: string | null): boolean {
  return senderType === 'agent' || senderType === 'human'
}

export function resolvePlanBillingKey(planTier?: string | null): 'trial' | 'starter' | 'pro' | 'enterprise' {
  const tier = String(planTier || 'standard').trim().toLowerCase()
  if (tier === 'trial') return 'trial'
  if (tier === 'pro') return 'pro'
  if (tier === 'enterprise') return 'enterprise'
  return 'starter'
}

function getPlanDefaultMessageLimit(planTier?: string | null): number {
  const key = resolvePlanBillingKey(planTier)
  if (key === 'trial') return 1000
  if (key === 'pro') return 25000
  if (key === 'enterprise') return 100000
  return 5000
}

export interface CompanyBillingOverageInput {
  sentMessages: number
  baseQuotaMessages: number
  addonMessagesPurchased?: number
  addonsTotalBrl?: number
  addonUnitPriceBrl?: number | null
  overageUnitPriceBrl?: number | null
  isTrial?: boolean
}

export interface CompanyBillingOverageResult {
  sentMessages: number
  baseQuotaMessages: number
  addonMessagesPurchased: number
  effectiveQuotaMessages: number
  coveredByBaseMessages: number
  coveredByAddonsMessages: number
  overageMessages: number
  addonUnitPriceBrl: number
  overageUnitPriceBrl: number
  addonsTotalBrl: number
  overageTotalBrl: number
  extraInvoiceTotalBrl: number
  quota: {
    used: number
    limit: number
    usagePercent: number
    status: QuotaStatus
  }
}

export function calculateCompanyBillingOverage(
  input: CompanyBillingOverageInput
): CompanyBillingOverageResult {
  const sentMessages = Math.max(0, Math.floor(Number(input.sentMessages) || 0))
  const baseQuotaMessages = Math.max(0, Math.floor(Number(input.baseQuotaMessages) || 0))
  const addonMessagesPurchased = Math.max(
    0,
    Math.floor(Number(input.addonMessagesPurchased) || 0)
  )
  const effectiveQuotaMessages = baseQuotaMessages + addonMessagesPurchased

  const resolvedAddonRate =
    input.addonUnitPriceBrl !== undefined && input.addonUnitPriceBrl !== null
      ? Math.max(0, Number(input.addonUnitPriceBrl) || 0)
      : input.isTrial
      ? 0
      : DEFAULT_ADDON_UNIT_PRICE_BRL

  const resolvedOverageRate =
    input.overageUnitPriceBrl !== undefined && input.overageUnitPriceBrl !== null
      ? Math.max(0, Number(input.overageUnitPriceBrl) || 0)
      : input.isTrial
      ? 0
      : DEFAULT_OVERAGE_UNIT_PRICE_BRL

  const coveredByBaseMessages = Math.min(sentMessages, baseQuotaMessages)
  const remainingAfterBase = Math.max(0, sentMessages - baseQuotaMessages)
  const coveredByAddonsMessages = Math.min(remainingAfterBase, addonMessagesPurchased)
  const overageMessages = Math.max(0, sentMessages - effectiveQuotaMessages)

  const addonsTotalBrl =
    Math.round(Math.max(0, Number(input.addonsTotalBrl) || 0) * 100) / 100
  const overageTotalBrl = Math.round(overageMessages * resolvedOverageRate * 100) / 100
  const extraInvoiceTotalBrl = Math.round((addonsTotalBrl + overageTotalBrl) * 100) / 100

  return {
    sentMessages,
    baseQuotaMessages,
    addonMessagesPurchased,
    effectiveQuotaMessages,
    coveredByBaseMessages,
    coveredByAddonsMessages,
    overageMessages,
    addonUnitPriceBrl: resolvedAddonRate,
    overageUnitPriceBrl: resolvedOverageRate,
    addonsTotalBrl,
    overageTotalBrl,
    extraInvoiceTotalBrl,
    quota: evaluateQuotaStatus(sentMessages, effectiveQuotaMessages),
  }
}

function computePercentile(sortedAsc: number[], percentile: number): number {
  if (sortedAsc.length === 0) return 0
  const index = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedAsc.length) - 1)
  )
  return sortedAsc[index]
}

export function buildAgentReplyIdempotencyKey(eventId: string): string {
  return `agent-reply-${eventId.trim()}`
}

export interface ProviderUsageBreakdown {
  provider: string
  model: string
  runs: number
  totalTokens: number
  estimatedCostUsd: number
}

export interface TenantGovernanceRow {
  companyId: string
  companyName: string
  companySlug: string
  planTier: string
  companyStatus: string
  monthlyMessagesUsed: number
  monthlySentMessagesUsed: number
  monthlyAgentMessagesUsed: number
  monthlyHumanMessagesUsed: number
  monthlyCustomerMessagesUsed: number
  monthlyMessagesLimit: number
  addonMessagesPurchased: number
  effectiveMessagesLimit: number
  overageMessages: number
  addonUnitPriceBrl: number
  overageUnitPriceBrl: number
  addonsTotalBrl: number
  overageTotalBrl: number
  extraInvoiceTotalBrl: number
  quotaUsagePercent: number
  quotaStatus: QuotaStatus
  totalRuns: number
  successRuns: number
  errorRuns: number
  timeoutRuns: number
  fallbackCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  estimatedCostBrl: number
  avgDurationMs: number
  p95DurationMs: number
  outboxSent: number
  outboxFailed: number
  outboxPending: number
  outboxSuppressed: number
  providerBreakdown: ProviderUsageBreakdown[]
}

export interface TenantGovernanceReport {
  generatedAt: string
  billingMonth: string
  windowDays: number
  monthStartIso: string
  usdToBrlRate: number
  quotaEnforcementMode: 'soft_alert'
  schemaWarnings: string[]
  totals: {
    tenantsCount: number
    warningTenantsCount: number
    exceededTenantsCount: number
    totalMonthlyMessages: number
    totalSentMonthlyMessages: number
    totalAddonMessages: number
    totalOverageMessages: number
    totalExtraInvoiceBrl: number
    totalRuns: number
    totalErrorsAndTimeouts: number
    totalFallbacks: number
    totalTokens: number
    totalCostUsd: number
    totalCostBrl: number
    avgDurationMs: number
  }
  tenants: TenantGovernanceRow[]
}

export async function getTenantGovernanceReport(options?: {
  adminClient?: any
  daysWindow?: number
  usdToBrlRate?: number
}): Promise<TenantGovernanceReport> {
  const windowDays = Math.min(90, Math.max(1, options?.daysWindow ?? 30))
  const usdToBrlRate =
    options?.usdToBrlRate && options.usdToBrlRate > 0
      ? options.usdToBrlRate
      : DEFAULT_USD_TO_BRL_RATE

  const now = new Date()
  const billingMonth = getCurrentBillingMonth(now)
  const monthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  ).toISOString()
  const windowStartIso = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const schemaWarnings: string[] = []

  const supabase = options?.adminClient || safeCreateAdminClient()
  if (!supabase) {
    return {
      generatedAt: now.toISOString(),
      billingMonth,
      windowDays,
      monthStartIso,
      usdToBrlRate,
      quotaEnforcementMode: 'soft_alert',
      schemaWarnings: ['Cliente administrativo indisponível no ambiente atual.'],
      totals: {
        tenantsCount: 0,
        warningTenantsCount: 0,
        exceededTenantsCount: 0,
        totalMonthlyMessages: 0,
        totalSentMonthlyMessages: 0,
        totalAddonMessages: 0,
        totalOverageMessages: 0,
        totalExtraInvoiceBrl: 0,
        totalRuns: 0,
        totalErrorsAndTimeouts: 0,
        totalFallbacks: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        totalCostBrl: 0,
        avgDurationMs: 0,
      },
      tenants: [],
    }
  }

  // 1. Empresas + limites (com fallback compatível caso migration 3D ainda não tenha sido aplicada)
  let companyRows: any[] = []
  const { data: companiesWith3d, error: companies3dErr } = await supabase
    .from('companies')
    .select(
      'id, name, slug, plan_tier, status, company_limits(max_agents, max_monthly_messages, max_monthly_quotes, max_catalog_items, allowed_llm_providers, custom_addon_unit_price_brl, custom_overage_unit_price_brl)'
    )

  if (companies3dErr) {
    const { data: companiesWithLimits, error: companiesErr } = await supabase
      .from('companies')
      .select(
        'id, name, slug, plan_tier, status, company_limits(max_agents, max_monthly_messages, max_monthly_quotes, max_catalog_items, allowed_llm_providers)'
      )
    if (companiesErr) {
      if (isMissingSchemaFeatureError(companiesErr)) {
        schemaWarnings.push(`companies/company_limits: ${companiesErr.message}`)
      }
      const { data: plainCompanies } = await supabase
        .from('companies')
        .select('id, name, slug, plan_tier, status')
      companyRows = plainCompanies || []
    } else {
      companyRows = companiesWithLimits || []
    }
  } else {
    companyRows = companiesWith3d || []
  }

  // 1.1 Tarifas dos planos (addon/avulso) e pacotes adicionais do mês
  const planRateMap = new Map<string, { addonRate: number; overageRate: number }>()
  try {
    const { data: planRows, error: planErr } = await supabase
      .from('platform_plans')
      .select('key, addon_package_unit_price_brl, overage_unit_price_brl')
    if (!planErr && Array.isArray(planRows)) {
      for (const p of planRows) {
        if (p?.key) {
          planRateMap.set(String(p.key).toLowerCase(), {
            addonRate: Number(p.addon_package_unit_price_brl ?? (p.key === 'trial' ? 0 : DEFAULT_ADDON_UNIT_PRICE_BRL)),
            overageRate: Number(p.overage_unit_price_brl ?? (p.key === 'trial' ? 0 : DEFAULT_OVERAGE_UNIT_PRICE_BRL)),
          })
        }
      }
    }
  } catch {
    // Fallback silencioso para tarifas padrão
  }

  const addonStatsMap = new Map<string, { messages: number; totalBrl: number }>()
  try {
    const { data: addonRows, error: addonErr } = await supabase
      .from('company_message_addons')
      .select('company_id, package_messages, total_price_brl, status, billing_month')
      .eq('billing_month', billingMonth)
      .eq('status', 'active')

    if (addonErr) {
      if (isMissingSchemaFeatureError(addonErr)) {
        schemaWarnings.push('Tabela company_message_addons (Etapa 3D) ainda não migrada; usando excedente avulso compatível.')
      }
    } else if (Array.isArray(addonRows)) {
      for (const a of addonRows) {
        if (!a?.company_id) continue
        const bucket = addonStatsMap.get(a.company_id) || { messages: 0, totalBrl: 0 }
        bucket.messages += Math.max(0, Number(a.package_messages) || 0)
        bucket.totalBrl += Math.max(0, Number(a.total_price_brl) || 0)
        addonStatsMap.set(a.company_id, bucket)
      }
    }
  } catch {
    // Fallback silencioso
  }

  // 2. Mensagens do mês corrente por empresa
  const { data: monthlyMessages, error: msgErr } = await supabase
    .from('messages')
    .select('company_id, sender_type, created_at')
    .gte('created_at', monthStartIso)

  if (msgErr && isMissingSchemaFeatureError(msgErr)) {
    schemaWarnings.push(`messages: ${msgErr.message}`)
  }

  // 3. Execuções LLM na janela (com degradação automática caso migration 3B ainda não tenha sido aplicada)
  let agentRunRows: any[] = []
  const { data: runs3b, error: runs3bErr } = await supabase
    .from('agent_runs')
    .select(
      'id, company_id, agent_id, conversation_id, status, provider, model, prompt_tokens, completion_tokens, total_tokens, duration_ms, error_message, metadata, created_at, correlation_event_id, webhook_event_id, estimated_cost_usd'
    )
    .gte('created_at', windowStartIso)

  if (runs3bErr) {
    if (isMissingSchemaFeatureError(runs3bErr)) {
      schemaWarnings.push(
        'Colunas da Etapa 3B em agent_runs ainda não aplicadas; usando cálculo dinâmico compatível.'
      )
      const { data: legacyRuns, error: legacyErr } = await supabase
        .from('agent_runs')
        .select(
          'id, company_id, agent_id, conversation_id, status, provider, model, prompt_tokens, completion_tokens, total_tokens, duration_ms, error_message, metadata, created_at'
        )
        .gte('created_at', windowStartIso)

      if (!legacyErr && Array.isArray(legacyRuns)) {
        agentRunRows = legacyRuns
      }
    }
  } else if (Array.isArray(runs3b)) {
    agentRunRows = runs3b
  }

  // 4. Outbox na janela por empresa
  const { data: outboxRows, error: outboxErr } = await supabase
    .from('message_outbox')
    .select('id, company_id, status, attempts, created_at')
    .gte('created_at', windowStartIso)

  if (outboxErr && isMissingSchemaFeatureError(outboxErr)) {
    schemaWarnings.push(`message_outbox: ${outboxErr.message}`)
  }

  // Mapas de agregação por tenant
  const msgStatsMap = new Map<
    string,
    { total: number; sent: number; agent: number; human: number; customer: number }
  >()
  for (const m of monthlyMessages || []) {
    if (!m.company_id) continue
    const bucket = msgStatsMap.get(m.company_id) || {
      total: 0,
      sent: 0,
      agent: 0,
      human: 0,
      customer: 0,
    }
    bucket.total += 1
    if (isOutboundSentSenderType(m.sender_type)) bucket.sent += 1
    if (m.sender_type === 'agent') bucket.agent += 1
    else if (m.sender_type === 'human') bucket.human += 1
    else if (m.sender_type === 'customer') bucket.customer += 1
    msgStatsMap.set(m.company_id, bucket)
  }

  const outboxStatsMap = new Map<
    string,
    { sent: number; failed: number; pending: number; suppressed: number }
  >()
  for (const ob of outboxRows || []) {
    if (!ob.company_id) continue
    const bucket = outboxStatsMap.get(ob.company_id) || {
      sent: 0,
      failed: 0,
      pending: 0,
      suppressed: 0,
    }
    if (ob.status === 'sent') bucket.sent += 1
    else if (ob.status === 'failed') bucket.failed += 1
    else if (ob.status === 'suppressed') bucket.suppressed += 1
    else if (ob.status === 'pending' || ob.status === 'processing') bucket.pending += 1
    outboxStatsMap.set(ob.company_id, bucket)
  }

  const runStatsMap = new Map<
    string,
    {
      totalRuns: number
      successRuns: number
      errorRuns: number
      timeoutRuns: number
      fallbackCount: number
      promptTokens: number
      completionTokens: number
      totalTokens: number
      estimatedCostUsd: number
      durations: number[]
      providerMap: Map<string, ProviderUsageBreakdown>
    }
  >()

  for (const run of agentRunRows) {
    if (!run.company_id) continue
    const bucket = runStatsMap.get(run.company_id) || {
      totalRuns: 0,
      successRuns: 0,
      errorRuns: 0,
      timeoutRuns: 0,
      fallbackCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      durations: [] as number[],
      providerMap: new Map<string, ProviderUsageBreakdown>(),
    }

    bucket.totalRuns += 1
    if (run.status === 'success') bucket.successRuns += 1
    else if (run.status === 'timeout') bucket.timeoutRuns += 1
    else if (run.status === 'error') bucket.errorRuns += 1

    const fallbackTriggered = Boolean(
      run.metadata?.orchestration?.fallback_catalog_triggered
    )
    if (fallbackTriggered) {
      bucket.fallbackCount += 1
    }

    const pTokens = Math.max(0, Number(run.prompt_tokens) || 0)
    const cTokens = Math.max(0, Number(run.completion_tokens) || 0)
    const tTokens = Math.max(pTokens + cTokens, Number(run.total_tokens) || 0)

    bucket.promptTokens += pTokens
    bucket.completionTokens += cTokens
    bucket.totalTokens += tTokens

    const storedCost = Number(run.estimated_cost_usd)
    const runCost =
      Number.isFinite(storedCost) && storedCost > 0
        ? storedCost
        : estimateLlmCostUsd(run.provider, run.model, pTokens, cTokens)

    bucket.estimatedCostUsd += runCost

    const duration = Number(run.duration_ms)
    if (Number.isFinite(duration) && duration >= 0) {
      bucket.durations.push(duration)
    }

    const providerKey = `${run.provider || 'unknown'}::${run.model || 'unknown'}`
    const existingProvider = bucket.providerMap.get(providerKey) || {
      provider: run.provider || 'unknown',
      model: run.model || 'unknown',
      runs: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    }
    existingProvider.runs += 1
    existingProvider.totalTokens += tTokens
    existingProvider.estimatedCostUsd =
      Math.round((existingProvider.estimatedCostUsd + runCost) * 1_000_000) / 1_000_000
    bucket.providerMap.set(providerKey, existingProvider)

    runStatsMap.set(run.company_id, bucket)
  }

  // Se houver runs/messages órfãos ou mockados sem registro em companies, garante inclusão limpa
  const knownCompanyIds = new Set(companyRows.map((c) => c.id))
  for (const extraId of Array.from(
    new Set(
      Array.from(msgStatsMap.keys()).concat(
        Array.from(runStatsMap.keys()),
        Array.from(outboxStatsMap.keys())
      )
    )
  )) {
    if (!knownCompanyIds.has(extraId)) {
      companyRows.push({
        id: extraId,
        name: `Tenant ${extraId.slice(0, 8)}`,
        slug: extraId.slice(0, 8),
        plan_tier: 'standard',
        status: 'active',
        company_limits: null,
      })
    }
  }

  const allDurations: number[] = []
  let totalMonthlyMessages = 0
  let totalSentMonthlyMessages = 0
  let totalAddonMessages = 0
  let totalOverageMessages = 0
  let totalExtraInvoiceBrl = 0
  let totalRuns = 0
  let totalErrorsAndTimeouts = 0
  let totalFallbacks = 0
  let totalTokens = 0
  let totalCostUsd = 0
  let warningTenantsCount = 0
  let exceededTenantsCount = 0

  const tenants: TenantGovernanceRow[] = companyRows.map((company) => {
    const limits = Array.isArray(company.company_limits)
      ? company.company_limits[0]
      : company.company_limits

    const monthlyLimit =
      Number(limits?.max_monthly_messages) ||
      getPlanDefaultMessageLimit(company.plan_tier)
    const msgBucket = msgStatsMap.get(company.id) || {
      total: 0,
      sent: 0,
      agent: 0,
      human: 0,
      customer: 0,
    }
    const addonBucket = addonStatsMap.get(company.id) || { messages: 0, totalBrl: 0 }
    const planKey = resolvePlanBillingKey(company.plan_tier)
    const planRates = planRateMap.get(planKey)

    const customAddonRate =
      limits?.custom_addon_unit_price_brl !== undefined &&
      limits?.custom_addon_unit_price_brl !== null
        ? Number(limits.custom_addon_unit_price_brl)
        : undefined
    const customOverageRate =
      limits?.custom_overage_unit_price_brl !== undefined &&
      limits?.custom_overage_unit_price_brl !== null
        ? Number(limits.custom_overage_unit_price_brl)
        : undefined

    const billing = calculateCompanyBillingOverage({
      sentMessages: msgBucket.sent,
      baseQuotaMessages: monthlyLimit,
      addonMessagesPurchased: addonBucket.messages,
      addonsTotalBrl: addonBucket.totalBrl,
      addonUnitPriceBrl: customAddonRate ?? planRates?.addonRate,
      overageUnitPriceBrl: customOverageRate ?? planRates?.overageRate,
      isTrial: planKey === 'trial',
    })
    const quota = billing.quota

    if (quota.status === 'warning') warningTenantsCount += 1
    else if (quota.status === 'exceeded') exceededTenantsCount += 1

    const runBucket = runStatsMap.get(company.id) || {
      totalRuns: 0,
      successRuns: 0,
      errorRuns: 0,
      timeoutRuns: 0,
      fallbackCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      durations: [] as number[],
      providerMap: new Map<string, ProviderUsageBreakdown>(),
    }

    const obBucket = outboxStatsMap.get(company.id) || {
      sent: 0,
      failed: 0,
      pending: 0,
      suppressed: 0,
    }

    const sortedDurations = [...runBucket.durations].sort((a, b) => a - b)
    const avgDurationMs =
      sortedDurations.length > 0
        ? Math.round(
            sortedDurations.reduce((acc, v) => acc + v, 0) / sortedDurations.length
          )
        : 0
    const p95DurationMs = computePercentile(sortedDurations, 95)

    for (const d of sortedDurations) {
      allDurations.push(d)
    }

    const roundedUsd = Math.round(runBucket.estimatedCostUsd * 1_000_000) / 1_000_000
    const roundedBrl = Math.round(roundedUsd * usdToBrlRate * 100) / 100

    totalMonthlyMessages += msgBucket.total
    totalSentMonthlyMessages += msgBucket.sent
    totalAddonMessages += billing.addonMessagesPurchased
    totalOverageMessages += billing.overageMessages
    totalExtraInvoiceBrl += billing.extraInvoiceTotalBrl
    totalRuns += runBucket.totalRuns
    totalErrorsAndTimeouts += runBucket.errorRuns + runBucket.timeoutRuns
    totalFallbacks += runBucket.fallbackCount
    totalTokens += runBucket.totalTokens
    totalCostUsd += roundedUsd

    return {
      companyId: company.id,
      companyName: company.name || 'Empresa',
      companySlug: company.slug || '',
      planTier: company.plan_tier || 'standard',
      companyStatus: company.status || 'active',
      monthlyMessagesUsed: msgBucket.total,
      monthlySentMessagesUsed: msgBucket.sent,
      monthlyAgentMessagesUsed: msgBucket.agent,
      monthlyHumanMessagesUsed: msgBucket.human,
      monthlyCustomerMessagesUsed: msgBucket.customer,
      monthlyMessagesLimit: monthlyLimit,
      addonMessagesPurchased: billing.addonMessagesPurchased,
      effectiveMessagesLimit: billing.effectiveQuotaMessages,
      overageMessages: billing.overageMessages,
      addonUnitPriceBrl: billing.addonUnitPriceBrl,
      overageUnitPriceBrl: billing.overageUnitPriceBrl,
      addonsTotalBrl: billing.addonsTotalBrl,
      overageTotalBrl: billing.overageTotalBrl,
      extraInvoiceTotalBrl: billing.extraInvoiceTotalBrl,
      quotaUsagePercent: quota.usagePercent,
      quotaStatus: quota.status,
      totalRuns: runBucket.totalRuns,
      successRuns: runBucket.successRuns,
      errorRuns: runBucket.errorRuns,
      timeoutRuns: runBucket.timeoutRuns,
      fallbackCount: runBucket.fallbackCount,
      promptTokens: runBucket.promptTokens,
      completionTokens: runBucket.completionTokens,
      totalTokens: runBucket.totalTokens,
      estimatedCostUsd: roundedUsd,
      estimatedCostBrl: roundedBrl,
      avgDurationMs,
      p95DurationMs,
      outboxSent: obBucket.sent,
      outboxFailed: obBucket.failed,
      outboxPending: obBucket.pending,
      outboxSuppressed: obBucket.suppressed,
      providerBreakdown: Array.from(runBucket.providerMap.values()).sort(
        (a, b) => b.estimatedCostUsd - a.estimatedCostUsd
      ),
    }
  })

  tenants.sort((a, b) => {
    if (b.extraInvoiceTotalBrl !== a.extraInvoiceTotalBrl) {
      return b.extraInvoiceTotalBrl - a.extraInvoiceTotalBrl
    }
    if (b.estimatedCostUsd !== a.estimatedCostUsd) {
      return b.estimatedCostUsd - a.estimatedCostUsd
    }
    if (b.quotaUsagePercent !== a.quotaUsagePercent) {
      return b.quotaUsagePercent - a.quotaUsagePercent
    }
    return b.monthlySentMessagesUsed - a.monthlySentMessagesUsed
  })

  const roundedTotalUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000
  const roundedTotalBrl = Math.round(roundedTotalUsd * usdToBrlRate * 100) / 100
  const roundedTotalExtraInvoiceBrl = Math.round(totalExtraInvoiceBrl * 100) / 100
  const globalAvgDuration =
    allDurations.length > 0
      ? Math.round(allDurations.reduce((acc, v) => acc + v, 0) / allDurations.length)
      : 0

  return {
    generatedAt: now.toISOString(),
    billingMonth,
    windowDays,
    monthStartIso,
    usdToBrlRate,
    quotaEnforcementMode: 'soft_alert',
    schemaWarnings,
    totals: {
      tenantsCount: tenants.length,
      warningTenantsCount,
      exceededTenantsCount,
      totalMonthlyMessages,
      totalSentMonthlyMessages,
      totalAddonMessages,
      totalOverageMessages,
      totalExtraInvoiceBrl: roundedTotalExtraInvoiceBrl,
      totalRuns,
      totalErrorsAndTimeouts,
      totalFallbacks,
      totalTokens,
      totalCostUsd: roundedTotalUsd,
      totalCostBrl: roundedTotalBrl,
      avgDurationMs: globalAvgDuration,
    },
    tenants,
  }
}

export interface TraceTimelineStep {
  stage:
    | 'webhook_received'
    | 'agent_run'
    | 'message_persisted'
    | 'outbox_queued'
    | 'gateway_lock'
    | 'whatsapp_dispatched'
  timestamp: string
  status: string
  title: string
  detail: string
  metadata?: Record<string, any>
}

export interface EventCorrelationTrace {
  found: boolean
  query: string
  resolvedIds: {
    companyId: string | null
    eventId: string | null
    webhookEventId: string | null
    conversationId: string | null
    messageId: string | null
    outboxId: string | null
    idempotencyKey: string | null
    providerMessageId: string | null
  }
  webhookEvents: any[]
  agentRuns: any[]
  messages: any[]
  outboxItems: any[]
  gatewayLocks: any[]
  timeline: TraceTimelineStep[]
  schemaWarnings: string[]
}

/**
 * Rastreamento ponta a ponta: correlaciona event_id / webhook_event / agent_runs / messages / message_outbox / gateway_outbound_locks.
 */
export async function traceEventCorrelation(
  rawQuery: string,
  options?: { adminClient?: any }
): Promise<EventCorrelationTrace> {
  const query = String(rawQuery || '').trim()
  const emptyResult: EventCorrelationTrace = {
    found: false,
    query,
    resolvedIds: {
      companyId: null,
      eventId: null,
      webhookEventId: null,
      conversationId: null,
      messageId: null,
      outboxId: null,
      idempotencyKey: null,
      providerMessageId: null,
    },
    webhookEvents: [],
    agentRuns: [],
    messages: [],
    outboxItems: [],
    gatewayLocks: [],
    timeline: [],
    schemaWarnings: [],
  }

  if (!query) return emptyResult

  const supabase = options?.adminClient || safeCreateAdminClient()
  if (!supabase) {
    return {
      ...emptyResult,
      schemaWarnings: ['Cliente administrativo indisponível no ambiente atual.'],
    }
  }

  const schemaWarnings: string[] = []
  const isUuid = UUID_REGEX.test(query)

  const webhookMap = new Map<string, any>()
  const agentRunMap = new Map<string, any>()
  const outboxMap = new Map<string, any>()
  const messageMap = new Map<string, any>()
  const lockMap = new Map<string, any>()

  const addWebhookRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      if (row?.id) webhookMap.set(row.id, row)
    }
  }
  const addRunRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      if (row?.id) agentRunMap.set(row.id, row)
    }
  }
  const addOutboxRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      if (row?.id) outboxMap.set(row.id, row)
    }
  }
  const addMessageRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      if (row?.id) messageMap.set(row.id, row)
    }
  }
  const addLockRows = (rows: any[] | null | undefined) => {
    for (const row of rows || []) {
      const key = `${row?.company_id || ''}::${row?.idempotency_key || ''}`
      if (row?.idempotency_key) lockMap.set(key, row)
    }
  }

  const fetchAgentRunsByFilter = async (
    column: string,
    value: string
  ): Promise<any[]> => {
    const baseCols =
      'id, company_id, agent_id, conversation_id, status, provider, model, prompt_tokens, completion_tokens, total_tokens, duration_ms, error_message, metadata, created_at'
    const fullCols = `${baseCols}, correlation_event_id, webhook_event_id, estimated_cost_usd`

    const { data, error } = await supabase
      .from('agent_runs')
      .select(fullCols)
      .eq(column, value)
      .order('created_at', { ascending: true })
      .limit(20)

    if (!error) return data || []
    if (!isMissingSchemaFeatureError(error)) return []

    if (column === 'correlation_event_id' || column === 'webhook_event_id') {
      if (!schemaWarnings.includes('Colunas 3B de correlação em agent_runs ainda não migradas.')) {
        schemaWarnings.push('Colunas 3B de correlação em agent_runs ainda não migradas.')
      }
      return []
    }

    const { data: fallbackData } = await supabase
      .from('agent_runs')
      .select(baseCols)
      .eq(column, value)
      .order('created_at', { ascending: true })
      .limit(20)

    return fallbackData || []
  }

  // Passo 1: Busca primária pelo termo informado
  if (isUuid) {
    const [whById, runsById, runsByWebhook, runsByConv, obById, obByMsg, obByConv, msgById, msgByConv] =
      await Promise.all([
        supabase.from('webhook_events').select('*').eq('id', query).limit(10),
        fetchAgentRunsByFilter('id', query),
        fetchAgentRunsByFilter('webhook_event_id', query),
        fetchAgentRunsByFilter('conversation_id', query),
        supabase.from('message_outbox').select('*').eq('id', query).limit(10),
        supabase.from('message_outbox').select('*').eq('message_id', query).limit(10),
        supabase.from('message_outbox').select('*').eq('conversation_id', query).order('created_at', { ascending: true }).limit(20),
        supabase.from('messages').select('id, company_id, conversation_id, sender_type, content, external_id, metadata, created_at').eq('id', query).limit(10),
        supabase.from('messages').select('id, company_id, conversation_id, sender_type, content, external_id, metadata, created_at').eq('conversation_id', query).order('created_at', { ascending: true }).limit(30),
      ])

    addWebhookRows(whById.data)
    addRunRows(runsById)
    addRunRows(runsByWebhook)
    addRunRows(runsByConv)
    addOutboxRows(obById.data)
    addOutboxRows(obByMsg.data)
    addOutboxRows(obByConv.data)
    addMessageRows(msgById.data)
    addMessageRows(msgByConv.data)
  } else {
    const candidateKey = query.startsWith('agent-reply-')
      ? query
      : buildAgentReplyIdempotencyKey(query)
    const strippedEventId = query.startsWith('agent-reply-')
      ? query.slice('agent-reply-'.length)
      : query

    const [whByEvent, runsByEvent, obByKey, obByProvider, msgByExt] = await Promise.all([
      supabase.from('webhook_events').select('*').eq('event_id', strippedEventId).limit(10),
      fetchAgentRunsByFilter('correlation_event_id', strippedEventId),
      supabase.from('message_outbox').select('*').eq('idempotency_key', candidateKey).limit(10),
      supabase.from('message_outbox').select('*').eq('provider_message_id', query).limit(10),
      supabase.from('messages').select('id, company_id, conversation_id, sender_type, content, external_id, metadata, created_at').eq('external_id', strippedEventId).limit(10),
    ])

    addWebhookRows(whByEvent.data)
    addRunRows(runsByEvent)
    addOutboxRows(obByKey.data)
    addOutboxRows(obByProvider.data)
    addMessageRows(msgByExt.data)
  }

  // Passo 2: Expansão cruzada a partir das âncoras descobertas
  const firstWebhook = Array.from(webhookMap.values())[0]
  const firstOutbox = Array.from(outboxMap.values())[0]
  const firstMessage = Array.from(messageMap.values())[0]
  const firstRun = Array.from(agentRunMap.values())[0]

  const resolvedEventId: string | null =
    firstWebhook?.event_id ||
    firstRun?.correlation_event_id ||
    firstRun?.metadata?.orchestration?.trigger_event_id ||
    firstMessage?.metadata?.trigger_event_id ||
    (typeof firstOutbox?.idempotency_key === 'string' &&
    firstOutbox.idempotency_key.startsWith('agent-reply-')
      ? firstOutbox.idempotency_key.slice('agent-reply-'.length)
      : null) ||
    (!isUuid ? (query.startsWith('agent-reply-') ? query.slice('agent-reply-'.length) : query) : null)

  const resolvedConversationId: string | null =
    firstRun?.conversation_id ||
    firstOutbox?.conversation_id ||
    firstMessage?.conversation_id ||
    null

  const resolvedCompanyId: string | null =
    firstWebhook?.company_id ||
    firstRun?.company_id ||
    firstOutbox?.company_id ||
    firstMessage?.company_id ||
    null

  const resolvedWebhookEventId: string | null =
    firstWebhook?.id ||
    firstRun?.webhook_event_id ||
    firstRun?.metadata?.orchestration?.webhook_event_id ||
    null

  const derivedIdempotencyKey: string | null =
    firstOutbox?.idempotency_key ||
    (resolvedEventId ? buildAgentReplyIdempotencyKey(resolvedEventId) : null)

  const secondaryQueries: Promise<any>[] = []

  if (resolvedEventId && webhookMap.size === 0) {
    secondaryQueries.push(
      supabase.from('webhook_events').select('*').eq('event_id', resolvedEventId).limit(10).then((r: any) => addWebhookRows(r.data))
    )
  }
  if (resolvedWebhookEventId && webhookMap.size === 0) {
    secondaryQueries.push(
      supabase.from('webhook_events').select('*').eq('id', resolvedWebhookEventId).limit(5).then((r: any) => addWebhookRows(r.data))
    )
  }
  if (resolvedEventId && agentRunMap.size === 0) {
    secondaryQueries.push(
      fetchAgentRunsByFilter('correlation_event_id', resolvedEventId).then(addRunRows)
    )
  }
  if (resolvedConversationId) {
    secondaryQueries.push(
      fetchAgentRunsByFilter('conversation_id', resolvedConversationId).then((runs) => {
        if (resolvedEventId) {
          const matching = runs.filter(
            (r) =>
              r.correlation_event_id === resolvedEventId ||
              r.metadata?.orchestration?.trigger_event_id === resolvedEventId ||
              runs.length <= 5
          )
          addRunRows(matching.length > 0 ? matching : runs)
        } else {
          addRunRows(runs)
        }
      })
    )
    secondaryQueries.push(
      supabase
        .from('messages')
        .select('id, company_id, conversation_id, sender_type, content, external_id, metadata, created_at')
        .eq('conversation_id', resolvedConversationId)
        .order('created_at', { ascending: true })
        .limit(20)
        .then((r: any) => addMessageRows(r.data))
    )
    secondaryQueries.push(
      supabase
        .from('message_outbox')
        .select('*')
        .eq('conversation_id', resolvedConversationId)
        .order('created_at', { ascending: true })
        .limit(20)
        .then((r: any) => addOutboxRows(r.data))
    )
  }
  if (derivedIdempotencyKey) {
    secondaryQueries.push(
      supabase
        .from('message_outbox')
        .select('*')
        .eq('idempotency_key', derivedIdempotencyKey)
        .limit(10)
        .then((r: any) => addOutboxRows(r.data))
    )
    secondaryQueries.push(
      supabase
        .from('gateway_outbound_locks')
        .select('*')
        .eq('idempotency_key', derivedIdempotencyKey)
        .limit(10)
        .then((r: any) => {
          if (r.error && isMissingSchemaFeatureError(r.error)) {
            schemaWarnings.push(`gateway_outbound_locks: ${r.error.message}`)
          } else {
            addLockRows(r.data)
          }
        })
    )
  }
  if (firstOutbox?.message_id && !messageMap.has(firstOutbox.message_id)) {
    secondaryQueries.push(
      supabase
        .from('messages')
        .select('id, company_id, conversation_id, sender_type, content, external_id, metadata, created_at')
        .eq('id', firstOutbox.message_id)
        .limit(5)
        .then((r: any) => addMessageRows(r.data))
    )
  }

  await Promise.all(secondaryQueries)

  const webhookEvents = Array.from(webhookMap.values()).sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || ''))
  )
  const agentRuns = Array.from(agentRunMap.values()).sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || ''))
  )
  const allMessages = Array.from(messageMap.values()).sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || ''))
  )
  const outboxItems = Array.from(outboxMap.values()).sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || ''))
  )
  const gatewayLocks = Array.from(lockMap.values())

  // Filtra mensagens se houver event_id específico e conversa longa, preservando customer + agent do mesmo evento
  const relatedMessageIds = new Set(outboxItems.map((o) => o.message_id).filter(Boolean))
  const filteredMessages = resolvedEventId
    ? allMessages.filter(
        (m) =>
          relatedMessageIds.has(m.id) ||
          m.external_id === resolvedEventId ||
          m.metadata?.trigger_event_id === resolvedEventId
      )
    : allMessages
  const messages = filteredMessages.length > 0 ? filteredMessages : allMessages

  const timeline: TraceTimelineStep[] = []

  for (const wh of webhookEvents) {
    timeline.push({
      stage: 'webhook_received',
      timestamp: wh.created_at || wh.processed_at || new Date(0).toISOString(),
      status: wh.status || 'received',
      title: `Webhook recebido (${wh.event_id || wh.id})`,
      detail: wh.error_message
        ? `Status: ${wh.status} · Tentativas: ${wh.attempts ?? 1} · Erro: ${wh.error_message}`
        : `Status: ${wh.status || 'received'} · Tentativas: ${wh.attempts ?? 1}`,
      metadata: {
        webhook_event_id: wh.id,
        event_id: wh.event_id,
        company_id: wh.company_id,
      },
    })
  }

  for (const run of agentRuns) {
    const cost =
      Number(run.estimated_cost_usd) > 0
        ? Number(run.estimated_cost_usd)
        : estimateLlmCostUsd(run.provider, run.model, run.prompt_tokens, run.completion_tokens)
    const fallback = Boolean(run.metadata?.orchestration?.fallback_catalog_triggered)
    timeline.push({
      stage: 'agent_run',
      timestamp: run.created_at || new Date(0).toISOString(),
      status: run.status || 'unknown',
      title: `Execução IA (${run.provider || 'llm'}/${run.model || 'default'})`,
      detail: `${run.total_tokens || 0} tokens · ${run.duration_ms || 0}ms · $${cost.toFixed(6)}${
        fallback ? ' · Fallback catálogo ativado' : ''
      }${run.error_message ? ` · Erro: ${run.error_message}` : ''}`,
      metadata: {
        agent_run_id: run.id,
        correlation_event_id:
          run.correlation_event_id || run.metadata?.orchestration?.trigger_event_id || null,
        estimated_cost_usd: cost,
      },
    })
  }

  for (const msg of messages) {
    const deliveryStatus = msg.metadata?.delivery_status || (msg.sender_type === 'customer' ? 'inbound' : 'persisted')
    timeline.push({
      stage: 'message_persisted',
      timestamp: msg.created_at || new Date(0).toISOString(),
      status: String(deliveryStatus),
      title:
        msg.sender_type === 'customer'
          ? 'Mensagem do cliente registrada'
          : `Resposta (${msg.sender_type}) persistida`,
      detail: `${String(msg.content || '').slice(0, 120)}${
        String(msg.content || '').length > 120 ? '...' : ''
      }`,
      metadata: {
        message_id: msg.id,
        external_id: msg.external_id || null,
        delivery_status: deliveryStatus,
      },
    })
  }

  for (const ob of outboxItems) {
    timeline.push({
      stage: 'outbox_queued',
      timestamp: ob.created_at || new Date(0).toISOString(),
      status: ob.status || 'pending',
      title: `Outbox transacional (${ob.idempotency_key || ob.id})`,
      detail: `Status: ${ob.status} · Tentativas: ${ob.attempts ?? 0}${
        ob.last_error ? ` · Último erro: ${ob.last_error}` : ''
      }`,
      metadata: {
        outbox_id: ob.id,
        message_id: ob.message_id,
      },
    })

    if (ob.sent_at || ob.provider_message_id) {
      timeline.push({
        stage: 'whatsapp_dispatched',
        timestamp: ob.sent_at || ob.created_at || new Date(0).toISOString(),
        status: ob.status === 'sent' ? 'sent' : ob.status || 'dispatched',
        title: 'Entrega WhatsApp Gateway',
        detail: ob.provider_message_id
          ? `Provider Message ID: ${ob.provider_message_id}`
          : `Dispatch registrado sem provider_message_id (${ob.status})`,
        metadata: {
          outbox_id: ob.id,
          provider_message_id: ob.provider_message_id || null,
        },
      })
    }
  }

  for (const lock of gatewayLocks) {
    timeline.push({
      stage: 'gateway_lock',
      timestamp: lock.updated_at || lock.created_at || new Date(0).toISOString(),
      status: lock.status || 'unknown',
      title: `Gateway Outbound Lock (${lock.status})`,
      detail: lock.provider_message_id
        ? `Chave: ${lock.idempotency_key} · Provider ID: ${lock.provider_message_id}`
        : `Chave: ${lock.idempotency_key}${lock.last_error ? ` · Erro: ${lock.last_error}` : ''}`,
      metadata: {
        idempotency_key: lock.idempotency_key,
        company_id: lock.company_id,
      },
    })
  }

  timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const finalWebhook = webhookEvents[0]
  const finalOutbox = outboxItems[0]
  const finalRun = agentRuns[0]
  const finalMsg = messages[0]

  const found =
    webhookEvents.length > 0 ||
    agentRuns.length > 0 ||
    messages.length > 0 ||
    outboxItems.length > 0 ||
    gatewayLocks.length > 0

  return {
    found,
    query,
    resolvedIds: {
      companyId:
        resolvedCompanyId ||
        finalWebhook?.company_id ||
        finalOutbox?.company_id ||
        finalRun?.company_id ||
        null,
      eventId: resolvedEventId || finalWebhook?.event_id || null,
      webhookEventId: finalWebhook?.id || resolvedWebhookEventId || null,
      conversationId:
        resolvedConversationId ||
        finalRun?.conversation_id ||
        finalOutbox?.conversation_id ||
        finalMsg?.conversation_id ||
        null,
      messageId: finalOutbox?.message_id || finalMsg?.id || null,
      outboxId: finalOutbox?.id || null,
      idempotencyKey:
        finalOutbox?.idempotency_key || derivedIdempotencyKey || null,
      providerMessageId:
        finalOutbox?.provider_message_id ||
        gatewayLocks[0]?.provider_message_id ||
        null,
    },
    webhookEvents,
    agentRuns,
    messages,
    outboxItems,
    gatewayLocks,
    timeline,
    schemaWarnings,
  }
}
