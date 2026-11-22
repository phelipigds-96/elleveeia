import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildCleanOsEnv,
  loadStagingConfig,
  runPreflightCheck,
} from './preflight-staging-runtime.mjs'
import {
  setupStagingWorkspace,
  cleanStagingBuildArtifacts,
  getNextBinPath,
} from './staging-workspace-helper.mjs'

const projectRootDir = process.cwd()

console.log('=== [BUILD STAGING ISOLADO] PREPARAÇÃO E COMPILAÇÃO BLINDADA ===\n')

try {
  // 1. Carregar configuração de Staging com garantias criptográficas e estruturais
  console.log('1. Carregando e validando credenciais de Staging...')
  const stagingConfig = loadStagingConfig(projectRootDir)

  // 2. Construir ambiente isolado sem herança indiscriminada de process.env
  console.log('2. Construindo ambiente restrito via OS allowlist...')
  const cleanOsEnv = buildCleanOsEnv(process.env)
  const childEnv = {
    ...cleanOsEnv,
    ...stagingConfig,
  }

  // 3. Pré-Flight inicial pré-compilação (Fail-Closed)
  console.log('\n3. Executando pré-flight de segurança pré-compilação...')
  const preCheck = await runPreflightCheck({
    env: childEnv,
    skipBundleScan: true,
    skipPortCheck: true,
    projectRootDir,
    silent: false,
  })

  if (!preCheck.ok) {
    console.error('❌ Falha no pré-flight pré-build. Compilação abortada.')
    process.exit(1)
  }

  // 4. Preparar workspace isolado e limpar artefatos anteriores
  console.log('\n4. Configurando workspace isolado e limpando artefatos anteriores...')
  const workspaceDir = setupStagingWorkspace(projectRootDir)
  cleanStagingBuildArtifacts(projectRootDir)
  const nextBin = getNextBinPath(projectRootDir)

  // 5. Executar next build diretamente com node.exe no workspace isolado utilizando Webpack
  // (Webpack garante suporte nativo a NTFS directory junctions no Windows, prevenindo falha de rotas do Turbopack)
  console.log(`\n5. Executando 'next build --webpack' isolado em '${workspaceDir}'...`)
  const buildResult = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    cwd: workspaceDir,
    env: childEnv,
    stdio: 'inherit',
  })

  if (buildResult.status !== 0) {
    console.error(`\n❌ Falha na compilação do Next.js (exit=${buildResult.status})`)
    process.exit(buildResult.status || 1)
  }

  // 6. Pré-Flight pós-compilação com varredura completa do bundle .next e validação de rotas
  console.log('\n6. Executando pré-flight pós-compilação (varredura estrita do bundle e rotas)...')
  const targetNextDir = path.resolve(workspaceDir, '.next')
  const postCheck = await runPreflightCheck({
    env: childEnv,
    targetNextDir,
    skipPortCheck: true,
    projectRootDir,
    silent: false,
  })

  if (!postCheck.ok) {
    console.error('❌ Falha pós-build: O bundle compilado não passou na verificação de integridade e segurança!')
    process.exit(1)
  }

  // 7. Validação estrita de integridade das rotas essenciais e Server Actions
  const appPathsManifestPath = path.resolve(targetNextDir, 'server', 'app-paths-manifest.json')
  const serverReferencePath = path.resolve(targetNextDir, 'server', 'server-reference-manifest.json')

  const appPaths = JSON.parse(fs.readFileSync(appPathsManifestPath, 'utf8'))
  const serverRef = JSON.parse(fs.readFileSync(serverReferencePath, 'utf8'))

  const criticalRoutes = [
    '/(auth)/login/page',
    '/(auth)/signup/page',
    '/(dashboard)/dashboard/page',
    '/(dashboard)/conversations/page',
    '/(admin)/companies/page',
    '/(admin)/paineladmin/page',
    '/api/chat/upload/route',
    '/api/cron/outbox-worker/route',
    '/api/outbox/process/route',
    '/api/webhooks/messages/route',
  ]

  const missingCritical = criticalRoutes.filter(r => !appPaths[r])
  if (missingCritical.length > 0) {
    console.error('❌ ERRO CRÍTICO: Rotas essenciais ausentes no build compilado:', missingCritical)
    process.exit(1)
  }

  const actionsCount = Object.keys(serverRef.node || {}).length
  if (actionsCount === 0) {
    console.error('❌ ERRO CRÍTICO: Nenhuma Server Action registrada em server-reference-manifest.json!')
    process.exit(1)
  }

  console.log(`✔ Integridade de rotas confirmada: ${Object.keys(appPaths).length} rotas compiladas no App Router.`)
  console.log(`✔ Integridade de Server Actions confirmada: ${actionsCount} server actions registradas.`)
  console.log('\n🎉 SUCESSO: Build de Staging compilado e 100% blindado contra produção.')
  console.log(`Artefatos gerados isoladamente em: ${targetNextDir}`)
} catch (err) {
  console.error(`\n[FATAL ERROR] Falha no processo de compilação isolada: ${err.message}`)
  process.exit(1)
}
