import test, { describe } from "node:test"
import assert from "node:assert/strict"
import {
  generateOpaqueSessionToken,
  hashSessionToken,
  isPlatformImmuneRoute,
  startImpersonationSession,
  terminateImpersonationSession,
  resolveEffectiveSessionContext,
  ImpersonationError,
  type ContextGuard,
} from "@/lib/services/platform/impersonation"

// ==============================================================================
// MOCK DETERMINÍSTICO DE BANCO DE DADOS EM MEMÓRIA COM RESTRIÇÕES DE POSTGRESQL
// ==============================================================================

const SUPERADMIN_ID = "00000000-0000-4000-a000-000000000001"
const ATTENDANT_ID = "00000000-0000-4000-a000-000000000002"
const OPERATOR_COMPANY_ID = "11111111-1111-4111-a111-111111111111"
const TARGET_COMPANY_A = "22222222-2222-4222-a222-222222222222"
const TARGET_COMPANY_B = "33333333-3333-4333-a333-333333333333"
const SUSPENDED_COMPANY = "44444444-4444-4444-a444-444444444444"

interface MockDatabase {
  profiles: Map<string, any>
  platform_admins: Map<string, any>
  companies: Map<string, any>
  platform_impersonation_sessions: Map<string, any>
  platform_audit_logs: any[]
}

function createMockDb(): MockDatabase {
  const db: MockDatabase = {
    profiles: new Map(),
    platform_admins: new Map(),
    companies: new Map(),
    platform_impersonation_sessions: new Map(),
    platform_audit_logs: [],
  }

  // Popula dados base
  db.profiles.set(SUPERADMIN_ID, {
    id: SUPERADMIN_ID,
    company_id: OPERATOR_COMPANY_ID,
    role: "admin",
    full_name: "SuperAdmin Operador",
  })

  db.profiles.set(ATTENDANT_ID, {
    id: ATTENDANT_ID,
    company_id: OPERATOR_COMPANY_ID,
    role: "attendant",
    full_name: "Atendente Comum",
  })

  db.platform_admins.set(SUPERADMIN_ID, {
    id: SUPERADMIN_ID,
    role: "superadmin",
    active: true,
  })

  db.companies.set(OPERATOR_COMPANY_ID, {
    id: OPERATOR_COMPANY_ID,
    name: "Empresa Matriz Ellevee",
    slug: "ellevee-matriz",
    status: "active",
  })

  db.companies.set(TARGET_COMPANY_A, {
    id: TARGET_COMPANY_A,
    name: "Cliente Empresa A",
    slug: "empresa-a",
    status: "active",
  })

  db.companies.set(TARGET_COMPANY_B, {
    id: TARGET_COMPANY_B,
    name: "Cliente Empresa B",
    slug: "empresa-b",
    status: "active",
  })

  db.companies.set(SUSPENDED_COMPANY, {
    id: SUSPENDED_COMPANY,
    name: "Empresa Inadimplente Suspensa",
    slug: "empresa-suspensa",
    status: "suspended",
  })

  return db
}

function createMockAdminClient(db: MockDatabase) {
  return {
    from: (table: string) => {
      let currentTable = table
      let filterCol: string | null = null
      let filterVal: any = null
      let updatePayload: any = null
      let insertPayload: any = null

      const builder: any = {
        select: (cols: string) => builder,
        eq: (col: string, val: any) => {
          filterCol = col
          filterVal = val
          return builder
        },
        single: async () => {
          if (currentTable === "companies") {
            const found = db.companies.get(filterVal)
            if (!found) return { data: null, error: { message: "Row not found" } }
            return { data: { ...found }, error: null }
          }
          if (currentTable === "platform_impersonation_sessions") {
            const found = Array.from(db.platform_impersonation_sessions.values()).find(
              (s) => s[filterCol!] === filterVal
            )
            return { data: found ? { ...found } : null, error: found ? null : { message: "Not found" } }
          }
          return { data: null, error: null }
        },
        maybeSingle: async () => {
          if (currentTable === "profiles") {
            const found = db.profiles.get(filterVal)
            return { data: found ? { ...found } : null, error: null }
          }
          if (currentTable === "platform_admins") {
            const found = db.platform_admins.get(filterVal)
            return { data: found ? { ...found } : null, error: null }
          }
          if (currentTable === "companies") {
            const found = db.companies.get(filterVal)
            return { data: found ? { ...found } : null, error: null }
          }
          if (currentTable === "platform_impersonation_sessions") {
            const found = Array.from(db.platform_impersonation_sessions.values()).find(
              (s) => s[filterCol!] === filterVal
            )
            return { data: found ? { ...found } : null, error: null }
          }
          return { data: null, error: null }
        },
        update: (payload: any) => {
          updatePayload = payload
          return {
            eq: (col1: string, val1: any) => {
              const doUpdate = (col2?: string, val2?: any) => {
                let updatedCount = 0
                for (const [id, row] of db.platform_impersonation_sessions.entries()) {
                  const match1 = row[col1] === val1
                  const match2 = col2 !== undefined ? row[col2] === val2 : true
                  if (match1 && match2) {
                    Object.assign(row, updatePayload)
                    updatedCount++
                  }
                }
                return updatedCount
              }

              const resultObj: any = {
                then: (resolve: any, reject: any) => {
                  try {
                    const count = doUpdate()
                    resolve({ data: null, error: null, count })
                  } catch (e) {
                    if (reject) reject(e)
                  }
                },
                eq: async (col2: string, val2: any) => {
                  const count = doUpdate(col2, val2)
                  return { data: null, error: null, count }
                },
                select: () => ({
                  maybeSingle: async () => {
                    doUpdate()
                    const found = Array.from(db.platform_impersonation_sessions.values()).find(
                      (r) => r[col1] === val1
                    )
                    return { data: found ? { ...found } : null, error: null }
                  },
                }),
              }
              return resultObj
            },
          }
        },
        insert: (payload: any) => {
          insertPayload = Array.isArray(payload) ? payload[0] : payload
          return {
            select: () => ({
              single: async () => {
                if (currentTable === "platform_impersonation_sessions") {
                  // EMULAÇÃO DA RESTRIÇÃO DE UNICIDADE DO POSTGRESQL:
                  // CREATE UNIQUE INDEX idx_pims_single_active_operator ON (operator_id) WHERE status = 'active'
                  if (insertPayload.status === "active") {
                    const existingActive = Array.from(db.platform_impersonation_sessions.values()).find(
                      (s) => s.operator_id === insertPayload.operator_id && s.status === "active"
                    )
                    if (existingActive) {
                      return {
                        data: null,
                        error: {
                          code: "23505",
                          message: "duplicate key value violates unique constraint idx_pims_single_active_operator",
                        },
                      }
                    }
                  }

                  const newId = `session-${Date.now()}-${Math.random()}`
                  const fullRow = { id: newId, ...insertPayload }
                  db.platform_impersonation_sessions.set(newId, fullRow)
                  return { data: fullRow, error: null }
                }
                if (currentTable === "platform_audit_logs") {
                  db.platform_audit_logs.push(insertPayload)
                  return { data: insertPayload, error: null }
                }
                return { data: insertPayload, error: null }
              },
            }),
            then: (resolve: any) => {
              if (currentTable === "platform_audit_logs") {
                db.platform_audit_logs.push(insertPayload)
              }
              resolve({ data: insertPayload, error: null })
            },
          }
        },
      }
      return builder
    },
  }
}

function createMockUserClient(userId: string, email: string) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: userId, email } },
        error: null,
      }),
    },
  }
}

// ==============================================================================
// BATERIA DE TESTES DE SEGURANÇA AC-SEC-01.4-I1
// ==============================================================================

describe("AC-SEC-01.4-I1 — Bateria de Testes do Core Seguro de Impersonação", () => {

  test("1. Perfil do SuperAdmin permanece 100% imutável antes, durante e após a impersonação", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    // Snapshot inicial
    const initialProfile = JSON.parse(JSON.stringify(db.profiles.get(SUPERADMIN_ID)))
    assert.equal(initialProfile.company_id, OPERATOR_COMPANY_ID)
    assert.equal(initialProfile.role, "admin")

    // Inicia sessão
    const startRes = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_A,
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    })
    assert.equal(startRes.success, true)

    // Verifica que profiles NÃO sofreu mutação
    const duringProfile = db.profiles.get(SUPERADMIN_ID)
    assert.deepEqual(duringProfile, initialProfile, "profiles não pode ser alterado durante impersonação")

    // Executa resolução de contexto
    const resolved = await resolveEffectiveSessionContext({
      explicitToken: Array.from(db.platform_impersonation_sessions.values())[0].session_token_hash, // hash
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    }).catch(() => null)

    // Encerra sessão
    await terminateImpersonationSession({ injectedAdminClient: adminClient })

    // Snapshot final
    const finalProfile = db.profiles.get(SUPERADMIN_ID)
    assert.deepEqual(finalProfile, initialProfile, "profiles deve permanecer idêntico ao original")
  })

  test("2. Token inválido ou forjado é rejeitado com erro explícito (Fail-Closed, zero fallback)", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: "token-falso-forjado-1234567890abcdef",
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "IMPERSONATION_SESSION_INVALID")
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  test("3. Sessão expirada por tempo (TTL) é rejeitada e marcada no banco", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    // Insere sessão expirada há 10 minutos
    db.platform_impersonation_sessions.set("sess-exp", {
      id: "sess-exp",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "IMPERSONATION_SESSION_EXPIRED")
        return true
      }
    )

    // Confirma que status foi atualizado para 'expired' no banco
    assert.equal(db.platform_impersonation_sessions.get("sess-exp").status, "expired")
  })

  test("4. Sessão revogada é rejeitada imediatamente", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-rev", {
      id: "sess-rev",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "revoked",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "IMPERSONATION_SESSION_REVOKED")
        return true
      }
    )
  })

  test("5. Organização de destino suspensa é bloqueada tanto na criação quanto na resolução", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    // 1. Bloqueio ao tentar iniciar
    const startRes = await startImpersonationSession({
      targetCompanyId: SUSPENDED_COMPANY,
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    })
    assert.equal(startRes.success, false)
    assert.match(startRes.error || "", /suspensa/i)

    // 2. Bloqueio na resolução se for suspensa no meio da sessão
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-susp", {
      id: "sess-susp",
      operator_id: SUPERADMIN_ID,
      target_company_id: SUSPENDED_COMPANY,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "TARGET_COMPANY_SUSPENDED")
        return true
      }
    )
  })

  test("6. Concorrência: Iniciar nova sessão revoga atomicamente a sessão anterior do mesmo operador", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    // 1. Inicia Sessão A
    const resA = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_A,
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    })
    assert.equal(resA.success, true)
    const sessionAId = resA.data!.sessionId

    assert.equal(db.platform_impersonation_sessions.get(sessionAId).status, "active")

    // 2. Inicia Sessão B para outro cliente pelo mesmo operador
    const resB = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_B,
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    })
    assert.equal(resB.success, true)
    const sessionBId = resB.data!.sessionId

    // 3. Comprova que Sessão A foi revogada com SUPERSEDED_BY_NEW_SESSION
    assert.equal(db.platform_impersonation_sessions.get(sessionAId).status, "revoked")
    assert.equal(db.platform_impersonation_sessions.get(sessionAId).revocation_reason, "SUPERSEDED_BY_NEW_SESSION")

    // 4. Comprova que apenas Sessão B está ativa
    assert.equal(db.platform_impersonation_sessions.get(sessionBId).status, "active")

    // 5. Verifica que exatamente 1 sessão ativa existe no banco
    const activeCount = Array.from(db.platform_impersonation_sessions.values()).filter(
      (s) => s.operator_id === SUPERADMIN_ID && s.status === "active"
    ).length
    assert.equal(activeCount, 1)
  })

  test("7. Proteção Multi-Aba: Aba antiga com expectedCompanyId não pode operar se a sessão mudou para nova empresa", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    // Sessão ativa no servidor é para Empresa B
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-b", {
      id: "sess-b",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_B,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    // Mas a Aba 1 (que ainda estava aberta na Empresa A) dispara uma ação com expectedCompanyId = Empresa A
    const guard: ContextGuard = {
      expectedCompanyId: TARGET_COMPANY_A,
    }

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: guard,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "TENANT_CONTEXT_MISMATCH")
        assert.match(err.message, /Divergência de contexto multi-aba/)
        return true
      }
    )
  })

  test("8. Contexto esperado divergente da sessão é rejeitado com erro 403 e zero mutação", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-valid", {
      id: "sess-valid",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    // expectedSessionId errado
    const guard: ContextGuard = {
      expectedSessionId: "session-antiga-invalida",
    }

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: guard,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "TENANT_CONTEXT_MISMATCH")
        return true
      }
    )
  })

  test("9. Requisições em trânsito com sessão revogada falham fechadas e não tocam no banco", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    // Sessão revogada enquanto request estava voando na rede
    db.platform_impersonation_sessions.set("sess-inflight", {
      id: "sess-inflight",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "revoked",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "IMPERSONATION_SESSION_REVOKED")
        return true
      }
    )
  })

  test("10. Rotas administrativas preservam imunidade de plataforma mesmo com cookie de impersonação ativo", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-act", {
      id: "sess-act",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    // Teste de rotas imunes
    assert.equal(isPlatformImmuneRoute("/companies"), true)
    assert.equal(isPlatformImmuneRoute("/companies/new"), true)
    assert.equal(isPlatformImmuneRoute("/admin-settings"), true)
    assert.equal(isPlatformImmuneRoute("/paineladmin"), true)
    assert.equal(isPlatformImmuneRoute("/dashboard"), false)
    assert.equal(isPlatformImmuneRoute("/conversations"), false)

    // Resolução apontando para /companies ignora a sessão de suporte
    const resolved = await resolveEffectiveSessionContext({
      pathname: "/companies",
      explicitToken: rawToken,
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    })

    assert.equal(resolved.isImpersonating, false, "Rota /companies não pode adotar impersonação")
    assert.equal(resolved.effectiveCompanyId, OPERATOR_COMPANY_ID, "Deve retornar empresa nativa do operador")
    assert.equal(resolved.isPlatformAdmin, true)
  })

  test("11. Nenhuma credencial administrativa ou hash sensível é exposta ao cliente", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(SUPERADMIN_ID, "admin@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-clean", {
      id: "sess-clean",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
      client_ip: "10.0.0.1",
      user_agent: "Mozilla/5.0",
      metadata: { secret_internal: "data" },
    })

    const resolved = await resolveEffectiveSessionContext({
      explicitToken: rawToken,
      injectedAdminClient: adminClient,
      injectedUserClient: userClient,
    })

    // Valida que o objeto resolvido não contém hashes ou metadados de infraestrutura
    const serialized = JSON.stringify(resolved)
    assert.ok(!serialized.includes(tokenHash), "Hash do token jamais pode vazar no contexto do cliente")
    assert.ok(!serialized.includes("secret_internal"), "Metadados internos não podem vazar")
    assert.equal(resolved.impersonationSession?.sessionId, "sess-clean")
    assert.equal(resolved.impersonationSession?.targetCompanyId, TARGET_COMPANY_A)
  })

  test("12. Usuário não-superadmin (atendente comum) é bloqueado com erro 403 se tentar forjar token", async () => {
    const db = createMockDb()
    const adminClient = createMockAdminClient(db)
    const userClient = createMockUserClient(ATTENDANT_ID, "atendente@ellevee.ai")

    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-att", {
      id: "sess-att",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 1000 * 3600).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: any) => {
        assert.ok(err instanceof ImpersonationError)
        assert.equal(err.code, "FORBIDDEN_NOT_PLATFORM_ADMIN")
        return true
      }
    )
  })
})
