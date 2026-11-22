import test, { describe, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server"
import { clearMockCookies } from "./mocks/next-headers-mock.mjs"

import {
  generateOpaqueSessionToken,
  hashSessionToken,
  startImpersonationSession,
  terminateImpersonationSession,
  resolveEffectiveSessionContext,
  ImpersonationError,
  type ContextGuard,
  IMPERSONATION_COOKIE_NAME,
} from "@/lib/services/platform/impersonation"

import {
  impersonateCompanyAction,
  stopImpersonateAction,
  getImpersonateStatus,
} from "@/app/(admin)/companies/actions"

import {
  getConversationMessages,
  sendMessageAction,
  closeConversationAction,
  takeoverConversationAction,
  uploadChatMediaAction,
} from "@/app/(dashboard)/conversations/actions"

// ==============================================================================
// IDENTIFICADORES E DADOS DETERMINÍSTICOS DE TESTE
// ==============================================================================

const SUPERADMIN_ID = "00000000-0000-4000-a000-000000000001"
const ATTENDANT_USER_ID = "00000000-0000-4000-a000-000000000002"
const OPERATOR_COMPANY_ID = "11111111-1111-4111-a111-111111111111"
const TARGET_COMPANY_A = "22222222-2222-4222-a222-222222222222"
const TARGET_COMPANY_B = "33333333-3333-4333-a333-333333333333"
const CONV_A_ID = "ca000000-0000-4000-a000-000000000001"
const CONV_B_ID = "cb000000-0000-4000-a000-000000000002"

// ==============================================================================
// MOCK CLIENTS E AMBIENTE CONTROLADO
// ==============================================================================

interface MockState {
  profiles: Map<string, any>
  platform_admins: Map<string, any>
  companies: Map<string, any>
  conversations: Map<string, any>
  messages: any[]
  platform_impersonation_sessions: Map<string, any>
  platform_audit_logs: any[]
  storageUploads: string[]
}

function createIntegrationMockDb(): MockState {
  const state: MockState = {
    profiles: new Map(),
    platform_admins: new Map(),
    companies: new Map(),
    conversations: new Map(),
    messages: [],
    platform_impersonation_sessions: new Map(),
    platform_audit_logs: [],
    storageUploads: [],
  }

  state.profiles.set(SUPERADMIN_ID, {
    id: SUPERADMIN_ID,
    company_id: OPERATOR_COMPANY_ID,
    role: "admin",
    full_name: "SuperAdmin Operador",
  })

  state.profiles.set(ATTENDANT_USER_ID, {
    id: ATTENDANT_USER_ID,
    company_id: TARGET_COMPANY_A,
    role: "attendant",
    full_name: "Atendente Alice",
  })

  state.platform_admins.set(SUPERADMIN_ID, {
    id: SUPERADMIN_ID,
    role: "superadmin",
    active: true,
  })

  state.companies.set(OPERATOR_COMPANY_ID, {
    id: OPERATOR_COMPANY_ID,
    name: "Ellevee Matriz",
    slug: "ellevee-matriz",
    status: "active",
  })

  state.companies.set(TARGET_COMPANY_A, {
    id: TARGET_COMPANY_A,
    name: "Empresa A Cliente",
    slug: "empresa-a",
    status: "active",
  })

  state.companies.set(TARGET_COMPANY_B, {
    id: TARGET_COMPANY_B,
    name: "Empresa B Cliente",
    slug: "empresa-b",
    status: "active",
  })

  state.conversations.set(CONV_A_ID, {
    id: CONV_A_ID,
    company_id: TARGET_COMPANY_A,
    status: "open",
    assigned_to: null,
  })

  state.conversations.set(CONV_B_ID, {
    id: CONV_B_ID,
    company_id: TARGET_COMPANY_B,
    status: "open",
    assigned_to: null,
  })

  return state
}

function buildMockAdminClient(state: MockState) {
  return {
    from: (table: string) => {
      const filters: Record<string, any> = {}
      let pendingUpdate: any = null
      let pendingInsert: any = null

      const builder: any = {
        select: (cols?: string) => builder,
        eq: (col: string, val: any) => {
          filters[col] = val
          return builder
        },
        maybeSingle: async () => {
          if (table === "profiles") {
            const row = state.profiles.get(filters.id)
            return { data: row || null, error: null }
          }
          if (table === "platform_admins") {
            const row = state.platform_admins.get(filters.id)
            return { data: row || null, error: null }
          }
          if (table === "companies") {
            const row = state.companies.get(filters.id)
            return { data: row || null, error: null }
          }
          if (table === "conversations") {
            const row = state.conversations.get(filters.id)
            if (row && filters.company_id && row.company_id !== filters.company_id) {
              return { data: null, error: null }
            }
            return { data: row || null, error: null }
          }
          if (table === "platform_impersonation_sessions") {
            let found: any = null
            for (const s of state.platform_impersonation_sessions.values()) {
              let match = true
              if (filters.session_token_hash && s.session_token_hash !== filters.session_token_hash) match = false
              if (filters.operator_id && s.operator_id !== filters.operator_id) match = false
              if (filters.status && s.status !== filters.status) match = false
              if (filters.id && s.id !== filters.id) match = false
              if (match) {
                found = s
                break
              }
            }
            return { data: found, error: null }
          }
          return { data: null, error: null }
        },
        single: async () => builder.maybeSingle(),
        insert: (data: any) => {
          pendingInsert = data
          if (table === "platform_impersonation_sessions") {
            // Emula índice único parcial no PostgreSQL (idx_pims_single_active_operator)
            if (data.status === "active") {
              for (const s of state.platform_impersonation_sessions.values()) {
                if (s.operator_id === data.operator_id && s.status === "active") {
                  return {
                    select: () => ({
                      single: async () => ({
                        data: null,
                        error: { code: "23505", message: "Conflito de unicidade: sessão ativa já existente" },
                      }),
                    }),
                  }
                }
              }
            }
            const id = data.id || `sess-${Date.now()}-${Math.random()}`
            const record = { ...data, id }
            state.platform_impersonation_sessions.set(id, record)
            return {
              select: () => ({
                single: async () => ({ data: record, error: null }),
              }),
            }
          }
          if (table === "platform_audit_logs") {
            state.platform_audit_logs.push(data)
            return Promise.resolve({ data, error: null })
          }
          if (table === "messages") {
            state.messages.push(data)
            return Promise.resolve({ data, error: null })
          }
          return Promise.resolve({ data: pendingInsert, error: null })
        },
        update: (data: any) => {
          pendingUpdate = data
          const updateBuilder: any = {
            eq: (col: string, val: any) => {
              filters[col] = val
              return updateBuilder
            },
            select: () => updateBuilder,
            maybeSingle: async () => {
              const res = await updateBuilder
              return { data: res.data ? res.data[0] : null, error: null }
            },
            then: (resolve: any, reject: any) => {
              if (table === "platform_impersonation_sessions") {
                let affected: any = null
                for (const [id, s] of state.platform_impersonation_sessions.entries()) {
                  let match = true
                  if (filters.operator_id && s.operator_id !== filters.operator_id) match = false
                  if (filters.status && s.status !== filters.status) match = false
                  if (filters.session_token_hash && s.session_token_hash !== filters.session_token_hash) match = false
                  if (filters.id && s.id !== filters.id) match = false
                  if (match) {
                    const updated = { ...s, ...pendingUpdate }
                    state.platform_impersonation_sessions.set(id, updated)
                    affected = updated
                  }
                }
                return Promise.resolve({ data: affected ? [affected] : [], error: null }).then(resolve, reject)
              }
              if (table === "profiles") {
                const prof = state.profiles.get(filters.id)
                if (prof) {
                  const updated = { ...prof, ...pendingUpdate }
                  state.profiles.set(filters.id, updated)
                  return Promise.resolve({ data: [updated], error: null }).then(resolve, reject)
                }
              }
              if (table === "conversations") {
                const conv = state.conversations.get(filters.id)
                if (conv && (!filters.company_id || conv.company_id === filters.company_id)) {
                  const updated = { ...conv, ...pendingUpdate }
                  state.conversations.set(filters.id, updated)
                  return Promise.resolve({ data: [updated], error: null }).then(resolve, reject)
                }
              }
              return Promise.resolve({ data: [], error: null }).then(resolve, reject)
            },
          }
          return updateBuilder
        },
      }
      return builder
    },
    rpc: async (func: string, args: any) => {
      if (func === "start_impersonation_session_atomic") {
        // Valida operador
        const op = state.platform_admins.get(args.p_operator_id)
        if (!op || !op.active || op.role !== "superadmin") {
          return { data: null, error: { message: "Operador não autorizado" } }
        }
        // Valida empresa
        const comp = state.companies.get(args.p_target_company_id)
        if (!comp || comp.status === "suspended") {
          return { data: null, error: { message: "Empresa inválida ou suspensa" } }
        }
        // Atualiza anteriores
        for (const [id, s] of state.platform_impersonation_sessions.entries()) {
          if (s.operator_id === args.p_operator_id && s.status === "active") {
            const isExp = new Date(s.expires_at) <= new Date()
            state.platform_impersonation_sessions.set(id, {
              ...s,
              status: isExp ? "expired" : "revoked",
              revoked_at: isExp ? null : new Date().toISOString(),
              revocation_reason: isExp ? "EXPIRED_ON_ROTATION" : "SUPERSEDED_BY_NEW_SESSION",
            })
          }
        }
        // Insere nova
        const newId = `rpc-sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const record = {
          id: newId,
          operator_id: args.p_operator_id,
          target_company_id: args.p_target_company_id,
          session_token_hash: args.p_session_token_hash,
          auth_session_id: args.p_auth_session_id,
          status: "active",
          expires_at: args.p_expires_at,
          client_ip: args.p_client_ip,
          user_agent: args.p_user_agent,
          metadata: args.p_metadata,
        }
        state.platform_impersonation_sessions.set(newId, record)
        return {
          data: {
            session_id: newId,
            target_company_id: comp.id,
            target_company_name: comp.name,
            target_company_slug: comp.slug,
            expires_at: args.p_expires_at,
          },
          error: null,
        }
      }
      if (func === "terminate_impersonation_session_atomic") {
        for (const [id, s] of state.platform_impersonation_sessions.entries()) {
          if (s.session_token_hash === args.p_session_token_hash && s.status === "active") {
            const updated = {
              ...s,
              status: "revoked",
              revoked_at: new Date().toISOString(),
              revocation_reason: args.p_reason,
            }
            state.platform_impersonation_sessions.set(id, updated)
            return {
              data: {
                success: true,
                session_id: s.id,
                operator_id: s.operator_id,
                target_company_id: s.target_company_id,
              },
              error: null,
            }
          }
        }
        return { data: { success: false }, error: null }
      }
      return { data: null, error: { message: "Função não encontrada" } }
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (filePath: string, buffer: any, opts: any) => {
          state.storageUploads.push(filePath)
          return { error: null }
        },
        getPublicUrl: (filePath: string) => ({
          data: { publicUrl: `https://mock-storage.ellevee.ai/${bucket}/${filePath}` },
        }),
      }),
    },
  }
}

function buildMockUserClient(userId: string, email: string, accessToken?: string) {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: { id: userId, email },
        },
        error: null,
      }),
      getSession: async () => ({
        data: {
          session: accessToken
            ? {
                access_token: accessToken,
                user: { id: userId, email },
              }
            : null,
        },
        error: null,
      }),
    },
  }
}

// ==============================================================================
// BATERIA DE TESTES: AC-SEC-01.4-I2 INTEGRAÇÃO DAS SERVER ACTIONS
// ==============================================================================

describe("AC-SEC-01.4-I2 — Bateria de Testes de Integração Segura das Server Actions", () => {
  let db: MockState
  let mockAdminClient: any
  let superadminUserClient: any
  let attendantUserClient: any

  beforeEach(() => {
    clearMockCookies()
    db = createIntegrationMockDb()
    mockAdminClient = buildMockAdminClient(db)
    superadminUserClient = buildMockUserClient(SUPERADMIN_ID, "super@ellevee.ai", "token-super-auth-1")
    attendantUserClient = buildMockUserClient(ATTENDANT_USER_ID, "alice@empresa-a.com", "token-attendant-1")
  })

  test("1. Imutabilidade de profiles: start e stop impersonation NUNCA alteram profiles.company_id ou role", async () => {
    const profileBefore = { ...db.profiles.get(SUPERADMIN_ID) }
    assert.equal(profileBefore.company_id, OPERATOR_COMPANY_ID)
    assert.equal(profileBefore.role, "admin")

    // Inicia sessão para Empresa A
    const startRes = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_A,
      injectedAdminClient: mockAdminClient,
      injectedUserClient: superadminUserClient,
    })

    assert.equal(startRes.success, true)
    const profileDuring = db.profiles.get(SUPERADMIN_ID)
    assert.equal(profileDuring.company_id, OPERATOR_COMPANY_ID, "profiles.company_id DEVE permanecer inalterado!")
    assert.equal(profileDuring.role, "admin", "profiles.role DEVE permanecer inalterado!")

    // Encerra sessão
    await terminateImpersonationSession({
      injectedAdminClient: mockAdminClient,
    })

    const profileAfter = db.profiles.get(SUPERADMIN_ID)
    assert.equal(profileAfter.company_id, OPERATOR_COMPANY_ID, "profiles.company_id DEVE continuar imutável após stop!")
    assert.equal(profileAfter.role, "admin")
  })

  test("2. ContextGuard obrigatório em operações sensíveis durante suporte: Ausência é bloqueada com HTTP 403", async () => {
    // Inicia suporte para Empresa A
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-test-guard", {
      id: "sess-test-guard",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Tenta resolver contexto sensível SEM ContextGuard
    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          requireGuardIfImpersonating: true,
          injectedAdminClient: mockAdminClient,
          injectedUserClient: superadminUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "CONTEXT_GUARD_REQUIRED")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Operação sensível sem ContextGuard durante impersonação DEVE falhar fechada com 403 CONTEXT_GUARD_REQUIRED!"
    )
  })

  test("3. Sessões de abas diferentes na mesma empresa: Mismatch de expectedSessionId é bloqueado", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-current-active", {
      id: "sess-current-active",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Aba antiga esperava 'sess-old-tab' na mesma Empresa A
    const staleGuard: ContextGuard = {
      expectedCompanyId: TARGET_COMPANY_A,
      expectedSessionId: "sess-old-tab",
    }

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: staleGuard,
          requireGuardIfImpersonating: true,
          injectedAdminClient: mockAdminClient,
          injectedUserClient: superadminUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "TENANT_CONTEXT_MISMATCH")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Divergência de expectedSessionId entre abas DEVE ser sumariamente rejeitada!"
    )
  })

  test("4. Troca de empresa: Aba antiga (Empresa A) rejeitada se sessão mudou para Empresa B", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-empresa-b", {
      id: "sess-empresa-b",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_B, // Sessão ativa é na Empresa B
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Aba antiga tenta enviar mensagem esperando Empresa A
    const oldTabGuard: ContextGuard = {
      expectedCompanyId: TARGET_COMPANY_A,
      expectedSessionId: "sess-empresa-b",
    }

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: oldTabGuard,
          requireGuardIfImpersonating: true,
          injectedAdminClient: mockAdminClient,
          injectedUserClient: superadminUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "TENANT_CONTEXT_MISMATCH")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Aba com empresa defasada DEVE falhar fechada sem tocar na Empresa A nem na Empresa B!"
    )
  })

  test("5. Sessão revogada: Rejeição imediata com IMPERSONATION_SESSION_REVOKED", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-revoked", {
      id: "sess-revoked",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "revoked",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: { expectedCompanyId: TARGET_COMPANY_A, expectedSessionId: "sess-revoked" },
          requireGuardIfImpersonating: true,
          injectedAdminClient: mockAdminClient,
          injectedUserClient: superadminUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "IMPERSONATION_SESSION_REVOKED")
        assert.equal(err.statusCode, 403)
        return true
      }
    )
  })

  test("6. Sessão expirada por tempo limite (TTL): Rejeitada e marcada como 'expired' no banco", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-expired", {
      id: "sess-expired",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active", // Ainda marcada active, mas já expirou no relógio
      expires_at: new Date(Date.now() - 1000).toISOString(),
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: { expectedCompanyId: TARGET_COMPANY_A, expectedSessionId: "sess-expired" },
          injectedAdminClient: mockAdminClient,
          injectedUserClient: superadminUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "IMPERSONATION_SESSION_EXPIRED")
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    const updated = db.platform_impersonation_sessions.get("sess-expired")
    assert.equal(updated.status, "expired", "Sessão vencida deve ser marcada como 'expired'")
  })

  test("7. Vínculo confiável com Supabase Auth: Mismatch de authSessionId é sumariamente rejeitado", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-auth-bound", {
      id: "sess-auth-bound",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      auth_session_id: "hash-da-sessao-original-do-operador",
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Operador autenticado com outro JWT de acesso
    const changedAuthUserClient = buildMockUserClient(SUPERADMIN_ID, "super@ellevee.ai", "novo-token-jwt-outro-login")

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: { expectedCompanyId: TARGET_COMPANY_A, expectedSessionId: "sess-auth-bound" },
          injectedAdminClient: mockAdminClient,
          injectedUserClient: changedAuthUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "AUTH_SESSION_MISMATCH")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Sessão de suporte deve ser rejeitada se pertencer a outro token de autenticação Supabase!"
    )
  })

  test("8. Concorrência e Serialização: Iniciar nova sessão revoga atômica e serialmente a anterior", async () => {
    // 1ª Sessão
    const res1 = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_A,
      injectedAdminClient: mockAdminClient,
      injectedUserClient: superadminUserClient,
    })
    assert.equal(res1.success, true)
    const sess1Id = res1.data!.sessionId

    // 2ª Sessão disparada em seguida pelo mesmo operador
    const res2 = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_B,
      injectedAdminClient: mockAdminClient,
      injectedUserClient: superadminUserClient,
    })
    assert.equal(res2.success, true)
    const sess2Id = res2.data!.sessionId

    // Verifica que sess1 foi revogada com SUPERSEDED_BY_NEW_SESSION
    const sess1Db = db.platform_impersonation_sessions.get(sess1Id)
    assert.equal(sess1Db.status, "revoked")
    assert.equal(sess1Db.revocation_reason, "SUPERSEDED_BY_NEW_SESSION")

    // Verifica que sess2 está ativa
    const sess2Db = db.platform_impersonation_sessions.get(sess2Id)
    assert.equal(sess2Db.status, "active")
    assert.equal(sess2Db.target_company_id, TARGET_COMPANY_B)
  })

  test("9. Requisições em trânsito durante revogação: Falham fechadas com 403 e zero escritas", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-in-flight", {
      id: "sess-in-flight",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Simula revogação concorrente enquanto requisição estava em trânsito
    db.platform_impersonation_sessions.set("sess-in-flight", {
      ...db.platform_impersonation_sessions.get("sess-in-flight"),
      status: "revoked",
      revocation_reason: "EMERGENCY_REVOCATION",
    })

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          contextGuard: { expectedCompanyId: TARGET_COMPANY_A, expectedSessionId: "sess-in-flight" },
          requireGuardIfImpersonating: true,
          injectedAdminClient: mockAdminClient,
          injectedUserClient: superadminUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "IMPERSONATION_SESSION_REVOKED")
        return true
      }
    )
    assert.equal(db.messages.length, 0, "Zero mensagens devem ser inseridas no banco!")
  })

  test("10. RBAC e Prevenção de IDOR: Atendente comum com ContextGuard forjado para outro tenant é bloqueado", async () => {
    // Atendente Alice da Empresa A tenta executar passando ContextGuard da Empresa B
    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          contextGuard: { expectedCompanyId: TARGET_COMPANY_B },
          injectedAdminClient: mockAdminClient,
          injectedUserClient: attendantUserClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "TENANT_CONTEXT_MISMATCH")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Atendente não pode forjar expectedCompanyId para cruzar tenants!"
    )
  })

  test("11. Imunidade de Rotas de Plataforma: Rotas administrativas operam SEMPRE no perfil nativo", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)
    db.platform_impersonation_sessions.set("sess-platform", {
      id: "sess-platform",
      operator_id: SUPERADMIN_ID,
      target_company_id: TARGET_COMPANY_A,
      session_token_hash: tokenHash,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // SuperAdmin acessa rota imune /companies com cookie de suporte ativo
    const context = await resolveEffectiveSessionContext({
      pathname: "/companies",
      explicitToken: rawToken,
      injectedAdminClient: mockAdminClient,
      injectedUserClient: superadminUserClient,
    })

    assert.equal(context.isPlatformAdmin, true)
    assert.equal(context.isImpersonating, false, "Rotas /companies NÃO podem assumir contexto de impersonação!")
    assert.equal(context.effectiveCompanyId, OPERATOR_COMPANY_ID, "Deve preservar empresa matriz!")
  })

  test("12. Usuário normal sem impersonação: opera normalmente sem exigência de ContextGuard", async () => {
    // Atendente da Empresa A chamando operação normal (sem cookie de impersonação)
    const context = await resolveEffectiveSessionContext({
      requireGuardIfImpersonating: true, // flag ativada para ações sensíveis
      injectedAdminClient: mockAdminClient,
      injectedUserClient: attendantUserClient,
    })

    assert.equal(context.isImpersonating, false)
    assert.equal(context.effectiveCompanyId, TARGET_COMPANY_A)
    assert.equal(context.effectiveRole, "attendant")
  })
})
