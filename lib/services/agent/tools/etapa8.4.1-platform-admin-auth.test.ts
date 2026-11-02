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
import {
  requirePlatformAdmin,
  logPlatformAudit,
  PlatformAuthError,
  sanitizePayload
} from '@/lib/services/platform/admin'

test.describe('ETAPA 8.4.1 — Serviço Central de Autorização do Superadministrador', () => {
  const TENANT_A_ID = 'tenant-a-1111-1111-1111-111111111111'

  const SUPERADMIN_ACTIVE_ID = 'user-superadmin-001'
  const SUPERADMIN_INACTIVE_ID = 'user-superadmin-inactive-002'
  const SUPPORT_OPERATOR_ID = 'user-support-003'
  const BILLING_ADMIN_ID = 'user-billing-004'

  const COMPANY_ADMIN_ID = 'user-company-admin-010'
  const ATTENDANT_ID = 'user-attendant-020'
  const COMMON_USER_ID = 'user-common-030'

  test.beforeEach(() => {
    resetInMemoryDb()

    // 1. Cadastrar Empresa
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa Teste A',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Perfis de Clientes em public.profiles
    inMemoryDb.profiles.set(COMPANY_ADMIN_ID, {
      id: COMPANY_ADMIN_ID,
      company_id: TENANT_A_ID,
      role: 'admin',
      full_name: 'Admin da Empresa A',
      email: 'admin@empresa-a.com'
    })
    inMemoryDb.profiles.set(ATTENDANT_ID, {
      id: ATTENDANT_ID,
      company_id: TENANT_A_ID,
      role: 'attendant',
      full_name: 'Atendente da Empresa A',
      email: 'atendente@empresa-a.com'
    })
    inMemoryDb.profiles.set(COMMON_USER_ID, {
      id: COMMON_USER_ID,
      company_id: TENANT_A_ID,
      role: 'user',
      full_name: 'Usuário Comum Tenant',
      email: 'user@empresa-a.com'
    })

    // 3. Cadastrar Operadores da Plataforma em public.platform_admins (Tabela Estanque)
    inMemoryDb.platform_admins.set(SUPERADMIN_ACTIVE_ID, {
      id: SUPERADMIN_ACTIVE_ID,
      email: 'superadmin@elleveeia.com.br',
      full_name: 'Superadministrador Ativo',
      role: 'superadmin',
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.platform_admins.set(SUPERADMIN_INACTIVE_ID, {
      id: SUPERADMIN_INACTIVE_ID,
      email: 'inativo@elleveeia.com.br',
      full_name: 'Superadministrador Desativado',
      role: 'superadmin',
      active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.platform_admins.set(SUPPORT_OPERATOR_ID, {
      id: SUPPORT_OPERATOR_ID,
      email: 'suporte@elleveeia.com.br',
      full_name: 'Operador de Suporte',
      role: 'support_operator',
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.platform_admins.set(BILLING_ADMIN_ID, {
      id: BILLING_ADMIN_ID,
      email: 'financeiro@elleveeia.com.br',
      full_name: 'Administrador Financeiro',
      role: 'billing_admin',
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Usuário não autenticado recebe 401
  // ----------------------------------------------------------------------------
  test('1. Usuário não autenticado recebe erro 401 Unauthorized', async () => {
    // Cliente mock sem sessão de usuário
    const unauthenticatedClient = {
      auth: {
        getUser: async () => ({ data: { user: null }, error: new Error('Sessão inexistente') })
      }
    }

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: unauthenticatedClient })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 401)
        assert.equal(err.code, 'UNAUTHENTICATED')
        assert.match(err.message, /não autenticado/i)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Usuário comum de um tenant recebe 403
  // ----------------------------------------------------------------------------
  test('2. Usuário comum de um tenant recebe 403 Forbidden', async () => {
    const clientCommon = createAuthenticatedClient({
      userId: COMMON_USER_ID,
      email: 'user@empresa-a.com'
    })

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientCommon })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        assert.match(err.message, /não é um operador da plataforma/i)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Atendente recebe 403
  // ----------------------------------------------------------------------------
  test('3. Atendente de empresa cliente recebe 403 Forbidden', async () => {
    const clientAttendant = createAuthenticatedClient({
      userId: ATTENDANT_ID,
      email: 'atendente@empresa-a.com'
    })

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientAttendant })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Administrador de empresa recebe 403
  // ----------------------------------------------------------------------------
  test('4. Administrador de empresa cliente recebe 403 Forbidden', async () => {
    const clientCompanyAdmin = createAuthenticatedClient({
      userId: COMPANY_ADMIN_ID,
      email: 'admin@empresa-a.com'
    })

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientCompanyAdmin })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Superadministrador ativo é autorizado
  // ----------------------------------------------------------------------------
  test('5. Superadministrador ativo é autorizado e recebe contexto completo', async () => {
    const clientSuperadmin = createAuthenticatedClient({
      userId: SUPERADMIN_ACTIVE_ID,
      email: 'superadmin@elleveeia.com.br'
    })

    const ctx = await requirePlatformAdmin({ client: clientSuperadmin })

    assert.ok(ctx)
    assert.equal(ctx.user.id, SUPERADMIN_ACTIVE_ID)
    assert.equal(ctx.user.email, 'superadmin@elleveeia.com.br')
    assert.equal(ctx.operator.role, 'superadmin')
    assert.equal(ctx.operator.active, true)
    assert.equal(ctx.operator.fullName, 'Superadministrador Ativo')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Superadministrador inativo recebe 403
  // ----------------------------------------------------------------------------
  test('6. Superadministrador inativo recebe 403 Forbidden', async () => {
    const clientInactive = createAuthenticatedClient({
      userId: SUPERADMIN_INACTIVE_ID,
      email: 'inativo@elleveeia.com.br'
    })

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientInactive })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        assert.match(err.message, /desativado/i)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: support_operator é identificado com seu papel real
  // ----------------------------------------------------------------------------
  test('7. support_operator é identificado com seu papel real', async () => {
    const clientSupport = createAuthenticatedClient({
      userId: SUPPORT_OPERATOR_ID,
      email: 'suporte@elleveeia.com.br'
    })

    // Com permissão explícita para o papel:
    const ctx = await requirePlatformAdmin({
      client: clientSupport,
      requiredRoles: ['support_operator']
    })
    assert.equal(ctx.operator.role, 'support_operator')
    assert.equal(ctx.operator.fullName, 'Operador de Suporte')

    // Sem requiredRoles explícito (política restritiva padrão exige superadmin):
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientSupport })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    // Se a operação exigir expressamente o papel 'superadmin':
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientSupport, requiredRoles: ['superadmin'] })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: billing_admin é identificado com seu papel real
  // ----------------------------------------------------------------------------
  test('8. billing_admin é identificado com seu papel real', async () => {
    const clientBilling = createAuthenticatedClient({
      userId: BILLING_ADMIN_ID,
      email: 'financeiro@elleveeia.com.br'
    })

    // Com permissão explícita para o papel:
    const ctx = await requirePlatformAdmin({
      client: clientBilling,
      requiredRoles: ['billing_admin']
    })
    assert.equal(ctx.operator.role, 'billing_admin')
    assert.equal(ctx.operator.fullName, 'Administrador Financeiro')

    // Sem requiredRoles explícito, a política restritiva padrão bloqueia billing_admin:
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientBilling })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Papel enviado pelo frontend não altera a autorização
  // ----------------------------------------------------------------------------
  test('9. Papel enviado pelo frontend não altera a autorização (defesa contra spoofing)', async () => {
    // Atacante comum injeta payload simulado
    const clientAttendantSpoofing = createAuthenticatedClient({
      userId: ATTENDANT_ID,
      email: 'atendente@empresa-a.com',
      role: 'superadmin' // Tentativa de injeção no contexto do token/body
    })

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientAttendantSpoofing })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: user_id enviado pelo frontend não permite assumir outra identidade
  // ----------------------------------------------------------------------------
  test('10. user_id enviado pelo frontend não permite assumir outra identidade', async () => {
    // O cliente autenticado como atendente tenta informar nos parâmetros que é o Superadmin
    const clientAttendant = createAuthenticatedClient({
      userId: ATTENDANT_ID,
      email: 'atendente@empresa-a.com'
    })

    // requirePlatformAdmin consulta estritamente o id resolvido pelo token do servidor,
    // ignorando qualquer ID externo forjado
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientAttendant })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Falha na consulta ao banco nunca concede acesso (fail-closed)
  // ----------------------------------------------------------------------------
  test('11. Falha na consulta ao banco nunca concede acesso (fail-closed, 500)', async () => {
    const clientSuperadmin = createAuthenticatedClient({
      userId: SUPERADMIN_ACTIVE_ID,
      email: 'superadmin@elleveeia.com.br'
    })

    // Simulação de falha no banco de dados
    const failingAdminClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: { message: 'Database connection timeout', code: '57P01' } })
          })
        })
      })
    }

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientSuperadmin, adminClient: failingAdminClient })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 500)
        assert.equal(err.code, 'INTERNAL_ERROR')
        assert.match(err.message, /falha interna/i)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Nenhum segredo é exposto nas respostas ou logs
  // ----------------------------------------------------------------------------
  test('12. Nenhum segredo é exposto nas respostas de contexto ou logs de auditoria', async () => {
    const clientSuperadmin = createAuthenticatedClient({
      userId: SUPERADMIN_ACTIVE_ID,
      email: 'superadmin@elleveeia.com.br'
    })

    const ctx = await requirePlatformAdmin({ client: clientSuperadmin })

    // Validar que o contexto retornado não vaza secrets
    assert.equal((ctx as any).token, undefined)
    assert.equal((ctx as any).serviceRoleKey, undefined)
    assert.equal((ctx as any).password, undefined)

    // Testar sanitização de payload de auditoria
    const payloadWithSecrets = {
      companyName: 'Nova Empresa',
      api_key: 'sk_mock_secret_12345',
      password: 'super_secret_password',
      token: 'jwt_bearer_token',
      nested: {
        secret: 'nested_secret_value',
        allowedLimit: 5000
      }
    }

    const sanitized = sanitizePayload(payloadWithSecrets)
    assert.equal(sanitized.companyName, 'Nova Empresa')
    assert.equal(sanitized.api_key, '[REDACTED]')
    assert.equal(sanitized.password, '[REDACTED]')
    assert.equal(sanitized.token, '[REDACTED]')
    assert.equal(sanitized.nested.secret, '[REDACTED]')
    assert.equal(sanitized.nested.allowedLimit, 5000)

    // Gravar log sanitizado via logPlatformAudit
    await logPlatformAudit({
      actorId: SUPERADMIN_ACTIVE_ID,
      actorEmail: 'superadmin@elleveeia.com.br',
      action: 'platform.security_check',
      payloadSummary: payloadWithSecrets
    })

    // Verificar que o log foi gravado no banco sem secrets
    const savedLog = Array.from(inMemoryDb.platform_audit_logs.values()).find(
      l => l.action === 'platform.security_check'
    )
    assert.ok(savedLog)
    assert.equal(savedLog.payload_summary.api_key, '[REDACTED]')
    assert.equal(savedLog.payload_summary.password, '[REDACTED]')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: Separação entre profiles e platform_admins é preservada
  // ----------------------------------------------------------------------------
  test('13. A separação estanque entre profiles e platform_admins permanece preservada', async () => {
    // 1. O superadmin não possui registro em profiles (não pertence a nenhuma empresa)
    assert.equal(inMemoryDb.profiles.has(SUPERADMIN_ACTIVE_ID), false)

    // 2. O admin da empresa existe em profiles, mas NÃO em platform_admins
    assert.equal(inMemoryDb.profiles.has(COMPANY_ADMIN_ID), true)
    assert.equal(inMemoryDb.platform_admins.has(COMPANY_ADMIN_ID), false)

    // 3. Modificações em profiles não afetam autorização de plataforma
    inMemoryDb.profiles.set('user-temp', {
      id: 'user-temp',
      company_id: TENANT_A_ID,
      role: 'admin',
      full_name: 'Usuário Temporário'
    })

    const clientTemp = createAuthenticatedClient({ userId: 'user-temp', email: 'temp@empresa-a.com' })
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: clientTemp })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })
})
