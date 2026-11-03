// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  requireActiveCompany,
  TenantAccessError,
  type RequireTenantAccessOptions,
  type ActiveCompanyContext
} from '@/lib/services/platform/tenant-access'

describe('ETAPA 8.4.3D — Serviço Central de Controle de Acesso dos Tenants', () => {
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const SUSPENDED_COMPANY_ID = '22222222-2222-2222-2222-222222222222'
  const PROVISIONING_COMPANY_ID = '33333333-3333-3333-3333-333333333333'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'
  const CORRUPTED_STATUS_COMPANY_ID = '55555555-5555-5555-5555-555555555555'
  const SECOND_ACTIVE_COMPANY_ID = '66666666-6666-6666-6666-666666666666'
  const NON_EXISTENT_COMPANY_ID = '99999999-9999-9999-9999-999999999999'

  function createMockDb() {
    return {
      [ACTIVE_COMPANY_ID]: {
        id: ACTIVE_COMPANY_ID,
        name: 'Empresa Ativa Alpha',
        slug: 'empresa-ativa-alpha',
        status: 'active',
        suspension_reason: null,
        plan_tier: 'pro',
        api_key: 'sec_live_should_never_leak_123',
        database_url: 'postgres://postgres:secret@db:5432/main'
      },
      [SECOND_ACTIVE_COMPANY_ID]: {
        id: SECOND_ACTIVE_COMPANY_ID,
        name: 'Empresa Ativa Beta',
        slug: 'empresa-ativa-beta',
        status: 'active',
        suspension_reason: null,
        plan_tier: 'enterprise'
      },
      [SUSPENDED_COMPANY_ID]: {
        id: SUSPENDED_COMPANY_ID,
        name: 'Empresa Suspensa Gamma',
        slug: 'empresa-suspensa-gamma',
        status: 'suspended',
        suspension_reason: 'Inadimplência financeira referente à fatura INV-2026-009',
        plan_tier: 'standard'
      },
      [PROVISIONING_COMPANY_ID]: {
        id: PROVISIONING_COMPANY_ID,
        name: 'Empresa Em Implantação Delta',
        slug: 'empresa-implantacao-delta',
        status: 'provisioning',
        suspension_reason: null,
        plan_tier: 'trial'
      },
      [CANCELLED_COMPANY_ID]: {
        id: CANCELLED_COMPANY_ID,
        name: 'Empresa Cancelada Epsilon',
        slug: 'empresa-cancelada-epsilon',
        status: 'cancelled',
        suspension_reason: 'Contrato cancelado a pedido do cliente em 01/10/2026',
        plan_tier: 'pro'
      },
      [CORRUPTED_STATUS_COMPANY_ID]: {
        id: CORRUPTED_STATUS_COMPANY_ID,
        name: 'Empresa Com Status Desconhecido Zeta',
        slug: 'empresa-desconhecida-zeta',
        status: 'corrupted_state_or_legacy',
        suspension_reason: null,
        plan_tier: 'standard'
      }
    }
  }

  function createMockAdminClient(options: {
    db?: Record<string, any>
    simulateDbError?: boolean
    simulateTimeout?: boolean
    onMutationCalled?: (method: string) => void
    onQueryCalled?: (table: string, columns: string, id: string) => void
  } = {}) {
    const db = options.db || createMockDb()

    return {
      from: (table: string) => {
        return {
          select: (columns: string) => {
            return {
              eq: (columnName: string, value: string) => {
                return {
                  maybeSingle: async () => {
                    if (options.simulateTimeout) {
                      throw new Error('Connection timeout to PostgreSQL primary node (ETIMEDOUT)')
                    }

                    if (options.simulateDbError) {
                      return {
                        data: null,
                        error: {
                          message: 'relation "companies" does not exist (simulated 42P01)',
                          code: '42P01',
                          details: 'Table offline during maintenance'
                        }
                      }
                    }

                    if (options.onQueryCalled) {
                      options.onQueryCalled(table, columns, value)
                    }

                    if (table === 'companies' && columnName === 'id') {
                      const record = db[value]
                      if (!record) {
                        return { data: null, error: null }
                      }

                      // Simular a seleção exata de colunas conforme o select solicitado
                      const projected: any = {}
                      const requestedCols = columns.split(',').map(c => c.trim())
                      for (const col of requestedCols) {
                        projected[col] = record[col]
                      }

                      return { data: projected, error: null }
                    }

                    return { data: null, error: null }
                  }
                }
              }
            }
          },
          insert: () => {
            if (options.onMutationCalled) options.onMutationCalled('insert')
            throw new Error('Mutation not allowed: insert called on read-only check')
          },
          update: () => {
            if (options.onMutationCalled) options.onMutationCalled('update')
            throw new Error('Mutation not allowed: update called on read-only check')
          },
          delete: () => {
            if (options.onMutationCalled) options.onMutationCalled('delete')
            throw new Error('Mutation not allowed: delete called on read-only check')
          },
          upsert: () => {
            if (options.onMutationCalled) options.onMutationCalled('upsert')
            throw new Error('Mutation not allowed: upsert called on read-only check')
          }
        }
      }
    }
  }

  // ============================================================================
  // CENÁRIO 1: Empresa active é autorizada com sucesso e retorna objeto correto
  // ============================================================================
  test('1. Empresa active é autorizada com sucesso e retorna contexto restrito', async () => {
    let capturedTable = ''
    let capturedColumns = ''
    let capturedId = ''

    const adminClient = createMockAdminClient({
      onQueryCalled: (table, cols, id) => {
        capturedTable = table
        capturedColumns = cols
        capturedId = id
      }
    })

    const context = await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })

    assert.ok(context, 'Contexto da empresa deve ser retornado')
    assert.equal(context.id, ACTIVE_COMPANY_ID)
    assert.equal(context.name, 'Empresa Ativa Alpha')
    assert.equal(context.status, 'active')
    assert.equal(context.planTier, 'pro')

    assert.equal(capturedTable, 'companies')
    assert.equal(capturedId, ACTIVE_COMPANY_ID)
    assert.equal(capturedColumns, 'id, name, status, suspension_reason, plan_tier')
  })

  // ============================================================================
  // CENÁRIO 2: Empresa provisioning é bloqueada por padrão (TENANT_PROVISIONING, 403)
  // ============================================================================
  test('2. Empresa em status provisioning é bloqueada por padrão com código TENANT_PROVISIONING e HTTP 403', async () => {
    const adminClient = createMockAdminClient()

    await assert.rejects(
      async () => {
        await requireActiveCompany(PROVISIONING_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_PROVISIONING')
        assert.equal(err.statusCode, 403)
        assert.equal(err.companyId, PROVISIONING_COMPANY_ID)
        assert.match(err.message, /implantação/i)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 3: Empresa provisioning é autorizada se allowProvisioning === true
  // ============================================================================
  test('3. Empresa em provisioning é liberada estritamente quando allowProvisioning é true', async () => {
    const adminClient = createMockAdminClient()

    const context = await requireActiveCompany(PROVISIONING_COMPANY_ID, {
      adminClient,
      allowProvisioning: true
    })

    assert.ok(context)
    assert.equal(context.id, PROVISIONING_COMPANY_ID)
    assert.equal(context.status, 'provisioning')
    assert.equal(context.planTier, 'trial')
  })

  // ============================================================================
  // CENÁRIO 4: Empresa suspended é bloqueada (TENANT_SUSPENDED, 403) com suspensionReason
  // ============================================================================
  test('4. Empresa em status suspended é bloqueada com TENANT_SUSPENDED e preserva suspensionReason na propriedade do erro', async () => {
    const adminClient = createMockAdminClient()

    await assert.rejects(
      async () => {
        await requireActiveCompany(SUSPENDED_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_SUSPENDED')
        assert.equal(err.statusCode, 403)
        assert.equal(err.companyId, SUSPENDED_COMPANY_ID)
        assert.equal(err.suspensionReason, 'Inadimplência financeira referente à fatura INV-2026-009')
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 5: Empresa cancelled é bloqueada (TENANT_CANCELLED, 403)
  // ============================================================================
  test('5. Empresa em status cancelled é bloqueada com TENANT_CANCELLED e HTTP 403', async () => {
    const adminClient = createMockAdminClient()

    await assert.rejects(
      async () => {
        await requireActiveCompany(CANCELLED_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_CANCELLED')
        assert.equal(err.statusCode, 403)
        assert.equal(err.companyId, CANCELLED_COMPANY_ID)
        assert.match(err.message, /cancelado/i)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 6: Empresa inexistente retorna TENANT_NOT_FOUND (404)
  // ============================================================================
  test('6. Empresa inexistente lança TENANT_NOT_FOUND e HTTP 404', async () => {
    const adminClient = createMockAdminClient()

    await assert.rejects(
      async () => {
        await requireActiveCompany(NON_EXISTENT_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_NOT_FOUND')
        assert.equal(err.statusCode, 404)
        assert.equal(err.companyId, NON_EXISTENT_COMPANY_ID)
        assert.match(err.message, new RegExp(NON_EXISTENT_COMPANY_ID))
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 7: UUID inválido é rejeitado imediatamente (INVALID_COMPANY_ID, 400)
  // ============================================================================
  test('7. Identificadores malformados, nulos, numéricos ou com SQL injection são rejeitados com INVALID_COMPANY_ID (400)', async () => {
    let dbAccessAttempted = false
    const adminClient = createMockAdminClient({
      onQueryCalled: () => {
        dbAccessAttempted = true
      }
    })

    const invalidInputs = [
      '',
      '   ',
      'invalid-uuid-string',
      '12345',
      null,
      undefined,
      '11111111-1111-1111-1111-11111111111g', // caractere inválido
      "11111111-1111-1111-1111-111111111111' OR 1=1 --", // sql injection
      { id: ACTIVE_COMPANY_ID } // objeto
    ]

    for (const invalid of invalidInputs) {
      await assert.rejects(
        async () => {
          await requireActiveCompany(invalid as any, { adminClient })
        },
        (err: any) => {
          assert.ok(err instanceof TenantAccessError)
          assert.equal(err.code, 'INVALID_COMPANY_ID')
          assert.equal(err.statusCode, 400)
          return true
        }
      )
    }

    assert.equal(dbAccessAttempted, false, 'O banco jamais deve ser consultado para UUIDs inválidos')
  })

  // ============================================================================
  // CENÁRIO 8: Falha na consulta de banco resulta em fail-closed (TENANT_STATUS_UNAVAILABLE, 503)
  // ============================================================================
  test('8. Erro retornado pelo banco resulta em bloqueio fail-closed com TENANT_STATUS_UNAVAILABLE (503)', async () => {
    const adminClient = createMockAdminClient({ simulateDbError: true })

    await assert.rejects(
      async () => {
        await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_STATUS_UNAVAILABLE')
        assert.equal(err.statusCode, 503)
        assert.equal(err.companyId, ACTIVE_COMPANY_ID)
        // Não deve expor detalhes internos do Postgres
        assert.ok(!err.message.includes('42P01'))
        assert.ok(!err.message.includes('relation "companies" does not exist'))
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 9: Timeout ou exceção lançada na infraestrutura resulta em fail-closed (503)
  // ============================================================================
  test('9. Timeout ou erro de conexão de baixo nível resulta em fail-closed com TENANT_STATUS_UNAVAILABLE (503)', async () => {
    const adminClient = createMockAdminClient({ simulateTimeout: true })

    await assert.rejects(
      async () => {
        await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_STATUS_UNAVAILABLE')
        assert.equal(err.statusCode, 503)
        assert.equal(err.companyId, ACTIVE_COMPANY_ID)
        assert.ok(!err.message.includes('ETIMEDOUT'))
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 10: Nenhum status fornecido pelo chamador é considerado
  // ============================================================================
  test('10. Parâmetros forjados no payload ou status enviados pelo solicitante são sumariamente ignorados', async () => {
    const adminClient = createMockAdminClient()

    // O chamador tenta passar status: 'active' nas opções para burlar a suspensão
    const maliciousOptions: any = {
      adminClient,
      status: 'active',
      is_active: true,
      role: 'superadmin',
      bypass: true
    }

    await assert.rejects(
      async () => {
        await requireActiveCompany(SUSPENDED_COMPANY_ID, maliciousOptions)
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_SUSPENDED')
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 11: Nenhuma credencial ou segredo do banco vaza na mensagem de erro
  // ============================================================================
  test('11. Mensagem de erro pública é estritamente limpa e sanitizada', async () => {
    const adminClient = createMockAdminClient({ simulateDbError: true })

    try {
      await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
      assert.fail('Deveria ter lançado erro')
    } catch (err: any) {
      assert.ok(err instanceof TenantAccessError)
      assert.equal(err.message, 'Falha de infraestrutura ao verificar status da empresa.')
      assert.ok(!JSON.stringify(err).includes('password'))
      assert.ok(!JSON.stringify(err).includes('postgres://'))
    }
  })

  // ============================================================================
  // CENÁRIO 12: Objeto de retorno contém apenas campos permitidos
  // ============================================================================
  test('12. Objeto de retorno contém apenas os campos permitidos: id, name, status, planTier', async () => {
    const adminClient = createMockAdminClient()

    const context = await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })

    const keys = Object.keys(context)
    assert.deepEqual(keys.sort(), ['id', 'name', 'planTier', 'status'].sort())

    // Garantir que campos confidenciais não constam no retorno
    assert.equal((context as any).api_key, undefined)
    assert.equal((context as any).database_url, undefined)
    assert.equal((context as any).slug, undefined)
    assert.equal((context as any).suspension_reason, undefined)
  })

  // ============================================================================
  // CENÁRIO 13: Motivo de suspensão não vaza na mensagem pública de erro
  // ============================================================================
  test('13. Motivo de suspensão não é exposto na mensagem pública do erro, apenas na propriedade suspensionReason', async () => {
    const adminClient = createMockAdminClient()

    try {
      await requireActiveCompany(SUSPENDED_COMPANY_ID, { adminClient })
      assert.fail('Deveria ter lançado erro de suspensão')
    } catch (err: any) {
      assert.ok(err instanceof TenantAccessError)
      assert.equal(err.code, 'TENANT_SUSPENDED')
      // Mensagem pública padronizada
      assert.equal(err.message, 'Operação comercial bloqueada: acesso da empresa suspenso pela plataforma.')
      // Propriedade interna contém o motivo completo
      assert.equal(err.suspensionReason, 'Inadimplência financeira referente à fatura INV-2026-009')
      // A mensagem genérica NÃO deve conter detalhes financeiros da fatura
      assert.ok(!err.message.includes('INV-2026-009'))
      assert.ok(!err.message.includes('Inadimplência'))
    }
  })

  // ============================================================================
  // CENÁRIO 14: Isolamento multi-tenant: alteração na Empresa A não afeta Empresa B
  // ============================================================================
  test('14. Isolamento multi-tenant: suspensão da Empresa A não afeta a autorização da Empresa B', async () => {
    const mutableDb = createMockDb()
    const adminClient = createMockAdminClient({ db: mutableDb })

    // Inicialmente ambas ativas
    const ctxA = await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
    const ctxB = await requireActiveCompany(SECOND_ACTIVE_COMPANY_ID, { adminClient })
    assert.equal(ctxA.status, 'active')
    assert.equal(ctxB.status, 'active')

    // Empresa A é suspensa administrativamente
    mutableDb[ACTIVE_COMPANY_ID].status = 'suspended'
    mutableDb[ACTIVE_COMPANY_ID].suspension_reason = 'Suspensão cautelar'

    // Empresa A é bloqueada
    await assert.rejects(
      async () => {
        await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.equal(err.code, 'TENANT_SUSPENDED')
        return true
      }
    )

    // Empresa B continua 100% ativa e autorizada
    const ctxBAfter = await requireActiveCompany(SECOND_ACTIVE_COMPANY_ID, { adminClient })
    assert.equal(ctxBAfter.status, 'active')
    assert.equal(ctxBAfter.id, SECOND_ACTIVE_COMPANY_ID)
  })

  // ============================================================================
  // CENÁRIO 15: Ausência de cache: alteração no banco reflete imediatamente
  // ============================================================================
  test('15. Sem camada de cache stale: mudança de status no banco reflete na chamada imediatamente seguinte', async () => {
    const mutableDb = createMockDb()
    const adminClient = createMockAdminClient({ db: mutableDb })

    // 1ª chamada: empresa ativa
    const firstCall = await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
    assert.equal(firstCall.status, 'active')

    // Mudança no banco: cancelamento
    mutableDb[ACTIVE_COMPANY_ID].status = 'cancelled'

    // 2ª chamada imediatamente a seguir: deve bloquear na hora, sem cache stale
    await assert.rejects(
      async () => {
        await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.equal(err.code, 'TENANT_CANCELLED')
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 16: Garantia de idempotência e leitura estrita (sem mutações no banco)
  // ============================================================================
  test('16. Estrita garantia de read-only: nenhuma mutação (INSERT, UPDATE, DELETE, UPSERT) é executada', async () => {
    let mutationCalled = false
    const adminClient = createMockAdminClient({
      onMutationCalled: () => {
        mutationCalled = true
      }
    })

    await requireActiveCompany(ACTIVE_COMPANY_ID, { adminClient })

    assert.equal(mutationCalled, false, 'Nenhuma função de mutação foi invocada no cliente do banco')
  })

  // ============================================================================
  // CENÁRIO 17: Status desconhecido/corrompido no banco falha em fail-closed
  // ============================================================================
  test('17. Status desconhecido ou corrompido no banco falha fechado com TENANT_STATUS_UNAVAILABLE (503)', async () => {
    const adminClient = createMockAdminClient()

    await assert.rejects(
      async () => {
        await requireActiveCompany(CORRUPTED_STATUS_COMPANY_ID, { adminClient })
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_STATUS_UNAVAILABLE')
        assert.equal(err.statusCode, 503)
        return true
      }
    )
  })
})
