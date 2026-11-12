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
      env: { ...process.env, ...extraEnv },
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

runSuite('Etapas 2A, 2B, 3A, 3B & Regressão Core', [
  'tests/ci/etapa2a-verify.test.ts',
  'tests/ci/etapa2b-verify.test.ts',
  'tests/ci/etapa3a-verify.test.ts',
  'tests/ci/etapa3b-verify.test.ts',
  'lib/services/agent/tools/etapa7.2-prompt-scoping.test.ts',
  'lib/services/agent/tools/etapa8.4.3s-admin-metrics-and-audit.test.ts',
])

console.log('\n✅ Todas as suítes do Gate de CI passaram com sucesso.')
