import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

test.describe('ETAPA 8.2 — Blindagem do RLS, Proteção de Perfis e Defesa em Profundidade no Banco', () => {
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
      name: 'Empresa A Comércio de Alimentos',
      created_at: new Date().toISOString()
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa B Distribuidora Concorrente',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Perfis de Usuários
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

    // 3. Cadastrar Marcas e Categorias de Referência
    inMemoryDb.product_brands.set('brand-a1', {
      id: 'brand-a1',
      company_id: TENANT_A_ID,
      name: 'Marca A1'
    })
    inMemoryDb.product_brands.set('brand-b1', {
      id: 'brand-b1',
      company_id: TENANT_B_ID,
      name: 'Marca B1'
    })

    inMemoryDb.product_categories.set('cat-a1', {
      id: 'cat-a1',
      company_id: TENANT_A_ID,
      name: 'Categoria Pai A'
    })
    inMemoryDb.product_categories.set('cat-b1', {
      id: 'cat-b1',
      company_id: TENANT_B_ID,
      name: 'Categoria B1'
    })

    // 4. Cadastrar Produtos e Preços da Empresa B para testes de isolamento
    inMemoryDb.products.set('prod-b1', {
      id: 'prod-b1',
      company_id: TENANT_B_ID,
      name: 'Produto Exclusivo Empresa B',
      sku: 'SKU-B1',
      active: true
    })
    inMemoryDb.product_prices.push({
      id: 'price-b1',
      company_id: TENANT_B_ID,
      product_id: 'prod-b1',
      price: 199.90,
      price_type: 'retail',
      min_quantity: 1,
      active: true
    })
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Usuário não consegue alterar o próprio company_id
  // ----------------------------------------------------------------------------
  test('1. Usuário não consegue alterar o próprio company_id (trigger de imutabilidade)', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { error } = await clientAttendant
      .from('profiles')
      .update({ company_id: TENANT_B_ID })
      .eq('id', ATTENDANT_A_ID)

    assert.ok(error, 'Deveria retornar erro ao tentar alterar o company_id')
    assert.match(
      error.message,
      /não é permitido alterar o vínculo de empresa \(company_id\)/i,
      'A mensagem deve indicar o bloqueio da alteração de tenant'
    )

    // Garantir que no banco em memória o vínculo não foi alterado
    const profile = inMemoryDb.profiles.get(ATTENDANT_A_ID)
    assert.equal(profile.company_id, TENANT_A_ID, 'O company_id deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Usuário não consegue alterar o próprio role para admin
  // ----------------------------------------------------------------------------
  test('2. Usuário não consegue alterar o próprio role para admin (privilege escalation)', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { error } = await clientAttendant
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', ATTENDANT_A_ID)

    assert.ok(error, 'Deveria retornar erro ao tentar elevar o papel de permissão')
    assert.match(
      error.message,
      /não é permitido alterar o papel de permissão \(role\)/i,
      'A mensagem deve indicar o bloqueio da alteração de role'
    )

    const profile = inMemoryDb.profiles.get(ATTENDANT_A_ID)
    assert.equal(profile.role, 'attendant', 'O papel deve permanecer como atendente')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Usuário não consegue assumir o tenant de outra empresa
  // ----------------------------------------------------------------------------
  test('3. Usuário não consegue assumir o tenant de outra empresa em inserções ou filtros', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    // Tentar inserir um cliente forçando company_id do concorrente (Tenant B)
    const { error } = await clientAttendant
      .from('customers')
      .insert({
        company_id: TENANT_B_ID,
        name: 'Cliente Injetado Tenant B',
        phone: '11999990000'
      })

    assert.ok(error, 'Deveria violar política RLS ao tentar gravar dados no tenant B')
    assert.match(error.message, /violates row-level security policy/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Usuário sem perfil válido não obtém acesso indevido
  // ----------------------------------------------------------------------------
  test('4. Usuário sem perfil válido não obtém acesso indevido', async () => {
    const clientSemPerfil = createAuthenticatedClient({ userId: 'user-sem-perfil-999' })

    // Tentativa de consultar produtos
    const { data: prods } = await clientSemPerfil.from('products').select('*')
    assert.deepEqual(prods, [], 'Usuário sem perfil não deve receber nenhum produto')

    // Tentativa de inserir registro
    const { error } = await clientSemPerfil.from('customers').insert({
      name: 'Cliente Teste'
    })
    assert.ok(error, 'Tentativa de inserção sem perfil deve ser bloqueada')
    assert.match(error.message, /user has no valid company profile/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Administrador consegue executar as operações administrativas autorizadas
  // ----------------------------------------------------------------------------
  test('5. Administrador consegue executar as operações administrativas autorizadas', async () => {
    const clientAdmin = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // 1. Inserir produto
    const { data: prod, error: errProd } = await clientAdmin
      .from('products')
      .insert({
        company_id: TENANT_A_ID,
        name: 'Produto Admin A',
        sku: 'SKU-ADM-1',
        brand_id: 'brand-a1',
        active: true
      })
    assert.equal(errProd, null, 'Admin deve conseguir cadastrar produto')
    assert.ok(prod.id, 'Produto deve ser criado com ID')

    // 2. Inserir preço
    const { error: errPrice } = await clientAdmin
      .from('product_prices')
      .insert({
        company_id: TENANT_A_ID,
        product_id: prod.id,
        price: 89.90,
        price_type: 'retail',
        min_quantity: 1,
        active: true
      })
    assert.equal(errPrice, null, 'Admin deve conseguir cadastrar preço')

    // 3. Cadastrar API Key
    const { error: errKey } = await clientAdmin
      .from('api_keys')
      .insert({
        company_id: TENANT_A_ID,
        name: 'Webhook Key Admin'
      })
    assert.equal(errKey, null, 'Admin deve conseguir gerenciar API keys')

    // 4. Cadastrar Integração
    const { error: errInteg } = await clientAdmin
      .from('integrations')
      .insert({
        company_id: TENANT_A_ID,
        provider: 'evolution_api'
      })
    assert.equal(errInteg, null, 'Admin deve conseguir configurar integrações')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Atendente consegue consultar produtos e preços
  // ----------------------------------------------------------------------------
  test('6. Atendente consegue consultar produtos e preços', async () => {
    // Preparar produto e preço da Empresa A
    inMemoryDb.products.set('prod-a-vitrine', {
      id: 'prod-a-vitrine',
      company_id: TENANT_A_ID,
      name: 'Chocolate Confeiteiro 1kg',
      sku: 'SKU-A-VITRINE',
      active: true
    })
    inMemoryDb.product_prices.push({
      id: 'price-a-vitrine',
      company_id: TENANT_A_ID,
      product_id: 'prod-a-vitrine',
      price: 42.00,
      price_type: 'retail',
      min_quantity: 1,
      active: true
    })

    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { data: prods, error: errProds } = await clientAttendant.from('products').select('*')
    assert.equal(errProds, null)
    assert.ok(prods.some(p => p.id === 'prod-a-vitrine'), 'Atendente deve ver produtos de sua empresa')

    const { data: prices, error: errPrices } = await clientAttendant.from('product_prices').select('*')
    assert.equal(errPrices, null)
    assert.ok(prices.some(p => p.id === 'price-a-vitrine'), 'Atendente deve ver preços de sua empresa')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Atendente não consegue modificar produtos e preços
  // ----------------------------------------------------------------------------
  test('7. Atendente não consegue modificar produtos e preços', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    // Tentativa de inserção de produto
    const { error: errInsertProd } = await clientAttendant
      .from('products')
      .insert({
        company_id: TENANT_A_ID,
        name: 'Produto Não Autorizado',
        sku: 'SKU-FAIL'
      })
    assert.ok(errInsertProd, 'Atendente não pode inserir produto')
    assert.match(errInsertProd.message, /violates row-level security policy/i)

    // Tentativa de alteração de preço
    const { error: errUpdatePrice } = await clientAttendant
      .from('product_prices')
      .update({ price: 1.00 })
      .eq('company_id', TENANT_A_ID)
    assert.ok(errUpdatePrice, 'Atendente não pode alterar regras de preço')
    assert.match(errUpdatePrice.message, /permission denied/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Atendente não consegue alterar agentes ou prompts
  // ----------------------------------------------------------------------------
  test('8. Atendente não consegue alterar agentes ou prompts', async () => {
    inMemoryDb.agents.set('agent-a1', {
      id: 'agent-a1',
      company_id: TENANT_A_ID,
      name: 'Ellevee Agente A',
      system_prompt: 'Prompt Original Seguro'
    })

    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { error } = await clientAttendant
      .from('agents')
      .update({ system_prompt: 'Prompt Injetado Maliciosamente' })
      .eq('id', 'agent-a1')

    assert.ok(error, 'Atendente não pode modificar agentes')
    assert.match(error.message, /permission denied/i)

    const agent = inMemoryDb.agents.get('agent-a1')
    assert.equal(agent.system_prompt, 'Prompt Original Seguro', 'O prompt deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Atendente não consegue visualizar ou alterar credenciais de integração
  // ----------------------------------------------------------------------------
  test('9. Atendente não consegue visualizar ou alterar credenciais de integração', async () => {
    inMemoryDb.integrations.set('integ-a1', {
      id: 'integ-a1',
      company_id: TENANT_A_ID,
      provider: 'whatsapp_evolution',
      api_token: 'secret-token-12345'
    })

    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    // Consulta: RLS deve ocultar registros
    const { data: integs, error: errSelect } = await clientAttendant.from('integrations').select('*')
    assert.equal(errSelect, null)
    assert.deepEqual(integs, [], 'Atendente não deve visualizar integrações confidenciais')

    // Modificação: RLS deve bloquear alteração
    const { error: errUpdate } = await clientAttendant
      .from('integrations')
      .update({ api_token: 'hacked-token' })
      .eq('id', 'integ-a1')

    assert.ok(errUpdate, 'Atendente não pode atualizar integrações')
    assert.match(errUpdate.message, /permission denied/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Atendente não consegue gerenciar chaves de API
  // ----------------------------------------------------------------------------
  test('10. Atendente não consegue gerenciar chaves de API', async () => {
    inMemoryDb.api_keys.set('key-a1', {
      id: 'key-a1',
      company_id: TENANT_A_ID,
      key_hash: 'hash-seguro-empresa-a'
    })

    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    // Consulta: RLS deve ocultar
    const { data: keys } = await clientAttendant.from('api_keys').select('*')
    assert.deepEqual(keys, [], 'Atendente não deve ver chaves de API')

    // Inserção: RLS deve bloquear
    const { error: errInsert } = await clientAttendant
      .from('api_keys')
      .insert({ company_id: TENANT_A_ID, name: 'Chave Inválida' })

    assert.ok(errInsert, 'Atendente não pode gerar chaves de API')
    assert.match(errInsert.message, /violates row-level security policy/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Atendente não consegue excluir ou reconfigurar workflows
  // ----------------------------------------------------------------------------
  test('11. Atendente não consegue excluir ou reconfigurar workflows', async () => {
    inMemoryDb.workflows.set('wf-a1', {
      id: 'wf-a1',
      company_id: TENANT_A_ID,
      name: 'Workflow de Vendas Padrão'
    })

    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    // Tentativa de update
    const { error: errUpdate } = await clientAttendant
      .from('workflows')
      .update({ name: 'Workflow Desconfigurado' })
      .eq('id', 'wf-a1')
    assert.ok(errUpdate, 'Atendente não pode atualizar workflow')
    assert.match(errUpdate.message, /permission denied/i)

    // Tentativa de delete
    const { error: errDelete } = await clientAttendant
      .from('workflows')
      .delete()
      .eq('id', 'wf-a1')
    assert.ok(errDelete, 'Atendente não pode excluir workflow')
    assert.match(errDelete.message, /permission denied to delete/i)

    assert.ok(inMemoryDb.workflows.has('wf-a1'), 'O workflow deve continuar intacto')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Produto não pode ser associado a marca ou categoria de outro tenant
  // ----------------------------------------------------------------------------
  test('12. Produto não pode ser associado a marca ou categoria de outro tenant', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // Tentativa de associar a produto da Empresa A a marca da Empresa B
    const { error: errBrand } = await clientAdminA
      .from('products')
      .insert({
        company_id: TENANT_A_ID,
        name: 'Produto Cross-Brand Inválido',
        sku: 'SKU-CROSS-BRAND',
        brand_id: 'brand-b1' // Marca pertence ao Tenant B!
      })

    assert.ok(errBrand, 'Deveria falhar violação de integridade de marca multi-tenant')
    assert.match(
      errBrand.message,
      /a marca associada \(brand_id\) não pertence à mesma empresa/i
    )

    // Tentativa de associar a produto da Empresa A a categoria da Empresa B
    const { error: errCat } = await clientAdminA
      .from('products')
      .insert({
        company_id: TENANT_A_ID,
        name: 'Produto Cross-Cat Inválido',
        sku: 'SKU-CROSS-CAT',
        category_id: 'cat-b1' // Categoria pertence ao Tenant B!
      })

    assert.ok(errCat, 'Deveria falhar violação de integridade de categoria multi-tenant')
    assert.match(
      errCat.message,
      /a categoria associada \(category_id\) não pertence à mesma empresa/i
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: Categoria não pode ter pai pertencente a outro tenant
  // ----------------------------------------------------------------------------
  test('13. Categoria não pode ter pai pertencente a outro tenant', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('product_categories')
      .insert({
        company_id: TENANT_A_ID,
        name: 'Categoria Filha Inválida',
        parent_id: 'cat-b1' // Categoria pai pertence ao Tenant B!
      })

    assert.ok(error, 'Deveria falhar integridade multi-tenant em categoria pai')
    assert.match(
      error.message,
      /a categoria pai \(parent_id\) não pertence à mesma empresa/i
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 14: Preço não pode ser associado a produto de outro tenant
  // ----------------------------------------------------------------------------
  test('14. Preço não pode ser associado a produto de outro tenant', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA
      .from('product_prices')
      .insert({
        company_id: TENANT_A_ID,
        product_id: 'prod-b1', // Produto pertence ao Tenant B!
        price: 15.00,
        price_type: 'retail',
        min_quantity: 1
      })

    assert.ok(error, 'Deveria falhar integridade multi-tenant em preço vs produto')
    assert.match(
      error.message,
      /o produto precificado \(product_id\) não pertence à mesma empresa da regra de preço/i
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 15: Empresa A não consegue consultar nem modificar registros da Empresa B
  // ----------------------------------------------------------------------------
  test('15. Empresa A não consegue consultar nem modificar registros da Empresa B usando cliente autenticado', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // 1. Consulta direcionada a registros do concorrente (Tenant B)
    const { data: prodsB } = await clientAdminA
      .from('products')
      .select('*')
      .eq('company_id', TENANT_B_ID)

    assert.deepEqual(prodsB, [], 'Cliente autenticado do Tenant A não deve ver produtos do Tenant B')

    // 2. Consulta geral de preços não deve vazar preços do Tenant B
    const { data: allPrices } = await clientAdminA.from('product_prices').select('*')
    assert.ok(
      allPrices.every(p => p.company_id === TENANT_A_ID),
      'Todos os preços retornados devem pertencer exclusivamente ao Tenant A'
    )
    assert.equal(
      allPrices.some(p => p.id === 'price-b1'),
      false,
      'Preço da Empresa B não pode estar visível para a Empresa A'
    )

    // 3. Tentativa de update em produto da Empresa B
    await clientAdminA
      .from('products')
      .update({ name: 'Nome Adulterado' })
      .eq('id', 'prod-b1')

    const prodB = inMemoryDb.products.get('prod-b1')
    assert.equal(prodB.name, 'Produto Exclusivo Empresa B', 'O produto da Empresa B não pode ter sido modificado')

    // 4. Tentativa de delete em produto da Empresa B
    await clientAdminA
      .from('products')
      .delete()
      .eq('id', 'prod-b1')

    assert.ok(inMemoryDb.products.has('prod-b1'), 'O produto da Empresa B não pode ter sido excluído')
  })
})
