// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PLANS,
  getPlatformPlans,
  PlatformPlan,
} from '@/lib/services/platform/plans'
import {
  humanizeAuditAction,
  humanizeAuditDetails,
} from '@/lib/services/platform/admin-metrics'

describe('ETAPA 8.4.3T — Planos e Limites da Plataforma (OpenAI Nativa)', () => {
  test('DEFAULT_PLANS possui os 4 níveis esperados da plataforma', () => {
    assert.equal(DEFAULT_PLANS.length, 4)
    const keys = DEFAULT_PLANS.map((p) => p.key)
    assert.deepEqual(keys, ['trial', 'starter', 'pro', 'enterprise'])
  })

  test('Todos os planos padrão configuram OpenAI como provedor de LLM prioritário', () => {
    for (const plan of DEFAULT_PLANS) {
      assert.equal(plan.defaultAiProvider, 'openai', `Plano ${plan.key} deve ter OpenAI como defaultAiProvider`)
      assert.ok(
        plan.allowedLlmProviders.includes('openai'),
        `Plano ${plan.key} deve conter openai em allowedLlmProviders`
      )
    }
  })

  test('Plano Pro possui os parâmetros comerciais e limites recomendados para a Sumel', () => {
    const proPlan = DEFAULT_PLANS.find((p) => p.key === 'pro')
    assert.ok(proPlan, 'Plano Pro deve existir')
    assert.equal(proPlan.priceMonthly, 697)
    assert.equal(proPlan.maxMonthlyMessages, 25000)
    assert.equal(proPlan.maxAgents, 5)
    assert.equal(proPlan.maxCatalogItems, 50000)
    assert.equal(proPlan.defaultAiModel, 'gpt-4o')
    assert.equal(proPlan.isPopular, true)
    assert.match(proPlan.badge || '', /Recomendado Sumel/i)
  })

  test('getPlatformPlans retorna DEFAULT_PLANS resiliente em caso de banco offline ou vazio', async () => {
    const mockClientEmpty = {
      from: () => ({
        select: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
    }

    const plans = await getPlatformPlans({ adminClient: mockClientEmpty })
    assert.equal(plans.length, 4)
    assert.equal(plans[0].key, 'trial')
    assert.equal(plans[2].key, 'pro')
  })

  test('getPlatformPlans funde alterações persistidas do banco sobre os planos padrão', async () => {
    const mockDbRows = [
      {
        id: 'plan-pro-custom-uuid',
        key: 'pro',
        name: 'Pro Avançado (Sumel)',
        description: 'Plano customizado',
        price_monthly: 750,
        max_monthly_messages: 30000,
        max_agents: 6,
        max_catalog_items: 60000,
        max_monthly_quotes: 6000,
        default_ai_provider: 'openai',
        default_ai_model: 'gpt-4o',
        allowed_llm_providers: ['openai'],
        features: ['Suporte 24/7 Sumel', 'Agente de Cardápio Ativo'],
        badge: 'Custom Sumel',
        is_popular: true,
        active: true,
      },
    ]

    const mockClientWithData = {
      from: () => ({
        select: () => ({
          order: async () => ({ data: mockDbRows, error: null }),
        }),
      }),
    }

    const plans = await getPlatformPlans({ adminClient: mockClientWithData })
    const pro = plans.find((p) => p.key === 'pro')
    assert.ok(pro)
    assert.equal(pro.name, 'Pro Avançado (Sumel)')
    assert.equal(pro.priceMonthly, 750)
    assert.equal(pro.maxMonthlyMessages, 30000)
    assert.equal(pro.maxAgents, 6)
    assert.equal(pro.badge, 'Custom Sumel')
    assert.deepEqual(pro.features, ['Suporte 24/7 Sumel', 'Agente de Cardápio Ativo'])
  })

  test('Auditoria registra e humaniza a ação plan.updated adequadamente', () => {
    const actionMeta = humanizeAuditAction('plan.updated')
    assert.equal(actionMeta.label, 'Planos')
    assert.equal(actionMeta.badgeVariant, 'default')

    const details = humanizeAuditDetails('plan.updated', {
      plan_key: 'pro',
      plan_name: 'Pro',
      changes_summary: 'R$ 697/mês, 25.000 msgs, 5 agentes, Modelo: gpt-4o',
    })
    assert.match(details, /Plano Pro atualizado/i)
    assert.match(details, /25\.000 msgs/i)
    assert.match(details, /gpt-4o/i)
  })
})
