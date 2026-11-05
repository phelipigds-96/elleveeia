// @ts-nocheck
import { describe, test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

// ==============================================================================
// AUDITORIA E TESTE DE SINCRONIA DE MIGRATIONS — ELLEVÉE IA
// Etapa 8.4.3H — Validação Físico-Estrutural do Supabase (Zero Mocks)
// ==============================================================================

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

describe('ETAPA 8.4.3H — Sincronia de Migrations & Integridade Estrutural (PostgreSQL Físico)', () => {
  const adminClient = createClient(LOCAL_SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // Resolução determinística do diretório de migrations
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  let migrationsDir = path.resolve(currentDir, '../../../../supabase/migrations')
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.resolve('C:/Users/Phelipi/Projects/elleveeia/supabase/migrations')
  }

  before(() => {
    // --------------------------------------------------------------------------
    // 1. Air-gap Cryptographic Guard
    // --------------------------------------------------------------------------
    if (!LOCAL_SUPABASE_URL.includes('127.0.0.1:54321') && !LOCAL_SUPABASE_URL.includes('localhost:54321')) {
      throw new Error(`ABORTADO: O endpoint (${LOCAL_SUPABASE_URL}) não corresponde ao PostgreSQL local.`)
    }

    const jwtParts = SERVICE_ROLE_KEY.split('.')
    if (jwtParts.length < 2) {
      throw new Error('Chave de serviço em formato JWT inválido.')
    }
    const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString('utf8'))
    if (jwtPayload.iss !== 'supabase-demo' || jwtPayload.role !== 'service_role') {
      throw new Error(`AIR-GAP VIOLATION: Teste deve rodar exclusivamente com token de desenvolvimento local.`)
    }
  })

  test('1. Paridade Estrita de Migrations (Filesystem vs supabase_migrations.schema_migrations)', async () => {
    // 1.1 Leitura dos arquivos em disco
    assert.ok(fs.existsSync(migrationsDir), `Diretório de migrations não encontrado: ${migrationsDir}`)
    const filesOnDisk = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort()

    assert.ok(filesOnDisk.length > 0, 'Nenhum arquivo de migration encontrado no diretório supabase/migrations.')

    const parsedDiskMigrations = filesOnDisk.map(filename => {
      const match = filename.match(/^([0-9]+)_(.+)\.sql$/)
      if (!match) {
        throw new Error(`Nome de migration inválido: ${filename}`)
      }
      return {
        version: match[1],
        name: match[2],
        filename
      }
    })

    // 1.2 Leitura física da tabela de controle do Supabase via psql (schema_migrations não é exposto via PostgREST)
    const psqlOutput = execSync(
      'docker exec -i supabase_db_elleveeia psql -U postgres -d postgres -t -A -F "," -c "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;"',
      { encoding: 'utf8' }
    ).trim()

    const dbMigrations = psqlOutput.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const [version, name] = line.split(',')
        return { version, name }
      })

    assert.ok(Array.isArray(dbMigrations) && dbMigrations.length > 0, 'Falha ao recuperar migrations de schema_migrations')

    const dbVersionSet = new Set(dbMigrations.map(m => m.version))
    const diskVersionSet = new Set(parsedDiskMigrations.map(m => m.version))

    // 1.3 Asserção de contagem
    assert.equal(
      parsedDiskMigrations.length,
      dbMigrations.length,
      `Divergência de contagem: ${parsedDiskMigrations.length} arquivos no disco vs ${dbMigrations.length} no banco`
    )

    // 1.4 Asserção de migrations pendentes (no disco, mas ausentes no banco)
    const missingInDb = parsedDiskMigrations.filter(m => !dbVersionSet.has(m.version))
    assert.deepEqual(
      missingInDb,
      [],
      `Existem migrations presentes no filesystem que não constam em schema_migrations: ${JSON.stringify(missingInDb)}`
    )

    // 1.5 Asserção de migrations órfãs (no banco, mas ausentes no disco)
    const orphanedInDb = dbMigrations.filter(m => !diskVersionSet.has(m.version))
    assert.deepEqual(
      orphanedInDb,
      [],
      `Existem migrations registradas em schema_migrations que não possuem arquivo físico: ${JSON.stringify(orphanedInDb)}`
    )

    // 1.6 Verificação específica das 3 migrations do checkpoint E.5 / G
    const criticalVersions = ['2026110607', '2026110608', '2026110609']
    for (const v of criticalVersions) {
      assert.ok(dbVersionSet.has(v), `Migration crítica ${v} deve estar registrada em schema_migrations`)
    }
  })

  test('2. Integridade Física de Objetos DDL Críticos no PostgreSQL', async () => {
    // 2.1 Verificação da tabela gateway_outbound_locks
    const { data: lockTable, error: lockErr } = await adminClient
      .from('gateway_outbound_locks')
      .select('count', { count: 'exact', head: true })

    assert.equal(lockErr, null, `Tabela gateway_outbound_locks não está acessível: ${lockErr?.message}`)

    // 2.2 Verificação da coluna provider_message_id na message_outbox
    const { data: outboxProbe, error: outboxErr } = await adminClient
      .from('message_outbox')
      .select('id, provider_message_id')
      .limit(1)

    assert.equal(outboxErr, null, `Coluna provider_message_id na message_outbox não está acessível: ${outboxErr?.message}`)

    // 2.3 Verificação das RPCs críticas do motor de mensagens e outbox através de chamadas de sondagem com assinaturas reais

    // RPC 1: create_outbound_message_atomic
    const res1 = await adminClient.rpc('create_outbound_message_atomic', {
      p_company_id: '00000000-0000-0000-0000-000000000000',
      p_conversation_id: '00000000-0000-0000-0000-000000000000',
      p_sender_type: 'system',
      p_content: 'probe_test',
      p_idempotency_key: 'probe_key'
    })
    assert.equal(res1.error, null, `create_outbound_message_atomic probe falhou: ${res1.error?.message}`)
    assert.ok(Array.isArray(res1.data) && res1.data.length > 0)
    assert.equal(res1.data[0].error_reason, 'company_not_found')

    // RPC 2: complete_outbox_message
    const res2 = await adminClient.rpc('complete_outbox_message', {
      p_company_id: '00000000-0000-0000-0000-000000000000',
      p_outbox_id: '00000000-0000-0000-0000-000000000000',
      p_claim_token: '00000000-0000-0000-0000-000000000000',
      p_claim_version: 1,
      p_status: 'sent'
    })
    assert.equal(res2.error, null, `complete_outbox_message probe falhou: ${res2.error?.message}`)
    assert.ok(Array.isArray(res2.data) && res2.data.length > 0)
    assert.equal(res2.data[0].error_reason, 'outbox_not_found')

    // RPC 3: claim_stalled_outbox_batch
    const res3 = await adminClient.rpc('claim_stalled_outbox_batch', {
      p_batch_size: 1,
      p_lease_seconds: 120
    })
    assert.equal(res3.error, null, `claim_stalled_outbox_batch probe falhou: ${res3.error?.message}`)
    assert.ok(Array.isArray(res3.data))

    // RPC 4: acquire_gateway_outbound_lock
    const res4 = await adminClient.rpc('acquire_gateway_outbound_lock', {
      p_company_id: '00000000-0000-0000-0000-000000000000',
      p_event_id: 'probe_event_id_test'
    })
    assert.notEqual(res4.error?.code, 'PGRST202', 'acquire_gateway_outbound_lock não existe no catálogo')
    assert.equal(res4.error?.code, '23503', 'acquire_gateway_outbound_lock deve validar constraint FK 23503')

    // RPC 5: complete_gateway_outbound_lock
    const res5 = await adminClient.rpc('complete_gateway_outbound_lock', {
      p_company_id: '00000000-0000-0000-0000-000000000000',
      p_event_id: 'non_existent_event_probe',
      p_claim_token: '00000000-0000-0000-0000-000000000000',
      p_status: 'completed'
    })
    assert.equal(res5.error, null, `complete_gateway_outbound_lock probe falhou: ${res5.error?.message}`)
    assert.ok(Array.isArray(res5.data) && res5.data.length > 0)
    assert.equal(res5.data[0].was_completed, false)

    // RPC 6: merge_message_metadata_monotonic
    const res6 = await adminClient.rpc('merge_message_metadata_monotonic', {
      p_company_id: '00000000-0000-0000-0000-000000000000',
      p_message_id: '00000000-0000-0000-0000-000000000000',
      p_metadata_patch: {}
    })
    assert.equal(res6.error, null, `merge_message_metadata_monotonic probe falhou: ${res6.error?.message}`)
    assert.ok(Array.isArray(res6.data) && res6.data.length > 0)
    assert.equal(res6.data[0].error_reason, 'message_not_found')
  })
})
