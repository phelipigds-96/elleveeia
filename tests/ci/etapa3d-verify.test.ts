import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  ADDON_PACKAGE_SIZES,
  DEFAULT_ADDON_UNIT_PRICE_BRL,
  DEFAULT_OVERAGE_UNIT_PRICE_BRL,
  calculateCompanyBillingOverage,
  getCurrentBillingMonth,
  getTenantGovernanceReport,
  isOutboundSentSenderType,
  resolvePlanBillingKey,
} from '@/lib/services/platform/tenant-governance'

test('1. Migration 2026111204 cria schema seguro de pacotes extras e tarifas sem DDL destrutiva', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/2026111204_overage_and_addon_packages.sql'
  )
  assert.equal(fs.existsSync(migrationPath), true, 'Migration 2026111204 deve existir')

  const sql = fs.readFileSync(migrationPath, 'utf8')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.company_message_addons/i)
  assert.match(sql, /CHECK\s*\(\s*package_messages\s+IN\s*\(\s*1000\s*,\s*5000\s*,\s*10000\s*,\s*15000\s*\)\s*\)/i)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i)
  assert.match(sql, /public\.is_platform_admin\(\)/i)
  assert.match(sql, /addon_package_unit_price_brl/i)
  assert.match(sql, /overage_unit_price_brl/i)
  assert.match(sql, /custom_addon_unit_price_brl/i)
  assert.match(sql, /custom_overage_unit_price_brl/i)
  assert.equal(/\b(DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(sql), false)
})

test('2. Contagem justa contabiliza somente mensagens enviadas (agent e human)', () => {
  assert.deepEqual([...ADDON_PACKAGE_SIZES], [1000, 5000, 10000, 15000])
  assert.equal(DEFAULT_ADDON_UNIT_PRICE_BRL, 0.04)
  assert.equal(DEFAULT_OVERAGE_UNIT_PRICE_BRL, 0.07)

  assert.equal(isOutboundSentSenderType('agent'), true)
  assert.equal(isOutboundSentSenderType('human'), true)

  assert.equal(isOutboundSentSenderType('HUMAN'), false)
  assert.equal(isOutboundSentSenderType('customer'), false)
  assert.equal(isOutboundSentSenderType('system'), false)
  assert.equal(isOutboundSentSenderType(null), false)
  assert.equal(isOutboundSentSenderType(undefined), false)

  assert.equal(resolvePlanBillingKey('standard'), 'starter')
  assert.equal(resolvePlanBillingKey('Trial'), 'trial')
  assert.equal(resolvePlanBillingKey('PRO'), 'pro')
  assert.equal(resolvePlanBillingKey('enterprise'), 'enterprise')
  assert.match(getCurrentBillingMonth(new Date('2026-11-12T12:00:00Z')), /^2026-11$/)
})

test('3. calculateCompanyBillingOverage aplica ordem Franquia -> Pacote (1k/5k/10k/15k) -> Avulso', () => {
  // Cenário A: dentro da franquia base
  const withinBase = calculateCompanyBillingOverage({
    sentMessages: 2500,
    baseQuotaMessages: 5000,
  })
  assert.equal(withinBase.addonMessagesPurchased, 0)
  assert.equal(withinBase.effectiveQuotaMessages, 5000)
  assert.equal(withinBase.overageMessages, 0)
  assert.equal(withinBase.extraInvoiceTotalBrl, 0)

  // Cenário B: estourou a franquia base, mas coberto por pacote +1000 (R$ 0,04/msg = R$ 40,00)
  const coveredByAddon = calculateCompanyBillingOverage({
    sentMessages: 5800,
    baseQuotaMessages: 5000,
    addonMessagesPurchased: 1000,
    addonsTotalBrl: 40,
  })
  assert.equal(coveredByAddon.addonMessagesPurchased, 1000)
  assert.equal(coveredByAddon.effectiveQuotaMessages, 6000)
  assert.equal(coveredByAddon.coveredByAddonsMessages, 800)
  assert.equal(coveredByAddon.overageMessages, 0)
  assert.equal(coveredByAddon.addonsTotalBrl, 40)
  assert.equal(coveredByAddon.overageTotalBrl, 0)
  assert.equal(coveredByAddon.extraInvoiceTotalBrl, 40)

  // Cenário C: consumiu franquia (5000) + pacote (5000 a R$ 0,04 = R$ 200) + 1200 avulsas (R$ 0,07 = R$ 84)
  const mixedOverage = calculateCompanyBillingOverage({
    sentMessages: 11200,
    baseQuotaMessages: 5000,
    addonMessagesPurchased: 5000,
    addonsTotalBrl: 200,
  })
  assert.equal(mixedOverage.effectiveQuotaMessages, 10000)
  assert.equal(mixedOverage.overageMessages, 1200)
  assert.equal(mixedOverage.addonsTotalBrl, 200)
  assert.equal(mixedOverage.overageTotalBrl, 84)
  assert.equal(mixedOverage.extraInvoiceTotalBrl, 284)

  // Cenário D: Trial não cobra excedente automático por padrão + override customizado por tenant
  const trialExceeded = calculateCompanyBillingOverage({
    sentMessages: 1400,
    baseQuotaMessages: 1000,
    isTrial: true,
  })
  assert.equal(trialExceeded.overageMessages, 400)
  assert.equal(trialExceeded.overageTotalBrl, 0)
  assert.equal(trialExceeded.extraInvoiceTotalBrl, 0)

  const customRate = calculateCompanyBillingOverage({
    sentMessages: 6000,
    baseQuotaMessages: 5000,
    overageUnitPriceBrl: 0.05,
  })
  assert.equal(customRate.overageTotalBrl, 50)
  assert.equal(customRate.extraInvoiceTotalBrl, 50)
})

function buildMockQuery(rowsInput: any[], opts?: { error?: { code: string; message: string } }) {
  let rows = [...rowsInput]
  return {
    select() {
      return this
    },
    eq(col: string, val: any) {
      rows = rows.filter((r) => r?.[col] === val)
      return this
    },
    gte() {
      return this
    },
    order() {
      return this
    },
    limit(n: number) {
      rows = rows.slice(0, n)
      return this
    },
    then(resolve: any) {
      if (opts?.error) {
        return resolve({ data: null, error: opts.error })
      }
      return resolve({ data: rows, error: null })
    },
  }
}

test('4. getTenantGovernanceReport aplica contagem justa, pacotes extras e fallback sem migration 3D', async () => {
  const billingMonth = getCurrentBillingMonth()
  const companies = [
    {
      id: 'comp-sumel',
      name: 'Sumel',
      slug: 'sumel',
      plan_tier: 'starter',
      status: 'active',
      company_limits: [{ max_monthly_messages: 5000 }],
    },
  ]

  // 7.000 mensagens de clientes (NÃO devem contar) + 6.200 enviadas (agent + human)
  const messages = [
    ...Array.from({ length: 7000 }, () => ({ company_id: 'comp-sumel', sender_type: 'customer' })),
    ...Array.from({ length: 6000 }, () => ({ company_id: 'comp-sumel', sender_type: 'agent' })),
    ...Array.from({ length: 200 }, () => ({ company_id: 'comp-sumel', sender_type: 'human' })),
  ]

  const addons = [
    {
      company_id: 'comp-sumel',
      billing_month: billingMonth,
      package_messages: 1000,
      unit_price_brl: 0.04,
      total_price_brl: 40,
      status: 'active',
    },
  ]

  const plans = [
    {
      key: 'starter',
      addon_package_unit_price_brl: 0.04,
      overage_unit_price_brl: 0.07,
    },
  ]

  const mockAdmin = {
    from(table: string) {
      if (table === 'companies') return buildMockQuery(companies)
      if (table === 'messages') return buildMockQuery(messages)
      if (table === 'company_message_addons') return buildMockQuery(addons)
      if (table === 'platform_plans') return buildMockQuery(plans)
      return buildMockQuery([])
    },
  }

  const report = await getTenantGovernanceReport({ adminClient: mockAdmin, daysWindow: 30 })
  assert.equal(report.tenants.length, 1)
  const sumel = report.tenants[0]

  // Apenas 6.200 enviadas entram na cota e overage: 5.000 base + 1.000 bloco = 6.000 efetivo; 200 avulsas
  assert.equal(sumel.monthlyMessagesUsed, 13200)
  assert.equal(sumel.monthlySentMessagesUsed, 6200)
  assert.equal(sumel.addonMessagesPurchased, 1000)
  assert.equal(sumel.effectiveMessagesLimit, 6000)
  assert.equal(sumel.overageMessages, 200)
  assert.equal(sumel.addonsTotalBrl, 40)
  assert.equal(sumel.overageTotalBrl, 14) // 200 * 0.07
  assert.equal(sumel.extraInvoiceTotalBrl, 54)
  assert.equal(sumel.quotaStatus, 'exceeded')

  assert.equal(report.totals.totalAddonMessages, 1000)
  assert.equal(report.totals.totalOverageMessages, 200)
  assert.equal(report.totals.totalExtraInvoiceBrl, 54)

  // Fallback gracioso quando tabela company_message_addons ainda não existe (42P01)
  const legacyAdmin = {
    from(table: string) {
      if (table === 'companies') return buildMockQuery(companies)
      if (table === 'messages') return buildMockQuery(messages)
      if (table === 'company_message_addons') {
        return buildMockQuery([], {
          error: { code: '42P01', message: 'relation "public.company_message_addons" does not exist' },
        })
      }
      if (table === 'platform_plans') {
        return buildMockQuery([], {
          error: { code: '42703', message: 'column platform_plans.addon_package_unit_price_brl does not exist' },
        })
      }
      return buildMockQuery([])
    },
  }

  const legacyReport = await getTenantGovernanceReport({ adminClient: legacyAdmin, daysWindow: 30 })
  assert.equal(legacyReport.tenants.length, 1)
  assert.equal(legacyReport.tenants[0].monthlySentMessagesUsed, 6200)
  assert.equal(legacyReport.tenants[0].effectiveMessagesLimit, 5000)
  assert.equal(legacyReport.tenants[0].overageMessages, 1200)
  assert.equal(legacyReport.tenants[0].extraInvoiceTotalBrl, 84) // 1200 * 0.07 default
  assert.equal(legacyReport.schemaWarnings.some((w) => w.includes('company_message_addons')), true)
})
