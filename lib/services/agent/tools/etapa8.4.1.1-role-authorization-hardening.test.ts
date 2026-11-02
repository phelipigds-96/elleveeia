// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

// Assegurar variáveis de ambiente mínimas para inicialização de clients
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  requirePlatformAdmin,
  logPlatformAudit,
  executeAuditedAction,
  sanitizePayload,
  PlatformAuthError,
  PlatformAuditError,
  type PlatformOperatorContext,
  type PlatformRole
} from '@/lib/services/platform/admin'

describe('ETAPA 8.4.1.1 — Revisão de Autorização por Papel e Proteção do Contexto Administrativo', () => {
  // IDs fixos para testes controlados
  const SUPERADMIN_ID = '00000000-0000-0000-0000-000000000001'
  const SUPPORT_ID = '00000000-0000-0000-0000-000000000002'
  const BILLING_ID = '00000000-0000-0000-0000-000000000003'
  const INACTIVE_SUPERADMIN_ID = '00000000-0000-0000-0000-000000000004'
  const INACTIVE_SUPPORT_ID = '00000000-0000-0000-0000-000000000005'
  const UNKNOWN_ROLE_OPERATOR_ID = '00000000-0000-0000-0000-000000000006'

  // Registros simulados na tabela platform_admins
  const operatorsDb: Record<string, any> = {
    [SUPERADMIN_ID]: {
      id: SUPERADMIN_ID,
      email: 'superadmin@elleveeia.com.br',
      full_name: 'Superadministrador Oficial',
      role: 'superadmin',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [SUPPORT_ID]: {
      id: SUPPORT_ID,
      email: 'suporte@elleveeia.com.br',
      full_name: 'Técnico de Suporte N2',
      role: 'support_operator',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [BILLING_ID]: {
      id: BILLING_ID,
      email: 'faturamento@elleveeia.com.br',
      full_name: 'Analista Financeiro',
      role: 'billing_admin',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [INACTIVE_SUPERADMIN_ID]: {
      id: INACTIVE_SUPERADMIN_ID,
      email: 'ex-super@elleveeia.com.br',
      full_name: 'Super Inativo',
      role: 'superadmin',
      active: false,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [INACTIVE_SUPPORT_ID]: {
      id: INACTIVE_SUPPORT_ID,
      email: 'ex-suporte@elleveeia.com.br',
      full_name: 'Suporte Inativo',
      role: 'support_operator',
      active: false,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [UNKNOWN_ROLE_OPERATOR_ID]: {
      id: UNKNOWN_ROLE_OPERATOR_ID,
      email: 'custom@elleveeia.com.br',
      full_name: 'Operador Papel Corrompido',
      role: 'custom_operator_hacker',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    }
  }

  // Logs de auditoria inseridos durante os testes
  const auditLogsCaptured: any[] = []

  // Fábrica de cliente Supabase autenticado
  function createAuthClient(userId: string, email: string) {
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: userId, email } },
          error: null
        })
      }
    }
  }

  // Fábrica de cliente Supabase administrativo (Service Role mock)
  function createMockAdminClient(options: { failOnSelect?: boolean; failOnAuditInsert?: boolean } = {}) {
    return {
      from: (table: string) => {
        if (table === 'platform_admins') {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                single: async () => {
                  if (options.failOnSelect) {
                    return { data: null, error: { message: 'DB Connection Timeout on platform_admins', code: 'ETIMEDOUT' } }
                  }
                  const record = operatorsDb[val]
                  if (!record) {
                    return { data: null, error: { message: 'Row not found', code: 'PGRST116' } }
                  }
                  return { data: { ...record }, error: null }
                }
              })
            })
          }
        }
        if (table === 'platform_audit_logs') {
          return {
            insert: async (data: any) => {
              if (options.failOnAuditInsert) {
                return { error: { message: 'Database disk full or constraint violation on platform_audit_logs', code: '57P01' } }
              }
              auditLogsCaptured.push(data)
              return { error: null }
            }
          }
        }
        return {
          select: () => ({ single: async () => ({ data: null, error: null }) }),
          insert: async () => ({ error: null })
        }
      }
    }
  }

  const standardAdminClient = createMockAdminClient()

  // ----------------------------------------------------------------------------
  // TESTE 1: requirePlatformAdmin() sem opções autoriza Superadministrador ativo
  // ----------------------------------------------------------------------------
  test('1. requirePlatformAdmin() sem opções autoriza Superadministrador ativo', async () => {
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    const ctx = await requirePlatformAdmin({
      client: clientSuper,
      adminClient: standardAdminClient
    })

    assert.ok(ctx)
    assert.equal(ctx.user.id, SUPERADMIN_ID)
    assert.equal(ctx.operator.role, 'superadmin')
    assert.equal(ctx.operator.active, true)
    assert.equal(ctx.operator.fullName, 'Superadministrador Oficial')
  })

  // ----------------------------------------------------------------------------
  // TESTE 2: requirePlatformAdmin() sem opções bloqueia support_operator
  // ----------------------------------------------------------------------------
  test('2. requirePlatformAdmin() sem opções bloqueia support_operator', async () => {
    const clientSupport = createAuthClient(SUPPORT_ID, 'suporte@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSupport,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        assert.match(err.message, /o papel 'support_operator' não possui permissão/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 3: requirePlatformAdmin() sem opções bloqueia billing_admin
  // ----------------------------------------------------------------------------
  test('3. requirePlatformAdmin() sem opções bloqueia billing_admin', async () => {
    const clientBilling = createAuthClient(BILLING_ID, 'faturamento@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientBilling,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        assert.match(err.message, /o papel 'billing_admin' não possui permissão/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 4: requiredRoles: ['support_operator'] autoriza somente suporte ativo
  // ----------------------------------------------------------------------------
  test('4. requiredRoles: [\'support_operator\'] autoriza somente suporte ativo', async () => {
    const clientSupport = createAuthClient(SUPPORT_ID, 'suporte@elleveeia.com.br')
    const ctx = await requirePlatformAdmin({
      client: clientSupport,
      adminClient: standardAdminClient,
      requiredRoles: ['support_operator']
    })
    assert.equal(ctx.operator.role, 'support_operator')

    // Verifica que superadmin é bloqueado quando requiredRoles é estritamente suporte
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSuper,
          adminClient: standardAdminClient,
          requiredRoles: ['support_operator']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    // Verifica que billing_admin é bloqueado
    const clientBilling = createAuthClient(BILLING_ID, 'faturamento@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientBilling,
          adminClient: standardAdminClient,
          requiredRoles: ['support_operator']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 5: requiredRoles: ['billing_admin'] autoriza somente financeiro ativo
  // ----------------------------------------------------------------------------
  test('5. requiredRoles: [\'billing_admin\'] autoriza somente financeiro ativo', async () => {
    const clientBilling = createAuthClient(BILLING_ID, 'faturamento@elleveeia.com.br')
    const ctx = await requirePlatformAdmin({
      client: clientBilling,
      adminClient: standardAdminClient,
      requiredRoles: ['billing_admin']
    })
    assert.equal(ctx.operator.role, 'billing_admin')

    // Verifica que suporte é bloqueado
    const clientSupport = createAuthClient(SUPPORT_ID, 'suporte@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSupport,
          adminClient: standardAdminClient,
          requiredRoles: ['billing_admin']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    // Verifica que superadmin é bloqueado se não estiver explicitamente no array
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSuper,
          adminClient: standardAdminClient,
          requiredRoles: ['billing_admin']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 6: requiredRoles: ['superadmin'] bloqueia os demais papéis
  // ----------------------------------------------------------------------------
  test('6. requiredRoles: [\'superadmin\'] bloqueia os demais papéis', async () => {
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    const ctx = await requirePlatformAdmin({
      client: clientSuper,
      adminClient: standardAdminClient,
      requiredRoles: ['superadmin']
    })
    assert.equal(ctx.operator.role, 'superadmin')

    // Bloqueia support_operator
    const clientSupport = createAuthClient(SUPPORT_ID, 'suporte@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSupport,
          adminClient: standardAdminClient,
          requiredRoles: ['superadmin']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    // Bloqueia billing_admin
    const clientBilling = createAuthClient(BILLING_ID, 'faturamento@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientBilling,
          adminClient: standardAdminClient,
          requiredRoles: ['superadmin']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 7: Lista vazia de papéis não concede acesso
  // ----------------------------------------------------------------------------
  test('7. Lista vazia de papéis não concede acesso', async () => {
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSuper,
          adminClient: standardAdminClient,
          requiredRoles: []
        })
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
  // TESTE 8: Papel desconhecido nunca concede acesso
  // ----------------------------------------------------------------------------
  test('8. Papel desconhecido nunca concede acesso', async () => {
    // 8a: requiredRoles com papel inexistente bloqueia até superadmin
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSuper,
          adminClient: standardAdminClient,
          requiredRoles: ['role_fantasma' as any]
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    // 8b: Registro de operador com role corrompida no banco
    const clientUnknown = createAuthClient(UNKNOWN_ROLE_OPERATOR_ID, 'custom@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientUnknown,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INVALID_ROLE')
        assert.match(err.message, /Papel de operador desconhecido/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 9: Operador inativo continua bloqueado
  // ----------------------------------------------------------------------------
  test('9. Operador inativo continua bloqueado', async () => {
    // Superadmin desativado
    const clientInactiveSuper = createAuthClient(INACTIVE_SUPERADMIN_ID, 'ex-super@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientInactiveSuper,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        assert.match(err.message, /desativado/)
        return true
      }
    )

    // Suporte desativado
    const clientInactiveSupp = createAuthClient(INACTIVE_SUPPORT_ID, 'ex-suporte@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientInactiveSupp,
          adminClient: standardAdminClient,
          requiredRoles: ['support_operator']
        })
      },
      (err: any) => {
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 10: Falha de banco continua resultando em bloqueio
  // ----------------------------------------------------------------------------
  test('10. Falha de banco continua resultando em bloqueio (fail-closed, 500)', async () => {
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    const failingDbClient = createMockAdminClient({ failOnSelect: true })

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({
          client: clientSuper,
          adminClient: failingDbClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 500)
        assert.equal(err.code, 'INTERNAL_ERROR')
        assert.match(err.message, /Falha interna/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 11: Contexto administrativo não é serializado nem exposto em respostas
  // ----------------------------------------------------------------------------
  test('11. Contexto administrativo não é serializado nem exposto em respostas', async () => {
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    const ctx = await requirePlatformAdmin({
      client: clientSuper,
      adminClient: standardAdminClient
    })

    // 1. O objeto retornado NÃO deve possuir propriedades de client ou credenciais
    assert.equal((ctx as any).adminClient, undefined)
    assert.equal((ctx as any).client, undefined)
    assert.equal((ctx as any).supabase, undefined)
    assert.equal((ctx as any).serviceRoleKey, undefined)
    assert.equal((ctx as any).key, undefined)

    // 2. Serialização para JSON deve produzir exclusivamente dados escalares seguros
    const serialized = JSON.stringify(ctx)
    assert.ok(!serialized.includes('service_role'))
    assert.ok(!serialized.includes('secret'))
    assert.ok(!serialized.includes('adminClient'))

    const parsed = JSON.parse(serialized)
    assert.deepEqual(Object.keys(parsed).sort(), ['operator', 'user'].sort())
    assert.deepEqual(
      Object.keys(parsed.user).sort(),
      ['email', 'id'].sort()
    )
    assert.deepEqual(
      Object.keys(parsed.operator).sort(),
      ['active', 'createdAt', 'email', 'fullName', 'id', 'role', 'updatedAt'].sort()
    )
  })

  // ----------------------------------------------------------------------------
  // TESTE 12: Falha na auditoria obrigatória não retorna sucesso administrativo
  // ----------------------------------------------------------------------------
  test('12. Falha na auditoria obrigatória não retorna sucesso administrativo', async () => {
    const clientSuper = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    const ctx = await requirePlatformAdmin({
      client: clientSuper,
      adminClient: standardAdminClient
    })

    // Caso 1: Client administrativo com falha na tabela de auditoria
    const failingAuditClient = createMockAdminClient({ failOnAuditInsert: true })

    // Operação sensível: tentar executar com executeAuditedAction quando a auditoria falha
    let businessOperationExecuted = false
    await assert.rejects(
      async () => {
        await executeAuditedAction(
          ctx,
          {
            action: 'company.update_limits',
            targetCompanyId: 'comp-100',
            payloadSummary: { maxUsers: 50 },
            reason: 'Alteração contratual'
          },
          async () => {
            businessOperationExecuted = true
            return { updated: true, newLimit: 50 }
          },
          failingAuditClient
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuditError)
        assert.equal(err.code, 'AUDIT_WRITE_FAILED')
        assert.match(err.message, /Falha crítica ao gravar log de auditoria/)
        return true
      }
    )

    // A operação de negócio pode ter rodado internamente, mas o caller NUNCA recebe o retorno de sucesso
    assert.equal(businessOperationExecuted, true)

    // Caso 2: Se a própria operação de negócio lançar erro, executeAuditedAction preserva o erro original
    class BusinessValidationError extends Error {
      constructor(msg: string) {
        super(msg)
        this.name = 'BusinessValidationError'
      }
    }

    await assert.rejects(
      async () => {
        await executeAuditedAction(
          ctx,
          {
            action: 'company.update_limits',
            targetCompanyId: 'comp-100',
            payloadSummary: { maxUsers: -5 }
          },
          async () => {
            throw new BusinessValidationError('Limite de usuários não pode ser negativo.')
          },
          standardAdminClient
        )
      },
      (err: any) => {
        // Confirma que o erro original da operação foi preservado intacto!
        assert.ok(err instanceof BusinessValidationError)
        assert.equal(err.message, 'Limite de usuários não pode ser negativo.')
        return true
      }
    )

    // Confirma que o erro de negócio foi gravado como 'failed' na auditoria
    const lastLog = auditLogsCaptured[auditLogsCaptured.length - 1]
    assert.equal(lastLog.status, 'failed')
    assert.equal(lastLog.error_message, 'Limite de usuários não pode ser negativo.')
    assert.equal(lastLog.action, 'company.update_limits')
  })

  // ----------------------------------------------------------------------------
  // TESTE 13: A sanitização preserva informações úteis sem expor credenciais
  // ----------------------------------------------------------------------------
  test('13. A sanitização preserva informações úteis sem expor credenciais', () => {
    const rawPayload = {
      company_name: 'Metalúrgica Sumel Ltda',
      plan: 'enterprise',
      admin_email: 'contato@sumel.com.br',
      max_users: 25,
      allowed_features: ['ai_agent', 'catalogo_ilimitado', 'relatorios_avancados'],
      notes: 'Implantação assistida pela Ellevee IA',
      // Campos sensíveis que DEVEM ser censurados:
      password: 'senhaSuperSecreta123!',
      db_password: 'root_password_99',
      api_key: 'sk_mock_abcdef1234567890',
      service_role_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
      jwt_token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakejwt',
      webhook_secret: 'whsec_999988887777',
      credit_card: '4111222233334444',
      cvv: '123',
      nested_config: {
        timeout_seconds: 30,
        retry_count: 3,
        client_secret: 'top_secret_oauth_client_secret',
        endpoint: 'https://api.empresa.com.br/v1'
      }
    }

    const sanitized = sanitizePayload(rawPayload)

    // Confirma que dados operacionais e de negócio foram PRESERVADOS:
    assert.equal(sanitized.company_name, 'Metalúrgica Sumel Ltda')
    assert.equal(sanitized.plan, 'enterprise')
    assert.equal(sanitized.admin_email, 'contato@sumel.com.br')
    assert.equal(sanitized.max_users, 25)
    assert.deepEqual(sanitized.allowed_features, ['ai_agent', 'catalogo_ilimitado', 'relatorios_avancados'])
    assert.equal(sanitized.notes, 'Implantação assistida pela Ellevee IA')
    assert.equal(sanitized.nested_config.timeout_seconds, 30)
    assert.equal(sanitized.nested_config.retry_count, 3)
    assert.equal(sanitized.nested_config.endpoint, 'https://api.empresa.com.br/v1')

    // Confirma que todos os dados sensíveis foram CENSURADOS com [REDACTED]:
    assert.equal(sanitized.password, '[REDACTED]')
    assert.equal(sanitized.db_password, '[REDACTED]')
    assert.equal(sanitized.api_key, '[REDACTED]')
    assert.equal(sanitized.service_role_key, '[REDACTED]')
    assert.equal(sanitized.jwt_token, '[REDACTED]')
    assert.equal(sanitized.webhook_secret, '[REDACTED]')
    assert.equal(sanitized.credit_card, '[REDACTED]')
    assert.equal(sanitized.cvv, '[REDACTED]')
    assert.equal(sanitized.nested_config.client_secret, '[REDACTED]')
  })
})
