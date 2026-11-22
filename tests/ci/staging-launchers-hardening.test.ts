import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawnSync, spawn } from 'node:child_process'
import {
  decodeJwtPayload,
  buildCleanOsEnv,
  runPreflightCheck,
  scanBundleForForbiddenStrings,
  checkPortAvailability,
  STAGING_PROJECT_ID,
  PRODUCTION_PROJECT_ID,
  STAGING_URL,
} from '../../scripts/preflight-staging-runtime.mjs'
import { isAllowedHost } from '../../scripts/egress-guard.cjs'

test('AC-SEC-01.3-H1-F | Bateria de Hardening dos Launchers de Homologação', async (t) => {
  const dummyStagingJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJka2pycGRoeW10a2dia25vY2lqeSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.dummy_signature'
  const dummyProdJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJpcHhoa3dpcnpyaWd0dHB3endibCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.dummy_signature'

  const baseValidStagingEnv = {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable__KT2STe7vpTeMctSqlZtvA_TrNDXCqD',
    SUPABASE_SERVICE_ROLE_KEY: dummyStagingJwt,
    SUPABASE_URL: STAGING_URL,
    PORT: '3001',
    HOSTNAME: '127.0.0.1',
    EVOLUTION_API_URL: 'http://127.0.0.1:9',
    EVOLUTION_API_KEY: 'disabled-in-homologation',
    OPENAI_API_KEY: 'disabled-in-homologation',
    GEMINI_API_KEY: 'disabled-in-homologation',
    CRON_SECRET: 'staging-cron-secret-local-only',
  }

  // 1. Cenário 1: Variável de produção herdada no ambiente -> Pré-flight falha & OS allowlist isola
  await t.test('Cenário 1: Variável de produção herdada no ambiente deve ser bloqueada', async () => {
    // 1.1 Pré-flight bloqueia qualquer variável com referência ao projeto de produção
    const dirtyEnv = {
      ...baseValidStagingEnv,
      EXTERNAL_PROD_URL: `https://${PRODUCTION_PROJECT_ID}.supabase.co`,
    }
    const preflightRes = await runPreflightCheck({
      env: dirtyEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(preflightRes.ok, false)
    assert.ok(preflightRes.failures.some(f => f.includes('VIOLAÇÃO CRÍTICA') && f.includes(PRODUCTION_PROJECT_ID)))

    // 1.2 OS allowlist remove variáveis não autorizadas do host
    const rawHostEnv = {
      PATH: process.env.PATH || '',
      UNTRUSTED_LEAKED_VAR: 'secret_value',
      ANOTHER_SECRET: 'super_secret',
    }
    const cleanOsEnv = buildCleanOsEnv(rawHostEnv)
    assert.strictEqual(cleanOsEnv.UNTRUSTED_LEAKED_VAR, undefined)
    assert.strictEqual(cleanOsEnv.ANOTHER_SECRET, undefined)
    assert.ok(cleanOsEnv.PATH !== undefined)
  })

  // 2. Cenário 2: Credencial não permitida (JWT de produção ou desconhecido) -> Pré-flight falha
  await t.test('Cenário 2: Credencial de produção ou divergente deve ser sumariamente bloqueada', async () => {
    // 2.1 JWT decodificado corretamente
    const decodedStaging = decodeJwtPayload(dummyStagingJwt)
    assert.strictEqual(decodedStaging?.ref, STAGING_PROJECT_ID)
    assert.strictEqual(decodedStaging?.role, 'service_role')

    const decodedProd = decodeJwtPayload(dummyProdJwt)
    assert.strictEqual(decodedProd?.ref, PRODUCTION_PROJECT_ID)

    // 2.2 Pré-flight com JWT de produção falha categoricamente
    const prodEnv = {
      ...baseValidStagingEnv,
      SUPABASE_SERVICE_ROLE_KEY: dummyProdJwt,
    }
    const resProd = await runPreflightCheck({
      env: prodEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(resProd.ok, false)
    assert.ok(resProd.failures.some(f => f.includes(PRODUCTION_PROJECT_ID)))

    // 2.3 Pré-flight com JWT de ref desconhecida falha
    const unknownJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWYiOiJ1bmtub3duLXJlZiIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.dummy_signature'
    const unknownEnv = {
      ...baseValidStagingEnv,
      SUPABASE_SERVICE_ROLE_KEY: unknownJwt,
    }
    const resUnknown = await runPreflightCheck({
      env: unknownEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(resUnknown.ok, false)
    assert.ok(resUnknown.failures.some(f => f.includes('ref desconhecida')))
  })

  // 3. Cenário 3: Supabase URL incorreta -> Pré-flight falha
  await t.test('Cenário 3: Supabase URL divergente do Staging deve falhar', async () => {
    const wrongUrlEnv = {
      ...baseValidStagingEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://other-instance.supabase.co',
      SUPABASE_URL: 'https://other-instance.supabase.co',
    }
    const res = await runPreflightCheck({
      env: wrongUrlEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(res.ok, false)
    assert.ok(res.failures.some(f => f.includes('não aponta para o Staging autorizado')))
  })

  // 4. Cenário 4: Bundle compilado contaminado -> Varredura detecta e pré-flight falha
  await t.test('Cenário 4: Bundle compilado com strings de produção deve ser interceptado', async () => {
    const testDir = path.resolve(process.cwd(), '.temp-test-bundle')
    fs.mkdirSync(testDir, { recursive: true })

    try {
      const cleanFile = path.join(testDir, 'page-clean.js')
      const contaminatedFile = path.join(testDir, 'page-dirty.js')

      fs.writeFileSync(cleanFile, 'console.log("Safe staging bundle with dkjrpdhymtkgbknocijy");', 'utf8')
      fs.writeFileSync(contaminatedFile, `console.log("LEAK: https://${PRODUCTION_PROJECT_ID}.supabase.co");`, 'utf8')

      // Varredura direta
      const scanRes = scanBundleForForbiddenStrings(testDir, [PRODUCTION_PROJECT_ID])
      assert.strictEqual(scanRes.scanned, 2)
      assert.strictEqual(scanRes.contaminated.length, 1)
      assert.strictEqual(scanRes.contaminated[0].stringFound, PRODUCTION_PROJECT_ID)

      // Pré-flight apontando para este diretório
      const preflightRes = await runPreflightCheck({
        env: baseValidStagingEnv,
        targetNextDir: testDir,
        skipPortCheck: true,
        silent: true,
      })
      assert.strictEqual(preflightRes.ok, false)
      assert.ok(preflightRes.failures.some(f => f.includes('Bundle contaminado') && f.includes(PRODUCTION_PROJECT_ID)))
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  // 5. Cenário 5: Variáveis obrigatórias ausentes -> Pré-flight falha
  await t.test('Cenário 5: Variáveis obrigatórias ausentes devem disparar fail-closed', async () => {
    const emptyEnv = {}
    const res = await runPreflightCheck({
      env: emptyEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(res.ok, false)
    assert.ok(res.failures.some(f => f.includes('NEXT_PUBLIC_SUPABASE_URL não configurada')))
    assert.ok(res.failures.some(f => f.includes('SUPABASE_SERVICE_ROLE_KEY não configurada')))
  })

  // 6. Cenário 6: Host de bind diferente de 127.0.0.1 (ex: 0.0.0.0) -> Bloqueado
  await t.test('Cenário 6: Bind em 0.0.0.0 ou IP externo deve ser sumariamente bloqueado', async () => {
    const wildCardEnv = {
      ...baseValidStagingEnv,
      HOSTNAME: '0.0.0.0',
    }
    const resWildcard = await runPreflightCheck({
      env: wildCardEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(resWildcard.ok, false)
    assert.ok(resWildcard.failures.some(f => f.includes('HOST_BIND_VIOLATION') && f.includes('0.0.0.0')))

    const externalIpEnv = {
      ...baseValidStagingEnv,
      HOSTNAME: '192.168.1.100',
    }
    const resExternal = await runPreflightCheck({
      env: externalIpEnv,
      skipBundleScan: true,
      skipPortCheck: true,
      silent: true,
    })
    assert.strictEqual(resExternal.ok, false)
    assert.ok(resExternal.failures.some(f => f.includes('HOST_BIND_VIOLATION')))
  })

  // 7. Cenário 7: Porta ocupada -> Pré-flight falha
  await t.test('Cenário 7: Conflito de porta ocupada deve ser identificado', async () => {
    const testPort = 3098
    const server = net.createServer()

    await new Promise((resolve) => {
      server.listen(testPort, '127.0.0.1', () => resolve())
    })

    try {
      const isAvailable = await checkPortAvailability(testPort, '127.0.0.1')
      assert.strictEqual(isAvailable, false)

      const portBusyEnv = {
        ...baseValidStagingEnv,
        PORT: String(testPort),
      }
      const res = await runPreflightCheck({
        env: portBusyEnv,
        skipBundleScan: true,
        silent: true,
      })
      assert.strictEqual(res.ok, false)
      assert.ok(res.failures.some(f => f.includes(`Porta ${testPort} já está em uso`)))
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }

    const isNowAvailable = await checkPortAvailability(testPort, '127.0.0.1')
    assert.strictEqual(isNowAvailable, true)
  })

  // 8. Cenário 8: Encerramento limpo de processos no Windows
  await t.test('Cenário 8: Encerramento limpo de processo filho sem processos zumbis', async () => {
    // Inicia um processo filho que aguarda
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    assert.ok(child.pid)

    // Encerra com taskkill no Windows ou SIGTERM em POSIX
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }

    // Aguarda o término
    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code))
    })
    assert.ok(exitCode !== undefined)
  })

  // 9. Cenário 9: Egress firewall bloqueia chamada de rede não autorizada (egress-guard.cjs)
  await t.test('Cenário 9: Egress Guard bloqueia in-process conexões para hosts externos', async () => {
    // 9.1 Validação da regra pura de host
    assert.strictEqual(isAllowedHost('127.0.0.1'), true)
    assert.strictEqual(isAllowedHost('localhost'), true)
    assert.strictEqual(isAllowedHost('dkjrpdhymtkgbknocijy.supabase.co'), true)
    assert.strictEqual(isAllowedHost('api.openai.com'), false)
    assert.strictEqual(isAllowedHost('ipxhkwirzrigttpwzwbl.supabase.co'), false)
    assert.strictEqual(isAllowedHost('evolution-api.externa.com'), false)

    // 9.2 Execução real HTTP com injeção via NODE_OPTIONS --require egress-guard.cjs
    const egressGuardPath = path.resolve(process.cwd(), 'scripts', 'egress-guard.cjs').replace(/\\/g, '/')
    const scriptCode = `
      const http = require('http');
      const req = http.get('http://api.openai.com/v1/models', (res) => {
        process.exit(1);
      });
      req.on('error', (err) => {
        if (err.code === 'EGRESS_BLOCKED') {
          process.stdout.write('EGRESS_SUCCESSFULLY_BLOCKED');
          process.exit(0);
        }
        process.exit(2);
      });
    `

    const res = spawnSync(
      process.execPath,
      ['-e', scriptCode],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require "${egressGuardPath}"`,
        },
      }
    )

    const stdout = res.stdout?.toString() || ''
    assert.strictEqual(res.status, 0, `Esperado exit 0 do egress-guard, obtido status ${res.status}. Stderr: ${res.stderr?.toString()}`)
    assert.ok(stdout.includes('EGRESS_SUCCESSFULLY_BLOCKED'))

    // 9.3 Execução real fetch com injeção via NODE_OPTIONS
    const fetchScript = `
      globalThis.fetch('https://api.anthropic.com/v1/messages')
        .then(() => process.exit(1))
        .catch((err) => {
          if (err.code === 'EGRESS_BLOCKED') {
            process.stdout.write('FETCH_SUCCESSFULLY_BLOCKED');
            process.exit(0);
          }
          process.exit(2);
        });
    `
    const fetchRes = spawnSync(
      process.execPath,
      ['-e', fetchScript],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require "${egressGuardPath}"`,
        },
      }
    )
    const fetchStdout = fetchRes.stdout?.toString() || ''
    assert.strictEqual(fetchRes.status, 0, `Esperado exit 0 do egress-guard fetch, obtido status ${fetchRes.status}`)
    assert.ok(fetchStdout.includes('FETCH_SUCCESSFULLY_BLOCKED'))
  })
})
