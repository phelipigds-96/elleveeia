import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAuthenticatedClient,
  createAdminClient,
  isPlatformAdmin,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

test.describe('ETAPA 8.3.2 — Núcleo de Governança do Superadministrador e Estrutura SaaS', () => {
  const TENANT_A_ID = 'tenant-a-1111-1111-1111-111111111111'
  const TENANT_B_ID = 'tenant-b-2222-2222-2222-222222222222'

  const SUPERADMIN_ID = 'superadmin-user-001'
  const ADMIN_A_ID = 'user-admin-a-001'
  const ATTENDANT_A_ID = 'user-attendant-a-002'

  test.beforeEach(() => {
    resetInMemoryDb()

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa A Alimentos',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa B Confeitaria',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Limites das Empresas
    inMemoryDb.company_limits.set('lim-a', {
      id: 'lim-a',
      company_id: TENANT_A_ID,
      max_agents: 2,
      max_monthly_messages: 10000,
      max_monthly_quotes: 2000,
      max_catalog_items: 50000,
      allowed_llm_providers: ['gemini']
    })

    // 3. Cadastrar Perfis de Clientes em profiles
    inMemoryDb.profiles.set(ADMIN_A_ID, {
      id: ADMIN_A_ID,
      company_id: TENANT_A_ID,
      role: 'admin',
      full_name: 'Admin Empresa A',
      email: 'admin@empresa-a.com'
    })
    inMemoryDb.profiles.set(ATTENDANT_A_ID, {
      id: ATTENDANT_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant',
      full_name: 'Atendente Empresa A',
      email: 'atendente@empresa-a.com'
    })

    // 4. Cadastrar Superadministrador em platform_admins (NÃO em profiles)
    inMemoryDb.platform_admins.set(SUPERADMIN_ID, {
      id: SUPERADMIN_ID,
      email: 'proprietario@elleveeia.com.br',
      full_name: 'Superadministrador Ellevee',
      role: 'superadmin',
      active: true,
      created_at: new Date().toISOString()
    })
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Criação correta das novas tabelas
  // ----------------------------------------------------------------------------
  test('1. Criação correta das novas tabelas de governança no banco', async () => {
    const adminClient = createAdminClient()

    // Inspecionar se as tabelas aceitam queries estruturais via service role
    const { data: platAdmins, error: errPlat } = await adminClient.from('platform_admins').select('*')
    assert.equal(errPlat, null)
    assert.ok(Array.isArray(platAdmins))

    const { data: limits, error: errLimits } = await adminClient.from('company_limits').select('*')
    assert.equal(errLimits, null)
    assert.ok(Array.isArray(limits))

    const { data: jobs, error: errJobs } = await adminClient.from('provisioning_jobs').select('*')
    assert.equal(errJobs, null)
    assert.ok(Array.isArray(jobs))

    const { data: audit, error: errAudit } = await adminClient.from('platform_audit_logs').select('*')
    assert.equal(errAudit, null)
    assert.ok(Array.isArray(audit))
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Constraints de papéis e status
  // ----------------------------------------------------------------------------
  test('2. Constraints de papéis e status limitam valores aceitos', async () => {
    const adminClient = createAdminClient()

    // 1. Papel inválido em platform_admins
    const { error: errRole } = await adminClient.from('platform_admins').insert({
      id: 'user-invalido-role',
      email: 'hacker@invalido.com',
      full_name: 'Hacker',
      role: 'root_god_mode' // Papel inválido!
    })
    assert.ok(errRole, 'Deveria falhar na constraint de role de platform_admins')
    assert.match(errRole.message, /violates check constraint "platform_admins_role_check"/i)

    // 2. Status inválido em companies
    const { error: errStatus } = await adminClient.from('companies').insert({
      name: 'Empresa Status Inválido',
      status: 'vip_unlimited' // Status inválido!
    })
    assert.ok(errStatus, 'Deveria falhar na constraint de status de companies')
    assert.match(errStatus.message, /violates check constraint "companies_status_check"/i)

    // 3. Plano inválido em companies
    const { error: errPlan } = await adminClient.from('companies').insert({
      name: 'Empresa Plano Inválido',
      status: 'active',
      plan_tier: 'diamond_luxury' // Plano inválido!
    })
    assert.ok(errPlan, 'Deveria falhar na constraint de plan_tier de companies')
    assert.match(errPlan.message, /violates check constraint "companies_plan_tier_check"/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Integridade das foreign keys e limites numéricos
  // ----------------------------------------------------------------------------
  test('3. Integridade e validação de limites numéricos não negativos', async () => {
    const adminClient = createAdminClient()

    // Tentativa de criar company_limits com limite negativo
    const { error: errNeg } = await adminClient.from('company_limits').insert({
      company_id: TENANT_B_ID,
      max_agents: 0 // max_agents deve ser >= 1
    })
    assert.ok(errNeg, 'Deveria falhar limite de agentes menor que 1')
    assert.match(errNeg.message, /violates check constraint "company_limits_max_agents_check"/i)

    const { error: errNegMsg } = await adminClient.from('company_limits').insert({
      company_id: TENANT_B_ID,
      max_agents: 1,
      max_monthly_messages: -500 // Deve ser >= 0
    })
    assert.ok(errNegMsg, 'Deveria falhar cota de mensagens negativa')
    assert.match(errNegMsg.message, /violates check constraint "company_limits_max_monthly_messages_check"/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Unicidade de company_limits por empresa
  // ----------------------------------------------------------------------------
  test('4. Unicidade de company_limits por empresa (1 para 1 estrito)', async () => {
    const adminClient = createAdminClient()

    // Tenant A já possui limites cadastrados ('lim-a')
    // Tentativa de inserir um segundo registro de limites para o Tenant A
    const { error } = await adminClient.from('company_limits').insert({
      company_id: TENANT_A_ID,
      max_agents: 5
    })

    assert.ok(error, 'Deveria violar constraint UNIQUE de company_id em company_limits')
    assert.match(error.message, /violates unique constraint "company_limits_company_id_key"/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: RLS habilitado em todas as novas tabelas
  // ----------------------------------------------------------------------------
  test('5. RLS habilitado em todas as novas tabelas impede acesso indiscriminado', async () => {
    const clientAnon = createAuthenticatedClient({ userId: 'anon-random-user' })

    // Consulta anônima / usuário sem tenant em company_limits
    const { data: limits } = await clientAnon.from('company_limits').select('*')
    assert.deepEqual(limits, [], 'Usuário sem contexto não deve ver limites de nenhuma empresa')

    // Consulta anônima em provisioning_jobs
    const { data: jobs } = await clientAnon.from('provisioning_jobs').select('*')
    assert.deepEqual(jobs, [], 'Usuário sem contexto não deve ver jobs de provisionamento')

    // Consulta anônima em platform_audit_logs
    const { data: audit } = await clientAnon.from('platform_audit_logs').select('*')
    assert.deepEqual(audit, [], 'Usuário sem contexto não deve ver logs de auditoria')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Usuário comum não consegue se inserir em platform_admins
  // ----------------------------------------------------------------------------
  test('6. Usuário comum não consegue se inserir em platform_admins (auto-promoção bloqueada)', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    const { error } = await clientAdminA.from('platform_admins').insert({
      id: ADMIN_A_ID,
      email: 'admin@empresa-a.com',
      full_name: 'Admin querendo virar Superadmin',
      role: 'superadmin'
    })

    assert.ok(error, 'Usuário comum de empresa não pode se inserir em platform_admins')
    assert.match(
      error.message,
      /gerenciamento de operadores da plataforma só é permitido via serviço administrativo de backend/i
    )

    assert.equal(inMemoryDb.platform_admins.has(ADMIN_A_ID), false)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Usuário comum não consegue alterar seu próprio papel de plataforma
  // ----------------------------------------------------------------------------
  test('7. Usuário comum não consegue alterar ou assumir papel de plataforma', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    const { error } = await clientAttendant.from('platform_admins').update({
      role: 'superadmin',
      active: true
    }).eq('id', ATTENDANT_A_ID)

    assert.ok(error, 'Tentativa de mutação em platform_admins deve ser bloqueada')
    assert.match(error.message, /gerenciamento de operadores da plataforma só é permitido via serviço administrativo de backend/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Usuário de uma empresa não consegue ler logs globais
  // ----------------------------------------------------------------------------
  test('8. Usuário de uma empresa não consegue ler logs de auditoria globais', async () => {
    // Gravar log confidencial na plataforma via backend (service role)
    const adminService = createAdminClient()
    await adminService.from('platform_audit_logs').insert({
      actor_id: SUPERADMIN_ID,
      actor_email: 'proprietario@elleveeia.com.br',
      action: 'company.suspend',
      target_company_id: TENANT_B_ID,
      reason: 'Inadimplência contratual comprovada'
    })

    // Usuário administrador da Empresa A tenta consultar a auditoria global
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })
    const { data: logsA } = await clientAdminA.from('platform_audit_logs').select('*')
    assert.deepEqual(logsA, [], 'Admin de empresa cliente não pode ver logs globais')

    // Atendente da Empresa A tenta consultar a auditoria global
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })
    const { data: logsAttendant } = await clientAttendant.from('platform_audit_logs').select('*')
    assert.deepEqual(logsAttendant, [], 'Atendente não pode ver logs globais')

    // Superadministrador consulta e visualiza o log
    const clientSuperadmin = createAuthenticatedClient({ userId: SUPERADMIN_ID })
    const { data: logsSuper, error: errSuper } = await clientSuperadmin.from('platform_audit_logs').select('*')
    assert.equal(errSuper, null)
    assert.equal(logsSuper.length, 1)
    assert.equal(logsSuper[0].action, 'company.suspend')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Atendente não consegue alterar limites
  // ----------------------------------------------------------------------------
  test('9. Atendente não consegue alterar limites de sua empresa', async () => {
    const clientAttendant = createAuthenticatedClient({ userId: ATTENDANT_A_ID })

    // Consulta permitida (ver cotas)
    const { data: lims, error: errSelect } = await clientAttendant.from('company_limits').select('*')
    assert.equal(errSelect, null)
    assert.equal(lims.length, 1)

    // Tentativa de update bloqueada por RLS
    const { error: errUpdate } = await clientAttendant
      .from('company_limits')
      .update({ max_monthly_messages: 9999999 })
      .eq('company_id', TENANT_A_ID)

    assert.ok(errUpdate, 'Atendente não tem permissão para alterar limites')
    assert.match(errUpdate.message, /permission denied for table company_limits/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Job de provisionamento não pode ser manipulado diretamente pelo cliente
  // ----------------------------------------------------------------------------
  test('10. Job de provisionamento não pode ser manipulado diretamente pelo cliente', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // Tentativa de criar job diretamente
    const { error: errInsert } = await clientAdminA.from('provisioning_jobs').insert({
      company_id: TENANT_A_ID,
      admin_email: 'injetado@teste.com',
      admin_name: 'Injeção',
      status: 'running'
    })
    assert.ok(errInsert, 'Cliente comum não pode criar jobs diretamente')
    assert.match(errInsert.message, /violates row-level security policy/i)

    // Tentativa de alterar job diretamente
    const { error: errUpdate } = await clientAdminA.from('provisioning_jobs').update({
      status: 'success'
    }).eq('company_id', TENANT_A_ID)
    assert.ok(errUpdate, 'Cliente comum não pode alterar status de jobs')
    assert.match(errUpdate.message, /permission denied/i)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Registro de auditoria não pode ser alterado ou excluído (imutabilidade)
  // ----------------------------------------------------------------------------
  test('11. Registro de auditoria não pode ser alterado ou excluído (trigger de imutabilidade estrita)', async () => {
    const adminService = createAdminClient()

    // 1. Criar um log de auditoria
    const { data: log } = await adminService.from('platform_audit_logs').insert({
      actor_id: SUPERADMIN_ID,
      actor_email: 'proprietario@elleveeia.com.br',
      action: 'limits.update',
      target_company_id: TENANT_A_ID,
      payload_summary: { max_agents: 5 }
    })

    // 2. Tentativa de UPDATE no log (inclusive via service_role / qualquer cliente)
    const { error: errUpdate } = await adminService
      .from('platform_audit_logs')
      .update({ action: 'ação_adulterada' })
      .eq('id', log.id)

    assert.ok(errUpdate, 'UPDATE em logs de auditoria deve ser sumariamente bloqueado')
    assert.match(
      errUpdate.message,
      /logs de auditoria da plataforma são estritamente imutáveis/i
    )

    // 3. Tentativa de DELETE no log
    const { error: errDelete } = await adminService
      .from('platform_audit_logs')
      .delete()
      .eq('id', log.id)

    assert.ok(errDelete, 'DELETE em logs de auditoria deve ser sumariamente bloqueado')
    assert.match(
      errDelete.message,
      /logs de auditoria da plataforma são estritamente imutáveis/i
    )

    // Verificar que o log permanece intacto
    const logCheck = inMemoryDb.platform_audit_logs.get(log.id)
    assert.ok(logCheck)
    assert.equal(logCheck.action, 'limits.update')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Empresa existente permanece active após a migration
  // ----------------------------------------------------------------------------
  test('12. Empresa existente permanece com status active e plano standard após migration', async () => {
    const adminService = createAdminClient()

    const { data: defaultCompany } = await adminService
      .from('companies')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single()

    assert.ok(defaultCompany)
    assert.equal(defaultCompany.status, 'active', 'Empresa pré-existente deve ter status active')
    assert.equal(defaultCompany.plan_tier, 'standard', 'Empresa pré-existente deve ter plan_tier standard')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: A função is_platform_admin() reconhece somente operadores ativos
  // ----------------------------------------------------------------------------
  test('13. A função is_platform_admin() reconhece somente operadores ativos cadastrados', async () => {
    // 1. Superadministrador ativo
    assert.equal(isPlatformAdmin(SUPERADMIN_ID), true, 'Superadmin ativo deve retornar true')

    // 2. Operador desativado
    inMemoryDb.platform_admins.set('operator-inativo', {
      id: 'operator-inativo',
      email: 'inativo@elleveeia.com.br',
      full_name: 'Operador Inativo',
      role: 'support_operator',
      active: false
    })
    assert.equal(isPlatformAdmin('operator-inativo'), false, 'Operador inativo deve retornar false')

    // 3. Usuário inexistente
    assert.equal(isPlatformAdmin('usuario-fantasma-999'), false, 'Usuário fantasma deve retornar false')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 14: Usuário sem perfil de plataforma não recebe autorização global
  // ----------------------------------------------------------------------------
  test('14. Usuário de empresa (mesmo admin de tenant) não recebe autorização global', async () => {
    assert.equal(isPlatformAdmin(ADMIN_A_ID), false, 'Admin de tenant NÃO é platform admin')
    assert.equal(isPlatformAdmin(ATTENDANT_A_ID), false, 'Atendente NÃO é platform admin')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 15: As políticas da Etapa 8.2 continuam funcionando perfeitamente
  // ----------------------------------------------------------------------------
  test('15. As políticas da Etapa 8.2 continuam funcionando e isolando tenants', async () => {
    const clientAdminA = createAuthenticatedClient({ userId: ADMIN_A_ID })

    // Admin da Empresa A tenta consultar dados da Empresa B
    const { data: prodsB } = await clientAdminA
      .from('products')
      .select('*')
      .eq('company_id', TENANT_B_ID)

    assert.deepEqual(prodsB, [], 'Isolamento de tenant da Etapa 8.2 permanece ativo e intocado')

    // Admin da Empresa A tenta alterar seu próprio company_id em profiles
    const { error: errTenantHijack } = await clientAdminA
      .from('profiles')
      .update({ company_id: TENANT_B_ID })
      .eq('id', ADMIN_A_ID)

    assert.ok(errTenantHijack, 'Trigger de imutabilidade de profiles da Etapa 8.2 permanece ativo')
    assert.match(errTenantHijack.message, /não é permitido alterar o vínculo de empresa/i)
  })
})
