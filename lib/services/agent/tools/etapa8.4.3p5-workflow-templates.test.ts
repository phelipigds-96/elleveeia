/**
 * Testes unitários do Marco 1 — Biblioteca de Templates de Funil por Segmento.
 *
 * Escopo deliberadamente restrito às funções puras (sem banco de dados):
 *   - Integridade do catálogo de templates (chaves, rótulos, cores).
 *   - Compatibilidade com o enum existente `stage_type`.
 *   - Domínio de `handled_by` ('ai' | 'human' | 'waiting').
 *   - Comportamento de `getWorkflowTemplate`.
 *
 * A aplicação do template em si (`applyWorkflowTemplate`) é coberta por
 * integração no ambiente com Supabase, pois exige sessão, tenant ativo e
 * escrita em `workflow_stages`/`conversations`.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  DEFAULT_WORKFLOW_STAGES,
  type WorkflowTemplate,
} from '../../workflows/template-catalog.ts'

const VALID_STAGE_TYPES = ['initial', 'in_progress', 'final']
const VALID_HANDLED_BY = ['ai', 'human', 'waiting']
const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

test('catálogo de templates expõe as quatro verticais esperadas', () => {
  const expected = ['retail_food', 'events_party', 'dental_clinic', 'general_services']
  for (const key of expected) {
    assert.ok(WORKFLOW_TEMPLATES[key], `template ausente: ${key}`)
  }
})

test('cada template possui rótulo, segmento, descrição e ao menos uma etapa', () => {
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    assert.ok(template.key.length > 0)
    assert.ok(template.label.length > 0)
    assert.ok(template.segment.length > 0)
    assert.ok(template.description.length > 0)
    assert.ok(Array.isArray(template.stages) && template.stages.length > 0)
  }
})

test('toda etapa usa stage_type válido e handled_by dentro do domínio', () => {
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    for (const stage of template.stages) {
      assert.ok(
        VALID_STAGE_TYPES.includes(stage.stage_type),
        `stage_type inválido em ${template.key}/${stage.name}: ${stage.stage_type}`
      )
      assert.ok(
        VALID_HANDLED_BY.includes(stage.handled_by),
        `handled_by inválido em ${template.key}/${stage.name}: ${stage.handled_by}`
      )
      assert.ok(
        HEX_COLOR_REGEX.test(stage.color),
        `cor inválida em ${template.key}/${stage.name}: ${stage.color}`
      )
      assert.ok(stage.name.trim().length > 0)
    }
  }
})

test('todo template possui exatamente uma etapa inicial e ao menos uma final', () => {
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    const initials = template.stages.filter((s) => s.stage_type === 'initial')
    const finals = template.stages.filter((s) => s.stage_type === 'final')
    assert.equal(initials.length, 1, `template ${template.key} deve ter uma única etapa inicial`)
    assert.ok(finals.length >= 1, `template ${template.key} deve ter ao menos uma etapa final`)
  }
})

test('nomes de etapa são únicos dentro de cada template', () => {
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    const normalized = template.stages.map((s) => s.name.trim().toLowerCase())
    assert.equal(new Set(normalized).size, normalized.length, `nomes duplicados em ${template.key}`)
  }
})

test('a etapa inicial de cada template é conduzida pela IA', () => {
  for (const template of Object.values(WORKFLOW_TEMPLATES)) {
    const initial = template.stages.find((s) => s.stage_type === 'initial')
    assert.ok(initial)
    assert.equal(initial?.handled_by, 'ai', `etapa inicial de ${template.key} deve ser da IA`)
  }
})

test('getWorkflowTemplate resolve chaves conhecidas e rejeita desconhecidas', () => {
  const template: WorkflowTemplate | null = getWorkflowTemplate('retail_food')
  assert.ok(template)
  assert.equal(template?.key, 'retail_food')

  assert.equal(getWorkflowTemplate('inexistente'), null)
  assert.equal(getWorkflowTemplate(''), null)
})

test('getWorkflowTemplate tolera espaços nas bordas da chave', () => {
  const template = getWorkflowTemplate('  dental_clinic  ')
  assert.ok(template)
  assert.equal(template?.key, 'dental_clinic')
})

test('etapas padrão do funil seguem o mesmo domínio de cor e handled_by', () => {
  for (const stage of DEFAULT_WORKFLOW_STAGES) {
    assert.ok(
      VALID_STAGE_TYPES.includes(stage.stage_type),
      `stage_type inválido na etapa padrão ${stage.name}`
    )
    assert.ok(
      VALID_HANDLED_BY.includes(stage.handled_by as string),
      `handled_by inválido na etapa padrão ${stage.name}`
    )
    assert.ok(
      HEX_COLOR_REGEX.test(stage.color as string),
      `cor inválida na etapa padrão ${stage.name}`
    )
  }
})
