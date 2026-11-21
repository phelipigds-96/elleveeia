// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import { setMockCookies, clearMockCookies } from './mocks/next-headers-mock.mjs'

import {
  getConversationMessages,
  getAgentProfileContext
} from '@/app/(dashboard)/conversations/actions'
import { getDashboardData } from '@/lib/services/dashboard'
import { getImpersonateStatus } from '@/app/(admin)/companies/actions'
import { POST as uploadChatMedia } from '@/app/api/chat/upload/route'

// IDs de teste bem-formados (UUID v4)
const COMPANY_A = '11111111-1111-4111-8111-111111111111'
const COMPANY_B = '22222222-2222-4222-8222-222222222222'
const COMPANY_SUSPENDED = '33333333-3333-4333-8333-333333333333'

const USER_A_ATTENDANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_A_ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad'
const USER_B_ATTENDANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_NO_COMPANY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const USER_SUPERADMIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const USER_SUPERADMIN_INACTIVE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const CONV_A_UNASSIGNED = 'a0000000-0000-4000-8000-000000000001'
const CONV_A_ASSIGNED_USER_A = 'a0000000-0000-4000-8000-000000000002'
const CONV_A_ASSIGNED_OTHER = 'a0000000-0000-4000-8000-000000000003'
const CONV_B_UNASSIGNED = 'b0000000-0000-4000-8000-000000000001'

let lastStorageUploadPath = null

/**
 * Cria banco de dados mock para testar autorização em profundidade
 */
function createSecurityMockDb(options = {}) {
  const currentUser = options.currentUser || null

  const companiesDb = {
    [COMPANY_A]: { id: COMPANY_A, name: 'Empresa A Alvo', slug: 'empresa-a', plan_tier: 'Pro', status: 'active' },
    [COMPANY_B]: { id: COMPANY_B, name: 'Empresa B Vítima', slug: 'empresa-b', plan_tier: 'Enterprise', status: 'active' },
    [COMPANY_SUSPENDED]: { id: COMPANY_SUSPENDED, name: 'Empresa Suspensa', slug: 'empresa-suspensa', plan_tier: 'Starter', status: 'suspended' },
  }

  const profilesDb = {
    [USER_A_ATTENDANT]: { id: USER_A_ATTENDANT, company_id: COMPANY_A, role: 'attendant', full_name: 'Atendente Alice' },
    [USER_A_ADMIN]: { id: USER_A_ADMIN, company_id: COMPANY_A, role: 'admin', full_name: 'Admin André' },
    [USER_B_ATTENDANT]: { id: USER_B_ATTENDANT, company_id: COMPANY_B, role: 'attendant', full_name: 'Atendente Bob' },
    [USER_NO_COMPANY]: { id: USER_NO_COMPANY, company_id: null, role: 'attendant', full_name: 'Sem Empresa' },
    [USER_SUPERADMIN]: { id: USER_SUPERADMIN, company_id: COMPANY_A, role: 'superadmin', full_name: 'Super Operador' },
    [USER_SUPERADMIN_INACTIVE]: { id: USER_SUPERADMIN_INACTIVE, company_id: COMPANY_A, role: 'superadmin', full_name: 'Super Inativo' },
  }

  const platformAdminsDb = {
    [USER_SUPERADMIN]: { id: USER_SUPERADMIN, role: 'superadmin', active: true, email: 'super@ellevee.ai' },
    [USER_SUPERADMIN_INACTIVE]: { id: USER_SUPERADMIN_INACTIVE, role: 'superadmin', active: false, email: 'inactive@ellevee.ai' },
  }

  const conversationsDb = {
    [CONV_A_UNASSIGNED]: { id: CONV_A_UNASSIGNED, company_id: COMPANY_A, assigned_to: null, status: 'open' },
    [CONV_A_ASSIGNED_USER_A]: { id: CONV_A_ASSIGNED_USER_A, company_id: COMPANY_A, assigned_to: USER_A_ATTENDANT, status: 'open' },
    [CONV_A_ASSIGNED_OTHER]: { id: CONV_A_ASSIGNED_OTHER, company_id: COMPANY_A, assigned_to: '99999999-9999-4999-8999-999999999999', status: 'open' },
    [CONV_B_UNASSIGNED]: { id: CONV_B_UNASSIGNED, company_id: COMPANY_B, assigned_to: null, status: 'open' },
  }

  const messagesDb = [
    { id: 'm1', company_id: COMPANY_A, conversation_id: CONV_A_UNASSIGNED, sender_type: 'customer', content: 'Olá Empresa A' },
    { id: 'm2', company_id: COMPANY_A, conversation_id: CONV_A_ASSIGNED_USER_A, sender_type: 'customer', content: 'Mensagem Alice' },
    { id: 'm3', company_id: COMPANY_A, conversation_id: CONV_A_ASSIGNED_OTHER, sender_type: 'customer', content: 'Mensagem Outro Atendente' },
    { id: 'm4', company_id: COMPANY_B, conversation_id: CONV_B_UNASSIGNED, sender_type: 'customer', content: 'Segredo Empresa B' },
  ]

  function makeChain(table) {
    const filters = {}
    let limitVal = null
    let orderCol = null

    const chain = {
      select: () => chain,
      eq: (col, val) => { filters[col] = val; return chain },
      order: (col) => { orderCol = col; return chain },
      limit: (n) => { limitVal = n; return chain },
      single: async () => chain.maybeSingle(),
      maybeSingle: async () => {
        if (table === 'profiles') {
          const prof = profilesDb[filters.id]
          if (!prof) return { data: null, error: { message: 'Profile not found' } }
          const comp = prof.company_id ? companiesDb[prof.company_id] : null
          return { data: { ...prof, companies: comp ? [comp] : [] }, error: null }
        }
        if (table === 'platform_admins') {
          const admin = platformAdminsDb[filters.id]
          if (!admin) return { data: null, error: null }
          return { data: admin, error: null }
        }
        if (table === 'companies') {
          const comp = companiesDb[filters.id]
          if (!comp) return { data: null, error: null }
          return { data: comp, error: null }
        }
        if (table === 'conversations') {
          const conv = conversationsDb[filters.id]
          if (!conv) return { data: null, error: null }
          if (filters.company_id && conv.company_id !== filters.company_id) return { data: null, error: null }
          return { data: conv, error: null }
        }
        return { data: null, error: null }
      },
      then: (resolve, reject) => {
        Promise.resolve().then(() => {
          if (table === 'messages') {
            const res = messagesDb.filter(m => {
              if (filters.conversation_id && m.conversation_id !== filters.conversation_id) return false
              if (filters.company_id && m.company_id !== filters.company_id) return false
              return true
            })
            return { data: res, error: null }
          }
          if (table === 'conversations') {
            const list = Object.values(conversationsDb).filter(c => {
              if (filters.company_id && c.company_id !== filters.company_id) return false
              return true
            })
            return { data: list, error: null }
          }
          return { data: [], error: null }
        }).then(resolve, reject)
      }
    }
    return chain
  }

  return {
    from: (table) => makeChain(table),
    auth: {
      getUser: async () => {
        if (!currentUser) {
          return { data: { user: null }, error: new Error('Sessão inexistente') }
        }
        return {
          data: {
            user: {
              id: currentUser.id,
              email: currentUser.email || 'user@test.com'
            }
          },
          error: null
        }
      }
    },
    storage: {
      from: (bucket) => ({
        upload: async (filePath, buffer, options) => {
          lastStorageUploadPath = filePath
          return { data: { path: filePath }, error: null }
        },
        getPublicUrl: (filePath) => ({
          data: { publicUrl: `https://mock.storage/${bucket}/${filePath}` }
        })
      })
    }
  }
}

describe('AC-SEC-01.3 — Bateria de Testes de Segurança e Autorização Emergencial', () => {
  beforeEach(() => {
    clearMockCookies()
    lastStorageUploadPath = null
  })

  // ==========================================================================
  // PILAR A: getConversationMessages (Isolamento Multi-Tenant e RBAC)
  // ==========================================================================
  describe('Pilar A — getConversationMessages (Isolamento Multi-Tenant e RBAC)', () => {
    test('A.1 Requisição Não-Autenticada (Sem Sessão): Falha fechado e retorna [] sem vazar mensagens', async () => {
      const mock = createSecurityMockDb({ currentUser: null })
      setMockSupabaseClient(mock)

      const result = await getConversationMessages(CONV_A_UNASSIGNED)
      assert.deepEqual(result, [], 'Deve retornar array vazio para chamadas anônimas')
    })

    test('A.2 Usuário sem perfil ou empresa vinculada: Falha fechado com []', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_NO_COMPANY, email: 'nocompany@test.com' }
      })
      setMockSupabaseClient(mock)

      const result = await getConversationMessages(CONV_A_UNASSIGNED)
      assert.deepEqual(result, [], 'Usuário sem empresa vinculada não deve ter acesso a nenhuma conversa')
    })

    test('A.3 Tentativa de IDOR Cross-Tenant: Atendente da Empresa A tenta ler conversa da Empresa B -> Bloqueado com []', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      // Conversa pertence à Empresa B, atendente pertence à Empresa A
      const result = await getConversationMessages(CONV_B_UNASSIGNED)
      assert.deepEqual(result, [], 'Conversa pertencente a outro tenant DEVE retornar array vazio')
    })

    test('A.4 RBAC de Atendente: Atendente Alice tenta acessar conversa atribuída a outro atendente -> Bloqueado com []', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      // Conversa pertence à Empresa A, mas está atribuída a outro operador
      const result = await getConversationMessages(CONV_A_ASSIGNED_OTHER)
      assert.deepEqual(result, [], 'Atendente comum NÃO pode ler conversas atribuídas a colegas')
    })

    test('A.5 RBAC de Atendente: Atendente Alice acessa conversa não atribuída (fila geral) -> Permitido', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      const result = await getConversationMessages(CONV_A_UNASSIGNED)
      assert.equal(result.length, 1)
      assert.equal(result[0].content, 'Olá Empresa A')
      assert.equal(result[0].company_id, COMPANY_A)
    })

    test('A.6 RBAC de Atendente: Atendente Alice acessa conversa atribuída a si mesma -> Permitido', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      const result = await getConversationMessages(CONV_A_ASSIGNED_USER_A)
      assert.equal(result.length, 1)
      assert.equal(result[0].content, 'Mensagem Alice')
      assert.equal(result[0].company_id, COMPANY_A)
    })

    test('A.7 Papel Elevado (Admin): Administrador André pode visualizar qualquer conversa do seu tenant', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ADMIN, email: 'andre@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      // Conversa atribuída a outro atendente, mas André é Admin da Empresa A
      const result = await getConversationMessages(CONV_A_ASSIGNED_OTHER)
      assert.equal(result.length, 1)
      assert.equal(result[0].content, 'Mensagem Outro Atendente')
      assert.equal(result[0].company_id, COMPANY_A)
    })

    test('A.8 Identificador de conversa malicioso ou inválido (SQLi / path traversal) é rejeitado com []', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ADMIN, email: 'andre@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      assert.deepEqual(await getConversationMessages("'; DROP TABLE messages; --"), [])
      assert.deepEqual(await getConversationMessages('../../etc/passwd'), [])
      assert.deepEqual(await getConversationMessages(''), [])
      assert.deepEqual(await getConversationMessages(null), [])
    })
  })

  // ==========================================================================
  // PILAR B: getAuthenticatedAgentContext (Neutralização de Cookie Forjado)
  // ==========================================================================
  describe('Pilar B — getAuthenticatedAgentContext (Neutralização de Forjamento)', () => {
    test('B.1 Atendente comum com cookie ellevee_impersonate_active forjado para Empresa B: Cookie IGNORADO', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      // Atendente comum tenta injetar cookie apontando para Empresa B
      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const context = await getAgentProfileContext()
      assert.equal(context.companyId, COMPANY_A, 'Cookie forjado por atendente DEVE ser sumariamente ignorado')
      assert.equal(context.role, 'attendant', 'Role não deve ser promovida para admin')
      assert.equal(context.userId, USER_A_ATTENDANT)
    })

    test('B.2 Admin do tenant com cookie ellevee_impersonate_active forjado para Empresa B: Cookie IGNORADO', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ADMIN, email: 'admin@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const context = await getAgentProfileContext()
      assert.equal(context.companyId, COMPANY_A, 'Tenant admin NÃO é SuperAdmin da plataforma; cookie DEVE ser ignorado')
      assert.equal(context.role, 'admin')
    })

    test('B.3 Usuário sem autenticação: Falha fechada com exceção UNAUTHENTICATED', async () => {
      const mock = createSecurityMockDb({ currentUser: null })
      setMockSupabaseClient(mock)

      await assert.rejects(
        async () => { await getAgentProfileContext() },
        (err) => {
          assert.match(err.message, /UNAUTHENTICATED/i)
          return true
        }
      )
    })

    test('B.4 SuperAdmin ativo legítimo com cookie de impersonação: Impersonação respeitada com role admin', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_SUPERADMIN, email: 'super@ellevee.ai' }
      })
      setMockSupabaseClient(mock)

      // SuperAdmin legítimo impersonando Empresa B
      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const context = await getAgentProfileContext()
      assert.equal(context.companyId, COMPANY_B, 'SuperAdmin ativo com cookie válido DEVE operar na empresa impersonada')
      assert.equal(context.role, 'admin')
    })

    test('B.5 SuperAdmin inativo (active: false) tentando impersonar: Cookie IGNORADO', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_SUPERADMIN_INACTIVE, email: 'inactive@ellevee.ai' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const context = await getAgentProfileContext()
      assert.equal(context.companyId, COMPANY_A, 'Operador inativo NÃO tem autorização para impersonar')
    })
  })

  // ==========================================================================
  // PILAR C: getDashboardData (Remoção de Insecure Fallback e Proteção de Métricas)
  // ==========================================================================
  describe('Pilar C — getDashboardData (Eliminação do Fallback para Primeira Empresa)', () => {
    test('C.1 Usuário não autenticado: Retorna fallbackData zerado sem consultar métricas de nenhuma empresa', async () => {
      const mock = createSecurityMockDb({ currentUser: null })
      setMockSupabaseClient(mock)

      const data = await getDashboardData('today')
      assert.equal(data.companyInfo.id, '', 'Não deve retornar ID de nenhuma empresa')
      assert.equal(data.metrics.total_conversations, 0)
    })

    test('C.2 Usuário com conta sem empresa associada: Retorna fallbackData zerado, sem consultar firstCompany', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_NO_COMPANY, email: 'nocompany@test.com' }
      })
      setMockSupabaseClient(mock)

      const data = await getDashboardData('today')
      assert.equal(data.companyInfo.id, '', 'Usuário sem empresa NÃO deve cair na primeira empresa do banco')
    })

    test('C.3 Atendente comum com cookie forjado para Empresa B: Cookie IGNORADO, exibe Empresa A', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const data = await getDashboardData('today')
      assert.equal(data.companyInfo.id, COMPANY_A, 'Dashboard deve carregar estritamente a empresa real do atendente')
      assert.equal(data.companyInfo.name, 'Empresa A Alvo')
    })

    test('C.4 SuperAdmin ativo com cookie de impersonação para Empresa B: Dashboard carrega dados da Empresa B', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_SUPERADMIN, email: 'super@ellevee.ai' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const data = await getDashboardData('today')
      assert.equal(data.companyInfo.id, COMPANY_B, 'SuperAdmin visualiza métricas da empresa impersonada')
      assert.equal(data.companyInfo.name, 'Empresa B Vítima')
    })
  })

  // ==========================================================================
  // PILAR D: getImpersonateStatus (Proteção do Endpoint Administrativo)
  // ==========================================================================
  describe('Pilar D — getImpersonateStatus (Autorização Estrita de Plataforma)', () => {
    test('D.1 Visitante anônimo: Retorna { isImpersonating: false } sem erro e sem vazar nomes', async () => {
      const mock = createSecurityMockDb({ currentUser: null })
      setMockSupabaseClient(mock)

      const status = await getImpersonateStatus()
      assert.deepEqual(status, { isImpersonating: false })
    })

    test('D.2 Atendente comum com cookie de impersonação ativo: Retorna { isImpersonating: false }', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const status = await getImpersonateStatus()
      assert.deepEqual(status, { isImpersonating: false }, 'Atendente não pode consultar status nem nome de empresas impersonadas')
    })

    test('D.3 SuperAdmin inativo: Retorna { isImpersonating: false }', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_SUPERADMIN_INACTIVE, email: 'inactive@ellevee.ai' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const status = await getImpersonateStatus()
      assert.deepEqual(status, { isImpersonating: false })
    })

    test('D.4 SuperAdmin ativo com cookie: Retorna status positivo com dados da empresa alvo', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_SUPERADMIN, email: 'super@ellevee.ai' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const status = await getImpersonateStatus()
      assert.equal(status.isImpersonating, true)
      assert.equal(status.targetCompanyId, COMPANY_B)
      assert.equal(status.targetCompanyName, 'Empresa B Vítima')
      assert.equal(status.targetCompanySlug, 'empresa-b')
    })
  })

  // ==========================================================================
  // PILAR E: POST /api/chat/upload (Eliminação de Tenant Fixo e Isolamento de Storage)
  // ==========================================================================
  describe('Pilar E — POST /api/chat/upload (Eliminação de Tenant Fixo e Isolamento de Storage)', () => {
    test('E.1 Visitante não-autenticado é rejeitado com HTTP 401', async () => {
      const mock = createSecurityMockDb({ currentUser: null })
      setMockSupabaseClient(mock)

      const formData = new FormData()
      formData.append('file', new Blob(['test-content'], { type: 'text/plain' }), 'test.txt')

      const req = new NextRequest('http://localhost:3000/api/chat/upload', {
        method: 'POST',
        body: formData
      })

      const res = await uploadChatMedia(req)
      assert.equal(res.status, 401)
      const json = await res.json()
      assert.equal(json.success, false)
      assert.match(json.error, /Não autorizado|sessão/i)
      assert.equal(lastStorageUploadPath, null, 'Nenhum arquivo gravado no storage')
    })

    test('E.2 Usuário sem empresa associada é rejeitado com HTTP 403 (Zero fallback para 00000000-0000-0000-0000-000000000001)', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_NO_COMPANY, email: 'nocompany@test.com' }
      })
      setMockSupabaseClient(mock)

      const formData = new FormData()
      formData.append('file', new Blob(['test-content'], { type: 'text/plain' }), 'test.txt')

      const req = new NextRequest('http://localhost:3000/api/chat/upload', {
        method: 'POST',
        body: formData
      })

      const res = await uploadChatMedia(req)
      assert.equal(res.status, 403)
      const json = await res.json()
      assert.equal(json.success, false)
      assert.match(json.error, /empresa não vinculada/i)
      assert.equal(lastStorageUploadPath, null, 'Nenhum arquivo gravado no storage')
    })

    test('E.3 Atendente da Empresa A com cookie forjado para Empresa B grava estritamente na pasta da Empresa A', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      // Cookie forjado tentando gravar no bucket da Empresa B
      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const formData = new FormData()
      formData.append('file', new Blob(['relatorio-secreto'], { type: 'text/plain' }), 'relatorio.txt')

      const req = new NextRequest('http://localhost:3000/api/chat/upload', {
        method: 'POST',
        body: formData
      })

      const res = await uploadChatMedia(req)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.success, true)

      // O arquivo DEVE ter sido gravado sob a pasta da Empresa A, NUNCA Empresa B nem default fixo
      assert(lastStorageUploadPath.startsWith(`${COMPANY_A}/`), `Upload deve iniciar com ${COMPANY_A}/, recebido: ${lastStorageUploadPath}`)
      assert(!lastStorageUploadPath.startsWith(`${COMPANY_B}/`), 'Upload NUNCA deve cair na Empresa B através de cookie forjado')
      assert(!lastStorageUploadPath.includes('00000000-0000-0000-0000-000000000001'), 'Tenant fixo legado deve estar 100% extinto')
    })

    test('E.4 SuperAdmin ativo com impersonação legítima grava na pasta da empresa impersonada', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_SUPERADMIN, email: 'super@ellevee.ai' }
      })
      setMockSupabaseClient(mock)

      setMockCookies({ ellevee_impersonate_active: COMPANY_B })

      const formData = new FormData()
      formData.append('file', new Blob(['super-admin-upload'], { type: 'text/plain' }), 'documento.pdf')

      const req = new NextRequest('http://localhost:3000/api/chat/upload', {
        method: 'POST',
        body: formData
      })

      const res = await uploadChatMedia(req)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.success, true)
      assert(lastStorageUploadPath.startsWith(`${COMPANY_B}/`), `SuperAdmin impersonando deve gravar na pasta de ${COMPANY_B}`)
    })

    test('E.5 Requisição POST sem arquivo retorna HTTP 400', async () => {
      const mock = createSecurityMockDb({
        currentUser: { id: USER_A_ATTENDANT, email: 'alice@empresa-a.com' }
      })
      setMockSupabaseClient(mock)

      const formData = new FormData()

      const req = new NextRequest('http://localhost:3000/api/chat/upload', {
        method: 'POST',
        body: formData
      })

      const res = await uploadChatMedia(req)
      assert.equal(res.status, 400)
      const json = await res.json()
      assert.equal(json.success, false)
      assert.match(json.error, /Nenhum arquivo/i)
    })
  })
})
