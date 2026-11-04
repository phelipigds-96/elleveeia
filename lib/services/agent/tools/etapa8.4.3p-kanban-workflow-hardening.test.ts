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
  getCompanyWorkflows
} from '@/lib/services/workflows/workflows'

import {
  createWorkflowStageAction,
  updateWorkflowStageAction,
  deleteWorkflowStageAction,
  moveConversationStageAction
} from '@/app/(dashboard)/settings/workflows/actions'

test.describe('ETAPA 8.4.3P — Blindagem do Kanban e Integridade Referencial de Workflows', () => {
  // Tenancies
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED_ID = '33333333-3333-3333-3333-333333333333'
  const TENANT_CANCELLED_ID = '44444444-4444-4444-4444-444444444444'
  const TENANT_PROVISIONING_ID = '55555555-5555-5555-5555-555555555555'

  // Users
  const USER_ADMIN_A_ID = 'user-admin-a'
  const USER_ATTENDANT_A_ID = 'user-attendant-a'
  const USER_ADMIN_B_ID = 'user-admin-b'
  const USER_ADMIN_SUSPENDED_ID = 'user-admin-suspended'
  const USER_ADMIN_CANCELLED_ID = 'user-admin-cancelled'
  const USER_ADMIN_PROVISIONING_ID = 'user-admin-provisioning'

  // Workflows
  const WF_A1_ID = 'aaaaaaaa-1111-1111-1111-111111111111'
  const WF_A2_ID = 'aaaaaaaa-2222-2222-2222-222222222222'
  const WF_B1_ID = 'bbbbbbbb-1111-1111-1111-111111111111'

  // Stages
  const STAGE_A1_1_ID = 'aaaaaaaa-1111-1111-1111-000000000001'
  const STAGE_A1_2_ID = 'aaaaaaaa-1111-1111-1111-000000000002'
  const STAGE_A2_1_ID = 'aaaaaaaa-2222-2222-2222-000000000001'
  const STAGE_B1_1_ID = 'bbbbbbbb-1111-1111-1111-000000000001'

  // Conversations
  const CONV_A1_ID = 'cccccccc-1111-1111-1111-111111111111'
  const CONV_A_NO_WF_ID = 'cccccccc-1111-1111-1111-222222222222'
  const CONV_A_WF_NO_STAGE_ID = 'cccccccc-1111-1111-1111-333333333333'
  const CONV_B1_ID = 'cccccccc-2222-2222-2222-111111111111'

  function seedDatabase() {
    resetInMemoryDb()

    // 1. Companies
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa Alpha Ativa',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa Beta Ativa',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Suspensa',
      status: 'suspended',
      suspension_reason: 'Inadimplência financeira',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_CANCELLED_ID, {
      id: TENANT_CANCELLED_ID,
      name: 'Empresa Cancelada',
      status: 'cancelled',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_PROVISIONING_ID, {
      id: TENANT_PROVISIONING_ID,
      name: 'Empresa Provisioning',
      status: 'provisioning',
      plan_tier: 'trial'
    })

    // 2. Profiles
    inMemoryDb.profiles.set(USER_ADMIN_A_ID, {
      id: USER_ADMIN_A_ID,
      company_id: TENANT_A_ID,
      role: 'admin',
      name: 'Admin Alpha'
    })
    inMemoryDb.profiles.set(USER_ATTENDANT_A_ID, {
      id: USER_ATTENDANT_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant',
      name: 'Atendente Alpha'
    })
    inMemoryDb.profiles.set(USER_ADMIN_B_ID, {
      id: USER_ADMIN_B_ID,
      company_id: TENANT_B_ID,
      role: 'admin',
      name: 'Admin Beta'
    })
    inMemoryDb.profiles.set(USER_ADMIN_SUSPENDED_ID, {
      id: USER_ADMIN_SUSPENDED_ID,
      company_id: TENANT_SUSPENDED_ID,
      role: 'admin',
      name: 'Admin Suspensa'
    })
    inMemoryDb.profiles.set(USER_ADMIN_CANCELLED_ID, {
      id: USER_ADMIN_CANCELLED_ID,
      company_id: TENANT_CANCELLED_ID,
      role: 'admin',
      name: 'Admin Cancelada'
    })
    inMemoryDb.profiles.set(USER_ADMIN_PROVISIONING_ID, {
      id: USER_ADMIN_PROVISIONING_ID,
      company_id: TENANT_PROVISIONING_ID,
      role: 'admin',
      name: 'Admin Provisioning'
    })

    // 3. Workflows
    inMemoryDb.workflows.set(WF_A1_ID, {
      id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Funil Alpha Principal',
      description: 'Workflow principal Alpha',
      is_default: true,
      is_active: true
    })
    inMemoryDb.workflows.set(WF_A2_ID, {
      id: WF_A2_ID,
      company_id: TENANT_A_ID,
      name: 'Funil Alpha Secundário',
      description: 'Workflow pós-venda Alpha',
      is_default: false,
      is_active: true
    })
    inMemoryDb.workflows.set(WF_B1_ID, {
      id: WF_B1_ID,
      company_id: TENANT_B_ID,
      name: 'Funil Beta Principal',
      description: 'Workflow Beta',
      is_default: true,
      is_active: true
    })

    // 4. Workflow Stages
    inMemoryDb.workflow_stages.set(STAGE_A1_1_ID, {
      id: STAGE_A1_1_ID,
      workflow_id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Novo Contato Alpha',
      description: 'Etapa inicial',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_A1_2_ID, {
      id: STAGE_A1_2_ID,
      workflow_id: WF_A1_ID,
      company_id: TENANT_A_ID,
      name: 'Em Atendimento Alpha',
      description: 'Etapa em andamento',
      position: 1,
      stage_type: 'in_progress',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_A2_1_ID, {
      id: STAGE_A2_1_ID,
      workflow_id: WF_A2_ID,
      company_id: TENANT_A_ID,
      name: 'Pós-Venda Alpha',
      description: 'Etapa do funil 2',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.workflow_stages.set(STAGE_B1_1_ID, {
      id: STAGE_B1_1_ID,
      workflow_id: WF_B1_ID,
      company_id: TENANT_B_ID,
      name: 'Novo Contato Beta',
      description: 'Etapa de Beta',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })

    // 5. Conversations
    inMemoryDb.conversations.set(CONV_A1_ID, {
      id: CONV_A1_ID,
      company_id: TENANT_A_ID,
      workflow_id: WF_A1_ID,
      workflow_stage_id: STAGE_A1_1_ID,
      status: 'active'
    })
    inMemoryDb.conversations.set(CONV_A_NO_WF_ID, {
      id: CONV_A_NO_WF_ID,
      company_id: TENANT_A_ID,
      workflow_id: null,
      workflow_stage_id: null,
      status: 'active'
    })
    inMemoryDb.conversations.set(CONV_A_WF_NO_STAGE_ID, {
      id: CONV_A_WF_NO_STAGE_ID,
      company_id: TENANT_A_ID,
      workflow_id: WF_A1_ID,
      workflow_stage_id: null,
      status: 'active'
    })
    inMemoryDb.conversations.set(CONV_B1_ID, {
      id: CONV_B1_ID,
      company_id: TENANT_B_ID,
      workflow_id: WF_B1_ID,
      workflow_stage_id: STAGE_B1_1_ID,
      status: 'active'
    })
  }

  test.beforeEach(() => {
    seedDatabase()
  })

  // ============================================================================
  // CENÁRIO 1: Empresa A não consegue associar sua conversa a etapa da Empresa B
  // ============================================================================
  test('1. Empresa A não consegue associar sua conversa a etapa da Empresa B', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })
    const clientAttendantA = createAuthenticatedClient({ userId: USER_ATTENDANT_A_ID })

    // Tentativa via Admin A
    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_A1_ID, STAGE_B1_1_ID, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )

    // Tentativa via Atendente A
    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_A1_ID, STAGE_B1_1_ID, { supabaseClient: clientAttendantA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )

    // Garante que o estado da conversa não mudou
    const conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.workflow_stage_id, STAGE_A1_1_ID)
    assert.equal(conv.workflow_id, WF_A1_ID)
  })

  // ============================================================================
  // CENÁRIO 2: Empresa A não consegue associar sua conversa a workflow da Empresa B
  // ============================================================================
  test('2. Empresa A não consegue associar sua conversa a workflow da Empresa B', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // Tentativa de associar etapa que pertence ao WF de Beta
    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_A_NO_WF_ID, STAGE_B1_1_ID, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )

    // E a trigger no banco rejeita inserção direta com workflow da Empresa B
    const adminDirect = createAdminClient()
    const { error: insertErr } = await adminDirect.from('conversations').insert({
      id: 'cccccccc-9999-9999-9999-999999999999',
      company_id: TENANT_A_ID,
      workflow_id: WF_B1_ID,
      status: 'active'
    })
    assert.ok(insertErr, 'Deve retornar erro de trigger no banco')
    assert.match(insertErr.message, /Violação de integridade multi-tenant/i)
  })

  // ============================================================================
  // CENÁRIO 3: Etapa de outro workflow é rejeitada
  // ============================================================================
  test('3. Etapa de outro workflow é rejeitada', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // CONV_A1 pertence a WF_A1. STAGE_A2_1 pertence a WF_A2 (ambos da Empresa A).
    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_A1_ID, STAGE_A2_1_ID, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa de outro workflow é rejeitada/i)
        return true
      }
    )

    // Conversa não foi alterada
    const conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.workflow_stage_id, STAGE_A1_1_ID)
    assert.equal(conv.workflow_id, WF_A1_ID)
  })

  // ============================================================================
  // CENÁRIO 4: Etapa inexistente é rejeitada
  // ============================================================================
  test('4. Etapa inexistente é rejeitada', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })
    const nonExistentStageId = '00000000-0000-0000-0000-000000009999'

    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_A1_ID, nonExistentStageId, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 5: Conversa de outro tenant não pode ser movimentada
  // ============================================================================
  test('5. Conversa de outro tenant não pode ser movimentada', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // Admin da Empresa A tenta movimentar CONV_B1 (da Empresa B)
    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_B1_ID, STAGE_A1_2_ID, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Conversa não encontrada/i)
        return true
      }
    )

    // Conversa de Beta intacta
    const convB = inMemoryDb.conversations.get(CONV_B1_ID)
    assert.equal(convB.workflow_stage_id, STAGE_B1_1_ID)
  })

  // ============================================================================
  // CENÁRIO 6: Empresa suspensa não consegue movimentar conversas
  // ============================================================================
  test('6. Empresa suspensa não consegue movimentar conversas', async () => {
    const clientSuspended = createAuthenticatedClient({ userId: USER_ADMIN_SUSPENDED_ID })

    // Criar conversa e etapa para a empresa suspensa
    const convSuspId = 'cccccccc-3333-3333-3333-111111111111'
    const wfSuspId = 'aaaaaaaa-3333-3333-3333-111111111111'
    const stageSuspId = 'aaaaaaaa-3333-3333-3333-000000000001'

    inMemoryDb.workflows.set(wfSuspId, {
      id: wfSuspId,
      company_id: TENANT_SUSPENDED_ID,
      name: 'Funil Suspensa',
      is_default: true,
      is_active: true
    })
    inMemoryDb.workflow_stages.set(stageSuspId, {
      id: stageSuspId,
      workflow_id: wfSuspId,
      company_id: TENANT_SUSPENDED_ID,
      name: 'Etapa Suspensa',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.conversations.set(convSuspId, {
      id: convSuspId,
      company_id: TENANT_SUSPENDED_ID,
      workflow_id: wfSuspId,
      workflow_stage_id: stageSuspId,
      status: 'active'
    })

    await assert.rejects(
      async () => {
        await moveConversationStage(convSuspId, stageSuspId, { supabaseClient: clientSuspended })
      },
      (err: any) => {
        assert.equal(err.name, 'TenantAccessError')
        assert.equal(err.code, 'TENANT_SUSPENDED')
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 7: Empresa cancelada não consegue movimentar conversas
  // ============================================================================
  test('7. Empresa cancelada não consegue movimentar conversas', async () => {
    const clientCancelled = createAuthenticatedClient({ userId: USER_ADMIN_CANCELLED_ID })

    const convId = 'cccccccc-4444-4444-4444-111111111111'
    const wfId = 'aaaaaaaa-4444-4444-4444-111111111111'
    const stageId = 'aaaaaaaa-4444-4444-4444-000000000001'

    inMemoryDb.workflows.set(wfId, {
      id: wfId,
      company_id: TENANT_CANCELLED_ID,
      name: 'Funil Cancelada',
      is_default: true,
      is_active: true
    })
    inMemoryDb.workflow_stages.set(stageId, {
      id: stageId,
      workflow_id: wfId,
      company_id: TENANT_CANCELLED_ID,
      name: 'Etapa Cancelada',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.conversations.set(convId, {
      id: convId,
      company_id: TENANT_CANCELLED_ID,
      workflow_id: wfId,
      workflow_stage_id: stageId,
      status: 'active'
    })

    await assert.rejects(
      async () => {
        await moveConversationStage(convId, stageId, { supabaseClient: clientCancelled })
      },
      (err: any) => {
        assert.equal(err.name, 'TenantAccessError')
        assert.equal(err.code, 'TENANT_CANCELLED')
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 8: Empresa em provisioning não consegue movimentar conversas
  // ============================================================================
  test('8. Empresa em provisioning não consegue movimentar conversas', async () => {
    const clientProvisioning = createAuthenticatedClient({ userId: USER_ADMIN_PROVISIONING_ID })

    const convId = 'cccccccc-5555-5555-5555-111111111111'
    const wfId = 'aaaaaaaa-5555-5555-5555-111111111111'
    const stageId = 'aaaaaaaa-5555-5555-5555-000000000001'

    inMemoryDb.workflows.set(wfId, {
      id: wfId,
      company_id: TENANT_PROVISIONING_ID,
      name: 'Funil Prov',
      is_default: true,
      is_active: true
    })
    inMemoryDb.workflow_stages.set(stageId, {
      id: stageId,
      workflow_id: wfId,
      company_id: TENANT_PROVISIONING_ID,
      name: 'Etapa Prov',
      position: 0,
      stage_type: 'initial',
      is_active: true
    })
    inMemoryDb.conversations.set(convId, {
      id: convId,
      company_id: TENANT_PROVISIONING_ID,
      workflow_id: wfId,
      workflow_stage_id: stageId,
      status: 'active'
    })

    await assert.rejects(
      async () => {
        await moveConversationStage(convId, stageId, { supabaseClient: clientProvisioning })
      },
      (err: any) => {
        assert.equal(err.name, 'TenantAccessError')
        assert.equal(err.code, 'TENANT_PROVISIONING')
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 9: Atendente não consegue criar workflow
  // ============================================================================
  test('9. Atendente não consegue criar workflow', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: USER_ATTENDANT_A_ID })

    await assert.rejects(
      async () => {
        await createWorkflow('Funil Ilegal', 'Tentativa por atendente', { supabaseClient: clientAttendant })
      },
      (err: any) => {
        assert.match(err.message, /apenas administradores podem gerenciar workflows/i)
        return true
      }
    )

    // Nenhum novo workflow inserido
    const wfs = Array.from(inMemoryDb.workflows.values()).filter(w => w.name === 'Funil Ilegal')
    assert.equal(wfs.length, 0)
  })

  // ============================================================================
  // CENÁRIO 10: Atendente não consegue criar etapa
  // ============================================================================
  test('10. Atendente não consegue criar etapa', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: USER_ATTENDANT_A_ID })

    await assert.rejects(
      async () => {
        await createWorkflowStage(WF_A1_ID, 'Etapa Ilegal', 'in_progress', { supabaseClient: clientAttendant })
      },
      (err: any) => {
        assert.match(err.message, /apenas administradores podem gerenciar workflows/i)
        return true
      }
    )

    const stages = Array.from(inMemoryDb.workflow_stages.values()).filter(s => s.name === 'Etapa Ilegal')
    assert.equal(stages.length, 0)
  })

  // ============================================================================
  // CENÁRIO 11: Atendente não consegue excluir etapa
  // ============================================================================
  test('11. Atendente não consegue excluir etapa', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: USER_ATTENDANT_A_ID })

    await assert.rejects(
      async () => {
        await deleteWorkflowStage(STAGE_A1_1_ID, { supabaseClient: clientAttendant })
      },
      (err: any) => {
        assert.match(err.message, /apenas administradores podem gerenciar workflows/i)
        return true
      }
    )

    // Etapa continua intacta
    assert.ok(inMemoryDb.workflow_stages.has(STAGE_A1_1_ID))
  })

  // ============================================================================
  // CENÁRIO 12: Admin da própria empresa consegue criar etapa
  // ============================================================================
  test('12. Admin da própria empresa consegue criar etapa', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    const newStage = await createWorkflowStage(WF_A1_ID, 'Nova Etapa Válida', 'in_progress', { supabaseClient: clientAdminA })

    assert.ok(newStage)
    assert.equal(newStage.name, 'Nova Etapa Válida')
    assert.equal(newStage.company_id, TENANT_A_ID)
    assert.equal(newStage.workflow_id, WF_A1_ID)
    assert.equal(newStage.position, 2) // STAGE_A1_1 pos 0, STAGE_A1_2 pos 1 -> next 2
  })

  // ============================================================================
  // CENÁRIO 13: Admin da própria empresa consegue atualizar etapa
  // ============================================================================
  test('13. Admin da própria empresa consegue atualizar etapa', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    await updateWorkflowStage(
      STAGE_A1_2_ID,
      { name: 'Em Atendimento Especializado', description: 'Nova descrição' },
      { supabaseClient: clientAdminA }
    )

    const updated = inMemoryDb.workflow_stages.get(STAGE_A1_2_ID)
    assert.equal(updated.name, 'Em Atendimento Especializado')
    assert.equal(updated.description, 'Nova descrição')
  })

  // ============================================================================
  // CENÁRIO 14: Admin da própria empresa consegue movimentar conversa para etapa válida
  // ============================================================================
  test('14. Admin da própria empresa consegue movimentar conversa para etapa válida', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // Move de STAGE_A1_1 para STAGE_A1_2
    await moveConversationStage(CONV_A1_ID, STAGE_A1_2_ID, { supabaseClient: clientAdminA })

    const conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.workflow_stage_id, STAGE_A1_2_ID)
    assert.equal(conv.workflow_id, WF_A1_ID)
  })

  // ============================================================================
  // CENÁRIO 15: Empresa A não consegue atualizar ou excluir etapa da Empresa B
  // ============================================================================
  test('15. Empresa A não consegue atualizar ou excluir etapa da Empresa B', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    // Tentativa de update
    await assert.rejects(
      async () => {
        await updateWorkflowStage(
          STAGE_B1_1_ID,
          { name: 'Hacked by Alpha' },
          { supabaseClient: clientAdminA }
        )
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )

    // Tentativa de delete
    await assert.rejects(
      async () => {
        await deleteWorkflowStage(STAGE_B1_1_ID, { supabaseClient: clientAdminA })
      },
      (err: any) => {
        assert.match(err.message, /Etapa não encontrada/i)
        return true
      }
    )

    // Etapa de Beta continua inalterada
    const stageBeta = inMemoryDb.workflow_stages.get(STAGE_B1_1_ID)
    assert.equal(stageBeta.name, 'Novo Contato Beta')
  })

  // ============================================================================
  // CENÁRIO 16: Falha de validação não gera nenhuma escrita
  // ============================================================================
  test('16. Falha de validação não gera nenhuma escrita', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })

    const snapshotBefore = JSON.stringify(inMemoryDb.conversations.get(CONV_A1_ID))

    // Disparar erro de validação
    await assert.rejects(
      async () => {
        await moveConversationStage(CONV_A1_ID, STAGE_A2_1_ID, { supabaseClient: clientAdminA })
      }
    )

    const snapshotAfter = JSON.stringify(inMemoryDb.conversations.get(CONV_A1_ID))
    assert.equal(snapshotBefore, snapshotAfter)
  })

  // ============================================================================
  // CENÁRIO 17: Conversas sem workflow continuam funcionando
  // ============================================================================
  test('17. Conversas sem workflow continuam funcionando', async () => {
    const adminDirect = createAdminClient()

    // Inserir conversa sem workflow e sem etapa
    const newConvId = 'cccccccc-7777-7777-7777-000000000001'
    const { data: created, error } = await adminDirect.from('conversations').insert({
      id: newConvId,
      company_id: TENANT_A_ID,
      workflow_id: null,
      workflow_stage_id: null,
      status: 'active'
    })

    assert.equal(error, null)
    const conv = inMemoryDb.conversations.get(newConvId)
    assert.ok(conv)
    assert.equal(conv.workflow_id, null)
    assert.equal(conv.workflow_stage_id, null)

    // Movimentar conversa sem workflow para uma etapa válida atribui workflow e etapa coerentemente
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })
    await moveConversationStage(newConvId, STAGE_A1_1_ID, { supabaseClient: clientAdminA })

    const updatedConv = inMemoryDb.conversations.get(newConvId)
    assert.equal(updatedConv.workflow_id, WF_A1_ID)
    assert.equal(updatedConv.workflow_stage_id, STAGE_A1_1_ID)
  })

  // ============================================================================
  // CENÁRIO 18: Conversas com workflow e sem etapa continuam funcionando
  // ============================================================================
  test('18. Conversas com workflow e sem etapa continuam funcionando quando esse estado for válido no modelo', async () => {
    const adminDirect = createAdminClient()

    // Inserir conversa com workflow válido e etapa nula
    const convWfNoStageId = 'cccccccc-8888-8888-8888-000000000001'
    const { error } = await adminDirect.from('conversations').insert({
      id: convWfNoStageId,
      company_id: TENANT_A_ID,
      workflow_id: WF_A1_ID,
      workflow_stage_id: null,
      status: 'active'
    })

    assert.equal(error, null)
    const conv = inMemoryDb.conversations.get(convWfNoStageId)
    assert.ok(conv)
    assert.equal(conv.workflow_id, WF_A1_ID)
    assert.equal(conv.workflow_stage_id, null)

    // Movimentar para uma etapa daquele mesmo workflow funciona com sucesso
    const clientAdminA = createAuthenticatedClient({ userId: USER_ADMIN_A_ID })
    await moveConversationStage(convWfNoStageId, STAGE_A1_2_ID, { supabaseClient: clientAdminA })

    const updatedConv = inMemoryDb.conversations.get(convWfNoStageId)
    assert.equal(updatedConv.workflow_id, WF_A1_ID)
    assert.equal(updatedConv.workflow_stage_id, STAGE_A1_2_ID)
  })

  // ============================================================================
  // CENÁRIOS COMPLEMENTARES: Atendente movimenta no Kanban, Whitelist Zod & Migration
  // ============================================================================
  test('19. Atendente da própria empresa consegue movimentar conversa para etapa válida no Kanban', async () => {
    const clientAttendantA = createAuthenticatedClient({ userId: USER_ATTENDANT_A_ID })

    // Atendente movimenta no Kanban
    await moveConversationStage(CONV_A1_ID, STAGE_A1_2_ID, { supabaseClient: clientAttendantA })

    const conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.workflow_stage_id, STAGE_A1_2_ID)
  })

  test('20. Injeção de campos protegidos (id, company_id, workflow_id) em updateWorkflowStageAction é rejeitada pelo Zod', async () => {
    // Tentativa de injetar company_id malicioso
    await assert.rejects(
      async () => {
        await updateWorkflowStageAction(STAGE_A1_1_ID, {
          name: 'Nome Modificado',
          company_id: TENANT_B_ID
        })
      },
      (err: any) => {
        assert.match(err.message, /Campos adicionais ou não autorizados/i)
        return true
      }
    )

    // Tentativa de trocar workflow_id
    await assert.rejects(
      async () => {
        await updateWorkflowStageAction(STAGE_A1_1_ID, {
          name: 'Nome Modificado',
          workflow_id: WF_B1_ID
        })
      },
      (err: any) => {
        assert.match(err.message, /Campos adicionais ou não autorizados/i)
        return true
      }
    )

    // Tentativa de alterar id
    await assert.rejects(
      async () => {
        await updateWorkflowStageAction(STAGE_A1_1_ID, {
          name: 'Nome Modificado',
          id: '00000000-0000-0000-0000-000000000000'
        })
      },
      (err: any) => {
        assert.match(err.message, /Campos adicionais ou não autorizados/i)
        return true
      }
    )
  })

  test('21. Trigger de banco bloqueia cross-tenant mesmo sob service_role', async () => {
    const adminDirect = createAdminClient()

    // service_role tentando associar conversa da Empresa A a etapa da Empresa B
    const { error: err1 } = await adminDirect.from('conversations').update({
      workflow_stage_id: STAGE_B1_1_ID
    }).eq('id', CONV_A1_ID)

    assert.ok(err1, 'Trigger deve barrar etapa de outra empresa via service_role')
    assert.match(err1.message, /Violação de integridade multi-tenant/i)

    // service_role tentando criar mismatch entre workflow_id e workflow_stage_id
    const { error: err2 } = await adminDirect.from('conversations').update({
      workflow_id: WF_A2_ID,
      workflow_stage_id: STAGE_A1_1_ID
    }).eq('id', CONV_A1_ID)

    assert.ok(err2, 'Trigger deve barrar mismatch entre workflow_id e workflow_stage_id')
    assert.match(err2.message, /Violação de integridade de workflow/i)
  })

  test('22. Migration 20261104 e script de auditoria possuem proteções obrigatórias', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261104_conversation_workflow_tenant_integrity.sql'
    )
    assert.ok(fs.existsSync(migrationPath), 'Migration 20261104 deve existir.')
    const migrationSql = fs.readFileSync(migrationPath, 'utf8')

    // Pré-auditoria sem delete automático
    assert.match(migrationSql, /DO \$\$/i)
    assert.match(migrationSql, /RAISE EXCEPTION/i)
    assert.match(migrationSql, /MIGRATION_ABORTED/i)
    assert.doesNotMatch(migrationSql, /DELETE FROM public\.conversations/i)
    assert.doesNotMatch(migrationSql, /UPDATE public\.conversations SET/i)

    // Trigger e SECURITY DEFINER
    assert.match(migrationSql, /SECURITY DEFINER/i)
    assert.match(migrationSql, /SET search_path = pg_catalog, public, pg_temp/i)
    assert.match(migrationSql, /BEFORE INSERT OR UPDATE ON public\.conversations/i)

    // Script de auditoria standalone
    const scriptPath = path.resolve(
      process.cwd(),
      'supabase/scripts/audit_conversation_workflow_integrity.sql'
    )
    assert.ok(fs.existsSync(scriptPath), 'Script de auditoria deve existir.')
    const scriptSql = fs.readFileSync(scriptPath, 'utf8')
    assert.match(scriptSql, /cross_tenant_workflow_count/i)
    assert.match(scriptSql, /cross_tenant_stage_count/i)
    assert.match(scriptSql, /stage_workflow_mismatch_count/i)
    assert.doesNotMatch(scriptSql, /INSERT INTO|UPDATE|DELETE/i)
  })
})
