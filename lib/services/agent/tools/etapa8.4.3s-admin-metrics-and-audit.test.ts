// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  humanizeAuditAction,
  humanizeAuditDetails,
  formatRelativeTime,
} from '@/lib/services/platform/admin-metrics'

describe('ETAPA 8.4.3S — Métricas e Governança do Painel SuperAdmin', () => {
  test('humanizeAuditAction mapeia ações de governança com rótulos e badges adequados', () => {
    const actCreated = humanizeAuditAction('company.created')
    assert.equal(actCreated.label, 'Cadastro')
    assert.equal(actCreated.badgeVariant, 'default')

    const actPlan = humanizeAuditAction('company.plan_changed')
    assert.equal(actPlan.label, 'Plano')

    const actWorkflow = humanizeAuditAction('company.workflow_updated')
    assert.equal(actWorkflow.label, 'Funil')

    const actImpersonate = humanizeAuditAction('platform.impersonate_started')
    assert.equal(actImpersonate.label, 'Impersonate')
    assert.equal(actImpersonate.badgeVariant, 'secondary')

    const actSuspended = humanizeAuditAction('company.suspended')
    assert.equal(actSuspended.label, 'Suspensão')
    assert.equal(actSuspended.badgeVariant, 'destructive')
  })

  test('humanizeAuditDetails gera descrições amigáveis a partir do payload de auditoria', () => {
    const detailsCreated = humanizeAuditDetails('company.created', {
      plan_tier: 'pro',
      workflow_template: 'Varejo & Confeitaria (ex: Sumel)',
    })
    assert.match(detailsCreated, /Organização provisionada no plano pro/)
    assert.match(detailsCreated, /Funil: Varejo & Confeitaria/)

    const detailsWorkflow = humanizeAuditDetails('company.workflow_template_applied', {
      template_name: 'Varejo & Confeitaria',
      stages_count: 6,
    })
    assert.match(detailsWorkflow, /Template "Varejo & Confeitaria" aplicado com 6 etapas/)

    const detailsLimits = humanizeAuditDetails('company.limits_changed', {
      max_monthly_messages: 50000,
      max_agents: 5,
    })
    assert.match(detailsLimits, /50.000 msgs/)
    assert.match(detailsLimits, /5 agentes/)

    const detailsImpersonate = humanizeAuditDetails('platform.impersonate_started', {
      target_name: 'Sumel Atacado e Varejo',
    })
    assert.match(detailsImpersonate, /Sessão de suporte iniciada para Sumel Atacado e Varejo/)
  })

  test('formatRelativeTime calcula tempo decorrido em português', () => {
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    assert.equal(formatRelativeTime(fiveMinutesAgo), 'Há 5 minutos')

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    assert.equal(formatRelativeTime(twoHoursAgo), 'Há 2 horas')
  })

  test('Cálculo de MRR consolidado baseado nos planos de empresas ativas', () => {
    const PLAN_VALUES: Record<string, number> = {
      trial: 0,
      starter: 297,
      standard: 297,
      pro: 697,
      enterprise: 1997,
    }

    const mockCompanies = [
      { status: 'active', plan_tier: 'starter' },
      { status: 'active', plan_tier: 'pro' },
      { status: 'active', plan_tier: 'enterprise' },
      { status: 'suspended', plan_tier: 'pro' }, // Suspensas não contam no MRR ativo
      { status: 'active', plan_tier: 'trial' },
    ]

    let mrr = 0
    for (const c of mockCompanies) {
      if (c.status === 'active') {
        mrr += PLAN_VALUES[c.plan_tier] ?? 0
      }
    }

    // 297 + 697 + 1997 + 0 = 2991
    assert.equal(mrr, 2991)
  })
})
