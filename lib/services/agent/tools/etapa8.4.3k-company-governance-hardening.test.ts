import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

test.describe('ETAPA 8.4.3K — Hardening de RLS e Proteção de Campos de Governança na Tabela Companies', () => {
  // IDs de empresas (tenants)
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED_ID = '33333333-3333-3333-3333-333333333333'

  // IDs de usuários do tenant
  const ADMIN_A_ID = 'user-admin-tenant-a'
  const ATTENDANT_A_ID = 'user-attendant-tenant-a'
  const ADMIN_B_ID = 'user-admin-tenant-b'
  const ADMIN_SUSPENDED_ID = 'user-admin-tenant-suspended'
  const USER_WITHOUT_PROFILE_ID = 'user-sem-perfil'

  // IDs de operadores da plataforma
  const ACTIVE_SUPERADMIN_ID = 'superadmin-active-001'
  const INACTIVE_SUPERADMIN_ID = 'superadmin-inactive-002'

  test.beforeEach(() => {
    resetInMemoryDb()

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa Alpha Comércio',
      slug: 'empresa-alpha',
      status: 'active',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa Beta Serviços',
      slug: 'empresa-beta',
      status: 'active',
      plan_tier: 'pro',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Gama Suspensa',
      slug: 'empresa-gama',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: 'Inadimplência recorrente',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Perfis de Usuários
    inMemoryDb.profiles.set(ADMIN_A_ID, {
      id: ADMIN_A_ID,
      company_id: TENANT_A_ID,
      role: 'admin',
      full_name: 'Admin Alpha',
      email: 'admin@alpha.com'
    })

    inMemoryDb.profiles.set(ATTENDANT_A_ID, {
      id: ATTENDANT_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant',
      full_name: 'Atendente Alpha',
      email: 'atendente@alpha.com'
    })

    inMemoryDb.profiles.set(ADMIN_B_ID, {
      id: ADMIN_B_ID,
      company_id: TENANT_B_ID,
      role: 'admin',
      full_name: 'Admin Beta',
      email: 'admin@beta.com'
    })

    inMemoryDb.profiles.set(ADMIN_SUSPENDED_ID, {
      id: ADMIN_SUSPENDED_ID,
      company_id: TENANT_SUSPENDED_ID,
      role: 'admin',
      full_name: 'Admin Gama',
      email: 'admin@gama.com'
    })

    // 3. Cadastrar Operadores da Plataforma
    inMemoryDb.platform_admins.set(ACTIVE_SUPERADMIN_ID, {
      id: ACTIVE_SUPERADMIN_ID,
      email: 'super@elleveeia.com',
      full_name: 'Superadmin Ativo',
      role: 'superadmin',
      active: true,
      created_at: new Date().toISOString()
    })

    inMemoryDb.platform_admins.set(INACTIVE_SUPERADMIN_ID, {
      id: INACTIVE_SUPERADMIN_ID,
      email: 'inativo@elleveeia.com',
      full_name: 'Superadmin Inativo',
      role: 'superadmin',
      active: false,
      created_at: new Date().toISOString()
    })
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Administrador de tenant tenta alterar status de suspended para active: bloqueado
  // ----------------------------------------------------------------------------
  test('1. Administrador de tenant tenta alterar status de suspended para active: bloqueado', async () => {
    const client = createAuthenticatedClient({ userId: ADMIN_SUSPENDED_ID })

    const { error } = await client
      .from('companies')
      .update({ status: 'active' })
      .eq('id', TENANT_SUSPENDED_ID)

    assert.ok(error, 'Administrador do tenant não pode reativar empresa por conta própria')
    assert.match(
      error.message,
      /Operação negada: os campos status, suspension_reason e plan_tier são de governança restrita/i
    )

    const company = inMemoryDb.companies.get(TENANT_SUSPENDED_ID)
    assert.equal(company.status, 'suspended', 'Status deve permanecer suspended')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Administrador de tenant tenta alterar suspension_reason: bloqueado
  // ----------------------------------------------------------------------------
  test('2. Administrador de tenant tenta alterar suspension_reason: bloqueado', async () => {
    const client = createAuthenticatedClient({ userId: ADMIN_SUSPENDED_ID })

    const { error } = await client
      .from('companies')
      .update({ suspension_reason: null })
      .eq('id', TENANT_SUSPENDED_ID)

    assert.ok(error, 'Administrador do tenant não pode limpar ou alterar suspension_reason')
    assert.match(
      error.message,
      /Operação negada: os campos status, suspension_reason e plan_tier são de governança restrita/i
    )

    const company = inMemoryDb.companies.get(TENANT_SUSPENDED_ID)
    assert.equal(company.suspension_reason, 'Inadimplência recorrente', 'suspension_reason deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Administrador de tenant tenta alterar plan_tier: bloqueado
  // ----------------------------------------------------------------------------
  test('3. Administrador de tenant tenta alterar plan_tier: bloqueado', async () => {
    const client = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await client
      .from('companies')
      .update({ plan_tier: 'enterprise' })
      .eq('id', TENANT_A_ID)

    assert.ok(error, 'Administrador do tenant não pode realizar upgrade de plano diretamente na tabela')
    assert.match(
      error.message,
      /Operação negada: os campos status, suspension_reason e plan_tier são de governança restrita/i
    )

    const company = inMemoryDb.companies.get(TENANT_A_ID)
    assert.equal(company.plan_tier, 'standard', 'plan_tier deve permanecer standard')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Administrador de tenant altera name: permitido, respeitando a policy existente
  // ----------------------------------------------------------------------------
  test('4. Administrador de tenant altera name: permitido, respeitando a policy existente', async () => {
    const client = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await client
      .from('companies')
      .update({ name: 'Alpha Distribuidora Oficial' })
      .eq('id', TENANT_A_ID)

    assert.equal(error, null, 'Administrador do tenant deve poder atualizar campos comuns autorizados')

    const company = inMemoryDb.companies.get(TENANT_A_ID)
    assert.equal(company.name, 'Alpha Distribuidora Oficial', 'Nome deve ser atualizado com sucesso')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Usuário attendant tenta alterar campos de governança: bloqueado (RLS)
  // ----------------------------------------------------------------------------
  test('5. Usuário attendant tenta alterar campos de governança: bloqueado (RLS)', async () => {
    const client = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { error } = await client
      .from('companies')
      .update({ status: 'suspended' })
      .eq('id', TENANT_A_ID)

    assert.ok(error, 'Atendente não deve ter permissão de UPDATE na tabela companies')
    assert.match(
      error.message,
      /permission denied for table companies|violates row-level security policy/i
    )

    const company = inMemoryDb.companies.get(TENANT_A_ID)
    assert.equal(company.status, 'active', 'Status deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Usuário sem vínculo com a empresa tenta alterar o registro: bloqueado (RLS)
  // ----------------------------------------------------------------------------
  test('6. Usuário sem vínculo com a empresa tenta alterar o registro: bloqueado (RLS)', async () => {
    // Subcaso A: Usuário sem perfil no banco
    const clientNoProfile = createAuthenticatedClient({ userId: USER_WITHOUT_PROFILE_ID })
    const { error: errNoProfile } = await clientNoProfile
      .from('companies')
      .update({ name: 'Invasor Sem Perfil' })
      .eq('id', TENANT_A_ID)

    assert.ok(errNoProfile, 'Usuário sem perfil cadastrado deve ser bloqueado por RLS')
    assert.match(
      errNoProfile.message,
      /row-level security policy|permission denied/i
    )

    // Subcaso B: Usuário com perfil em outra empresa (Tenant B tentando alterar Tenant A)
    const clientAdminB = createAuthenticatedClient({ userId: ADMIN_B_ID })
    const { data: updatedB } = await clientAdminB
      .from('companies')
      .update({ name: 'Tentativa Invasão Tenant B' })
      .eq('id', TENANT_A_ID)

    assert.equal(updatedB?.length || 0, 0, 'Nenhum registro de outro tenant pode ser afetado')

    const companyA = inMemoryDb.companies.get(TENANT_A_ID)
    assert.equal(companyA.name, 'Empresa Alpha Comércio', 'Nome da Empresa A deve permanecer inalterado')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Superadmin ativo altera status: permitido
  // ----------------------------------------------------------------------------
  test('7. Superadmin ativo altera status: permitido', async () => {
    const clientSuper = createAuthenticatedClient({ userId: ACTIVE_SUPERADMIN_ID })

    const { error } = await clientSuper
      .from('companies')
      .update({
        status: 'suspended',
        suspension_reason: 'Auditoria de conformidade da plataforma'
      })
      .eq('id', TENANT_A_ID)

    assert.equal(error, null, 'Superadmin ativo deve poder alterar o status da empresa')

    const company = inMemoryDb.companies.get(TENANT_A_ID)
    assert.equal(company.status, 'suspended', 'Status deve ser atualizado para suspended')
    assert.equal(company.suspension_reason, 'Auditoria de conformidade da plataforma')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Superadmin ativo altera plan_tier: permitido
  // ----------------------------------------------------------------------------
  test('8. Superadmin ativo altera plan_tier: permitido', async () => {
    const clientSuper = createAuthenticatedClient({ userId: ACTIVE_SUPERADMIN_ID })

    const { error } = await clientSuper
      .from('companies')
      .update({ plan_tier: 'enterprise' })
      .eq('id', TENANT_A_ID)

    assert.equal(error, null, 'Superadmin ativo deve poder alterar o plan_tier da empresa')

    const company = inMemoryDb.companies.get(TENANT_A_ID)
    assert.equal(company.plan_tier, 'enterprise', 'plan_tier deve ser atualizado para enterprise')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Superadmin inativo tenta alterar campos de governança: bloqueado
  // ----------------------------------------------------------------------------
  test('9. Superadmin inativo tenta alterar campos de governança: bloqueado', async () => {
    const clientInactive = createAuthenticatedClient({ userId: INACTIVE_SUPERADMIN_ID })

    const { error } = await clientInactive
      .from('companies')
      .update({ status: 'active' })
      .eq('id', TENANT_SUSPENDED_ID)

    assert.ok(error, 'Superadmin inativo não pode alterar campos de governança')

    const company = inMemoryDb.companies.get(TENANT_SUSPENDED_ID)
    assert.equal(company.status, 'suspended', 'Status deve permanecer suspended')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Operação interna com service_role altera campos de governança: permitido
  // ----------------------------------------------------------------------------
  test('10. Operação interna com service_role altera campos de governança: permitido', async () => {
    const adminClient = createAdminClient()

    const { error } = await adminClient
      .from('companies')
      .update({
        status: 'active',
        suspension_reason: null
      })
      .eq('id', TENANT_SUSPENDED_ID)

    assert.equal(error, null, 'Operações de backend via service_role devem poder alterar status e suspension_reason')

    const company = inMemoryDb.companies.get(TENANT_SUSPENDED_ID)
    assert.equal(company.status, 'active', 'Status deve ser ativado com sucesso')
    assert.equal(company.suspension_reason, null, 'suspension_reason deve ser limpo')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: UPDATE de campos comuns não provoca bloqueio indevido do trigger
  // ----------------------------------------------------------------------------
  test('11. UPDATE de campos comuns não provoca bloqueio indevido do trigger', async () => {
    const client = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // Atualização de campos comuns sem mencionar campos de governança
    const { error: err1 } = await client
      .from('companies')
      .update({ name: 'Alpha Razão Social Alterada' })
      .eq('id', TENANT_A_ID)

    assert.equal(err1, null, 'Atualização de campos comuns não deve acionar bloqueio do trigger')
    assert.equal(inMemoryDb.companies.get(TENANT_A_ID).name, 'Alpha Razão Social Alterada')

    // Atualização passando o mesmo status atual (IS NOT DISTINCT FROM)
    const { error: err2 } = await client
      .from('companies')
      .update({
        name: 'Alpha Razão Social Definitiva',
        status: 'active'
      })
      .eq('id', TENANT_A_ID)

    assert.equal(err2, null, 'Passar o mesmo valor existente não deve violar o trigger')
    assert.equal(inMemoryDb.companies.get(TENANT_A_ID).name, 'Alpha Razão Social Definitiva')
    assert.equal(inMemoryDb.companies.get(TENANT_A_ID).status, 'active')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Tentativa de alteração simultânea de campo comum e campo protegido por administrador de tenant: toda a operação deve ser rejeitada
  // ----------------------------------------------------------------------------
  test('12. Tentativa de alteração simultânea de campo comum e campo protegido por administrador de tenant: toda a operação deve ser rejeitada', async () => {
    const client = createAuthenticatedClient({ userId: ADMIN_SUSPENDED_ID })

    const { error } = await client
      .from('companies')
      .update({
        name: 'Tentativa de Hack de Nome',
        status: 'active'
      })
      .eq('id', TENANT_SUSPENDED_ID)

    assert.ok(error, 'Alteração mista com campo protegido deve ser rejeitada')
    assert.match(
      error.message,
      /Operação negada: os campos status, suspension_reason e plan_tier são de governança restrita/i
    )

    const company = inMemoryDb.companies.get(TENANT_SUSPENDED_ID)
    // Atomicidade: nenhum campo pode ser atualizado se o trigger falhar
    assert.equal(company.status, 'suspended', 'Status deve permanecer suspended')
    assert.equal(company.name, 'Empresa Gama Suspensa', 'Nome não pode ter sido modificado')
  })
})
