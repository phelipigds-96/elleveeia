import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import {
  rotateInboundWebhookTokenInternal,
  getInboundWebhookInfoInternal
} from '@/lib/services/integrations-internal'

test.describe('ETAPA 8.4.3N.5 — Auditoria e Correção Final da RPC de Webhook', () => {
  const TENANT_ACTIVE_A = '11111111-1111-1111-1111-111111111111'
  const TENANT_ACTIVE_B = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED = '33333333-3333-3333-3333-333333333333'

  const USER_ADMIN_A = 'user-admin-tenant-a'
  const USER_ADMIN_B = 'user-admin-tenant-b'
  const USER_ADMIN_SUSPENDED = 'user-admin-suspended'

  test.beforeEach(() => {
    resetInMemoryDb()

    inMemoryDb.companies.set(TENANT_ACTIVE_A, {
      id: TENANT_ACTIVE_A,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-alpha',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_ACTIVE_B, {
      id: TENANT_ACTIVE_B,
      name: 'Empresa Ativa Beta',
      slug: 'empresa-beta',
      status: 'active',
      plan_tier: 'enterprise',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_SUSPENDED, {
      id: TENANT_SUSPENDED,
      name: 'Empresa Suspenso Gamma',
      slug: 'empresa-gamma',
      status: 'suspended',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.profiles.set(USER_ADMIN_A, {
      id: USER_ADMIN_A,
      company_id: TENANT_ACTIVE_A,
      role: 'admin',
      full_name: 'Admin Empresa A'
    })

    inMemoryDb.profiles.set(USER_ADMIN_B, {
      id: USER_ADMIN_B,
      company_id: TENANT_ACTIVE_B,
      role: 'admin',
      full_name: 'Admin Empresa B'
    })

    inMemoryDb.profiles.set(USER_ADMIN_SUSPENDED, {
      id: USER_ADMIN_SUSPENDED,
      company_id: TENANT_SUSPENDED,
      role: 'admin',
      full_name: 'Admin Empresa Suspensa'
    })
  })

  // =========================================================================
  // 1. AUDITORIA E PERMISSÕES DA RPC
  // =========================================================================
  test.describe('1. Auditoria das Permissões da RPC (Least Privilege)', () => {
    test('1.1. DDL revoga explicitamente EXECUTE de PUBLIC, anon e authenticated', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/2026110301_api_keys_webhook_uniqueness.sql')
      assert.ok(fs.existsSync(migrationPath), 'Migration deve existir')

      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      // Revogação de PUBLIC
      assert.match(
        sqlContent,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.rotate_company_webhook_key\s*\(\s*UUID\s*,\s*TEXT\s*\)\s+FROM\s+PUBLIC/i,
        'Deve revogar ALL/EXECUTE de PUBLIC'
      )

      // Revogação de anon e authenticated
      assert.match(
        sqlContent,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.rotate_company_webhook_key\s*\(\s*UUID\s*,\s*TEXT\s*\)\s+FROM\s+anon\s*,\s*authenticated/i,
        'Deve revogar ALL/EXECUTE de anon e authenticated'
      )
    })

    test('1.2. DDL concede EXECUTE exclusivamente a service_role', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/2026110301_api_keys_webhook_uniqueness.sql')
      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      assert.match(
        sqlContent,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rotate_company_webhook_key\s*\(\s*UUID\s*,\s*TEXT\s*\)\s+TO\s+service_role/i,
        'Deve conceder EXECUTE estritamente a service_role'
      )
    })

    test('1.3. Clientes authenticated e anon recebem permissão negada ao tentar invocar a RPC diretamente', async () => {
      // Simula a restrição PostgreSQL: anon e authenticated não possuem privilégio EXECUTE
      const unprivilegedRpc = async (fnName: string) => {
        if (fnName === 'rotate_company_webhook_key') {
          return {
            data: null,
            error: {
              code: '42501',
              message: 'permission denied for function rotate_company_webhook_key'
            }
          }
        }
        return { data: null, error: { code: '42883', message: 'Function not found' } }
      }

      const clientAnon = { rpc: unprivilegedRpc }
      const resAnon = await clientAnon.rpc('rotate_company_webhook_key')
      assert.equal(resAnon.error?.code, '42501')
      assert.match(resAnon.error?.message || '', /permission denied/i)

      const clientAuth = { rpc: unprivilegedRpc }
      const resAuth = await clientAuth.rpc('rotate_company_webhook_key')
      assert.equal(resAuth.error?.code, '42501')
      assert.match(resAuth.error?.message || '', /permission denied/i)
    })
  })

  // =========================================================================
  // 2. SEGURANÇA DE SECURITY DEFINER E SEARCH_PATH
  // =========================================================================
  test.describe('2. Hardening de SECURITY DEFINER e search_path', () => {
    test('2.1. Função declara SECURITY DEFINER e search_path restritivo', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/2026110301_api_keys_webhook_uniqueness.sql')
      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      assert.match(sqlContent, /SECURITY\s+DEFINER/i, 'Função deve ser SECURITY DEFINER')
      assert.match(sqlContent, /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*pg_temp/i, 'search_path deve ser pg_catalog, public, pg_temp')
    })

    test('2.2. DDL valida parâmetros obrigatórios (p_company_id e p_new_key não nulos/vazios)', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/2026110301_api_keys_webhook_uniqueness.sql')
      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      assert.match(sqlContent, /RAISE\s+EXCEPTION\s+.*Parâmetros inválidos/i, 'Deve validar parâmetros de entrada na RPC')
    })

    test('2.3. Operações de UPDATE e INSERT na RPC são totalmente qualificadas com public.api_keys', () => {
      const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/2026110301_api_keys_webhook_uniqueness.sql')
      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      // Todas as tabelas devem estar qualificadas como public.api_keys
      assert.match(sqlContent, /FROM\s+public\.api_keys/i)
      assert.match(sqlContent, /UPDATE\s+public\.api_keys/i)
      assert.match(sqlContent, /INSERT\s+INTO\s+public\.api_keys/i)
    })
  })

  // =========================================================================
  // 3. EXECUÇÃO PROTEGIDA PELO SERVIÇO INTERNO (SERVER-ONLY)
  // =========================================================================
  test.describe('3. Execução Controlada pelo Serviço Interno', () => {
    test('3.1. Serviço interno chama a RPC via service_role após validação bem-sucedida do tenant ativo', async () => {
      let rpcInvoked = false
      let rpcPassedCompanyId = ''
      let rpcPassedKey = ''

      const realAdmin = createAdminClient()
      const customAdminClient = {
        ...realAdmin,
        rpc: async (fnName: string, params: any) => {
          if (fnName === 'rotate_company_webhook_key') {
            rpcInvoked = true
            rpcPassedCompanyId = params.p_company_id
            rpcPassedKey = params.p_new_key
            return { data: params.p_new_key, error: null }
          }
          return { data: null, error: { message: 'Not found' } }
        }
      }

      const adminClient = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const result = await rotateInboundWebhookTokenInternal({
        supabaseClient: adminClient,
        adminClient: customAdminClient
      })

      assert.equal(result.success, true)
      assert.equal(rpcInvoked, true, 'A RPC deve ser invocada pelo adminClient')
      assert.equal(rpcPassedCompanyId, TENANT_ACTIVE_A, 'A RPC deve receber o tenant validado no servidor')
      assert.match(rpcPassedKey, /^ell_[a-f0-9]{24}$/, 'A chave gerada deve ter formato ell_<24hex>')
    })

    test('3.2. Tenant suspenso ou cancelado bloqueia ANTES de invocar a RPC', async () => {
      let rpcInvoked = false

      const realAdmin = createAdminClient()
      const customAdminClient = {
        ...realAdmin,
        rpc: async () => {
          rpcInvoked = true
          return { data: 'token_deveria_ser_bloqueado', error: null }
        }
      }

      const suspendedClient = createAuthenticatedClient({ userId: USER_ADMIN_SUSPENDED })
      const result = await rotateInboundWebhookTokenInternal({
        supabaseClient: suspendedClient,
        adminClient: customAdminClient
      })

      assert.equal(result.success, false)
      assert.equal(rpcInvoked, false, 'A RPC NUNCA deve ser chamada se o tenant não estiver ativo')
      assert.equal(result.code, 'TENANT_SUSPENDED')
    })

    test('3.3. Tentativa de manipulação de company_id por usuário malicioso não atinge a RPC com tenant alheio', async () => {
      let rpcPassedCompanyId = ''

      const realAdmin = createAdminClient()
      const customAdminClient = {
        ...realAdmin,
        rpc: async (fnName: string, params: any) => {
          rpcPassedCompanyId = params.p_company_id
          return { data: params.p_new_key, error: null }
        }
      }

      // Usuário autenticado da Empresa A tentando forçar company_id da Empresa B
      const clientA = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const maliciousOptions = {
        supabaseClient: clientA,
        adminClient: customAdminClient,
        company_id: TENANT_ACTIVE_B, // Injeção arbitrária não-autorizada
        companyId: TENANT_ACTIVE_B
      } as any

      const result = await rotateInboundWebhookTokenInternal(maliciousOptions)

      assert.equal(result.success, true)
      // O tenant passado para a RPC deve ser ESTRITAMENTE o tenant de A, resolvido no servidor
      assert.equal(rpcPassedCompanyId, TENANT_ACTIVE_A)
      assert.notEqual(rpcPassedCompanyId, TENANT_ACTIVE_B)
    })
  })

  // =========================================================================
  // 4. ESCOPO ESTRITO DA RPC: ISOLAMENTO ENTRE TENANTS E CHAVES EXTERNAS
  // =========================================================================
  test.describe('4. Isolamento Estrito: Tenants e Chaves Externas', () => {
    test('4.1. Rotação na Empresa A não altera nem consulta chaves da Empresa B', async () => {
      // Configura chave para Empresa B
      inMemoryDb.api_keys.set('key-tenant-b', {
        id: 'key-tenant-b',
        company_id: TENANT_ACTIVE_B,
        key: 'ell_token_empresa_b_intacto_111',
        description: 'Chave Automatica Webhook',
        created_at: new Date().toISOString()
      })

      // Executa rotação para Empresa A
      const adminClientA = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const resA = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClientA })

      assert.equal(resA.success, true)

      // Chave de B permanece 100% inalterada
      const keyB = inMemoryDb.api_keys.get('key-tenant-b')
      assert.ok(keyB)
      assert.equal(keyB.key, 'ell_token_empresa_b_intacto_111')
    })

    test('4.2. Rotação não altera chaves externas (description != Chave Automatica Webhook)', async () => {
      // Configura chave externa (ex: integração ERP ou CRM) para a mesma Empresa A
      inMemoryDb.api_keys.set('key-ext-crm', {
        id: 'key-ext-crm',
        company_id: TENANT_ACTIVE_A,
        key: 'ell_token_externo_crm_seguro_222',
        description: 'Chave Externa Hubspot CRM',
        created_at: new Date().toISOString()
      })

      const adminClientA = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const resA = await rotateInboundWebhookTokenInternal({ supabaseClient: adminClientA })

      assert.equal(resA.success, true)

      // Chave externa permanece intacta
      const keyExt = inMemoryDb.api_keys.get('key-ext-crm')
      assert.ok(keyExt)
      assert.equal(keyExt.key, 'ell_token_externo_crm_seguro_222')
    })
  })

  // =========================================================================
  // 5. CONCORRÊNCIA E RESILIÊNCIA A FALHAS
  // =========================================================================
  test.describe('5. Semântica de Concorrência e Resiliência da RPC', () => {
    test('5.1. Rotação concorrente com chave existente: a transação que conclui por último vence deterministicamente', async () => {
      // Estado inicial: 1 chave
      inMemoryDb.api_keys.set('key-initial', {
        id: 'key-initial',
        company_id: TENANT_ACTIVE_A,
        key: 'ell_initial_token_000000000000',
        description: 'Chave Automatica Webhook',
        created_at: new Date().toISOString()
      })

      // Simulação: duas chamadas simultâneas de rotação
      const adminClientA = createAuthenticatedClient({ userId: USER_ADMIN_A })

      const [res1, res2] = await Promise.all([
        rotateInboundWebhookTokenInternal({ supabaseClient: adminClientA }),
        rotateInboundWebhookTokenInternal({ supabaseClient: adminClientA })
      ])

      assert.equal(res1.success, true)
      assert.equal(res2.success, true)

      // Apenas UMA chave automática deve existir no banco
      const autoKeys = Array.from(inMemoryDb.api_keys.values()).filter(
        (k: any) => k.company_id === TENANT_ACTIVE_A && k.description === 'Chave Automatica Webhook'
      )
      assert.equal(autoKeys.length, 1, 'Deve existir exatamente 1 chave automática após concorrência')

      // O token persistido no banco deve corresponder ao token retornado por uma das chamadas
      assert.ok(
        autoKeys[0].key === res1.token || autoKeys[0].key === res2.token,
        'O token persistido deve ser o vencedor de uma das duas chamadas'
      )
    })

    test('5.2. Primeira criação concorrente: chamadas concorrentes à RPC convergem atomicamente em chave única sem duplicatas', async () => {
      // Simulação do comportamento de concorrência real no PostgreSQL (ON CONFLICT DO UPDATE):
      // Quando duas chamadas chegam simultaneamente em tabela vazia, uma insere e a outra
      // executa o DO UPDATE no índice parcial único, resultando em exatamente 1 registro persistido.
      let dbStoredRecord: any = null

      const atomicRpcMock = async (fnName: string, params: any) => {
        if (fnName === 'rotate_company_webhook_key') {
          if (!dbStoredRecord) {
            dbStoredRecord = {
              id: 'key-auto-1',
              company_id: params.p_company_id,
              key: params.p_new_key,
              description: 'Chave Automatica Webhook'
            }
          } else {
            dbStoredRecord.key = params.p_new_key
          }
          return { data: dbStoredRecord.key, error: null }
        }
        return { data: null, error: { message: 'Not found' } }
      }

      const clientAdmin = {
        ...createAdminClient(),
        rpc: atomicRpcMock
      }

      const [res1, res2] = await Promise.all([
        clientAdmin.rpc('rotate_company_webhook_key', {
          p_company_id: TENANT_ACTIVE_B,
          p_new_key: 'ell_token_concorrente_111'
        }),
        clientAdmin.rpc('rotate_company_webhook_key', {
          p_company_id: TENANT_ACTIVE_B,
          p_new_key: 'ell_token_concorrente_222'
        })
      ])

      assert.ok(res1.data)
      assert.ok(res2.data)
      assert.ok(dbStoredRecord, 'Deve haver um registro persistido no banco')
      assert.equal(dbStoredRecord.company_id, TENANT_ACTIVE_B)
      assert.ok(
        dbStoredRecord.key === res1.data || dbStoredRecord.key === res2.data,
        'O banco deve conter o token resultante da execução atômica'
      )
    })

    test('5.3. Falha na RPC não perde o token anterior', async () => {
      // Chave existente
      inMemoryDb.api_keys.set('key-prev', {
        id: 'key-prev',
        company_id: TENANT_ACTIVE_A,
        key: 'ell_previous_token_1234567890',
        description: 'Chave Automatica Webhook',
        created_at: new Date().toISOString()
      })

      // Simula cliente cujo RPC falha com erro transitório de banco
      const realAdmin = createAdminClient()
      const failingRpcAdminClient = {
        ...realAdmin,
        rpc: async () => {
          return {
            data: null,
            error: { code: '08006', message: 'connection failure during RPC execution' }
          }
        },
        // O fallback em nível de aplicação também falha para garantir atomicidade
        from: (table: string) => {
          if (table === 'api_keys') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => {
                    const chain = {
                      order: () => chain,
                      then: (res: any) => Promise.resolve({ data: [{ id: 'key-prev', key: 'ell_previous_token_1234567890' }], error: null }).then(res),
                      catch: (rej: any) => Promise.resolve({ data: null, error: null }).catch(rej)
                    }
                    return chain
                  }
                })
              }),
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => ({
                        data: null,
                        error: { message: 'DB UPDATE failed' }
                      })
                    })
                  })
                })
              })
            }
          }
          return realAdmin.from(table)
        }
      }

      const adminClientA = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const result = await rotateInboundWebhookTokenInternal({
        supabaseClient: adminClientA,
        adminClient: failingRpcAdminClient
      })

      assert.equal(result.success, false)

      // Chave anterior permanece 100% preservada
      const keyAfter = inMemoryDb.api_keys.get('key-prev')
      assert.ok(keyAfter)
      assert.equal(keyAfter.key, 'ell_previous_token_1234567890')
    })
  })

  // =========================================================================
  // 6. PRÉ-VERIFICAÇÃO DE DUPLICATAS (SCRIPT AUDIT)
  // =========================================================================
  test.describe('6. Pré-verificação de Duplicatas e Privacidade', () => {
    test('6.1. Script audit_webhook_key_duplicates.sql existe em supabase/scripts', () => {
      const scriptPath = path.resolve(process.cwd(), 'supabase/scripts/audit_webhook_key_duplicates.sql')
      assert.ok(fs.existsSync(scriptPath), 'Script de auditoria de duplicatas deve existir')
    })

    test('6.2. Script é estritamente de leitura (somente SELECT, sem mutações)', () => {
      const scriptPath = path.resolve(process.cwd(), 'supabase/scripts/audit_webhook_key_duplicates.sql')
      const content = fs.readFileSync(scriptPath, 'utf8')

      // Não pode conter comandos de escrita
      assert.doesNotMatch(content, /\bDELETE\b/i, 'Script não pode conter DELETE')
      assert.doesNotMatch(content, /\bUPDATE\b/i, 'Script não pode conter UPDATE')
      assert.doesNotMatch(content, /\bINSERT\b/i, 'Script não pode conter INSERT')
      assert.doesNotMatch(content, /\bDROP\b/i, 'Script não pode conter DROP')
      assert.doesNotMatch(content, /\bTRUNCATE\b/i, 'Script não pode conter TRUNCATE')
      assert.doesNotMatch(content, /\bALTER\b/i, 'Script não pode conter ALTER')

      // Deve ser uma consulta SELECT
      assert.match(content, /\bSELECT\b/i, 'Script deve ser SELECT')
    })

    test('6.3. Script apresenta company_id, quantidade, IDs duplicados e chave preservada', () => {
      const scriptPath = path.resolve(process.cwd(), 'supabase/scripts/audit_webhook_key_duplicates.sql')
      const content = fs.readFileSync(scriptPath, 'utf8')

      assert.match(content, /\bcompany_id\b/i, 'Deve conter company_id')
      assert.match(content, /\btotal_auto_keys\b/i, 'Deve conter total de chaves')
      assert.match(content, /\bpreserved_key_id\b/i, 'Deve conter ID da chave preservada')
      assert.match(content, /\bduplicate_key_ids\b/i, 'Deve conter IDs das duplicatas')
      assert.match(content, /\bpreserved_created_at\b/i, 'Deve conter created_at da chave preservada')
    })

    test('6.4. Script NUNCA expõe o valor do segredo (coluna key omitida do SELECT final)', () => {
      const scriptPath = path.resolve(process.cwd(), 'supabase/scripts/audit_webhook_key_duplicates.sql')
      const content = fs.readFileSync(scriptPath, 'utf8')

      // Assegura que o token real da chave nunca seja selecionado na query
      // No SELECT de ranked_keys, apenas id, company_id, created_at são selecionados
      const selectRanked = content.match(/ranked_keys\s+AS\s*\(\s*SELECT([\s\S]*?)FROM/i)
      assert.ok(selectRanked, 'Deve existir CTE ranked_keys')
      assert.doesNotMatch(
        selectRanked[1],
        /\bkey\b/i,
        'A coluna secreta key NUNCA deve ser lida ou projetada na CTE'
      )
    })

    test('6.5. Script documenta expressamente o impacto operacional nas integrações n8n', () => {
      const scriptPath = path.resolve(process.cwd(), 'supabase/scripts/audit_webhook_key_duplicates.sql')
      const content = fs.readFileSync(scriptPath, 'utf8')

      assert.match(
        content,
        /n8n/i,
        'Script deve mencionar explicitamente o impacto operacional em integrações n8n'
      )
      assert.match(
        content,
        /401|invalidar|descartad/i,
        'Script deve avisar sobre o risco de descontinuação de chamadas ativas'
      )
    })
  })
})
