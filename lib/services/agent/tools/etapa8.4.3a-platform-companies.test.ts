// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  listPlatformCompanies,
  getPlatformCompanyDetails,
  type CompanyStatus,
  type CompanyPlanTier
} from '@/lib/services/platform/companies'
import { PlatformAuthError } from '@/lib/services/platform/admin'

describe('ETAPA 8.4.3A — Diretório Administrativo de Empresas (Somente Leitura)', () => {
  // IDs de operadores da plataforma
  const SUPERADMIN_ID = '00000000-0000-0000-0000-000000000001'
  const INACTIVE_SUPERADMIN_ID = '00000000-0000-0000-0000-000000000002'
  const SUPPORT_ID = '00000000-0000-0000-0000-000000000003'
  const BILLING_ID = '00000000-0000-0000-0000-000000000004'
  const TENANT_ADMIN_ID = '00000000-0000-0000-0000-000000000099'

  // IDs de empresas para testes
  const COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'
  const COMPANY_C_ID = '33333333-3333-3333-3333-333333333333'
  const COMPANY_D_ID = '44444444-4444-4444-4444-444444444444'

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

  // Base simulada de empresas (dados imutáveis durante os testes)
  const initialCompaniesDb: Record<string, any> = {
    [COMPANY_A_ID]: {
      id: COMPANY_A_ID,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-ativa-alpha',
      status: 'active',
      suspension_reason: null,
      plan_tier: 'pro',
      created_at: '2026-10-01T10:00:00Z'
    },
    [COMPANY_B_ID]: {
      id: COMPANY_B_ID,
      name: 'Empresa Suspensa Beta',
      slug: 'empresa-suspensa-beta',
      status: 'suspended',
      suspension_reason: 'Atraso na fatura de serviço',
      plan_tier: 'standard',
      created_at: '2026-10-02T10:00:00Z'
    },
    [COMPANY_C_ID]: {
      id: COMPANY_C_ID,
      name: 'Empresa Provisioning Gamma',
      slug: 'empresa-provisioning-gamma',
      status: 'provisioning',
      suspension_reason: null,
      plan_tier: 'enterprise',
      created_at: '2026-10-03T10:00:00Z'
    },
    [COMPANY_D_ID]: {
      id: COMPANY_D_ID,
      name: 'Empresa Cancelada Delta',
      slug: 'empresa-cancelada-delta',
      status: 'cancelled',
      suspension_reason: 'Contrato rescindido amigavelmente',
      plan_tier: 'trial',
      created_at: '2026-10-04T10:00:00Z'
    }
  }

  // Limites por empresa
  const limitsDb: Record<string, any> = {
    [COMPANY_A_ID]: {
      id: 'lim-1',
      company_id: COMPANY_A_ID,
      max_agents: 5,
      max_monthly_messages: 50000,
      max_monthly_quotes: 5000,
      max_catalog_items: 20000,
      allowed_llm_providers: ['gemini', 'openai'],
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z'
    },
    [COMPANY_B_ID]: {
      id: 'lim-2',
      company_id: COMPANY_B_ID,
      max_agents: 1,
      max_monthly_messages: 5000,
      max_monthly_quotes: 1000,
      max_catalog_items: 5000,
      allowed_llm_providers: ['gemini'],
      created_at: '2026-10-02T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z'
    },
    [COMPANY_C_ID]: {
      id: 'lim-3',
      company_id: COMPANY_C_ID,
      max_agents: 10,
      max_monthly_messages: 200000,
      max_monthly_quotes: 20000,
      max_catalog_items: 50000,
      allowed_llm_providers: ['gemini', 'openai'],
      created_at: '2026-10-03T10:00:00Z',
      updated_at: '2026-10-03T10:00:00Z'
    }
  }

  // Jobs de provisionamento
  const provisioningJobsDb: Record<string, any> = {
    [COMPANY_C_ID]: {
      id: 'job-gamma-1',
      company_id: COMPANY_C_ID,
      admin_email: 'admin@gamma.com.br',
      admin_name: 'Diretor Gamma',
      current_step: 'configuring_agents',
      status: 'running',
      error_log: 'CRITICAL_INTERNAL_EXCEPTION: db timeout / private trace',
      retry_count: 1,
      created_at: '2026-10-03T10:05:00Z',
      updated_at: '2026-10-03T10:06:00Z'
    }
  }

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

  function createMockAdminClient(options: { failOnSelectTable?: string } = {}) {
    return {
      from: (table: string) => {
        if (options.failOnSelectTable === table) {
          return {
            select: () => ({
              order: () => ({
                range: async () => ({
                  data: null,
                  count: null,
                  error: { message: `Simulated connection timeout on table ${table}`, code: 'ETIMEDOUT' }
                }),
                limit: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: `Simulated connection timeout on table ${table}`, code: 'ETIMEDOUT' }
                  })
                })
              }),
              eq: () => {
                const failBuilder: any = {
                  order: () => failBuilder,
                  limit: () => failBuilder,
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: `Simulated connection timeout on table ${table}`, code: 'ETIMEDOUT' }
                  })
                }
                return failBuilder
              },
              in: async () => ({
                data: null,
                error: { message: `Simulated connection timeout on table ${table}`, code: 'ETIMEDOUT' }
              })
            })
          }
        }

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
            select: (cols: string, queryOpts: any = {}) => {
              let currentStatus: string | null = null
              let currentPlan: string | null = null
              let isOrderDesc = true

              const builder: any = {
                order: (col: string, orderOpts: any) => {
                  isOrderDesc = orderOpts?.ascending === false
                  return builder
                },
                eq: (col: string, val: string) => {
                  if (col === 'status') currentStatus = val
                  if (col === 'plan_tier') currentPlan = val
                  if (col === 'id') {
                    return {
                      maybeSingle: async () => {
                        const comp = initialCompaniesDb[val]
                        return { data: comp ? { ...comp } : null, error: null }
                      }
                    }
                  }
                  return builder
                },
                range: async (from: number, to: number) => {
                  let list = Object.values(initialCompaniesDb)
                  if (currentStatus) list = list.filter(c => c.status === currentStatus)
                  if (currentPlan) list = list.filter(c => c.plan_tier === currentPlan)

                  list.sort((a, b) => {
                    if (a.created_at < b.created_at) return isOrderDesc ? 1 : -1
                    if (a.created_at > b.created_at) return isOrderDesc ? -1 : 1
                    return 0
                  })

                  const totalCount = list.length
                  const sliced = list.slice(from, to + 1)
                  return {
                    data: sliced.map(c => ({ ...c })),
                    count: totalCount,
                    error: null
                  }
                }
              }
              return builder
            }
          }
        }

        if (table === 'company_limits') {
          return {
            select: (cols: string) => ({
              in: async (col: string, ids: string[]) => {
                const results = ids.map(id => limitsDb[id]).filter(Boolean).map(lim => ({ ...lim }))
                return { data: results, error: null }
              },
              eq: (col: string, val: string) => ({
                maybeSingle: async () => {
                  const lim = limitsDb[val]
                  return { data: lim ? { ...lim } : null, error: null }
                }
              })
            })
          }
        }

        if (table === 'provisioning_jobs') {
          return {
            select: (cols: string) => ({
              eq: (col: string, val: string) => ({
                order: () => ({
                  limit: (n: number) => ({
                    maybeSingle: async () => {
                      const job = provisioningJobsDb[val]
                      return { data: job ? { ...job } : null, error: null }
                    }
                  })
                })
              })
            })
          }
        }

        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) })
          })
        }
      }
    }
  }

  const standardAdminClient = createMockAdminClient()
  const superadminClient = createAuthClient(SUPERADMIN_ID, 'superadmin@elleveeia.com.br')
  const inactiveSuperClient = createAuthClient(INACTIVE_SUPERADMIN_ID, 'inativo@elleveeia.com.br')
  const supportClient = createAuthClient(SUPPORT_ID, 'suporte@elleveeia.com.br')
  const billingClient = createAuthClient(BILLING_ID, 'financeiro@elleveeia.com.br')
  const tenantAdminClient = createAuthClient(TENANT_ADMIN_ID, 'cliente@empresa-a.com.br')

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Superadmin consegue listar empresas
  // ----------------------------------------------------------------------------
  test('1. Superadmin consegue listar empresas', async () => {
    const res = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient
    })

    assert.ok(res)
    assert.ok(Array.isArray(res.companies))
    assert.equal(res.companies.length, 4)
    assert.equal(res.pagination.totalCount, 4)
    assert.equal(res.pagination.page, 1)

    // Confirma que os itens possuem estrutura de lista
    const compA = res.companies.find(c => c.id === COMPANY_A_ID)
    assert.ok(compA)
    assert.equal(compA.name, 'Empresa Ativa Alpha')
    assert.equal(compA.status, 'active')
    assert.equal(compA.planTier, 'pro')
    assert.ok(compA.limits)
    assert.equal(compA.limits.maxAgents, 5)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Superadmin consegue consultar detalhes de uma empresa
  // ----------------------------------------------------------------------------
  test('2. Superadmin consegue consultar detalhes de uma empresa', async () => {
    // Empresa C (em provisioning, com limits e job)
    const details = await getPlatformCompanyDetails(COMPANY_C_ID, {
      client: superadminClient,
      adminClient: standardAdminClient
    })

    assert.ok(details)
    assert.equal(details.id, COMPANY_C_ID)
    assert.equal(details.name, 'Empresa Provisioning Gamma')
    assert.equal(details.status, 'provisioning')
    assert.equal(details.planTier, 'enterprise')
    assert.ok(details.limits)
    assert.equal(details.limits.maxMonthlyMessages, 200000)
    assert.deepEqual(details.limits.allowedLlmProviders, ['gemini', 'openai'])
    assert.ok(details.provisioningJob)
    assert.equal(details.provisioningJob.currentStep, 'configuring_agents')
    assert.equal(details.provisioningJob.status, 'running')
    assert.equal(details.provisioningJob.retryCount, 1)

    // Empresa B (suspensa com motivo)
    const detailsB = await getPlatformCompanyDetails(COMPANY_B_ID, {
      client: superadminClient,
      adminClient: standardAdminClient
    })
    assert.ok(detailsB)
    assert.equal(detailsB.status, 'suspended')
    assert.equal(detailsB.suspensionReason, 'Atraso na fatura de serviço')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Operador não autorizado recebe bloqueio
  // ----------------------------------------------------------------------------
  test('3. Operador não autorizado recebe bloqueio (403)', async () => {
    // Tentativa de listar empresas por administrador de empresa cliente
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: tenantAdminClient,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    // Tentativa de obter detalhes por administrador de empresa cliente
    await assert.rejects(
      async () => {
        await getPlatformCompanyDetails(COMPANY_A_ID, {
          client: tenantAdminClient,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Operador inativo recebe bloqueio
  // ----------------------------------------------------------------------------
  test('4. Operador inativo recebe bloqueio (403)', async () => {
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: inactiveSuperClient,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        return true
      }
    )

    await assert.rejects(
      async () => {
        await getPlatformCompanyDetails(COMPANY_A_ID, {
          client: inactiveSuperClient,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: support_operator e billing_admin não recebem acesso por padrão
  // ----------------------------------------------------------------------------
  test('5. support_operator e billing_admin não recebem acesso por padrão', async () => {
    // support_operator bloqueado por padrão
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: supportClient,
          adminClient: standardAdminClient
        })
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_INSUFFICIENT_PERMISSIONS')
        return true
      }
    )

    // billing_admin bloqueado por padrão
    await assert.rejects(
      async () => {
        await getPlatformCompanyDetails(COMPANY_A_ID, {
          client: billingClient,
          adminClient: standardAdminClient
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
  // CENÁRIO 6: Empresa inexistente retorna resultado controlado
  // ----------------------------------------------------------------------------
  test('6. Empresa inexistente retorna resultado controlado (null)', async () => {
    // UUID válido sintaticamente, mas inexistente no banco
    const resNonExistent = await getPlatformCompanyDetails('99999999-9999-9999-9999-999999999999', {
      client: superadminClient,
      adminClient: standardAdminClient
    })
    assert.equal(resNonExistent, null)

    // String inválida (não UUID)
    const resInvalidId = await getPlatformCompanyDetails('not-a-valid-uuid', {
      client: superadminClient,
      adminClient: standardAdminClient
    })
    assert.equal(resInvalidId, null)

    // ID nulo/vazio
    const resEmpty = await getPlatformCompanyDetails('', {
      client: superadminClient,
      adminClient: standardAdminClient
    })
    assert.equal(resEmpty, null)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Paginação funciona corretamente
  // ----------------------------------------------------------------------------
  test('7. Paginação funciona corretamente', async () => {
    // Página 1 com limite 2
    const page1 = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      page: 1,
      limit: 2
    })

    assert.equal(page1.companies.length, 2)
    assert.equal(page1.pagination.page, 1)
    assert.equal(page1.pagination.limit, 2)
    assert.equal(page1.pagination.totalCount, 4)
    assert.equal(page1.pagination.totalPages, 2)
    assert.equal(page1.pagination.hasNextPage, true)
    assert.equal(page1.pagination.hasPreviousPage, false)

    // Página 2 com limite 2
    const page2 = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      page: 2,
      limit: 2
    })

    assert.equal(page2.companies.length, 2)
    assert.equal(page2.pagination.page, 2)
    assert.equal(page2.pagination.hasNextPage, false)
    assert.equal(page2.pagination.hasPreviousPage, true)

    // Os registros retornados na página 1 e página 2 são disjuntos
    const idsPage1 = page1.companies.map(c => c.id)
    const idsPage2 = page2.companies.map(c => c.id)
    for (const id of idsPage1) {
      assert.ok(!idsPage2.includes(id), `ID ${id} duplicado entre páginas`)
    }
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Limite máximo de registros é respeitado
  // ----------------------------------------------------------------------------
  test('8. Limite máximo de registros é respeitado', async () => {
    // Solicitar limite excessivo (500) é clamped para MAX_LIMIT (100)
    const resExcess = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      limit: 500
    })
    assert.equal(resExcess.pagination.limit, 100)

    // Solicitar limite inválido (-1 ou 0) assume DEFAULT_LIMIT (20)
    const resNegative = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      limit: -5
    })
    assert.equal(resNegative.pagination.limit, 20)

    // Solicitar página negativa ou zero assume DEFAULT_PAGE (1)
    const resZeroPage = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      page: 0
    })
    assert.equal(resZeroPage.pagination.page, 1)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Filtros de status e plano são validados
  // ----------------------------------------------------------------------------
  test('9. Filtros de status e plano são validados', async () => {
    // Filtro válido: status = 'active'
    const resActive = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      status: 'active'
    })
    assert.equal(resActive.companies.length, 1)
    assert.equal(resActive.companies[0].status, 'active')
    assert.equal(resActive.companies[0].id, COMPANY_A_ID)

    // Filtro válido: planTier = 'enterprise'
    const resEnterprise = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient,
      planTier: 'enterprise'
    })
    assert.equal(resEnterprise.companies.length, 1)
    assert.equal(resEnterprise.companies[0].planTier, 'enterprise')
    assert.equal(resEnterprise.companies[0].id, COMPANY_C_ID)

    // Filtro inválido de status: rejeição imediata com erro explicativo
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: superadminClient,
          adminClient: standardAdminClient,
          status: 'status_fantasma' as any
        })
      },
      (err: any) => {
        assert.match(err.message, /Filtro de status inválido/)
        return true
      }
    )

    // Filtro inválido de plano: rejeição imediata com erro explicativo
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: superadminClient,
          adminClient: standardAdminClient,
          planTier: 'super_vip' as any
        })
      },
      (err: any) => {
        assert.match(err.message, /Filtro de plano inválido/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Consultas retornam somente os campos permitidos
  // ----------------------------------------------------------------------------
  test('10. Consultas retornam somente os campos permitidos', async () => {
    // Listagem: verificar campos estritos de cada item
    const listRes = await listPlatformCompanies({
      client: superadminClient,
      adminClient: standardAdminClient
    })
    const item = listRes.companies[0]
    assert.deepEqual(
      Object.keys(item).sort(),
      ['createdAt', 'id', 'limits', 'name', 'planTier', 'slug', 'status'].sort()
    )

    // Detalhes: verificar campos estritos do objeto de detalhes
    const details = await getPlatformCompanyDetails(COMPANY_C_ID, {
      client: superadminClient,
      adminClient: standardAdminClient
    })
    assert.deepEqual(
      Object.keys(details!).sort(),
      ['createdAt', 'id', 'limits', 'name', 'planTier', 'provisioningJob', 'slug', 'status', 'suspensionReason'].sort()
    )

    // Limites: verificar campos estritos
    assert.deepEqual(
      Object.keys(details!.limits!).sort(),
      ['allowedLlmProviders', 'maxAgents', 'maxCatalogItems', 'maxMonthlyMessages', 'maxMonthlyQuotes'].sort()
    )

    // Provisioning Job: verificar campos estritos (omitindo error_log e dados internos)
    assert.deepEqual(
      Object.keys(details!.provisioningJob!).sort(),
      ['createdAt', 'currentStep', 'id', 'retryCount', 'status', 'updatedAt'].sort()
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Nenhuma credencial ou segredo é exposto
  // ----------------------------------------------------------------------------
  test('11. Nenhuma credencial ou segredo é exposto', async () => {
    const details = await getPlatformCompanyDetails(COMPANY_C_ID, {
      client: superadminClient,
      adminClient: standardAdminClient
    })

    const serialized = JSON.stringify(details)
    // Confirma ausência total de chaves confidenciais e stack traces
    assert.ok(!serialized.includes('CRITICAL_INTERNAL_EXCEPTION'))
    assert.ok(!serialized.includes('private trace'))
    assert.ok(!serialized.includes('error_log'))
    assert.ok(!serialized.includes('service_role'))
    assert.ok(!serialized.includes('api_key'))
    assert.ok(!serialized.includes('token'))
    assert.ok(!serialized.includes('password'))
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Falhas do banco não retornam dados parciais como se fossem sucesso
  // ----------------------------------------------------------------------------
  test('12. Falhas do banco não retornam dados parciais como se fossem sucesso (fail-closed)', async () => {
    // 12a: Falha na tabela companies durante listagem
    const failingCompaniesClient = createMockAdminClient({ failOnSelectTable: 'companies' })
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: superadminClient,
          adminClient: failingCompaniesClient
        })
      },
      (err: any) => {
        assert.match(err.message, /Falha ao listar empresas/)
        return true
      }
    )

    // 12b: Falha na tabela company_limits durante listagem
    const failingLimitsClient = createMockAdminClient({ failOnSelectTable: 'company_limits' })
    await assert.rejects(
      async () => {
        await listPlatformCompanies({
          client: superadminClient,
          adminClient: failingLimitsClient
        })
      },
      (err: any) => {
        assert.match(err.message, /Falha ao consultar limites/)
        return true
      }
    )

    // 12c: Falha na tabela provisioning_jobs durante consulta de detalhes
    const failingJobsClient = createMockAdminClient({ failOnSelectTable: 'provisioning_jobs' })
    await assert.rejects(
      async () => {
        await getPlatformCompanyDetails(COMPANY_C_ID, {
          client: superadminClient,
          adminClient: failingJobsClient
        })
      },
      (err: any) => {
        assert.match(err.message, /Falha ao consultar histórico de implantação/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: Não há alteração de registros durante as consultas (read-only)
  // ----------------------------------------------------------------------------
  test('13. Não há alteração de registros durante as consultas (garantia read-only)', async () => {
    const snapshotBefore = JSON.stringify({
      companies: initialCompaniesDb,
      limits: limitsDb,
      jobs: provisioningJobsDb,
      operators: operatorsDb
    })

    // Executa múltiplas leituras sucessivas
    await listPlatformCompanies({ client: superadminClient, adminClient: standardAdminClient })
    await listPlatformCompanies({ client: superadminClient, adminClient: standardAdminClient, status: 'suspended' })
    await getPlatformCompanyDetails(COMPANY_A_ID, { client: superadminClient, adminClient: standardAdminClient })
    await getPlatformCompanyDetails(COMPANY_B_ID, { client: superadminClient, adminClient: standardAdminClient })
    await getPlatformCompanyDetails(COMPANY_C_ID, { client: superadminClient, adminClient: standardAdminClient })
    await getPlatformCompanyDetails(COMPANY_D_ID, { client: superadminClient, adminClient: standardAdminClient })

    const snapshotAfter = JSON.stringify({
      companies: initialCompaniesDb,
      limits: limitsDb,
      jobs: provisioningJobsDb,
      operators: operatorsDb
    })

    assert.equal(snapshotBefore, snapshotAfter, 'O banco em memória foi indevidamente modificado durante operações read-only!')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 14: Isolamento entre dados de empresas não é comprometido
  // ----------------------------------------------------------------------------
  test('14. Isolamento entre dados de empresas não é comprometido', async () => {
    const detailsA = await getPlatformCompanyDetails(COMPANY_A_ID, {
      client: superadminClient,
      adminClient: standardAdminClient
    })
    const detailsB = await getPlatformCompanyDetails(COMPANY_B_ID, {
      client: superadminClient,
      adminClient: standardAdminClient
    })

    // Limites de A não vazam para B
    assert.equal(detailsA!.limits!.maxAgents, 5)
    assert.equal(detailsB!.limits!.maxAgents, 1)

    // Status e dados cadastrais de A e B são estritamente isolados
    assert.equal(detailsA!.status, 'active')
    assert.equal(detailsB!.status, 'suspended')
    assert.equal(detailsA!.suspensionReason, null)
    assert.equal(detailsB!.suspensionReason, 'Atraso na fatura de serviço')
  })
})
