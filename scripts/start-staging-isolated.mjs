import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import {
  buildCleanOsEnv,
  loadStagingConfig,
  runPreflightCheck,
  TARGET_PORT,
} from './preflight-staging-runtime.mjs'
import {
  STAGING_WORKSPACE_DIR,
  setupStagingWorkspace,
  getNextBinPath,
} from './staging-workspace-helper.mjs'

const projectRootDir = process.cwd()

function killProcessTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // Ignora erro se o processo já tiver encerrado
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Ignora
      }
    }
  }
}

async function startRuntime() {
  console.log('=== [RUNTIME STAGING ISOLADO] INICIALIZANDO SERVIDOR NA PORTA 3001 ===\n')

  try {
    // 1. Carregar configuração de Staging com garantias criptográficas e estruturais
    console.log('1. Carregando e validando credenciais de Staging...')
    const stagingConfig = loadStagingConfig(projectRootDir)

    // 2. Construir ambiente estrito a partir de allowlist do sistema operacional
    console.log('2. Construindo ambiente estritamente restrito via OS allowlist...')
    const cleanOsEnv = buildCleanOsEnv(process.env)
    const childEnv = {
      ...cleanOsEnv,
      ...stagingConfig,
    }

    // 3. Verificar existência de build isolado prévio
    const workspaceDir = path.resolve(projectRootDir, STAGING_WORKSPACE_DIR)
    const targetNextDir = path.resolve(workspaceDir, '.next')
    if (!fs.existsSync(targetNextDir)) {
      console.error('❌ ERRO CRÍTICO: Bundle compilado não encontrado em .staging-workspace/.next.')
      console.error('Execute obrigatoriamente a compilação isolada antes:')
      console.error('   node scripts/build-staging-isolated.mjs\n')
      process.exit(1)
    }

    // 4. Executar Pré-Flight Fail-Closed completo antes do spawn
    console.log('3. Executando bateria de pré-flight de segurança fail-closed...')
    const preflight = await runPreflightCheck({
      env: childEnv,
      targetNextDir,
      projectRootDir,
      silent: false,
    })

    if (!preflight.ok) {
      console.error('❌ Falha no pré-flight de segurança. Servidor NÃO foi iniciado.')
      process.exit(1)
    }

    // 5. Garantir links do workspace
    setupStagingWorkspace(projectRootDir)
    const nextBin = getNextBinPath(projectRootDir)

    // 6. Iniciar Next.js com bind estrito em 127.0.0.1 e porta 3001
    console.log(`4. Iniciando Next.js diretamente em http://127.0.0.1:${TARGET_PORT}...`)
    const serverProcess = spawn(
      process.execPath,
      [nextBin, 'start', '-p', String(TARGET_PORT), '-H', '127.0.0.1'],
      {
        cwd: workspaceDir,
        env: childEnv,
        stdio: 'inherit',
      }
    )

    let isTerminating = false

    const handleShutdown = (signal) => {
      if (isTerminating) return
      isTerminating = true
      console.log(`\n[SHUTDOWN] Sinal ${signal} recebido. Encerrando árvore de processos do servidor...`)
      if (serverProcess && serverProcess.pid) {
        killProcessTree(serverProcess.pid)
      }
      process.exit(0)
    }

    process.on('SIGINT', () => handleShutdown('SIGINT'))
    process.on('SIGTERM', () => handleShutdown('SIGTERM'))

    serverProcess.on('error', (err) => {
      console.error('❌ Erro no processo do servidor Next.js:', err)
      process.exit(1)
    })

    serverProcess.on('exit', (code, signal) => {
      if (!isTerminating) {
        console.log(`Servidor Next.js encerrado (code=${code}, signal=${signal}).`)
      }
      process.exit(code || 0)
    })
  } catch (err) {
    console.error(`\n[FATAL ERROR] Falha ao iniciar runtime de homologação: ${err.message}`)
    process.exit(1)
  }
}

startRuntime()
