import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import {
  createWorkflow,
  createWorkflowStage,
  updateWorkflowStage,
  deleteWorkflowStage,
  moveConversationStage,
  getOrCreateDefaultWorkflow
} from '@/lib/services/workflows/workflows'

import {
  createDefaultWorkflowAction,
  updateWorkflowStageAction
} from '@/app/(dashboard)/settings/workflows/actions'

test.describe('ETAPA 8.4.3P.2 — Correção da Integridade de Exclusão e Workflow Padrão', () => {
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED_ID = '33333333-3333-3333-3333-333333333333'

  const USER_ADMIN_A_ID = 'user-admin-a'
  const USER_ADMIN_B_ID = 'user-admin-b'
  const USER_ATTENDANT_A_ID = 'user-attendant-a'

  const WF_A1_ID = 'aaaaaaaa-1111-1111-1111-111111111111'
  const WF_B1_ID = 'bbbbbbbb-1111-1111-1111-111111111111'

  const STAGE_A1_1_ID = 'aaaaaaaa-1111-1111-1111-000000000001'
  const STAGE_A1_2_ID = 'aaaaaaaa-1111-1111-1111-000000000002'
  const STAGE_B1_1_ID = 'bbbbbbbb-1111-1111-1111-000000000001'

  const CONV_1_ID = 'cccccccc-1111-1111-1111-000000000001'
  const CONV_2_ID = 'cccccccc-1111-1111-1111-000000000002'
  const CONV_3_ID = 'cccccccc-1111-1111-1111-000000000003'

  function seedDb() {
    resetInMemoryDb()

    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa Alpha',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa Beta',
      status: 'active',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Suspensa',
      status: 'suspended',
      plan_tier: 'standard'
    })

    inMemoryDb.profiles.set(USER_ADMIN_A_ID, {
      id: USER_ADMIN_A_ID,
      company_id: TENANT_A_ID,
      role: 'admin',
      name: 'Admin Alpha'
    })
    inMemoryDb.profiles.set(USER_ADMIN_B_ID, {
      id: USER_ADMIN_B_ID,
      company_id: TENANT_B_ID,
      role: 'admin',
      name: 'Admin Beta'
    })
    inMemoryDb.profiles.set(USER_ATTENDANT_A_ID, {
      id: USER_ATTENDANT_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant',
      name: 'Atendente Alpha'
    })

    inMemoryDb.workflows.set(WF_A1_ID, {
      id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Atendimento Principal Alpha',
      is_default: true,
      is_active: true
    })
    inMemoryDb.workflows.set(WF_B1_ID, {
      id: WF_B1_ID,
      company_id: TENANT_B_ID,
      name: 'Atendimento Principal Beta',
      is_default: true,
      is_active: true
    })

    inMemoryDb.workflow_stages.set(STAGE_A1_1_ID, {
      id: STAGE_A1_1_ID,
      workflow_id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Entrada',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_A1_2_ID, {
      id: STAGE_A1_2_ID,
      workflow_id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Em Andamento',
      position: 1,
      stage_type: 'in_progress',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_B1_1_ID, {
      id: STAGE_B1_1_ID,
      workflow_id: WF_B1_ID,
      company_id: TENANT_B_ID,
      name: 'Entrada Beta',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })

    inMemoryDb.conversations.set(CONV_1_ID, {
      id: CONV_1_ID,
      company_id: TENANT_A_ID,
      workflow_id: WF_A1_ID,
      workflow_stage_id: STAGE_A1_1_ID,
      status: 'active'
    })
    inMemoryDb.conversations.set(CONV_2_ID, {
      id: CONV_2_ID,
      company_id: TENANT_A_ID,
      workflow_id: WF_A1_ID,
      workflow_stage_id: null,
      status: 'active'
    })
    inMemoryDb.conversations.set(CONV_3_ID, {
      id: CONV_3_ID,
      company_id: TENANT_A_ID,
      workflow_id: WF_A1_ID,
      workflow_stage_id: STAGE_A1_2_ID,
      status: 'active'
    })
  }

  test.beforeEach(() => {
    seedDb()
  })

  // ============================================================================
  // PARTE 1: INTEGRIDADE E EXCLUSÃO (BUG-01)
  // ============================================================================

  test('1. Excluir somente a etapa vinculada deixa conversa com workflow_id mantido e stage_id = NULL', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // Exclui STAGE_A1_1 utilizada pela CONV_1
    await deleteWorkflowStage(STAGE_A1_1_ID, { supabaseClient: clientAdminA })

    // Conversa 1 deve permanecer com workflow_id mas sem etapa
    const conv1 = inMemoryDb.conversations.get(CONV_1_ID)
    assert.equal(conv1.workflow_stage_id, null, 'workflow_stage_id deve ser anulado via ON DELETE SET NULL')
    assert.equal(conv1.workflow_id, WF_A1_ID, 'workflow_id deve ser preservado')
  })

  test('2. Excluir workflow com conversa vinculada sem etapa deixa ambos nulos', async () => {
    const adminDirect = createAdminClient()

    // Exclui o workflow WF_A1
    await adminDirect.from('workflows').delete().eq('id', WF_A1_ID)

    // Conversa 2 (que estava sem etapa) deve ficar com workflow_id = null
    const conv2 = inMemoryDb.conversations.get(CONV_2_ID)
    assert.equal(conv2.workflow_id, null)
    assert.equal(conv2.workflow_stage_id, null)
  })

  test('3. Excluir workflow com conversa vinculada a uma etapa deixa ambos nulos sem violar FK', async () => {
    const adminDirect = createAdminClient()

    // Exclui o workflow WF_A1
    await adminDirect.from('workflows').delete().eq('id', WF_A1_ID)

    // Conversa 1 (que tinha etapa STAGE_A1_1) deve terminar com ambos nulos
    const conv1 = inMemoryDb.conversations.get(CONV_1_ID)
    assert.equal(conv1.workflow_id, null)
    assert.equal(conv1.workflow_stage_id, null)
  })

  test('4. Excluir workflow com várias etapas e várias conversas limpa todas as referências', async () => {
    const adminDirect = createAdminClient()

    await adminDirect.from('workflows').delete().eq('id', WF_A1_ID)

    const c1 = inMemoryDb.conversations.get(CONV_1_ID)
    const c2 = inMemoryDb.conversations.get(CONV_2_ID)
    const c3 = inMemoryDb.conversations.get(CONV_3_ID)

    assert.equal(c1.workflow_id, null)
    assert.equal(c1.workflow_stage_id, null)
    assert.equal(c2.workflow_id, null)
    assert.equal(c2.workflow_stage_id, null)
    assert.equal(c3.workflow_id, null)
    assert.equal(c3.workflow_stage_id, null)

    // E todas as etapas do workflow foram removidas em cascata
    assert.equal(inMemoryDb.workflow_stages.has(STAGE_A1_1_ID), false)
    assert.equal(inMemoryDb.workflow_stages.has(STAGE_A1_2_ID), false)
  })

  test('5. Atualização manual tentando deixar workflow_id = NULL mantendo etapa é rejeitada', async () => {
    const adminDirect = createAdminClient()

    // Tentativa manual de anular apenas workflow_id mantendo workflow_stage_id
    const { error } = await adminDirect.from('conversations').update({
      workflow_id: null
    }).eq('id', CONV_1_ID)

    assert.ok(error, 'Deve rejeitar anulação manual de workflow com etapa vinculada')
    assert.match(error.message, /não é permitido anular o workflow/i)
  })

  test('6. Movimentação normal entre etapas continua funcionando perfeitamente', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    await moveConversationStage(CONV_1_ID, STAGE_A1_2_ID, { supabaseClient: clientAdminA })

    const conv = inMemoryDb.conversations.get(CONV_1_ID)
    assert.equal(conv.workflow_stage_id, STAGE_A1_2_ID)
    assert.equal(conv.workflow_id, WF_A1_ID)
  })

  test('7. Associações cross-tenant continuam bloqueadas', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_1_ID, STAGE_B1_1_ID, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )
  })

  // ============================================================================
  // PARTE 2: UNICIDADE E IDEMPOTÊNCIA DO WORKFLOW PADRÃO (BUG-02 e BUG-03)
  // ============================================================================

  test('8. Criar primeiro workflow padrão para empresa sem workflows cria com sucesso', async () => {
    // Nova empresa sem workflows
    const TENANT_NEW_ID = '99999999-9999-9999-9999-999999999999'
    const USER_ADMIN_NEW_ID = 'user-admin-new'

    inMemoryDb.companies.set(TENANT_NEW_ID, {
      id: TENANT_NEW_ID,
      name: 'Empresa Nova',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.profiles.set(USER_ADMIN_NEW_ID, {
      id: USER_ADMIN_NEW_ID,
      company_id: TENANT_NEW_ID,
      role: 'admin'
    })

    const clientNew = createAuthenticatedClient({ userId: USER_ADMIN_NEW_ID })

    const result = await getOrCreateDefaultWorkflow({ supabaseClient: clientNew })
    assert.ok(result.workflow)
    assert.equal(result.workflow.company_id, TENANT_NEW_ID)
    assert.equal(result.workflow.is_default, true)
    assert.equal(result.created, true)

    // Etapas padrão foram criadas
    const stages = Array.from(inMemoryDb.workflow_stages.values()).filter(s => s.workflow_id === result.workflow.id)
    assert.equal(stages.length, 3)
  })

  test('9. Repetir chamada de criação retorna o workflow existente sem duplicar (idempotência)', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    const countBefore = Array.from(inMemoryDb.workflows.values()).filter(w => w.company_id === TENANT_A_ID).length

    // Empresa Alpha já possui WF_A1 como padrão
    const result = await getOrCreateDefaultWorkflow({ supabaseClient: clientAdminA })

    assert.equal(result.created, false)
    assert.equal(result.workflow.id, WF_A1_ID)

    const countAfter = Array.from(inMemoryDb.workflows.values()).filter(w => w.company_id === TENANT_A_ID).length
    assert.equal(countBefore, countAfter, 'Nenhum novo workflow deve ser inserido')
  })

  test('10. Tentativa de inserir segundo workflow padrão via banco é rejeitada pela constraint uq_workflows_company_default', async () => {
    const adminDirect = createAdminClient()

    // Empresa Alpha já possui WF_A1 com is_default = true
    const { error } = await adminDirect.from('workflows').insert({
      id: 'aaaaaaaa-9999-9999-9999-999999999999',
      company_id: TENANT_A_ID,
      name: 'Segundo Workflow Padrão',
      is_default: true,
      is_active: true
    })

    assert.ok(error, 'Deve rejeitar segundo workflow padrão para a mesma empresa')
    assert.equal(error.code, '23505')
    assert.match(error.message, /uq_workflows_company_default/i)
  })

  test('11. Empresas diferentes podem possuir cada uma o seu próprio workflow padrão', async () => {
    const wfA = inMemoryDb.workflows.get(WF_A1_ID)
    const wfB = inMemoryDb.workflows.get(WF_B1_ID)

    assert.equal(wfA.is_default, true)
    assert.equal(wfA.company_id, TENANT_A_ID)
    assert.equal(wfB.is_default, true)
    assert.equal(wfB.company_id, TENANT_B_ID)
  })

  test('12. Simulação de concorrência: colisão em uq_workflows_company_default recupera o padrão vencedor', async () => {
    const TENANT_RACE_ID = '77777777-7777-7777-7777-777777777777'
    const USER_RACE_ID = 'user-race'

    inMemoryDb.companies.set(TENANT_RACE_ID, {
      id: TENANT_RACE_ID,
      name: 'Empresa Corrida',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.profiles.set(USER_RACE_ID, {
      id: USER_RACE_ID,
      company_id: TENANT_RACE_ID,
      role: 'admin'
    })

    const clientRace = createAuthenticatedClient({ userId: USER_RACE_ID })

    // Dispara duas criações concorrentes simultâneas via Promise.all
    const [res1, res2] = await Promise.all([
      getOrCreateDefaultWorkflow({ supabaseClient: clientRace }),
      getOrCreateDefaultWorkflow({ supabaseClient: clientRace })
    ])

    // Ambas devem ter retornado o MESMO workflow ID
    assert.equal(res1.workflow.id, res2.workflow.id)
    assert.equal(res1.workflow.company_id, TENANT_RACE_ID)

    // E apenas 1 workflow deve existir para esta empresa no banco
    const wfs = Array.from(inMemoryDb.workflows.values()).filter(w => w.company_id === TENANT_RACE_ID)
    assert.equal(wfs.length, 1)
  })

  test('13. Tratamento de workflow padrão inativo: não cria outro e exige reativação operacional', async () => {
    // Desativa o workflow padrão de Alpha
    const wfA = inMemoryDb.workflows.get(WF_A1_ID)
    wfA.is_active = false
    inMemoryDb.workflows.set(WF_A1_ID, wfA)

    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    await assert.rejects(
      async () => {
        await getOrCreateDefaultWorkflow({ supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /se encontra inativo\. Reative o workflow existente/i)
        return true
      }
    )

    // Nenhum novo workflow criado
    const wfs = Array.from(inMemoryDb.workflows.values()).filter(w => w.company_id === TENANT_A_ID)
    assert.equal(wfs.length, 1)
  })

  test('14. Se já existir workflow com nome Atendimento Principal não padrão, promove-o a padrão sem criar duplicata', async () => {
    const TENANT_NAMED_ID = '66666666-6666-6666-6666-666666666666'
    const USER_NAMED_ID = 'user-named'
    const WF_NAMED_ID = 'aaaaaaaa-6666-6666-6666-000000000001'

    inMemoryDb.companies.set(TENANT_NAMED_ID, {
      id: TENANT_NAMED_ID,
      name: 'Empresa com Nome Existente',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.profiles.set(USER_NAMED_ID, {
      id: USER_NAMED_ID,
      company_id: TENANT_NAMED_ID,
      role: 'admin'
    })
    inMemoryDb.workflows.set(WF_NAMED_ID, {
      id: WF_NAMED_ID,
      company_id: TENANT_NAMED_ID,
      name: 'Atendimento Principal',
      is_default: false,
      is_active: true
    })

    const clientNamed = createAuthenticatedClient({ userId: USER_NAMED_ID })

    const result = await getOrCreateDefaultWorkflow({ supabaseClient: clientNamed })

    assert.equal(result.workflow.id, WF_NAMED_ID)
    assert.equal(result.created, false)
    assert.equal(result.workflow.is_default, true)

    // Garante que não criou um segundo "Atendimento Principal"
    const wfs = Array.from(inMemoryDb.workflows.values()).filter(w => w.company_id === TENANT_NAMED_ID)
    assert.equal(wfs.length, 1)
  })

  // ============================================================================
  // PARTE 3: AUDITORIA ESTÁTICA DAS MIGRATIONS E SCRIPTS (TESTES ESTÁTICOS)
  // ============================================================================

  test('15. [ESTÁTICO] Migration 20261104_conversation_workflow_tenant_integrity possui trigger BEFORE DELETE e bloqueio de anulação manual', () => {
    const filePath = path.resolve(
      process.cwd(),
      'supabase/migrations/2026110401_conversation_workflow_tenant_integrity.sql'
    )
    assert.ok(fs.existsSync(filePath))
    const sql = fs.readFileSync(filePath, 'utf8')

    // Trigger BEFORE DELETE de desacoplamento atômico
    assert.match(sql, /trg_unlink_conversations_before_workflow_delete/i)
    assert.match(sql, /unlink_conversations_before_workflow_delete/i)
    assert.match(sql, /BEFORE DELETE ON public\.workflows/i)

    // Bloqueio de anulação manual mantendo etapa
    assert.match(sql, /não é permitido anular o workflow/i)

    // Governança de search_path e SECURITY DEFINER
    assert.match(sql, /SECURITY DEFINER/i)
    assert.match(sql, /SET search_path = pg_catalog, public, pg_temp/i)
  })

  test('16. [ESTÁTICO] Migration 20261104_workflows_default_uniqueness possui pré-auditoria e índice único parcial', () => {
    const filePath = path.resolve(
      process.cwd(),
      'supabase/migrations/2026110402_workflows_default_uniqueness.sql'
    )
    assert.ok(fs.existsSync(filePath))
    const sql = fs.readFileSync(filePath, 'utf8')

    // Pré-auditoria sem expurgo automático
    assert.match(sql, /DO \$\$/i)
    assert.match(sql, /HAVING COUNT\(\*\)\s*>\s*1/i)
    assert.match(sql, /RAISE EXCEPTION/i)
    assert.doesNotMatch(sql, /DELETE FROM public\.workflows/i)
    assert.doesNotMatch(sql, /UPDATE public\.workflows SET/i)

    // Criação do índice único parcial
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_company_default/i)
    assert.match(sql, /ON public\.workflows\s*\(company_id\)/i)
    assert.match(sql, /WHERE is_default = true/i)
  })

  test('17. [ESTÁTICO] Script audit_workflow_default_duplicates é estritamente de leitura (READ-ONLY)', () => {
    const scriptPath = path.resolve(
      process.cwd(),
      'supabase/scripts/audit_workflow_default_duplicates.sql'
    )
    assert.ok(fs.existsSync(scriptPath))
    const sql = fs.readFileSync(scriptPath, 'utf8')

    assert.match(sql, /SELECT/i)
    assert.match(sql, /HAVING COUNT\(w\.id\)\s*>\s*1/i)
    assert.doesNotMatch(sql, /INSERT\s+INTO|\bUPDATE\s+public\b|\bDELETE\s+FROM\b/i)
  })
})
