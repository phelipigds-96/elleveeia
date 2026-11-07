// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AGENT_BLUEPRINTS,
  getPlatformAgentsList,
} from '@/lib/services/platform/agents'
import {
  PLATFORM_PROVIDERS,
  PLATFORM_INFRA_CONFIG,
  getPlatformProvidersData,
} from '@/lib/services/platform/providers'
import {
  humanizeAuditAction,
  humanizeAuditDetails,
} from '@/lib/services/platform/admin-metrics'

describe('ETAPA 8.4.3U — Agentes e Provedores do Painel SuperAdmin', () => {
  test('AGENT_BLUEPRINTS possui 4 templates de indústria com OpenAI nativa', () => {
    assert.equal(AGENT_BLUEPRINTS.length, 4)
    const sumelBlueprint = AGENT_BLUEPRINTS.find((b) => b.key === 'retail-confectionery')
    assert.ok(sumelBlueprint, 'Template de varejo e doceria Sumel deve existir')
    assert.equal(sumelBlueprint.recommendedProvider, 'openai')
    assert.equal(sumelBlueprint.recommendedModel, 'gpt-4o-mini')
    assert.match(sumelBlueprint.badge, /Sumel/i)
  })

  test('getPlatformAgentsList mapeia empresas e agentes com fallback resiliente', async () => {
    const mockDbRows = [
      {
        id: 'agent-1-uuid',
        company_id: 'comp-1-uuid',
        name: 'Doceria Sumel - Vendas & Delivery',
        segment: 'Confeitaria',
        model: 'gpt-4o-mini',
        provider: 'openai',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        companies: {
          id: 'comp-1-uuid',
          name: 'Sumel Atacado e Varejo',
          slug: 'sumel-atacado-e-varejo',
        },
      },
    ]

    const mockClient = {
      from: () => ({
        select: () => ({
          order: async () => ({ data: mockDbRows, error: null }),
        }),
      }),
    }

    const agents = await getPlatformAgentsList({ adminClient: mockClient })
    assert.equal(agents.length, 1)
    assert.equal(agents[0].name, 'Doceria Sumel - Vendas & Delivery')
    assert.equal(agents[0].companyName, 'Sumel Atacado e Varejo')
    assert.equal(agents[0].companySlug, 'sumel-atacado-e-varejo')
    assert.equal(agents[0].provider, 'openai')
    assert.equal(agents[0].isActive, true)
  })

  test('PLATFORM_PROVIDERS tem OpenAI configurada como provedor primário ativo', () => {
    const openai = PLATFORM_PROVIDERS.find((p) => p.key === 'openai')
    assert.ok(openai)
    assert.equal(openai.isPrimary, true)
    assert.equal(openai.status, 'operational')
    assert.ok(openai.supportedModels.includes('gpt-4o-mini'))
    assert.ok(openai.supportedModels.includes('gpt-4o'))
  })

  test('PLATFORM_INFRA_CONFIG define políticas transacionais e de concorrência seguras', () => {
    assert.equal(PLATFORM_INFRA_CONFIG.primaryProvider, 'openai')
    assert.equal(PLATFORM_INFRA_CONFIG.concurrencyLeaseSeconds, 120)
    assert.equal(PLATFORM_INFRA_CONFIG.retryAttempts, 3)
    assert.equal(PLATFORM_INFRA_CONFIG.gatewayLockActive, true)
  })

  test('Auditoria humaniza ações de agentes e provedores adequadamente', () => {
    const actAgent = humanizeAuditAction('agent.status_changed')
    assert.equal(actAgent.label, 'Agentes')

    const actProvider = humanizeAuditAction('provider.tested')
    assert.equal(actProvider.label, 'Provedores')

    const agentDetails = humanizeAuditDetails('agent.status_changed', {
      agent_name: 'Doceria Sumel - Atendimento',
      company_name: 'Sumel',
      new_status: 'pausado',
    })
    assert.match(agentDetails, /Doceria Sumel - Atendimento/)
    assert.match(agentDetails, /pausado/)

    const providerDetails = humanizeAuditDetails('provider.tested', {
      provider: 'OPENAI',
      status: 'OK',
      latency_ms: 380,
    })
    assert.match(providerDetails, /OPENAI/)
    assert.match(providerDetails, /380ms/)
  })
})
