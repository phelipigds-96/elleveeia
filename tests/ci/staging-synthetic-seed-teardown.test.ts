import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  maskId,
  maskEmail,
} from '../../scripts/staging-teardown-synthetic.mjs'
import {
  formatSupabaseSsrCookie,
  discoverServerActionIds,
} from '../../scripts/run-staging-security-matrix.mjs'
import {
  saveTestManifest,
  loadTestManifest,
  SYNTHETIC_DATA,
  PREEXISTING_SUPERADMIN,
} from '../../scripts/staging-seed-synthetic.mjs'

test('AC-SEC-01.3-H4-F | Validação Unitária dos Scripts de Seed, Teardown e SSR Chunker', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ellevee-seed-teardown-test-'))
  const testManifestPath = path.join(tempDir, 'manifest-unit-test.json')

  t.after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch {
      // Ignora erro de limpeza de arquivos temporários
    }
  })

  // 1. Mascaramento seguro de IDs e e-mails
  await t.test('1. Mascaramento seguro de IDs e e-mails para auditoria e logs', () => {
    assert.equal(maskId('00000000-0000-4000-a000-000000000001'), '0000...0001')
    assert.equal(maskId('short'), 'short')
    assert.equal(maskId(null), 'unknown')

    assert.equal(maskEmail('alice.qa@qa.ellevee.local'), 'al***@qa.ellevee.local')
    assert.equal(maskEmail('ab@test.com'), 'ab***@test.com')
    assert.equal(maskEmail('invalid-email'), 'unknown')
  })

  // 2. Cookie formatting e chunking (@supabase/ssr)
  await t.test('2. Formatação de cookies SSR com e sem fragmentação (chunking)', () => {
    const smallSession = {
      access_token: 'valid.token.small',
      refresh_token: 'refresh.token.small',
    }
    const cookieHeaderSmall = formatSupabaseSsrCookie(smallSession)
    assert.match(cookieHeaderSmall, /^sb-dkjrpdhymtkgbknocijy-auth-token=base64-/)
    assert.doesNotMatch(cookieHeaderSmall, /auth-token\.0=/)

    // Sessão gigante (> 3180 caracteres) para testar fragmentação de cookies
    const bigToken = 'x'.repeat(4500)
    const bigSession = {
      access_token: bigToken,
      refresh_token: 'refresh.token.big',
    }
    const cookieHeaderBig = formatSupabaseSsrCookie(bigSession)
    assert.match(cookieHeaderBig, /sb-dkjrpdhymtkgbknocijy-auth-token\.0=/)
    assert.match(cookieHeaderBig, /sb-dkjrpdhymtkgbknocijy-auth-token\.1=/)
  })

  // 3. Descoberta dinâmica de Action IDs via server-reference-manifest.json
  await t.test('3. Descoberta dinâmica de Action IDs via server-reference-manifest.json (isolado com fixture sintética)', () => {
    const validManifestPath = path.join(tempDir, 'valid-server-reference-manifest.json')
    const corruptedManifestPath = path.join(tempDir, 'corrupted-server-reference-manifest.json')
    const missingActionManifestPath = path.join(tempDir, 'missing-action-manifest.json')
    const nonExistentManifestPath = path.join(tempDir, 'non-existent-manifest.json')

    const mockManifestValid = {
      node: {
        '401a8f7c9b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f': {
          workers: { 'app/actions.js': '401a8f7c9b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f' },
          layer: { 'app/actions.js': 'action' },
          exportedName: 'getConversationMessages',
        },
        '502b9f8d0c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a': {
          workers: { 'app/actions.js': '502b9f8d0c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a' },
          layer: { 'app/actions.js': 'action' },
          exportedName: 'getImpersonateStatus',
        },
        '603c0f9e1d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b': {
          workers: { 'app/actions.js': '603c0f9e1d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b' },
          layer: { 'app/actions.js': 'action' },
          exportedName: 'getAgentProfileContext',
        },
        '704d1f0f2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c': {
          workers: { 'app/actions.js': '704d1f0f2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c' },
          layer: { 'app/actions.js': 'action' },
          exportedName: 'extraAction',
        },
      },
      edge: {},
    }

    fs.writeFileSync(validManifestPath, JSON.stringify(mockManifestValid, null, 2), 'utf8')
    fs.writeFileSync(corruptedManifestPath, '{"node": { CORRUPTED_JSON_HERE', 'utf8')

    const mockManifestMissingAction = {
      node: {
        '401a8f7c9b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f': {
          workers: { 'app/actions.js': '401a8f7c9b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f' },
          layer: { 'app/actions.js': 'action' },
          exportedName: 'getConversationMessages',
        },
      },
      edge: {},
    }
    fs.writeFileSync(missingActionManifestPath, JSON.stringify(mockManifestMissingAction, null, 2), 'utf8')

    // Cenário 1: Descoberta de múltiplos Action IDs com caminho de manifesto injetável
    const discovered = discoverServerActionIds({ manifestPath: validManifestPath })
    assert.equal(discovered['getConversationMessages'], '401a8f7c9b2e3d4f5a6b7c8d9e0f1a2b3c4d5e6f')
    assert.equal(discovered['getImpersonateStatus'], '502b9f8d0c3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a')
    assert.equal(discovered['getAgentProfileContext'], '603c0f9e1d4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b')
    assert.equal(discovered['extraAction'], '704d1f0f2e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c')
    assert.match(discovered['getConversationMessages'], /^[0-9a-f]{40,42}$/, 'Action ID deve ser hash hexadecimal')

    // Cenário 2: Lançamento de erro quando o manifesto não existe
    assert.throws(
      () => discoverServerActionIds({ manifestPath: nonExistentManifestPath }),
      (err: Error) => {
        return err.message.includes('[ACTION DISCOVERY] Manifesto Next.js não encontrado em:')
      }
    )

    // Cenário 3: Lançamento de erro quando o JSON é corrompido
    assert.throws(
      () => discoverServerActionIds({ manifestPath: corruptedManifestPath }),
      (err: Error) => {
        return err.message.includes('[ACTION DISCOVERY] JSON do manifesto corrompido ou inválido')
      }
    )

    // Cenário 4: Lançamento de erro quando uma action requerida não é encontrada
    assert.throws(
      () => discoverServerActionIds({ manifestPath: missingActionManifestPath }),
      (err: Error) => {
        return err.message.includes('[ACTION DISCOVERY] Action requerida') &&
          err.message.includes('não foi encontrada no manifesto!')
      }
    )

    // Cenário 5: Preservação do caminho padrão relativo a projectRoot (sem dependência de arquivo em staging-workspace)
    const dummyProjectRoot = path.join(tempDir, 'dummy-project')
    assert.throws(
      () => discoverServerActionIds(dummyProjectRoot),
      (err: Error) => {
        const expectedTarget = path.join(dummyProjectRoot, '.staging-workspace', '.next', 'server', 'server-reference-manifest.json')
        return err.message.includes('[ACTION DISCOVERY] Manifesto Next.js não encontrado em:') &&
          err.message.includes(expectedTarget)
      }
    )
  })

  // 4. Persistência e integridade do manifesto de teste
  await t.test('4. Ciclo de vida do manifesto persistente de teste', () => {
    const mockManifest = {
      runId: 'h4_test_run_123',
      createdAt: new Date().toISOString(),
      status: 'seeded',
      companies: [{ id: 'comp-1', name: 'Empresa 1', slug: 'emp-1' }],
      users: [{ authId: 'u-1', email: 'alice.qa@qa.ellevee.local' }],
      platformAdmins: [{ id: 'u-admin', email: 'superadmin.synth@qa.ellevee.local' }],
      conversations: [{ id: 'conv-1', companyId: 'comp-1' }],
      messages: [{ id: 'msg-1', conversationId: 'conv-1' }],
      storageFiles: [{ bucket: 'chat-media', path: 'comp-1/test.txt' }],
    }

    saveTestManifest(mockManifest, testManifestPath)
    assert.ok(fs.existsSync(testManifestPath))

    const loaded = loadTestManifest(testManifestPath)
    assert.equal(loaded.runId, 'h4_test_run_123')
    assert.equal(loaded.status, 'seeded')
    assert.equal(loaded.companies.length, 1)
    assert.equal(loaded.storageFiles.length, 1)
  })

  // 5. Configuração da conta SuperAdmin sintética dedicada vs preexistente
  await t.test('5. SuperAdmin sintético dedicado preserva conta preexistente', () => {
    assert.equal(PREEXISTING_SUPERADMIN.id, '38bbee0f-c0a6-46cd-856b-ce77a6ff801d')
    assert.equal(PREEXISTING_SUPERADMIN.email, 'superadmin.qa@ellevee.internal')

    const synthSuper = SYNTHETIC_DATA.users.superadminSynth
    assert.ok(synthSuper, 'Deve existir superadminSynth em SYNTHETIC_DATA')
    assert.equal(synthSuper.email, 'superadmin.synth@qa.ellevee.local')
    assert.equal(synthSuper.isPlatformAdmin, true)
    assert.equal(synthSuper.platformRole, 'superadmin')
  })

  // 6. Configuração de papel de Carlos (Usuário comum vs Atendente)
  await t.test('6. Papel de Carlos configurado como usuário padrão na Empresa B', () => {
    const carlos = SYNTHETIC_DATA.users.carlos
    assert.ok(carlos)
    assert.equal(carlos.email, 'carlos.qa@qa.ellevee.local')
    assert.equal(carlos.role, 'user')
    assert.equal(carlos.companyKey, 'tenantB')
  })
})
