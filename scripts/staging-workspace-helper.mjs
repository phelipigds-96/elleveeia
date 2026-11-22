import fs from 'node:fs'
import path from 'node:path'

export const STAGING_WORKSPACE_DIR = '.staging-workspace'

export const DIRS_TO_JUNCTION = [
  'app',
  'components',
  'lib',
  'public',
  'node_modules',
  'hooks',
  'types',
  'styles',
  'scratch',
]

export const FILES_TO_MIRROR = [
  'package.json',
  'next.config.mjs',
  'tsconfig.json',
  'postcss.config.js',
  'tailwind.config.ts',
  'components.json',
  'next-env.d.ts',
]

/**
 * Cria ou sincroniza o workspace isolado para Staging usando junctions (sem privilégios admin).
 */
export function setupStagingWorkspace(projectRootDir = process.cwd()) {
  const workspacePath = path.resolve(projectRootDir, STAGING_WORKSPACE_DIR)
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true })
  }

  // 1. Criar Directory Junctions para pastas do projeto
  for (const dirName of DIRS_TO_JUNCTION) {
    const srcDir = path.resolve(projectRootDir, dirName)
    const destJunction = path.resolve(workspacePath, dirName)

    if (fs.existsSync(srcDir)) {
      if (fs.existsSync(destJunction)) {
        // Se já existe, verifica se é um link válido
        try {
          const stat = fs.lstatSync(destJunction)
          if (!stat.isSymbolicLink()) {
            fs.rmSync(destJunction, { recursive: true, force: true })
            fs.symlinkSync(srcDir, destJunction, 'junction')
          }
        } catch {
          // Ignora se já estiver correto
        }
      } else {
        fs.symlinkSync(srcDir, destJunction, 'junction')
      }
    }
  }

  // 2. Copiar arquivos essenciais de configuração
  for (const fileName of FILES_TO_MIRROR) {
    const srcFile = path.resolve(projectRootDir, fileName)
    const destFile = path.resolve(workspacePath, fileName)

    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile)
    }
  }

  // 3. Garantir ausência ABSOLUTA de qualquer arquivo .env dentro do workspace isolado
  const workspaceEntries = fs.readdirSync(workspacePath)
  for (const entry of workspaceEntries) {
    if (entry.startsWith('.env')) {
      const forbiddenEnvPath = path.resolve(workspacePath, entry)
      fs.rmSync(forbiddenEnvPath, { force: true })
    }
  }

  return workspacePath
}

/**
 * Limpa com segurança os artefatos de compilação anteriores do workspace de staging.
 */
export function cleanStagingBuildArtifacts(projectRootDir = process.cwd()) {
  const nextBuildPath = path.resolve(projectRootDir, STAGING_WORKSPACE_DIR, '.next')
  if (fs.existsSync(nextBuildPath)) {
    fs.rmSync(nextBuildPath, { recursive: true, force: true })
  }
}

/**
 * Desfaz com segurança o workspace isolado (remove junctions sem tocar nos arquivos originais).
 */
export function teardownStagingWorkspace(projectRootDir = process.cwd()) {
  const workspacePath = path.resolve(projectRootDir, STAGING_WORKSPACE_DIR)
  if (!fs.existsSync(workspacePath)) return

  // 1. Desconectar Junctions com fs.unlinkSync (NUNCA rmSync recursivo em links)
  for (const dirName of DIRS_TO_JUNCTION) {
    const destJunction = path.resolve(workspacePath, dirName)
    if (fs.existsSync(destJunction)) {
      try {
        const stat = fs.lstatSync(destJunction)
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(destJunction)
        }
      } catch {
        // Ignora erros ao desvincular
      }
    }
  }

  // 2. Remover diretório do workspace e arquivos restantes
  try {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  } catch {
    // Ignora erros de permissão temporária
  }
}

/**
 * Obtém o caminho absoluto para o executável do Next.js CLI diretamente no node_modules.
 */
export function getNextBinPath(projectRootDir = process.cwd()) {
  const binPath = path.resolve(projectRootDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  if (!fs.existsSync(binPath)) {
    throw new Error(`Binário do Next.js não encontrado em '${binPath}'. Execute npm install antes.`)
  }
  return binPath
}
