process.env.NODE_ENV = "test"

import test, { describe, beforeEach } from "node:test"
import assert from "node:assert/strict"

import {
  extractAuthSessionId,
  generateOpaqueSessionToken,
  hashSessionToken,
  startImpersonationSession,
  resolveEffectiveSessionContext,
  ImpersonationError,
} from "@/lib/services/platform/impersonation"

import { clearMockCookies } from "./mocks/next-headers-mock.mjs"

// ==============================================================================
// UTILITÁRIO PARA CONSTRUÇÃO DE TOKENS JWT DO SUPABASE AUTH
// ==============================================================================

function buildSupabaseAuthJwt(payload: Record<string, any>): string {
  const header = { alg: "HS256", typ: "JWT" }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url")
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signatureB64 = Buffer.from("mock-jwt-signature-staging").toString("base64url")
  return `${headerB64}.${payloadB64}.${signatureB64}`
}

// ==============================================================================
// DADOS DETERMINÍSTICOS DE TESTE
// ==============================================================================

const OPERATOR_USER_ID = "00000000-0000-4000-a000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000099"
const OPERATOR_COMPANY_ID = "11111111-1111-4111-a111-111111111111"
const TARGET_COMPANY_ID = "22222222-2222-4222-a222-222222222222"
const STABLE_AUTH_SESSION_UUID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
const SECOND_AUTH_SESSION_UUID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"

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

  db.profiles.set(OPERATOR_USER_ID, {
    id: OPERATOR_USER_ID,
    company_id: OPERATOR_COMPANY_ID,
    role: "admin",
    full_name: "SuperAdmin Operador",
  })

  db.platform_admins.set(OPERATOR_USER_ID, {
    id: OPERATOR_USER_ID,
    role: "superadmin",
    active: true,
  })

  db.companies.set(OPERATOR_COMPANY_ID, {
    id: OPERATOR_COMPANY_ID,
    name: "Ellevee Matriz",
    slug: "ellevee-matriz",
    status: "active",
  })

  db.companies.set(TARGET_COMPANY_ID, {
    id: TARGET_COMPANY_ID,
    name: "Empresa Alvo Homologação",
    slug: "empresa-alvo",
    status: "active",
  })

  return db
}

function buildMockAdmin(db: MockDatabase) {
  return {
    from: (table: string) => {
      const filters: Record<string, any> = {}
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          filters[col] = val
          return builder
        },
        maybeSingle: async () => {
          if (table === "profiles") return { data: db.profiles.get(filters.id) || null, error: null }
          if (table === "platform_admins") return { data: db.platform_admins.get(filters.id) || null, error: null }
          if (table === "companies") return { data: db.companies.get(filters.id) || null, error: null }
          if (table === "platform_impersonation_sessions") {
            for (const s of db.platform_impersonation_sessions.values()) {
              if (filters.session_token_hash && s.session_token_hash !== filters.session_token_hash) continue
              if (filters.status && s.status !== filters.status) continue
              return { data: s, error: null }
            }
          }
          return { data: null, error: null }
        },
        insert: (data: any) => {
          if (table === "platform_impersonation_sessions") {
            const id = data.id || `sess-${Date.now()}`
            const record = { ...data, id }
            db.platform_impersonation_sessions.set(id, record)
            return {
              select: () => ({
                single: async () => ({ data: record, error: null }),
              }),
            }
          }
          if (table === "platform_audit_logs") {
            db.platform_audit_logs.push(data)
            return Promise.resolve({ data, error: null })
          }
          return Promise.resolve({ data, error: null })
        },
        update: (data: any) => {
          return {
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }
        },
      }
      return builder
    },
    rpc: async () => ({ data: null, error: { message: "RPC fallback para mock" } }),
  }
}

function buildMockUser(userId: string, email: string, token: string | null) {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: userId ? { id: userId, email } : null,
        },
        error: userId ? null : new Error("Not authenticated"),
      }),
      getSession: async () => ({
        data: {
          session: token
            ? {
                access_token: token,
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
// BATERIA DE TESTES: REFRESH DE JWT E ESTABILIDADE DE SESSÃO SUPABASE AUTH
// ==============================================================================

describe("AC-SEC-01.4-H1 — Validação de Estabilidade do JWT Refresh e Vínculo de Sessão", () => {
  let db: MockDatabase
  let adminClient: any

  beforeEach(() => {
    clearMockCookies()
    db = createMockDb()
    adminClient = buildMockAdmin(db)
  })

  test("1. extractAuthSessionId: extrai confiavelmente a claim session_id de um JWT real do Supabase", () => {
    const jwt = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: STABLE_AUTH_SESSION_UUID,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const extracted = extractAuthSessionId(jwt)
    assert.equal(extracted, STABLE_AUTH_SESSION_UUID, "Deve extrair exatamente a claim session_id do JWT!")
  })

  test("2. Compatibilidade total com Token Refresh: Access Token renovado preserva a sessão de suporte", async () => {
    // T0: Operador loga e recebe JWT v1
    const jwtV1 = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: STABLE_AUTH_SESSION_UUID,
      iat: 1000,
      exp: 4600,
    })

    const userClientV1 = buildMockUser(OPERATOR_USER_ID, "super@ellevee.ai", jwtV1)

    // Inicia sessão de suporte
    const startRes = await startImpersonationSession({
      targetCompanyId: TARGET_COMPANY_ID,
      injectedAdminClient: adminClient,
      injectedUserClient: userClientV1,
    })

    assert.equal(startRes.success, true)
    const sessionId = startRes.data!.sessionId
    const sessionInDb = db.platform_impersonation_sessions.get(sessionId)
    assert.equal(sessionInDb.auth_session_id, STABLE_AUTH_SESSION_UUID)

    // T1: 50 minutos depois, Supabase Auth executa refresh do JWT!
    // O novo access_token possui novos timestamps e string completamente diferente
    const jwtV2Refreshed = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: STABLE_AUTH_SESSION_UUID, // Mesma sessão de login mantida pelo GoTrue
      iat: 4000,
      exp: 7600,
    })
    assert.notEqual(jwtV1, jwtV2Refreshed, "O token de acesso DEVE ter mudado na renovação!")

    const userClientV2 = buildMockUser(OPERATOR_USER_ID, "super@ellevee.ai", jwtV2Refreshed)

    // Validação com o token renovado: DEVE TER SUCESSO e NÃO EXPIRAR a sessão
    const resolved = await resolveEffectiveSessionContext({
      injectedAdminClient: adminClient,
      injectedUserClient: userClientV2,
    })

    assert.equal(resolved.isImpersonating, true)
    assert.equal(resolved.effectiveCompanyId, TARGET_COMPANY_ID)
    assert.equal(resolved.userId, OPERATOR_USER_ID)
  })

  test("3. Ciclo completo de Start e Resolve através de Token Refresh sem perda de sessão", async () => {
    // 1. Emite sessão com token cru
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    const jwtT0 = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: STABLE_AUTH_SESSION_UUID,
      iat: 1000,
      exp: 4600,
    })

    db.platform_impersonation_sessions.set("sess-jwt-refresh", {
      id: "sess-jwt-refresh",
      operator_id: OPERATOR_USER_ID,
      target_company_id: TARGET_COMPANY_ID,
      session_token_hash: tokenHash,
      auth_session_id: STABLE_AUTH_SESSION_UUID,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // 2. Token refresh do Supabase (novo JWT emitido pelo GoTrue)
    const jwtT1 = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: STABLE_AUTH_SESSION_UUID,
      iat: 4000,
      exp: 7600,
    })

    const userClientRefreshed = buildMockUser(OPERATOR_USER_ID, "super@ellevee.ai", jwtT1)

    const context = await resolveEffectiveSessionContext({
      explicitToken: rawToken,
      injectedAdminClient: adminClient,
      injectedUserClient: userClientRefreshed,
      contextGuard: {
        expectedCompanyId: TARGET_COMPANY_ID,
        expectedSessionId: "sess-jwt-refresh",
      },
      requireGuardIfImpersonating: true,
    })

    assert.equal(context.isImpersonating, true)
    assert.equal(context.effectiveCompanyId, TARGET_COMPANY_ID)
    assert.equal(context.userId, OPERATOR_USER_ID)
  })

  test("4. Rejeição com 403 AUTH_SESSION_MISMATCH se o operador fizer login em outra sessão ou dispositivo", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-device-1", {
      id: "sess-device-1",
      operator_id: OPERATOR_USER_ID,
      target_company_id: TARGET_COMPANY_ID,
      session_token_hash: tokenHash,
      auth_session_id: STABLE_AUTH_SESSION_UUID, // Vinculado à sessão 1
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Requisição chega com JWT de outra sessão de login (sessão 2)
    const jwtDevice2 = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: SECOND_AUTH_SESSION_UUID, // Divergente!
      iat: 2000,
      exp: 5600,
    })

    const userClientDevice2 = buildMockUser(OPERATOR_USER_ID, "super@ellevee.ai", jwtDevice2)

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClientDevice2,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "AUTH_SESSION_MISMATCH")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Deve rejeitar com AUTH_SESSION_MISMATCH quando a sessão do Supabase divergir!"
    )
  })

  test("5. Rejeição imediata com 401 UNAUTHORICATED após Logout do operador (session: null)", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-logout", {
      id: "sess-logout",
      operator_id: OPERATOR_USER_ID,
      target_company_id: TARGET_COMPANY_ID,
      session_token_hash: tokenHash,
      auth_session_id: STABLE_AUTH_SESSION_UUID,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    // Cliente deslogado (sem sessão e sem usuário)
    const userClientLoggedOut = buildMockUser("", "", null)

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClientLoggedOut,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "UNAUTHENTICATED")
        assert.equal(err.statusCode, 401)
        return true
      },
      "Logout no Supabase DEVE revogar o acesso imediatamente com 401!"
    )
  })

  test("6. Rejeição se operador tentar utilizar sessão pertencente a outro operador", async () => {
    const rawToken = generateOpaqueSessionToken()
    const tokenHash = hashSessionToken(rawToken)

    db.platform_impersonation_sessions.set("sess-other-user", {
      id: "sess-other-user",
      operator_id: OTHER_USER_ID, // Pertence a outro operador
      target_company_id: TARGET_COMPANY_ID,
      session_token_hash: tokenHash,
      auth_session_id: STABLE_AUTH_SESSION_UUID,
      status: "active",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    })

    const jwtOperator = buildSupabaseAuthJwt({
      sub: OPERATOR_USER_ID,
      email: "super@ellevee.ai",
      session_id: STABLE_AUTH_SESSION_UUID,
    })

    const userClient = buildMockUser(OPERATOR_USER_ID, "super@ellevee.ai", jwtOperator)

    await assert.rejects(
      async () => {
        await resolveEffectiveSessionContext({
          explicitToken: rawToken,
          injectedAdminClient: adminClient,
          injectedUserClient: userClient,
        })
      },
      (err: ImpersonationError) => {
        assert.equal(err.code, "FORBIDDEN_NOT_PLATFORM_ADMIN")
        assert.equal(err.statusCode, 403)
        return true
      },
      "Sessão de suporte pertencente a outro operador deve ser categoricamente bloqueada!"
    )
  })

  test("7. Fallback determinístico para tokens sintéticos de teste (não-JWT)", () => {
    const mockToken = "token-super-auth-1"
    const extracted = extractAuthSessionId(mockToken)
    assert.ok(extracted)
    assert.equal(extracted.length, 32, "Deve retornar hash de 32 caracteres para strings não-JWT")

    // Idempotência
    const extracted2 = extractAuthSessionId(mockToken)
    assert.equal(extracted, extracted2)
  })
})
