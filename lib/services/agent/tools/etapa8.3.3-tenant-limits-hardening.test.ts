import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

test.describe('ETAPA 8.3.3 — Correção de Segurança dos Limites por Tenant', () => {
  const TENANT_A_ID = 'tenant-a-1111-1111-1111-111111111111'
  const TENANT_B_ID = 'tenant-b-2222-2222-2222-222222222222'

  const ADMIN_A_ID = 'user-admin-a-001'
  const ATTENDANT_A_ID = 'user-attendant-a-002'
  const ADMIN_B_ID = 'user-admin-b-001'

  test.beforeEach(() => {
    resetInMemoryDb()

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa A Comércio',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa B Confeitaria',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    // 2. Limites Comerciais Definidos pela Plataforma
    inMemoryDb.company_limits.set('lim-tenant-a', {
      id: 'lim-tenant-a',
      company_id: TENANT_A_ID,
      max_agents: 1,
      max_monthly_messages: 5000,
      max_monthly_quotes: 1000,
      max_catalog_items: 20000,
      allowed_llm_providers: ['gemini'],
      created_at: new Date().toISOString()
    })
    inMemoryDb.company_limits.set('lim-tenant-b', {
      id: 'lim-tenant-b',
      company_id: TENANT_B_ID,
      max_agents: 3,
      max_monthly_messages: 20000,
      max_monthly_quotes: 5000,
      max_catalog_items: 80000,
      allowed_llm_providers: ['gemini', 'openai'],
      created_at: new Date().toISOString()
    })

    // 3. Cadastrar Perfis de Usuários
    inMemoryDb.profiles.set(ADMIN_A_ID, {
      id: ADMIN_A_ID,
      company_id: TENANT_A_ID,
      role: 'admin',
      full_name: 'Administrador Empresa A',
      email: 'admin@empresa-a.com'
    })
    inMemoryDb.profiles.set(ATTENDANT_A_ID, {
      id: ATTENDANT_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant',
      full_name: 'Atendente Empresa A',
      email: 'atendente@empresa-a.com'
    })
    inMemoryDb.profiles.set(ADMIN_B_ID, {
      id: ADMIN_B_ID,
      company_id: TENANT_B_ID,
      role: 'admin',
      full_name: 'Administrador Empresa B',
      email: 'admin@empresa-b.com'
    })

    // 4. Cadastrar Produtos e Preços para validação de regressão
    inMemoryDb.products.set('prod-a1', {
      id: 'prod-a1',
      company_id: TENANT_A_ID,
      name: 'Top Gotas 1kg',
      sku: 'SKU-A1',
      active: true
    })
    inMemoryDb.product_prices.push({
      id: 'price-a1',
      company_id: TENANT_A_ID,
      product_id: 'prod-a1',
      price: 38.50,
      price_type: 'retail',
      min_quantity: 1,
      active: true
    })
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Administrador de empresa consegue consultar os próprios limites
  // ----------------------------------------------------------------------------
  test('1. Administrador de empresa consegue consultar os próprios limites comerciais', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { data: limits, error } = await clientAdminA.from('company_limits').select('*')
    assert.equal(error, null)
    assert.equal(limits.length, 1)
    assert.equal(limits[0].company_id, TENANT_A_ID)
    assert.equal(limits[0].max_agents, 1)
    assert.equal(limits[0].max_monthly_messages, 5000)
    assert.equal(limits[0].max_monthly_quotes, 1000)
    assert.equal(limits[0].max_catalog_items, 20000)
    assert.deepEqual(limits[0].allowed_llm_providers, ['gemini'])
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Administrador não consegue alterar max_agents
  // ----------------------------------------------------------------------------
  test('2. Administrador não consegue alterar max_agents', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('company_limits')
      .update({ max_agents: 10 })
      .eq('company_id', TENANT_A_ID)

    assert.ok(error, 'Administrador do cliente não pode alterar cota de agentes')
    assert.match(error.message, /permission denied for table company_limits/i)

    const limitRecord = inMemoryDb.company_limits.get('lim-tenant-a')
    assert.equal(limitRecord.max_agents, 1, 'max_agents deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Administrador não consegue alterar max_monthly_messages
  // ----------------------------------------------------------------------------
  test('3. Administrador não consegue alterar max_monthly_messages', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('company_limits')
      .update({ max_monthly_messages: 500000 })
      .eq('company_id', TENANT_A_ID)

    assert.ok(error, 'Administrador do cliente não pode alterar cota de mensagens')
    assert.match(error.message, /permission denied for table company_limits/i)

    const limitRecord = inMemoryDb.company_limits.get('lim-tenant-a')
    assert.equal(limitRecord.max_monthly_messages, 5000, 'max_monthly_messages deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Administrador não consegue alterar max_monthly_quotes
  // ----------------------------------------------------------------------------
  test('4. Administrador não consegue alterar max_monthly_quotes', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('company_limits')
      .update({ max_monthly_quotes: 999999 })
      .eq('company_id', TENANT_A_ID)

    assert.ok(error, 'Administrador do cliente não pode alterar cota de orçamentos')
    assert.match(error.message, /permission denied for table company_limits/i)

    const limitRecord = inMemoryDb.company_limits.get('lim-tenant-a')
    assert.equal(limitRecord.max_monthly_quotes, 1000, 'max_monthly_quotes deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Administrador não consegue alterar max_catalog_items
  // ----------------------------------------------------------------------------
  test('5. Administrador não consegue alterar max_catalog_items', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('company_limits')
      .update({ max_catalog_items: 1000000 })
      .eq('company_id', TENANT_A_ID)

    assert.ok(error, 'Administrador do cliente não pode alterar cota de catálogo')
    assert.match(error.message, /permission denied for table company_limits/i)

    const limitRecord = inMemoryDb.company_limits.get('lim-tenant-a')
    assert.equal(limitRecord.max_catalog_items, 20000, 'max_catalog_items deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Administrador não consegue alterar allowed_llm_providers e constraint valida provedores
  // ----------------------------------------------------------------------------
  test('6. Administrador não consegue alterar allowed_llm_providers e constraint valida provedores suportados', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // 1. Cliente comum tenta habilitar outros provedores
    const { error: errUpdate } = await clientAdminA
      .from('company_limits')
      .update({ allowed_llm_providers: ['gemini', 'openai'] })
      .eq('company_id', TENANT_A_ID)

    assert.ok(errUpdate, 'Administrador do cliente não pode alterar provedores liberados')
    assert.match(errUpdate.message, /permission denied for table company_limits/i)

    // 2. Validação da constraint: tentativa via service_role de inserir provedor não suportado
    const adminService = createAdminClient()
    const { error: errConstraint } = await adminService
      .from('company_limits')
      .update({ allowed_llm_providers: ['gemini', 'deepseek_arbitrary', 'claude_unsupported'] })
      .eq('company_id', TENANT_A_ID)

    assert.ok(errConstraint, 'Constraint deve rejeitar provedores não suportados pelo código')
    assert.match(
      errConstraint.message,
      /violates check constraint "company_limits_allowed_llm_providers_check"/i
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Atendente não consegue alterar limites
  // ----------------------------------------------------------------------------
  test('7. Atendente não consegue alterar limites', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { error } = await clientAttendant
      .from('company_limits')
      .update({ max_monthly_messages: 50000 })
      .eq('company_id', TENANT_A_ID)

    assert.ok(error, 'Atendente não pode atualizar limites')
    assert.match(error.message, /permission denied for table company_limits/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Usuário de outra empresa não consegue consultar limites do tenant
  // ----------------------------------------------------------------------------
  test('8. Usuário de outra empresa não consegue consultar limites do tenant alheio', async () => {
    const clientAdminB = createAuthenticatedClient({ userId: ADMIN_B_ID })

    // Usuário da Empresa B tenta buscar os limites da Empresa A
    const { data: limitsA } = await clientAdminB
      .from('company_limits')
      .select('*')
      .eq('company_id', TENANT_A_ID)

    assert.deepEqual(limitsA, [], 'Empresa B não pode consultar limites da Empresa A')

    // Usuário da Empresa B consulta e visualiza apenas os limites de sua própria empresa
    const { data: ownLimits } = await clientAdminB.from('company_limits').select('*')
    assert.equal(ownLimits.length, 1)
    assert.equal(ownLimits[0].company_id, TENANT_B_ID)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Usuário comum não consegue inserir limites
  // ----------------------------------------------------------------------------
  test('9. Usuário comum não consegue inserir limites (bloqueio de INSERT)', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA.from('company_limits').insert({
      company_id: TENANT_A_ID,
      max_agents: 5,
      max_monthly_messages: 50000
    })

    assert.ok(error, 'Administrador de empresa não pode inserir limites')
    assert.match(error.message, /permission denied for table company_limits/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Usuário comum não consegue excluir limites
  // ----------------------------------------------------------------------------
  test('10. Usuário comum não consegue excluir limites (bloqueio de DELETE)', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('company_limits')
      .delete()
      .eq('company_id', TENANT_A_ID)

    assert.ok(error, 'Administrador de empresa não pode deletar limites')
    assert.match(error.message, /permission denied for table company_limits/i)

    assert.ok(inMemoryDb.company_limits.has('lim-tenant-a'), 'Registro de limites deve continuar intacto')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Políticas permissivas existentes não permitem contornar as restrições
  // ----------------------------------------------------------------------------
  test('11. Políticas permissivas existentes não permitem contornar as restrições via upsert ou injeção', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // Tentativa via upsert
    const { error: errUpsert } = await clientAdminA.from('company_limits').upsert({
      id: 'lim-tenant-a',
      company_id: TENANT_A_ID,
      max_agents: 99
    })
    assert.ok(errUpsert, 'Upsert por usuário de empresa deve ser bloqueado')
    assert.match(errUpsert.message, /permission denied for table company_limits/i)

    // Tentativa de injetar limites no tenant B
    const { error: errInjectB } = await clientAdminA.from('company_limits').update({
      max_monthly_messages: 1000
    }).eq('company_id', TENANT_B_ID)

    assert.ok(errInjectB, 'Tentativa de alteração em outro tenant deve ser bloqueada')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: As demais políticas e funcionalidades da Etapa 8.2 continuam preservadas
  // ----------------------------------------------------------------------------
  test('12. As demais políticas e funcionalidades da Etapa 8.2 continuam preservadas', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // 1. Admin consulta catálogo de sua empresa normalmente
    const { data: prods, error: errProds } = await clientAdminA.from('products').select('*')
    assert.equal(errProds, null)
    assert.equal(prods.length, 1)
    assert.equal(prods[0].id, 'prod-a1')

    // 2. Admin consulta preços de sua empresa normalmente
    const { data: prices, error: errPrices } = await clientAdminA.from('product_prices').select('*')
    assert.equal(errPrices, null)
    assert.equal(prices.length, 1)
    assert.equal(prices[0].price, 38.50)

    // 3. Imutabilidade do perfil continua funcionando (trigger protect_profile_tenant_and_role)
    const { error: errProfile } = await clientAdminA.from('profiles').update({
      company_id: TENANT_B_ID
    }).eq('id', ADMIN_A_ID)

    assert.ok(errProfile, 'Trigger de perfil deve continuar impedindo alteração de company_id')
    assert.match(errProfile.message, /não é permitido alterar o vínculo de empresa/i)
  })
})
