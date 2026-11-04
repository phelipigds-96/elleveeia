import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import { importProductsBatch } from '@/lib/services/catalog/import-products'
import { confirmImportAction, parseCsvFileAction } from '@/app/(dashboard)/catalog/import/actions'
import {
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgentStatus,
  listAgents,
  getAgent
} from '@/lib/services/agents'

test.describe('ETAPA 8.4.3L — Proteção do Ciclo de Vida na Importação de Catálogo e Gestão de Agentes', () => {
  // IDs de empresas (tenants)
  const TENANT_ACTIVE_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_SUSPENDED_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_CANCELLED_ID = '33333333-3333-3333-3333-333333333333'
  const TENANT_PROVISIONING_ID = '44444444-4444-4444-4444-444444444444'
  const TENANT_OTHER_ACTIVE_ID = '55555555-5555-5555-5555-555555555555'

  // IDs de usuários
  const ADMIN_ACTIVE_ID = 'user-admin-active'
  const ATTENDANT_ACTIVE_ID = 'user-attendant-active'
  const ADMIN_SUSPENDED_ID = 'user-admin-suspended'
  const ADMIN_CANCELLED_ID = 'user-admin-cancelled'
  const ADMIN_PROVISIONING_ID = 'user-admin-provisioning'
  const ADMIN_OTHER_ID = 'user-admin-other'

  test.beforeEach(() => {
    resetInMemoryDb()

    // 1. Cadastrar Empresas com seus respectivos status de ciclo de vida
    inMemoryDb.companies.set(TENANT_ACTIVE_ID, {
      id: TENANT_ACTIVE_ID,
      name: 'Empresa Alpha Ativa',
      slug: 'empresa-alpha',
      status: 'active',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Beta Suspensa',
      slug: 'empresa-beta',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: 'Inadimplência financeira',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_CANCELLED_ID, {
      id: TENANT_CANCELLED_ID,
      name: 'Empresa Gamma Cancelada',
      slug: 'empresa-gamma',
      status: 'cancelled',
      plan_tier: 'standard',
      suspension_reason: 'Encerramento de contrato',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_PROVISIONING_ID, {
      id: TENANT_PROVISIONING_ID,
      name: 'Empresa Delta Provisioning',
      slug: 'empresa-delta',
      status: 'provisioning',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_OTHER_ACTIVE_ID, {
      id: TENANT_OTHER_ACTIVE_ID,
      name: 'Empresa Epsilon Outra Ativa',
      slug: 'empresa-epsilon',
      status: 'active',
      plan_tier: 'pro',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Perfis de Usuários
    inMemoryDb.profiles.set(ADMIN_ACTIVE_ID, {
      id: ADMIN_ACTIVE_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'admin',
      full_name: 'Admin Alpha',
      email: 'admin@alpha.com'
    })

    inMemoryDb.profiles.set(ATTENDANT_ACTIVE_ID, {
      id: ATTENDANT_ACTIVE_ID,
      company_id: TENANT_ACTIVE_ID,
      role: 'attendant',
      full_name: 'Atendente Alpha',
      email: 'atendente@alpha.com'
    })

    inMemoryDb.profiles.set(ADMIN_SUSPENDED_ID, {
      id: ADMIN_SUSPENDED_ID,
      company_id: TENANT_SUSPENDED_ID,
      role: 'admin',
      full_name: 'Admin Beta',
      email: 'admin@beta.com'
    })

    inMemoryDb.profiles.set(ADMIN_CANCELLED_ID, {
      id: ADMIN_CANCELLED_ID,
      company_id: TENANT_CANCELLED_ID,
      role: 'admin',
      full_name: 'Admin Gamma',
      email: 'admin@gamma.com'
    })

    inMemoryDb.profiles.set(ADMIN_PROVISIONING_ID, {
      id: ADMIN_PROVISIONING_ID,
      company_id: TENANT_PROVISIONING_ID,
      role: 'admin',
      full_name: 'Admin Delta',
      email: 'admin@delta.com'
    })

    inMemoryDb.profiles.set(ADMIN_OTHER_ID, {
      id: ADMIN_OTHER_ID,
      company_id: TENANT_OTHER_ACTIVE_ID,
      role: 'admin',
      full_name: 'Admin Epsilon',
      email: 'admin@epsilon.com'
    })

    // 3. Cadastrar Limites Comerciais
    inMemoryDb.company_limits.set(TENANT_ACTIVE_ID, {
      id: 'lim-active',
      company_id: TENANT_ACTIVE_ID,
      max_agents: 2,
      max_monthly_messages: 5000,
      max_monthly_quotes: 1000,
      max_catalog_items: 5,
      allowed_llm_providers: ['gemini']
    })

    inMemoryDb.company_limits.set(TENANT_SUSPENDED_ID, {
      id: 'lim-suspended',
      company_id: TENANT_SUSPENDED_ID,
      max_agents: 1,
      max_monthly_messages: 5000,
      max_monthly_quotes: 1000,
      max_catalog_items: 10,
      allowed_llm_providers: ['gemini']
    })

    inMemoryDb.company_limits.set(TENANT_CANCELLED_ID, {
      id: 'lim-cancelled',
      company_id: TENANT_CANCELLED_ID,
      max_agents: 1,
      max_monthly_messages: 5000,
      max_monthly_quotes: 1000,
      max_catalog_items: 10,
      allowed_llm_providers: ['gemini']
    })

    inMemoryDb.company_limits.set(TENANT_OTHER_ACTIVE_ID, {
      id: 'lim-other',
      company_id: TENANT_OTHER_ACTIVE_ID,
      max_agents: 2,
      max_monthly_messages: 5000,
      max_monthly_quotes: 1000,
      max_catalog_items: 10,
      allowed_llm_providers: ['gemini']
    })

    // 4. Cadastrar Agentes Iniciais
    inMemoryDb.agents.set('agent-active-1', {
      id: 'agent-active-1',
      company_id: TENANT_ACTIVE_ID,
      name: 'Assistente Vendas Alpha',
      provider: 'openai',
      model: 'gpt-4o-mini',
      is_active: true,
      created_at: new Date().toISOString()
    })

    inMemoryDb.agents.set('agent-suspended-1', {
      id: 'agent-suspended-1',
      company_id: TENANT_SUSPENDED_ID,
      name: 'Assistente Beta',
      provider: 'openai',
      model: 'gpt-4o-mini',
      is_active: true,
      created_at: new Date().toISOString()
    })

    inMemoryDb.agents.set('agent-cancelled-1', {
      id: 'agent-cancelled-1',
      company_id: TENANT_CANCELLED_ID,
      name: 'Assistente Gamma',
      provider: 'openai',
      model: 'gpt-4o-mini',
      is_active: true,
      created_at: new Date().toISOString()
    })

    inMemoryDb.agents.set('agent-other-1', {
      id: 'agent-other-1',
      company_id: TENANT_OTHER_ACTIVE_ID,
      name: 'Assistente Delta',
      provider: 'openai',
      model: 'gpt-4o-mini',
      is_active: true,
      created_at: new Date().toISOString()
    })
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Importação em tenant active: permitida
  // ----------------------------------------------------------------------------
  test('1. Importação em tenant active: permitida', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })

    const rows = [
      { codigo: 'SKU-001', barras: '789001', nome: 'Chocolate Ao Leite 1kg', preco: 35.50 },
      { codigo: 'SKU-002', barras: '789002', nome: 'Chocolate Branco 1kg', preco: 38.00 }
    ]

    const result = await confirmImportAction(rows, { supabaseClient: clientActive })
    assert.equal(result.success, true, 'Importação deve ser bem-sucedida para tenant ativo')
    assert.equal(result.successCount, 2)
    assert.equal(result.errorCount, 0)

    // Verificar se os produtos foram persistidos no banco
    const products = Array.from(inMemoryDb.products.values()).filter(p => p.company_id === TENANT_ACTIVE_ID)
    assert.equal(products.length, 2)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Importação em tenant suspended: bloqueada
  // ----------------------------------------------------------------------------
  test('2. Importação em tenant suspended: bloqueada', async () => {
    const clientSuspended = createAuthenticatedClient({ userId: ADMIN_SUSPENDED_ID })

    const rows = [
      { codigo: 'SKU-SUSP-1', barras: null, nome: 'Produto Bloqueado', preco: 50.0 }
    ]

    // 1. Bloqueio na Server Action confirmImportAction
    const resAction = await confirmImportAction(rows, { supabaseClient: clientSuspended })
    assert.equal(resAction.success, false)
    assert.equal(resAction.code, 'TENANT_SUSPENDED')

    // 2. Bloqueio redundante na camada interna de serviço importProductsBatch
    await assert.rejects(
      async () => {
        await importProductsBatch(TENANT_SUSPENDED_ID, rows)
      },
      (err: any) => {
        assert.equal(err.code, 'TENANT_SUSPENDED')
        return true
      }
    )

    // Nenhum produto deve ter sido inserido para o tenant suspenso
    const products = Array.from(inMemoryDb.products.values()).filter(p => p.company_id === TENANT_SUSPENDED_ID)
    assert.equal(products.length, 0)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Importação em tenant cancelled: bloqueada
  // ----------------------------------------------------------------------------
  test('3. Importação em tenant cancelled: bloqueada', async () => {
    const clientCancelled = createAuthenticatedClient({ userId: ADMIN_CANCELLED_ID })

    const rows = [
      { codigo: 'SKU-CANC-1', barras: null, nome: 'Produto Cancelado', preco: 20.0 }
    ]

    const resAction = await confirmImportAction(rows, { supabaseClient: clientCancelled })
    assert.equal(resAction.success, false)
    assert.equal(resAction.code, 'TENANT_CANCELLED')

    await assert.rejects(
      async () => {
        await importProductsBatch(TENANT_CANCELLED_ID, rows)
      },
      (err: any) => {
        assert.equal(err.code, 'TENANT_CANCELLED')
        return true
      }
    )

    const products = Array.from(inMemoryDb.products.values()).filter(p => p.company_id === TENANT_CANCELLED_ID)
    assert.equal(products.length, 0)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Importação em tenant provisioning: bloqueada
  // ----------------------------------------------------------------------------
  test('4. Importação em tenant provisioning: bloqueada', async () => {
    const clientProvisioning = createAuthenticatedClient({ userId: ADMIN_PROVISIONING_ID })

    const rows = [
      { codigo: 'SKU-PROV-1', barras: null, nome: 'Produto Em Provisionamento', preco: 10.0 }
    ]

    const resAction = await confirmImportAction(rows, { supabaseClient: clientProvisioning })
    assert.equal(resAction.success, false)
    assert.equal(resAction.code, 'TENANT_PROVISIONING')

    await assert.rejects(
      async () => {
        await importProductsBatch(TENANT_PROVISIONING_ID, rows)
      },
      (err: any) => {
        assert.equal(err.code, 'TENANT_PROVISIONING')
        return true
      }
    )

    const products = Array.from(inMemoryDb.products.values()).filter(p => p.company_id === TENANT_PROVISIONING_ID)
    assert.equal(products.length, 0)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Falha na consulta de tenant: fail-closed
  // ----------------------------------------------------------------------------
  test('5. Falha na consulta de tenant: fail-closed', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })

    // Simular falha de infraestrutura criando um client mock que retorna erro na consulta a companies
    const brokenAdminClient = {
      from: (table: string) => {
        if (table === 'companies') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Database connection timeout', code: '57P01' }
                })
              })
            })
          }
        }
        return createAdminClient().from(table)
      }
    }

    const rows = [{ codigo: 'SKU-FAIL-1', barras: null, nome: 'Produto Teste Falha', preco: 15.0 }]

    const resAction = await confirmImportAction(rows, {
      supabaseClient: clientActive,
      adminClient: brokenAdminClient
    })
    assert.equal(resAction.success, false)
    assert.equal(resAction.code, 'TENANT_STATUS_UNAVAILABLE')

    // Verificar fail-closed em importProductsBatch
    await assert.rejects(
      async () => {
        await importProductsBatch(TENANT_ACTIVE_ID, rows, { adminClient: brokenAdminClient })
      },
      (err: any) => {
        assert.equal(err.code, 'TENANT_STATUS_UNAVAILABLE')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Importação não executa escrita antes da validação
  // ----------------------------------------------------------------------------
  test('6. Importação não executa escrita antes da validação', async () => {
    const initialProductCount = inMemoryDb.products.size
    const initialPriceCount = inMemoryDb.product_prices.length

    const rows = [
      { codigo: 'SKU-NEVER-WRITTEN', barras: '0000', nome: 'Nunca Escrito', preco: 99.0 }
    ]

    // Tentativa em tenant suspenso
    try {
      await importProductsBatch(TENANT_SUSPENDED_ID, rows)
    } catch {}

    assert.equal(inMemoryDb.products.size, initialProductCount, 'Nenhum produto deve ter sido inserido')
    assert.equal(inMemoryDb.product_prices.length, initialPriceCount, 'Nenhum preço deve ter sido inserido')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Criação de agente em tenant active: permitida
  // ----------------------------------------------------------------------------
  test('7. Criação de agente em tenant active: permitida', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })

    const res = await createAgent({
      name: 'Agente Suporte Alpha',
      segment: 'comercio',
      personality: 'amigavel e prestativo',
      instructions: 'Atenda os clientes com clareza.',
      provider: 'openai',
      model: 'gpt-4o-mini',
      is_active: true
    }, { supabaseClient: clientActive })

    assert.ok(res.data, 'Agente deve ser criado com sucesso')
    assert.equal(res.data.name, 'Agente Suporte Alpha')
    assert.equal(res.data.company_id, TENANT_ACTIVE_ID)
    assert.equal(inMemoryDb.agents.has(res.data.id), true)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Criação de agente em tenant suspended: bloqueada
  // ----------------------------------------------------------------------------
  test('8. Criação de agente em tenant suspended: bloqueada', async () => {
    const clientSuspended = createAuthenticatedClient({ userId: ADMIN_SUSPENDED_ID })

    const res = await createAgent({
      name: 'Agente Ilegítimo',
      is_active: true
    }, { supabaseClient: clientSuspended })

    assert.ok(res.error, 'Criação de agente deve ser rejeitada')
    assert.equal(res.code, 'TENANT_SUSPENDED')

    const agentExists = Array.from(inMemoryDb.agents.values()).some(a => a.name === 'Agente Ilegítimo')
    assert.equal(agentExists, false, 'Agente não pode existir no banco')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Atualização de agente em tenant cancelled: bloqueada
  // ----------------------------------------------------------------------------
  test('9. Atualização de agente em tenant cancelled: bloqueada', async () => {
    const clientCancelled = createAuthenticatedClient({ userId: ADMIN_CANCELLED_ID })

    const res = await updateAgent('agent-cancelled-1', {
      name: 'Agente Nome Modificado',
      is_active: false
    }, { supabaseClient: clientCancelled })

    assert.ok(res.error, 'Atualização de agente deve ser rejeitada')
    assert.equal(res.code, 'TENANT_CANCELLED')

    const agent = inMemoryDb.agents.get('agent-cancelled-1')
    assert.equal(agent.name, 'Assistente Gamma', 'Nome do agente deve permanecer inalterado')
    assert.equal(agent.is_active, true, 'Status do agente deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Exclusão de agente em tenant suspended: bloqueada
  // ----------------------------------------------------------------------------
  test('10. Exclusão de agente em tenant suspended: bloqueada', async () => {
    const clientSuspended = createAuthenticatedClient({ userId: ADMIN_SUSPENDED_ID })

    const res = await deleteAgent('agent-suspended-1', { supabaseClient: clientSuspended })

    assert.ok(res.error, 'Exclusão de agente deve ser rejeitada para tenant suspenso')
    assert.equal(res.code, 'TENANT_SUSPENDED')

    assert.equal(inMemoryDb.agents.has('agent-suspended-1'), true, 'Agente deve continuar no banco')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Tentativa de manipulação cross-tenant: bloqueada
  // ----------------------------------------------------------------------------
  test('11. Tentativa de manipulação cross-tenant: bloqueada', async () => {
    // Admin Alpha (TENANT_ACTIVE_ID) tenta atualizar o agente Delta (TENANT_OTHER_ACTIVE_ID)
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })

    // 1. Atualização cross-tenant
    const resUpdate = await updateAgent('agent-other-1', {
      name: 'Invasão Hacker Cross-Tenant',
      is_active: false
    }, { supabaseClient: clientActive })

    assert.ok(resUpdate.error)
    assert.match(resUpdate.error, /não pertence à sua empresa|não encontrado/i)

    // 2. Exclusão cross-tenant
    const resDelete = await deleteAgent('agent-other-1', { supabaseClient: clientActive })
    assert.ok(resDelete.error)
    assert.match(resDelete.error, /não pertence à sua empresa|não encontrado/i)

    // 3. Toggle de status cross-tenant
    const resToggle = await toggleAgentStatus('agent-other-1', true, { supabaseClient: clientActive })
    assert.ok(resToggle.error)
    assert.match(resToggle.error, /não pertence à sua empresa|não encontrado/i)

    // O agente alheio deve permanecer completamente intacto
    const targetAgent = inMemoryDb.agents.get('agent-other-1')
    assert.equal(targetAgent.name, 'Assistente Delta')
    assert.equal(targetAgent.is_active, true)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Falha na validação do tenant: nenhuma escrita realizada
  // ----------------------------------------------------------------------------
  test('12. Falha na validação do tenant: nenhuma escrita realizada', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })

    const brokenAdminClient = {
      from: (table: string) => {
        if (table === 'companies') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Database connection failure', code: '08006' }
                })
              })
            })
          }
        }
        return createAdminClient().from(table)
      }
    }

    const agentsBefore = inMemoryDb.agents.size

    const res = await createAgent({
      name: 'Agente Falha DB'
    }, {
      supabaseClient: clientActive,
      adminClient: brokenAdminClient
    })

    assert.ok(res.error)
    assert.equal(res.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(inMemoryDb.agents.size, agentsBefore, 'Nenhum agente deve ter sido persistido')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: Limite de agentes respeitado (max_agents)
  // ----------------------------------------------------------------------------
  test('13. Limite de agentes respeitado (max_agents)', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })
    // TENANT_ACTIVE_ID tem max_agents = 2 e já possui 1 agente ('agent-active-1')

    // Criação do 2º agente (dentro da cota)
    const res2 = await createAgent({
      name: 'Segundo Agente',
      is_active: true
    }, { supabaseClient: clientActive })

    assert.ok(res2.data, '2º agente deve ser criado com sucesso')
    assert.equal(res2.data.name, 'Segundo Agente')

    // Tentativa de criação do 3º agente (excede max_agents = 2)
    const res3 = await createAgent({
      name: 'Terceiro Agente Ilegítimo',
      is_active: true
    }, { supabaseClient: clientActive })

    assert.ok(res3.error, 'Criação do 3º agente deve ser bloqueada por exceder o limite')
    assert.equal(res3.code, 'LIMIT_EXCEEDED')
    assert.match(res3.error, /Limite de agentes atingido \(2\)/i)

    const activeAgents = Array.from(inMemoryDb.agents.values()).filter(a => a.company_id === TENANT_ACTIVE_ID)
    assert.equal(activeAgents.length, 2, 'Total de agentes deve ser exatamente 2')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 14: Limite de catálogo respeitado (max_catalog_items)
  // ----------------------------------------------------------------------------
  test('14. Limite de catálogo respeitado (max_catalog_items)', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })
    // TENANT_ACTIVE_ID tem max_catalog_items = 5

    // 1. Inserir 2 produtos iniciais
    const initialBatch = [
      { codigo: 'CAT-01', barras: null, nome: 'Item 1', preco: 10.0 },
      { codigo: 'CAT-02', barras: null, nome: 'Item 2', preco: 20.0 }
    ]
    const res1 = await confirmImportAction(initialBatch, { supabaseClient: clientActive })
    assert.equal(res1.success, true)

    // 2. Tentar importar carga com 4 novos SKUs (2 existentes + 4 novos = 6 > max 5)
    const exceedingBatch = [
      { codigo: 'CAT-03', barras: null, nome: 'Item 3', preco: 30.0 },
      { codigo: 'CAT-04', barras: null, nome: 'Item 4', preco: 40.0 },
      { codigo: 'CAT-05', barras: null, nome: 'Item 5', preco: 50.0 },
      { codigo: 'CAT-06', barras: null, nome: 'Item 6', preco: 60.0 }
    ]

    const resExceed = await confirmImportAction(exceedingBatch, { supabaseClient: clientActive })
    assert.equal(resExceed.success, false, 'Carga excedente deve ser rejeitada')
    assert.match(resExceed.error, /Limite de catálogo excedido: limite de 5 itens/i)

    // 3. Importar lote com atualização de produtos existentes e deduplicação
    // 2 existentes atualizados (CAT-01, CAT-02) + 2 duplicatas do mesmo novo SKU (CAT-03) + 1 outro novo SKU (CAT-04)
    // Novos de fato: 2 (CAT-03 e CAT-04). Total pós-importação: 2 + 2 = 4 <= 5. Deve passar!
    const validDeduplicatedBatch = [
      { codigo: 'CAT-01', barras: null, nome: 'Item 1 Atualizado', preco: 12.0 },
      { codigo: 'CAT-02', barras: null, nome: 'Item 2 Atualizado', preco: 22.0 },
      { codigo: 'CAT-03', barras: null, nome: 'Item 3 Faixa Varejo', preco: 30.0, price_type: 'retail', min_quantity: 1 },
      { codigo: 'CAT-03', barras: null, nome: 'Item 3 Faixa Atacado', preco: 25.0, price_type: 'wholesale', min_quantity: 10 },
      { codigo: 'CAT-04', barras: null, nome: 'Item 4', preco: 40.0 }
    ]

    const resValid = await confirmImportAction(validDeduplicatedBatch, { supabaseClient: clientActive })
    assert.equal(resValid.success, true, 'Lote com deduplicação e atualizações deve ser aceito')

    const totalActiveProducts = Array.from(inMemoryDb.products.values()).filter(p => p.company_id === TENANT_ACTIVE_ID)
    assert.equal(totalActiveProducts.length, 4, 'Catálogo deve ter exatamente 4 produtos')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 15: Regressão dos fluxos normais de importação e agentes
  // ----------------------------------------------------------------------------
  test('15. Regressão dos fluxos normais de importação e agentes', async () => {
    const clientActive = createAuthenticatedClient({ userId: ADMIN_ACTIVE_ID })

    // 1. Listar agentes da empresa
    const list = await listAgents({ supabaseClient: clientActive })
    assert.ok(Array.isArray(list))
    assert.ok(list.every((a: any) => a.company_id === TENANT_ACTIVE_ID))

    // 2. Buscar agente por ID
    const agent = await getAgent('agent-active-1', { supabaseClient: clientActive })
    assert.ok(agent)
    assert.equal(agent.id, 'agent-active-1')

    // 3. Alternar status do agente (toggleAgentStatus)
    const toggleRes = await toggleAgentStatus('agent-active-1', true, { supabaseClient: clientActive })
    assert.equal(toggleRes.success, true)
    const agentAfterToggle = inMemoryDb.agents.get('agent-active-1')
    assert.equal(agentAfterToggle.is_active, false)

    // 4. Atendente tenta criar agente: bloqueado por RBAC
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_ACTIVE_ID })
    const resAttendant = await createAgent({
      name: 'Tentativa Atendente'
    }, { supabaseClient: clientAttendant })
    assert.ok(resAttendant.error)
    assert.match(resAttendant.error, /apenas administradores/i)
  })
})
