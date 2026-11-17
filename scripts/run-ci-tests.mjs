import { spawnSync } from 'node:child_process'

const nodeBin = process.execPath
const registerFlag = './tests/ci/register.mjs'

function runSuite(label, testFiles, extraEnv = {}) {
  console.log(`\n▶ [CI Tests] Executando ${label}...`)
  const res = spawnSync(
    nodeBin,
    ['--import', registerFlag, '--test', ...testFiles],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', ...extraEnv },
    }
  )

  if (res.status !== 0) {
    console.error(`❌ [CI Tests] Falha em ${label} (exit=${res.status})`)
    process.exit(res.status || 1)
  }
}

runSuite(
  'Etapa 1 (Worker, 410 Gone, Time Budget & Leases)',
  ['tests/ci/etapa1-verify.test.ts'],
  { MOCK_AGENT_ENGINE: '1' }
)

runSuite('Etapas 2A, 2B, 3A, 3B, 3D, 3E, 3F & Regressão Core', [
  'tests/ci/etapa2a-verify.test.ts',
  'tests/ci/etapa2b-verify.test.ts',
  'tests/ci/etapa3a-verify.test.ts',
  'tests/ci/etapa3b-verify.test.ts',
  'tests/ci/etapa3d-verify.test.ts',
  'tests/ci/etapa3e-audio-fallback.test.ts',
  'tests/ci/etapa3f-cart-ttl.test.ts',
  'lib/services/agent/tools/etapa7.2-prompt-scoping.test.ts',
  'lib/services/agent/tools/etapa8.4.3s-admin-metrics-and-audit.test.ts',
])

runSuite('Três Testes Forenses de Auditoria (Outbox/Crash, 5-Role Auth, SSRF/DNS Rebinding)', [
  'tests/ci/audit-deep-verification.test.ts',
])

runSuite('Homologação do Proxy e Preservação Cirúrgica de Cookies SSR (9 Cenários)', [
  'tests/ci/proxy-ssr-cookie-preservation.test.ts',
])

runSuite('Etapa AC-02 — Compreensão Comercial e Memória Contextual (10 Cenários)', [
  'tests/ci/ac02-commercial-understanding.test.ts',
])

console.log('\n✅ Todas as suítes do Gate de CI passaram com sucesso.')
