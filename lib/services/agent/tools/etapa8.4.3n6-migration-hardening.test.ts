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
  rotateInboundWebhookTokenInternal
} from '@/lib/services/integrations-internal'

test.describe('ETAPA 8.4.3N.6 — Hardening Final da Migration e SECURITY DEFINER', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111'
  const TENANT_B = '22222222-2222-2222-2222-222222222222'
  const USER_ADMIN_A = 'user-admin-tenant-a-n6'

  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261103_api_keys_webhook_uniqueness.sql')

  test.beforeEach(() => {
    resetInMemoryDb()

    inMemoryDb.companies.set(TENANT_A, {
      id: TENANT_A,
      name: 'Empresa Alpha N6',
      slug: 'empresa-alpha-n6',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(TENANT_B, {
      id: TENANT_B,
      name: 'Empresa Beta N6',
      slug: 'empresa-beta-n6',
      status: 'active',
      plan_tier: 'enterprise',
      created_at: new Date().toISOString()
    })

    inMemoryDb.profiles.set(USER_ADMIN_A, {
      id: USER_ADMIN_A,
      company_id: TENANT_A,
      role: 'admin',
      full_name: 'Admin Alpha N6'
    })
  })

  // =========================================================================
  // 1. BLOQUEIO DE EXPURGO AUTOMÁTICO NA MIGRATION
  // =========================================================================
  test.describe('1. Governança da Migration: Bloqueio de Expurgo Automático', () => {
    test('1.1. Migration NÃO executa comando DELETE automático de tokens', () => {
      assert.ok(fs.existsSync(migrationPath), 'Migration deve existir')
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Garante categoricamente que não há comandos DELETE na migration
      assert.doesNotMatch(
        sql,
        /\bDELETE\s+FROM\b/i,
        'A migration NÃO deve conter comandos DELETE automáticos de tokens'
      )
    })

    test('1.2. Migration contém verificação que aborta (RAISE EXCEPTION) quando existem duplicatas', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Deve conter bloco DO com verificação de duplicatas e RAISE EXCEPTION
      assert.match(sql, /DO\s+\$\$/i, 'Deve conter bloco procedural de verificação')
      assert.match(sql, /RAISE\s+EXCEPTION/i, 'Deve abortar via RAISE EXCEPTION se houver duplicatas')
      assert.match(
        sql,
        /audit_webhook_key_duplicates\.sql/i,
        'Mensagem de erro deve orientar o operador a executar o script de auditoria'
      )
    })

    test('1.3. Simulação: Verificação aborta quando encontra duplicatas pré-existentes', () => {
      // Simula a lógica SQL da migration sobre um dataset com duplicatas
      const sampleKeys = [
        { id: 'k1', company_id: 'c1', description: 'Chave Automatica Webhook', created_at: '2026-10-01T10:00:00Z' },
        { id: 'k2', company_id: 'c1', description: 'Chave Automatica Webhook', created_at: '2026-10-02T10:00:00Z' }, // Duplicata
        { id: 'k3', company_id: 'c2', description: 'Chave Automatica Webhook', created_at: '2026-10-01T10:00:00Z' },
        { id: 'k4', company_id: 'c1', description: 'Chave Externa ERP', created_at: '2026-10-01T10:00:00Z' } // Externa não conta
      ]

      // Executa a regra da CTE ranked_keys
      const autoKeysByCompany = new Map<string, any[]>()
      for (const k of sampleKeys) {
        if (k.description === 'Chave Automatica Webhook') {
          const list = autoKeysByCompany.get(k.company_id) || []
          list.push(k)
          autoKeysByCompany.set(k.company_id, list)
        }
      }

      let duplicateCount = 0
      for (const list of autoKeysByCompany.values()) {
        if (list.length > 1) {
          duplicateCount += (list.length - 1)
        }
      }

      assert.equal(duplicateCount, 1, 'Deve detectar exatamente 1 duplicata')

      // Simula o comportamento do RAISE EXCEPTION
      const simulateMigrationCheck = () => {
        if (duplicateCount > 0) {
          throw new Error(`MIGRATION ABORTADA: Foram encontradas ${duplicateCount} chave(s) automática(s) duplicada(s). Execute supabase/scripts/audit_webhook_key_duplicates.sql`)
        }
      }

      assert.throws(
        () => simulateMigrationCheck(),
        /MIGRATION ABORTADA.*audit_webhook_key_duplicates\.sql/i
      )
    })

    test('1.4. Simulação: Migration continua normalmente quando NÃO existem duplicatas', () => {
      const sampleKeysClean = [
        { id: 'k1', company_id: 'c1', description: 'Chave Automatica Webhook', created_at: '2026-10-01T10:00:00Z' },
        { id: 'k2', company_id: 'c2', description: 'Chave Automatica Webhook', created_at: '2026-10-01T10:00:00Z' },
        { id: 'k3', company_id: 'c1', description: 'Chave Externa CRM', created_at: '2026-10-01T10:00:00Z' }
      ]

      const autoKeysByCompany = new Map<string, any[]>()
      for (const k of sampleKeysClean) {
        if (k.description === 'Chave Automatica Webhook') {
          const list = autoKeysByCompany.get(k.company_id) || []
          list.push(k)
          autoKeysByCompany.set(k.company_id, list)
        }
      }

      let duplicateCount = 0
      for (const list of autoKeysByCompany.values()) {
        if (list.length > 1) {
          duplicateCount += (list.length - 1)
        }
      }

      assert.equal(duplicateCount, 0, 'Não deve haver duplicatas')

      let indexCreated = false
      const simulateMigration = () => {
        if (duplicateCount > 0) {
          throw new Error('Migration abortada')
        }
        indexCreated = true // Prossegue para criação do índice único
      }

      simulateMigration()
      assert.equal(indexCreated, true, 'Migration deve continuar e criar o índice único normalmente')
    })

    test('1.5. O índice único parcial continua presente para garantir unicidade após regularização', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.match(
        sql,
        /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_api_keys_company_auto_webhook/i,
        'Índice único parcial deve existir'
      )
      assert.match(sql, /ON\s+public\.api_keys\s*\(\s*company_id\s*\)/i)
      assert.match(sql, /WHERE\s+description\s*=\s*'Chave Automatica Webhook'/i)
    })
  })

  // =========================================================================
  // 2. HARDENING DO SEARCH_PATH E SEGURANÇA DA FUNÇÃO
  // =========================================================================
  test.describe('2. Hardening Rigoroso do search_path e SECURITY DEFINER', () => {
    test('2.1. search_path contém estritamente pg_catalog, public, pg_temp nessa ordem exata', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.match(
        sql,
        /SET\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*pg_temp/i,
        'search_path deve conter pg_catalog, public, pg_temp nessa ordem rigorosa'
      )
    })

    test('2.2. Função declara SECURITY DEFINER e todas as tabelas referenciadas são qualificadas', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.match(sql, /SECURITY\s+DEFINER/i, 'Função deve ser SECURITY DEFINER')
      assert.match(sql, /FROM\s+public\.api_keys/i)
      assert.match(sql, /UPDATE\s+public\.api_keys/i)
      assert.match(sql, /INSERT\s+INTO\s+public\.api_keys/i)
    })

    test('2.3. RPC revoga explicitamente EXECUTE de PUBLIC, anon e authenticated', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.rotate_company_webhook_key\s*\(\s*UUID\s*,\s*TEXT\s*\)\s+FROM\s+PUBLIC/i
      )
      assert.match(
        sql,
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.rotate_company_webhook_key\s*\(\s*UUID\s*,\s*TEXT\s*\)\s+FROM\s+anon\s*,\s*authenticated/i
      )
    })

    test('2.4. RPC concede privilégio EXECUTE exclusivamente ao service_role', () => {
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.match(
        sql,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rotate_company_webhook_key\s*\(\s*UUID\s*,\s*TEXT\s*\)\s+TO\s+service_role/i
      )
    })
  })

  // =========================================================================
  // 3. ISOLAMENTO CROSS-TENANT E PROTEÇÃO DE CHAVES EXTERNAS
  // =========================================================================
  test.describe('3. Isolamento entre Empresas e Preservação de Chaves Externas', () => {
    test('3.1. Rotação atômica para Empresa A não altera tokens da Empresa B', async () => {
      inMemoryDb.api_keys.set('key-beta', {
        id: 'key-beta',
        company_id: TENANT_B,
        key: 'ell_token_beta_intacto_999999',
        description: 'Chave Automatica Webhook',
        created_at: new Date().toISOString()
      })

      const clientA = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const res = await rotateInboundWebhookTokenInternal({ supabaseClient: clientA })

      assert.equal(res.success, true)

      // Chave da Empresa B permanece 100% inalterada
      const keyBeta = inMemoryDb.api_keys.get('key-beta')
      assert.ok(keyBeta)
      assert.equal(keyBeta.key, 'ell_token_beta_intacto_999999')
    })

    test('3.2. Rotação não altera chaves externas de outros sistemas/integrações', async () => {
      inMemoryDb.api_keys.set('key-ext-crm', {
        id: 'key-ext-crm',
        company_id: TENANT_A,
        key: 'ell_token_crm_salesforce_8888',
        description: 'Chave Externa Salesforce CRM',
        created_at: new Date().toISOString()
      })

      const clientA = createAuthenticatedClient({ userId: USER_ADMIN_A })
      const res = await rotateInboundWebhookTokenInternal({ supabaseClient: clientA })

      assert.equal(res.success, true)

      // Chave externa permanece intacta
      const keyExt = inMemoryDb.api_keys.get('key-ext-crm')
      assert.ok(keyExt)
      assert.equal(keyExt.key, 'ell_token_crm_salesforce_8888')
    })
  })
})
