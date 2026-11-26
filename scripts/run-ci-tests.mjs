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

runSuite('AC-SEC-01.3 — Correção Emergencial de Autorização Multi-Tenant e RBAC (26 Cenários)', [
  'tests/ci/ac-sec-01-3-emergency-auth.test.ts',
])

runSuite('AC-SEC-01.3-H1-F — Blindagem dos Launchers de Homologação (9 Cenários Negativos)', [
  'tests/ci/staging-launchers-hardening.test.ts',
])

runSuite('AC-SEC-01.3-H4-F — Validação de Seed, Teardown e SSR Chunker (7 Cenários)', [
  'tests/ci/staging-synthetic-seed-teardown.test.ts',
])

runSuite('AC-SEC-01.4-I1 — Core Seguro de Impersonação do SuperAdmin (12 Cenários)', [
  'tests/ci/ac-sec-01-4-impersonation-core.test.ts',
])

runSuite('AC-SEC-01.4-I2 — Integração Segura das Server Actions e Serviços (12 Cenários)', [
  'tests/ci/ac-sec-01-4-server-actions-integration.test.ts',
])

runSuite('AC-SEC-01.4-H1 — Validação de Estabilidade do JWT Refresh e Vínculo de Sessão (7 Cenários)', [
  'tests/ci/ac-sec-01-4-token-refresh.test.ts',
])

runSuite('Etapa AC-02 — Compreensão Comercial e Memória Contextual (10 Cenários)', [
  'tests/ci/ac02-commercial-understanding.test.ts',
])

runSuite('Etapa AC-03 — Conversação Natural e Consultiva do Agente Comercial (8 Comportamentos)', [
  'tests/ci/ac03-conversational-nature.test.ts',
])

runSuite('Etapa AC-04.1 — Intelligent Product Search Engine & Deterministic Ranking (16 Cenários)', [
  'tests/ci/ac04-1-intelligent-search.test.ts',
])

runSuite('Etapa AC-04.2 — Enterprise Pricing Engine & Batch Calculations (18 Cenários)', [
  'tests/ci/ac04-2-enterprise-pricing.test.ts',
])

runSuite('Etapa AC-04.3 — Enterprise Quote Engine & Intelligent Cart (20 Cenários)', [
  'tests/ci/ac04-3-enterprise-quotes.test.ts',
])

runSuite('Etapa AC-04.4 — Commercial Agent Runtime Integration & Consultative Sales (16 Cenários)', [
  'tests/ci/ac04-4-commercial-runtime.test.ts',
])

runSuite('Etapa AC-04.4.1 — Correções de Integridade Comercial & Preparação Staging (12 Cenários)', [
  'tests/ci/ac04-4-1-commercial-integrity.test.ts',
])

runSuite('Etapa AC-04.5-P0 — Verificação de Bloqueadores para Homologação Comercial (12 Cenários)', [
  'tests/ci/ac04-5-p0-blockers-verification.test.ts',
])

runSuite('Etapa AC-04.5-P0.1/P0.2/P0.3 — Fechamento Transacional & Concorrência (21 Cenários)', [
  'tests/ci/ac04-5-p0-1-transactional-closure.test.ts',
])

runSuite('Etapa AC-04.5-P0.5 — Guardas de Segurança e Confiabilidade do Runner (6 Cenários)', [
  'tests/ci/ac04-5-p0-5-runner-offline-guards.test.ts',
])

runSuite('Etapa AC-04.6.1 — Compatibilidade de Preços e Segurança do Seed QA (12 Cenários)', [
  'tests/ci/ac04-6-1-catalog-pricing-safety.test.ts',
])

runSuite('Etapa AC-04.6.4 — Correção dos Defeitos Comerciais Reais da Sofia (7 Cenários)', [
  'tests/ci/ac04-6-4-commercial-fixes.test.ts',
])

runSuite('Etapa AC-04.6.6 — Precificação Varejo/Atacado e Clareza de Subtotal (4 Cenários)', [
  'tests/ci/ac04-6-6-pricing-clarity-fixes.test.ts',
])

runSuite('Etapa UI-01 — Fundações Responsivas e Experiência Chrome Android (5 Cenários)', [
  'tests/ci/ui-01-conversations-responsive.test.ts',
])

runSuite('Etapa UI-02 — Ellevee Workspace Fluent Inspired na Rota /conversations (7 Cenários)', [
  'tests/ci/ui-02-conversations-fluent.test.ts',
])

runSuite('Etapa UI-03.1 — Extração Modular da Lista de Conversas (4 Cenários)', [
  'tests/ci/ui-03-1-conversation-list.test.ts',
])

runSuite('Etapa UI-03.2 — Modularização do Cabeçalho e Controles de Atendimento (3 Cenários)', [
  'tests/ci/ui-03-2-conversation-header.test.ts',
])

runSuite('Etapa UI-03.3 — Modularização do Histórico de Mensagens (4 Cenários)', [
  'tests/ci/ui-03-3-message-stream.test.ts',
])

runSuite('Etapa UI-03.4 — Modularização do Composer de Mensagens e Integridade (6 Cenários)', [
  'tests/ci/ui-03-4-composer-integrity.test.ts',
])

runSuite('Etapa UI-03.5 — Modularização do Inspector e Modais Operacionais (5 Cenários)', [
  'tests/ci/ui-03-5-inspector-dialogs.test.ts',
])

runSuite('Etapa UI-03.6 — Confiabilidade Consolidada e Contratos Arquiteturais UI-03 (8 Cenários)', [
  'tests/ci/ui-03-6-consolidated-reliability.test.ts',
])

console.log('\n✅ Todas as suítes do Gate de CI passaram com sucesso.')
