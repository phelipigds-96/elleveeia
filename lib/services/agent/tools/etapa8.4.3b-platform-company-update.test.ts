// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  updatePlatformCompany,
  type UpdatePlatformCompanyInput,
  type UpdatePlatformCompanyOptions
} from '@/lib/services/platform/companies'
import { PlatformAuthError } from '@/lib/services/platform/admin'
import { PlatformAuditError } from '@/lib/services/platform/audit'

describe('ETAPA 8.4.3B — Edição Cadastral Básica de Empresas (updatePlatformCompany)', () => {
  // IDs de operadores da plataforma
  const SUPERADMIN_ID = '00000000-0000-0000-0000-000000000001'
  const INACTIVE_SUPERADMIN_ID = '00000000-0000-0000-0000-000000000002'
  const SUPPORT_ID = '00000000-0000-0000-0000-000000000003'
  const BILLING_ID = '00000000-0000-0000-0000-000000000004'
  const REGULAR_USER_ID = '00000000-0000-0000-0000-000000000098'
  const TENANT_ADMIN_ID = '00000000-0000-0000-0000-000000000099'

  // IDs de empresas para testes
  const COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'

  // Operadores cadastrados em platform_admins
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
    [INACTIVE_SUPERADMIN_ID]: {
      id: INACTIVE_SUPERADMIN_ID,
      email: 'inativo@elleveeia.com.br',
      full_name: 'Super Inativo',
      role: 'superadmin',
      active: false,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [SUPPORT_ID]: {
      id: SUPPORT_ID,
      email: 'suporte@elleveeia.com.br',
      full_name: 'Suporte Técnico',
      role: 'support_operator',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    },
    [BILLING_ID]: {
      id: BILLING_ID,
      email: 'financeiro@elleveeia.com.br',
      full_name: 'Operador Financeiro',
      role: 'billing_admin',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    }
  }

  function createAuthClient(userId: string | null, email?: string) {
    return {
      auth: {
        getUser: async () => {
          if (!userId) {
            return { data: { user: null }, error: { message: 'Not authenticated' } }
          }
          return {
            data: { user: { id: userId, email: email || 'user@teste.com' } },
            error: null
          }
        }
      }
    }
  }

  function createMockEnvironment(options: {
    failOnAuditInsert?: boolean
    failOnCompanyUpdate?: boolean
    failOnCompanySelect?: boolean
    simulateUniqueSlugCode?: boolean
    initialCompanies?: Record<string, any>
  } = {}) {
    const companiesState: Record<string, any> = options.initialCompanies
      ? JSON.parse(JSON.stringify(options.initialCompanies))
      : {
          [COMPANY_A_ID]: {
            id: COMPANY_A_ID,
            name: 'Empresa Ativa Alpha',
            slug: 'empresa-ativa-alpha',
            status: 'active',
            plan_tier: 'pro',
            created_at: '2026-10-01T10:00:00Z'
          },
          [COMPANY_B_ID]: {
            id: COMPANY_B_ID,
            name: 'Empresa Suspensa Beta',
            slug: 'empresa-suspensa-beta',
            status: 'suspended',
            plan_tier: 'standard',
            created_at: '2026-10-02T10:00:00Z'
          }
        }

    const auditLogsCaptured: any[] = []

    const adminClient = {
      from: (table: string) => {
        if (table === 'platform_admins') {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                single: async () => {
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

        if (table === 'companies') {
          return {
            select: (cols: string) => ({
              eq: (col: string, val: string) => ({
                maybeSingle: async () => {
                  if (options.failOnCompanySelect) {
                    return { data: null, error: { message: 'Simulated DB select failure', code: '500' } }
                  }
                  if (col === 'id') {
                    const comp = companiesState[val]
                    return { data: comp ? { ...comp } : null, error: null }
                  }
                  if (col === 'slug') {
                    const comp = Object.values(companiesState).find((c: any) => c.slug === val)
                    return { data: comp ? { ...comp } : null, error: null }
                  }
                  return { data: null, error: null }
                }
              })
            }),
            update: (payload: any) => {
              let targetId: string | null = null
              return {
                eq: (col: string, val: string) => {
                  if (col === 'id') targetId = val
                  return {
                    select: (selCols: string) => ({
                      single: async () => {
                        if (options.failOnCompanyUpdate) {
                          return {
                            data: null,
                            error: { message: 'Simulated DB update failure on companies', code: '57P01' }
                          }
                        }
                        if (options.simulateUniqueSlugCode) {
                          return {
                            data: null,
                            error: {
                              message: 'duplicate key value violates unique constraint "companies_slug_key"',
                              code: '23505'
                            }
                          }
                        }
                        if (!targetId || !companiesState[targetId]) {
                          return { data: null, error: { message: 'Row not found', code: 'PGRST116' } }
                        }

                        // Verifica unicidade de slug se alterado
                        if (payload.slug) {
                          const conflict = Object.values(companiesState).find(
                            (c: any) => c.id !== targetId && c.slug === payload.slug
                          )
                          if (conflict) {
                            return {
                              data: null,
                              error: {
                                message: 'duplicate key value violates unique constraint "companies_slug_key"',
                                code: '23505'
                              }
                            }
                          }
                        }

                        const current = companiesState[targetId]
                        const updated = {
                          ...current,
                          ...payload,
                          updated_at: new Date().toISOString()
                        }
                        companiesState[targetId] = updated

                        return {
                          data: {
                            id: updated.id,
                            name: updated.name,
                            slug: updated.slug,
                            status: updated.status,
                            plan_tier: updated.plan_tier,
                            created_at: updated.created_at
                          },
                          error: null
                        }
                      }
                    })
                  }
                }
              }
            }
          }
        }

        if (table === 'platform_audit_logs') {
          return {
            insert: async (data: any) => {
              if (options.failOnAuditInsert) {
                return {
                  data: null,
                  error: {
                    message: 'Simulated DB connection failure on platform_audit_logs',
                    code: '57P01'
                  }
                }
              }
              const row = {
                id: 'log-' + (auditLogsCaptured.length + 1),
                ...data,
                created_at: new Date().toISOString()
              }
              auditLogsCaptured.push(row)
              return { data: row, error: null }
            }
          }
        }

        throw new Error(`Unexpected table queried in mock: ${table}`)
      }
    }

    return { adminClient, companiesState, auditLogsCaptured }
  }

  // ============================================================================
  // CENÁRIO 1: Superadmin altera o nome da empresa
  // ============================================================================
  test('Cenário 1: Superadmin altera o nome da empresa com sucesso e gera auditoria', async () => {
    const { adminClient, companiesState, auditLogsCaptured } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    const result = await updatePlatformCompany(
      COMPANY_A_ID,
      { name: 'Empresa Alpha Atualizada' },
      { client, adminClient }
    )

    assert.equal(result.updated, true, 'Deve indicar que a empresa foi atualizada')
    assert.equal(result.company.id, COMPANY_A_ID)
    assert.equal(result.company.name, 'Empresa Alpha Atualizada')
    assert.equal(result.company.slug, 'empresa-ativa-alpha', 'Slug original deve ser mantido')
    assert.equal(result.company.status, 'active', 'Status deve permanecer active')
    assert.equal(result.company.planTier, 'pro', 'PlanTier deve permanecer pro')

    // Verifica persistência no estado do banco
    assert.equal(companiesState[COMPANY_A_ID].name, 'Empresa Alpha Atualizada')

    // Verifica emissão do evento de auditoria
    assert.equal(auditLogsCaptured.length, 1)
    const log = auditLogsCaptured[0]
    assert.equal(log.action, 'company.updated')
    assert.equal(log.actor_id, SUPERADMIN_ID)
    assert.equal(log.target_company_id, COMPANY_A_ID)
    assert.equal(log.status, 'success')
    assert.deepEqual(log.payload_summary.changes.name, {
      from: 'Empresa Ativa Alpha',
      to: 'Empresa Alpha Atualizada'
    })
    assert.equal(log.payload_summary.changes.slug, undefined)
  })

  // ============================================================================
  // CENÁRIO 2: Superadmin altera o slug da empresa
  // ============================================================================
  test('Cenário 2: Superadmin altera o slug com normalização e gera auditoria', async () => {
    const { adminClient, companiesState, auditLogsCaptured } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    const result = await updatePlatformCompany(
      COMPANY_A_ID,
      { slug: '  EMPRESA-ALPHA-NOVA  ' },
      { client, adminClient }
    )

    assert.equal(result.updated, true)
    assert.equal(result.company.slug, 'empresa-alpha-nova', 'Deve normalizar para minúsculas e sem espaços')
    assert.equal(result.company.name, 'Empresa Ativa Alpha', 'Nome deve permanecer inalterado')
    assert.equal(companiesState[COMPANY_A_ID].slug, 'empresa-alpha-nova')

    assert.equal(auditLogsCaptured.length, 1)
    const log = auditLogsCaptured[0]
    assert.equal(log.action, 'company.updated')
    assert.deepEqual(log.payload_summary.changes.slug, {
      from: 'empresa-ativa-alpha',
      to: 'empresa-alpha-nova'
    })
  })

  // ============================================================================
  // CENÁRIO 3: Superadmin altera nome e slug juntos com justificativa
  // ============================================================================
  test('Cenário 3: Superadmin altera nome e slug simultaneamente com justificativa', async () => {
    const { adminClient, companiesState, auditLogsCaptured } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    const result = await updatePlatformCompany(
      COMPANY_A_ID,
      {
        name: 'Grupo Alpha Holding',
        slug: 'alpha-holding',
        reason: 'Reestruturação corporativa oficial'
      },
      { client, adminClient }
    )

    assert.equal(result.updated, true)
    assert.equal(result.company.name, 'Grupo Alpha Holding')
    assert.equal(result.company.slug, 'alpha-holding')

    assert.equal(auditLogsCaptured.length, 1)
    const log = auditLogsCaptured[0]
    assert.equal(log.reason, 'Reestruturação corporativa oficial')
    assert.deepEqual(log.payload_summary.changes.name, {
      from: 'Empresa Ativa Alpha',
      to: 'Grupo Alpha Holding'
    })
    assert.deepEqual(log.payload_summary.changes.slug, {
      from: 'empresa-ativa-alpha',
      to: 'alpha-holding'
    })
  })

  // ============================================================================
  // CENÁRIO 4: Usuário não autenticado é bloqueado (401)
  // ============================================================================
  test('Cenário 4: Usuário não autenticado é bloqueado com status 401 (PlatformAuthError)', async () => {
    const { adminClient, companiesState } = createMockEnvironment()
    const client = createAuthClient(null)

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Tentativa Não Autenticada' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 401)
        assert.equal(err.code, 'UNAUTHENTICATED')
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].name, 'Empresa Ativa Alpha', 'Empresa não pode ser alterada')
  })

  // ============================================================================
  // CENÁRIO 5: Usuário comum é bloqueado (403)
  // ============================================================================
  test('Cenário 5: Usuário comum sem privilégios de plataforma é bloqueado com 403', async () => {
    const { adminClient, companiesState } = createMockEnvironment()
    const client = createAuthClient(REGULAR_USER_ID, 'usuario.comum@gmail.com')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Tentativa Usuário Comum' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].name, 'Empresa Ativa Alpha')
  })

  // ============================================================================
  // CENÁRIO 6: Administrador de empresa cliente é bloqueado (403)
  // ============================================================================
  test('Cenário 6: Administrador de empresa cliente é bloqueado com 403', async () => {
    const { adminClient, companiesState } = createMockEnvironment()
    const client = createAuthClient(TENANT_ADMIN_ID, 'admin@cliente.com.br')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Tentativa Admin Tenant' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].name, 'Empresa Ativa Alpha')
  })

  // ============================================================================
  // CENÁRIO 7: support_operator e billing_admin são bloqueados por padrão (403)
  // ============================================================================
  test('Cenário 7: Operadores com papéis support_operator e billing_admin são bloqueados por padrão (403)', async () => {
    const { adminClient, companiesState } = createMockEnvironment()

    // Teste com support_operator
    const supportClient = createAuthClient(SUPPORT_ID, 'suporte@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Tentativa Suporte' },
          { client: supportClient, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    // Teste com billing_admin
    const billingClient = createAuthClient(BILLING_ID, 'financeiro@elleveeia.com.br')
    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Tentativa Financeiro' },
          { client: billingClient, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].name, 'Empresa Ativa Alpha')
  })

  // ============================================================================
  // CENÁRIO 8: Operador inativo é bloqueado (403)
  // ============================================================================
  test('Cenário 8: Operador superadmin inativo é bloqueado com 403 (OPERATOR_INACTIVE)', async () => {
    const { adminClient, companiesState } = createMockEnvironment()
    const client = createAuthClient(INACTIVE_SUPERADMIN_ID, 'inativo@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Tentativa Super Inativo' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].name, 'Empresa Ativa Alpha')
  })

  // ============================================================================
  // CENÁRIO 9: Empresa inexistente retorna erro controlado
  // ============================================================================
  test('Cenário 9: Empresa inexistente retorna erro controlado amigável', async () => {
    const { adminClient } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
    const NON_EXISTENT_ID = '99999999-9999-9999-9999-999999999999'

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          NON_EXISTENT_ID,
          { name: 'Nova Empresa Fake' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err.message.includes(`Empresa não encontrada: '${NON_EXISTENT_ID}'`))
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 10: UUID inválido é rejeitado
  // ============================================================================
  test('Cenário 10: Identificador com formato UUID inválido é rejeitado imediatamente', async () => {
    const { adminClient } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    const invalidIds = ['123', 'not-a-uuid', '', '   ', '11111111-2222-3333-4444', null as any]

    for (const id of invalidIds) {
      await assert.rejects(
        async () => {
          await updatePlatformCompany(
            id,
            { name: 'Tentativa UUID Inválido' },
            { client, adminClient }
          )
        },
        (err: any) => {
          assert.ok(err.message.includes('Deve ser um UUID válido'))
          return true
        }
      )
    }
  })

  // ============================================================================
  // CENÁRIO 11: Nome vazio ou inválido é rejeitado
  // ============================================================================
  test('Cenário 11: Nome vazio, muito curto (<2) ou muito longo (>100) é rejeitado', async () => {
    const { adminClient } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    // Vazio / espaços
    await assert.rejects(
      async () => {
        await updatePlatformCompany(COMPANY_A_ID, { name: '   ' }, { client, adminClient })
      },
      (err: any) => {
        assert.ok(err.message.includes('pelo menos 2 caracteres'))
        return true
      }
    )

    // Apenas 1 caractere
    await assert.rejects(
      async () => {
        await updatePlatformCompany(COMPANY_A_ID, { name: 'A' }, { client, adminClient })
      },
      (err: any) => {
        assert.ok(err.message.includes('pelo menos 2 caracteres'))
        return true
      }
    )

    // Mais de 100 caracteres
    await assert.rejects(
      async () => {
        await updatePlatformCompany(COMPANY_A_ID, { name: 'A'.repeat(101) }, { client, adminClient })
      },
      (err: any) => {
        assert.ok(err.message.includes('excede o tamanho máximo de 100 caracteres'))
        return true
      }
    )

    // Tipo não textual
    await assert.rejects(
      async () => {
        await updatePlatformCompany(COMPANY_A_ID, { name: 12345 as any }, { client, adminClient })
      },
      (err: any) => {
        assert.ok(err.message.includes('deve ser um texto válido'))
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 12: Slug inválido é rejeitado
  // ============================================================================
  test('Cenário 12: Slug com caracteres especiais, acentos, hífens consecutivos ou fora do padrão é rejeitado', async () => {
    const { adminClient } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    const invalidSlugs = [
      '',
      '   ',
      'slug com espacos',
      'slug_com_underline',
      'slug--hifen-duplo',
      '-slug-comeca-hifen',
      'slug-termina-hifen-',
      'slug@especial!',
      'slug#hashtag',
      'a'.repeat(81) // Excede 80 caracteres
    ]

    for (const slug of invalidSlugs) {
      await assert.rejects(
        async () => {
          await updatePlatformCompany(COMPANY_A_ID, { slug }, { client, adminClient })
        },
        (err: any) => {
          assert.ok(
            err.message.includes('Slug inválido') ||
            err.message.includes('não pode ser vazio') ||
            err.message.includes('excede o tamanho máximo de 80 caracteres')
          )
          return true
        }
      )
    }
  })

  // ============================================================================
  // CENÁRIO 13: Slug duplicado é tratado corretamente
  // ============================================================================
  test('Cenário 13: Slug duplicado é interceptado tanto por validação prévia quanto por constraint 23505', async () => {
    const { adminClient } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    // Empresa B já possui o slug 'empresa-suspensa-beta'
    // Tentativa de alterar o slug da Empresa A para o mesmo slug
    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { slug: 'empresa-suspensa-beta' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err.message.includes("já está em uso por outra empresa"))
        return true
      }
    )

    // Teste também da simulação de colisão concorrente via código de constraint 23505
    const { adminClient: adminClientWithCollision } = createMockEnvironment({ simulateUniqueSlugCode: true })
    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { slug: 'slug-novo-concorrente' },
          { client, adminClient: adminClientWithCollision }
        )
      },
      (err: any) => {
        assert.ok(err.message.includes("já está em uso por outra empresa"))
        return true
      }
    )
  })

  // ============================================================================
  // CENÁRIO 14: Tentativa de alterar status é rejeitada
  // ============================================================================
  test('Cenário 14: Tentativa de alterar status é rejeitada imediatamente', async () => {
    const { adminClient, companiesState } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Nome Ok', status: 'suspended' } as any,
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err.message.includes("Alteração do campo 'status' não é permitida neste serviço"))
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].status, 'active', 'Status deve permanecer active')
  })

  // ============================================================================
  // CENÁRIO 15: Tentativa de alterar plan_tier é rejeitada
  // ============================================================================
  test('Cenário 15: Tentativa de alterar plan_tier é rejeitada imediatamente', async () => {
    const { adminClient, companiesState } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Nome Ok', plan_tier: 'enterprise' } as any,
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err.message.includes("Alteração do campo 'plan_tier' não é permitida neste serviço"))
        return true
      }
    )

    assert.equal(companiesState[COMPANY_A_ID].plan_tier, 'pro', 'PlanTier deve permanecer pro')
  })

  // ============================================================================
  // CENÁRIO 16: Tentativa de alterar limites é rejeitada
  // ============================================================================
  test('Cenário 16: Tentativa de alterar limites comerciais é rejeitada imediatamente', async () => {
    const { adminClient } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    const payloads = [
      { name: 'Nome Ok', limits: { max_agents: 99 } } as any,
      { name: 'Nome Ok', company_limits: { max_agents: 99 } } as any,
      { name: 'Nome Ok', max_agents: 99 } as any,
      { name: 'Nome Ok', role: 'admin' } as any,
      { name: 'Nome Ok', id: 'hack' } as any,
      { name: 'Nome Ok', company_id: 'hack' } as any
    ]

    for (const p of payloads) {
      await assert.rejects(
        async () => {
          await updatePlatformCompany(COMPANY_A_ID, p, { client, adminClient })
        },
        (err: any) => {
          assert.ok(
            err.message.includes("Alteração de limites não é permitida") ||
            err.message.includes("Campo não permitido para atualização cadastral")
          )
          return true
        }
      )
    }
  })

  // ============================================================================
  // CENÁRIO 17: Auditoria registra ator e empresa corretos com contexto de rede
  // ============================================================================
  test('Cenário 17: Auditoria registra ator, empresa, status, IP e User-Agent fidedignos', async () => {
    const { adminClient, auditLogsCaptured } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    await updatePlatformCompany(
      COMPANY_A_ID,
      { name: 'Alpha Telecomunicações', slug: 'alpha-telecom', reason: 'Ajuste de razão social' },
      {
        client,
        adminClient,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 ElleveeAdmin/1.0'
      }
    )

    assert.equal(auditLogsCaptured.length, 1)
    const log = auditLogsCaptured[0]
    assert.equal(log.actor_id, SUPERADMIN_ID)
    assert.equal(log.actor_email, 'superadmin@elleveeia.com.br')
    assert.equal(log.action, 'company.updated')
    assert.equal(log.target_company_id, COMPANY_A_ID)
    assert.equal(log.ip_address, '192.168.1.100')
    assert.equal(log.user_agent, 'Mozilla/5.0 ElleveeAdmin/1.0')
    assert.equal(log.reason, 'Ajuste de razão social')
    assert.equal(log.status, 'success')
    assert.equal(log.payload_summary.changes.name.from, 'Empresa Ativa Alpha')
    assert.equal(log.payload_summary.changes.name.to, 'Alpha Telecomunicações')
    assert.equal(log.payload_summary.changes.slug.from, 'empresa-ativa-alpha')
    assert.equal(log.payload_summary.changes.slug.to, 'alpha-telecom')
  })

  // ============================================================================
  // CENÁRIO 18: Falha na auditoria pós-persistência não é apresentada como rollback
  // ============================================================================
  test('Cenário 18: Falha na auditoria após persistência lança PlatformAuditError alertando que operação não foi revertida', async () => {
    const { adminClient, companiesState } = createMockEnvironment({ failOnAuditInsert: true })
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Nome Persistido Sem Log' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuditError, 'Deve ser PlatformAuditError')
        assert.equal(err.code, 'AUDIT_WRITE_FAILED')
        assert.equal(err.operationExecuted, true, 'operationExecuted deve ser true')
        assert.equal(err.auditRecorded, false, 'auditRecorded deve ser false')
        assert.ok(
          err.message.includes('NÃO foi revertida automaticamente'),
          'Deve alertar expressamente que não houve rollback automático'
        )
        return true
      }
    )

    // A empresa foi persistida no banco, comprovando consistência e transparência
    assert.equal(companiesState[COMPANY_A_ID].name, 'Nome Persistido Sem Log')
  })

  // ============================================================================
  // CENÁRIO 19: Falha da operação de banco preserva o erro original
  // ============================================================================
  test('Cenário 19: Falha na atualização no banco preserva o erro original da operação', async () => {
    const { adminClient, auditLogsCaptured } = createMockEnvironment({ failOnCompanyUpdate: true })
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    await assert.rejects(
      async () => {
        await updatePlatformCompany(
          COMPANY_A_ID,
          { name: 'Falha Esperada de Banco' },
          { client, adminClient }
        )
      },
      (err: any) => {
        assert.ok(err.message.includes('Falha ao atualizar dados cadastrais da empresa'))
        assert.ok(err.message.includes('Simulated DB update failure'))
        return true
      }
    )

    // Auditoria deve ter registrado o erro da operação com status 'failed'
    assert.equal(auditLogsCaptured.length, 1)
    const log = auditLogsCaptured[0]
    assert.equal(log.status, 'failed')
    assert.ok(log.error_message.includes('Simulated DB update failure'))
  })

  // ============================================================================
  // CENÁRIO 20: Tratamento de No-Op e proteção contra vazamento de credenciais
  // ============================================================================
  test('Cenário 20: No-op detectado não altera dados nem gera auditoria desnecessária, e não vaza credenciais', async () => {
    const { adminClient, auditLogsCaptured } = createMockEnvironment()
    const client = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')

    // Envia exatamente os mesmos dados atuais da Empresa A
    const result = await updatePlatformCompany(
      COMPANY_A_ID,
      { name: 'Empresa Ativa Alpha', slug: 'empresa-ativa-alpha' },
      { client, adminClient }
    )

    // No-op deve retornar updated: false
    assert.equal(result.updated, false, 'Deve identificar que não houve alterações')
    assert.equal(result.company.id, COMPANY_A_ID)
    assert.equal(result.company.name, 'Empresa Ativa Alpha')
    assert.equal(result.company.slug, 'empresa-ativa-alpha')

    // Nenhuma gravação de auditoria redundante
    assert.equal(auditLogsCaptured.length, 0, 'Não deve emitir auditoria quando updated for false')

    // Valida que o objeto de retorno contém apenas os campos públicos e tipados
    const returnedKeys = Object.keys(result.company)
    assert.deepEqual(returnedKeys.sort(), ['createdAt', 'id', 'name', 'planTier', 'slug', 'status'].sort())
    assert.equal((result.company as any).service_role, undefined)
    assert.equal((result.company as any).api_key, undefined)
    assert.equal((result.company as any).secret, undefined)
  })
})
