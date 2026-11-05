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
  getOrCreateDefaultWorkflow,
  DEFAULT_WORKFLOW_STAGES
} from '@/lib/services/workflows/workflows'

test.describe('ETAPA 8.4.3P.4 — Desvinculação Atômica Pré-Exclusão e Recuperação de Etapas', () => {
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'

  const USER_ADMIN_A_ID = 'user-admin-a'
  const USER_ADMIN_B_ID = 'user-admin-b'

  const WF_A1_ID = 'aaaaaaaa-1111-1111-1111-111111111111'
  const WF_B1_ID = 'bbbbbbbb-1111-1111-1111-111111111111'

  const STAGE_A1_1_ID = 'aaaaaaaa-1111-1111-1111-000000000001'
  const STAGE_A1_2_ID = 'aaaaaaaa-1111-1111-1111-000000000002'
  const STAGE_A1_3_ID = 'aaaaaaaa-1111-1111-1111-000000000003'

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
      name: 'Novo Contato',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_A1_2_ID, {
      id: STAGE_A1_2_ID,
      workflow_id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Em Atendimento',
      position: 1,
      stage_type: 'in_progress',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_A1_3_ID, {
      id: STAGE_A1_3_ID,
      workflow_id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Finalizado',
      position: 2,
      stage_type: 'final',
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
  // PARTE 1: CENÁRIOS DE EXCLUSÃO E INTEGRIDADE (MOCK SERVICE)
  // ============================================================================

  test('1. [MOCK SERVICE] Exclusão de workflow com conversas sem etapa desacopla conversa perfeitamente', async () => {
    const adminDirect = createAdminClient()

    // Exclui o workflow WF_A1
    await adminDirect.from('workflows').delete().eq('id', WF_A1_ID)

    const conv2 = inMemoryDb.conversations.get(CONV_2_ID)
    assert.equal(conv2.workflow_id, null, 'workflow_id deve ser anulado')
    assert.equal(conv2.workflow_stage_id, null, 'workflow_stage_id deve permanecer nulo')
  })

  test('2. [MOCK SERVICE] Exclusão de workflow com conversas em etapas desacopla ambos os campos', async () => {
    const adminDirect = createAdminClient()

    await adminDirect.from('workflows').delete().eq('id', WF_A1_ID)

    const conv1 = inMemoryDb.conversations.get(CONV_1_ID)
    assert.equal(conv1.workflow_id, null, 'workflow_id deve ser anulado')
    assert.equal(conv1.workflow_stage_id, null, 'workflow_stage_id deve ser anulado atomicamente')
  })

  test('3. [MOCK SERVICE] Exclusão de workflow com várias etapas e conversas limpa todo o grafo', async () => {
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

    // Todas as etapas foram removidas
    assert.equal(inMemoryDb.workflow_stages.has(STAGE_A1_1_ID), false)
    assert.equal(inMemoryDb.workflow_stages.has(STAGE_A1_2_ID), false)
    assert.equal(inMemoryDb.workflow_stages.has(STAGE_A1_3_ID), false)
  })

  test('4. [MOCK SERVICE] Atualização manual inválida tentando deixar workflow nulo e etapa preenchida é rejeitada', async () => {
    const adminDirect = createAdminClient()

    const { error } = await adminDirect.from('conversations').update({
      workflow_id: null
    }).eq('id', CONV_1_ID)

    assert.ok(error, 'Deve rejeitar anulação manual de workflow mantendo etapa')
    assert.match(error.message, /não é permitido anular o workflow/i)
  })

  test('5. [MOCK SERVICE] Atualizações normais em conversa sem alteração de etapas funcionam perfeitamente sem efeitos colaterais', async () => {
    const adminDirect = createAdminClient()

    // Atualização normal de outro campo (status)
    const { error } = await adminDirect.from('conversations').update({
      status: 'closed'
    }).eq('id', CONV_1_ID)

    assert.equal(error, null, 'Atualização comum não deve disparar erro nem anular etapas')
    const conv1 = inMemoryDb.conversations.get(CONV_1_ID)
    assert.equal(conv1.status, 'closed')
    assert.equal(conv1.workflow_id, WF_A1_ID, 'workflow_id deve ser preservado')
    assert.equal(conv1.workflow_stage_id, STAGE_A1_1_ID, 'workflow_stage_id deve ser preservado')
  })

  // ============================================================================
  // PARTE 2: CONCORRÊNCIA NA PROMOÇÃO E RECUPERAÇÃO DE ETAPAS (MOCK SERVICE)
  // ============================================================================

  test('6. [MOCK SERVICE] Colisão 23505 durante promoção de Atendimento Principal recupera o padrão vencedor', async () => {
    const TENANT_PROM_ID = '44444444-4444-4444-4444-444444444444'
    const USER_PROM_ID = 'user-prom'
    const WF_PROM_ID = 'aaaaaaaa-4444-4444-4444-000000000001'

    inMemoryDb.companies.set(TENANT_PROM_ID, {
      id: TENANT_PROM_ID,
      name: 'Empresa Promoção Concorrente',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.profiles.set(USER_PROM_ID, {
      id: USER_PROM_ID,
      company_id: TENANT_PROM_ID,
      role: 'admin'
    })
    inMemoryDb.workflows.set(WF_PROM_ID, {
      id: WF_PROM_ID,
      company_id: TENANT_PROM_ID,
      name: 'Atendimento Principal',
      is_default: false,
      is_active: true
    })

    const clientProm = createAuthenticatedClient({ userId: USER_PROM_ID })

    // Simula colisão concorrente no UPDATE de promoção:
    // Uma requisição externa cria um padrão antes do UPDATE
    const originalUpdate = clientProm.from('workflows').update
    let updateCalled = false
    const customClient = {
      ...clientProm,
      from: (table: string) => {
        const builder = clientProm.from(table)
        if (table === 'workflows') {
          const origUpdate = builder.update.bind(builder)
          builder.update = (values: any) => {
            if (values.is_default === true && !updateCalled) {
              updateCalled = true
              // Insere o concorrente vencedor
              inMemoryDb.workflows.set('winner-wf-id', {
                id: 'winner-wf-id',
                company_id: TENANT_PROM_ID,
                name: 'Workflow Vencedor',
                is_default: true,
                is_active: true
              })
              // O builder retornará 23505 por colisão com winner-wf-id
            }
            return origUpdate(values)
          }
        }
        return builder
      }
    }

    const result = await getOrCreateDefaultWorkflow({ supabaseClient: customClient as any })

    assert.ok(result.workflow)
    assert.equal(result.workflow.id, 'winner-wf-id', 'Deve retornar o workflow vencedor da corrida')
    assert.equal(result.created, false)
  })

  test('7. [MOCK SERVICE] Falha na consulta de recuperação do workflow vencedor lança erro descritivo', async () => {
    const TENANT_ERR_ID = '55555555-5555-5555-5555-555555555555'
    const USER_ERR_ID = 'user-err'

    inMemoryDb.companies.set(TENANT_ERR_ID, {
      id: TENANT_ERR_ID,
      name: 'Empresa Erro Recuperação',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.profiles.set(USER_ERR_ID, {
      id: USER_ERR_ID,
      company_id: TENANT_ERR_ID,
      role: 'admin'
    })

    const clientErr = createAuthenticatedClient({ userId: USER_ERR_ID })

    // Cria um cliente cujo insert gera 23505, mas o select do default subsequente (recuperação) retorna erro
    let insertAttempted = false
    const customClient = {
      ...clientErr,
      from: (table: string) => {
        const builder = clientErr.from(table)
        if (table === 'workflows') {
          const origInsert = builder.insert.bind(builder)
          builder.insert = (values: any) => {
            insertAttempted = true
            const b = origInsert(values)
            b.single = async () => ({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_workflows_company_default"' }
            })
            return b
          }
          const origSelect = builder.select.bind(builder)
          builder.select = (cols: string) => {
            const b = origSelect(cols)
            if (insertAttempted && cols && cols.includes('workflow_stages')) {
              b.maybeSingle = async () => ({
                data: null,
                error: { message: 'Database connection timeout during recovery' }
              })
              b.single = async () => ({
                data: null,
                error: { message: 'Database connection timeout during recovery' }
              })
            }
            return b
          }
        }
        return builder
      }
    }

    await assert.rejects(
      async () => {
        await getOrCreateDefaultWorkflow({ supabaseClient: customClient as any })
      },
      (err: any) => {
        assert.match(err.message, /Falha ao recuperar o workflow padrão concorrente/i)
        return true
      }
    )
  })

  test('8. [MOCK SERVICE] Workflow padrão existente com etapas faltantes: recupera e cria apenas as faltantes', async () => {
    const TENANT_PARTIAL_ID = '66666666-6666-6666-6666-666666666666'
    const USER_PARTIAL_ID = 'user-partial'
    const WF_PARTIAL_ID = 'aaaaaaaa-6666-6666-6666-000000000001'
    const STAGE_EXISTING_ID = 'stage-existing-0001'

    inMemoryDb.companies.set(TENANT_PARTIAL_ID, {
      id: TENANT_PARTIAL_ID,
      name: 'Empresa com Etapas Faltantes',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.profiles.set(USER_PARTIAL_ID, {
      id: USER_PARTIAL_ID,
      company_id: TENANT_PARTIAL_ID,
      role: 'admin'
    })
    inMemoryDb.workflows.set(WF_PARTIAL_ID, {
      id: WF_PARTIAL_ID,
      company_id: TENANT_PARTIAL_ID,
      name: 'Atendimento Principal',
      is_default: true,
      is_active: true
    })
    // Apenas a etapa 'Novo Contato' foi criada previamente (falha parcial nas outras duas)
    inMemoryDb.workflow_stages.set(STAGE_EXISTING_ID, {
      id: STAGE_EXISTING_ID,
      workflow_id: WF_PARTIAL_ID,
      company_id: TENANT_PARTIAL_ID,
      name: 'Novo Contato',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })

    const clientPartial = createAuthenticatedClient({ userId: USER_PARTIAL_ID })

    const result = await getOrCreateDefaultWorkflow({ supabaseClient: clientPartial })

    assert.equal(result.created, false)
    assert.equal(result.workflow.id, WF_PARTIAL_ID)

    // Verifica que agora existem 3 etapas no workflow
    const stages = Array.from(inMemoryDb.workflow_stages.values()).filter(s => s.workflow_id === WF_PARTIAL_ID)
    assert.equal(stages.length, 3, 'Deve ter recuperado e criado as 2 etapas ausentes')

    const stageNames = stages.map(s => s.name).sort()
    assert.deepEqual(stageNames, ['Em Atendimento', 'Finalizado', 'Novo Contato'])

    // A etapa original existente manteve o mesmo ID
    assert.ok(stages.some(s => s.id === STAGE_EXISTING_ID))
  })

  test('9. [MOCK SERVICE] Reexecução idempotente não duplica etapas existentes', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // WF_A1 já possui as 3 etapas
    const stagesBefore = Array.from(inMemoryDb.workflow_stages.values()).filter(s => s.workflow_id === WF_A1_ID).length
    assert.equal(stagesBefore, 3)

    const result = await getOrCreateDefaultWorkflow({ supabaseClient: clientAdminA })
    assert.equal(result.created, false)

    const stagesAfter = Array.from(inMemoryDb.workflow_stages.values()).filter(s => s.workflow_id === WF_A1_ID).length
    assert.equal(stagesAfter, 3, 'Nenhuma etapa duplicada deve ter sido inserida')
  })

  test('10. [MOCK SERVICE] Workflow padrão inativo é rejeitado sem criar outro', async () => {
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

  test('11. [MOCK SERVICE] Isolamento entre empresas: operações de um tenant não afetam outro', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })
    const clientAdminB = createAuthenticatedClient({ userId: USER_ADMIN_B_ID })

    const resA = await getOrCreateDefaultWorkflow({ supabaseClient: clientAdminA })
    const resB = await getOrCreateDefaultWorkflow({ supabaseClient: clientAdminB })

    assert.equal(resA.workflow.company_id, TENANT_A_ID)
    assert.equal(resB.workflow.company_id, TENANT_B_ID)
    assert.notEqual(resA.workflow.id, resB.workflow.id)
  })

  // ============================================================================
  // PARTE 3: AUDITORIA ESTÁTICA DAS MIGRATIONS (TESTE ESTÁTICO)
  // ============================================================================

  test('12. [ESTÁTICO] Migration 20261104_conversation_workflow_tenant_integrity não usa pg_trigger_depth e possui BEFORE DELETE', () => {
    const filePath = path.resolve(
      process.cwd(),
      'supabase/migrations/2026110401_conversation_workflow_tenant_integrity.sql'
    )
    assert.ok(fs.existsSync(filePath), 'Arquivo de migration deve existir')
    const sql = fs.readFileSync(filePath, 'utf8')

    // pg_trigger_depth() DEVE estar completamente ausente
    assert.doesNotMatch(sql, /pg_trigger_depth/i, 'pg_trigger_depth não deve existir na migration')

    // Trigger BEFORE DELETE em public.workflows
    assert.match(sql, /trg_unlink_conversations_before_workflow_delete/i)
    assert.match(sql, /unlink_conversations_before_workflow_delete/i)
    assert.match(sql, /BEFORE DELETE ON public\.workflows/i)

    // Atualização atômica desvinculando workflow_id e workflow_stage_id
    assert.match(sql, /SET workflow_id = NULL,\s*workflow_stage_id = NULL/i)

    // Bloqueio explícito de anulação manual mantendo etapa
    assert.match(sql, /não é permitido anular o workflow/i)

    // Governança de search_path seguro e SECURITY DEFINER
    assert.match(sql, /SECURITY DEFINER/i)
    assert.match(sql, /SET search_path = pg_catalog, public, pg_temp/i)
  })
})
