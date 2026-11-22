import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'

export const STAGING_PROJECT_ID = 'dkjrpdhymtkgbknocijy'
export const PRODUCTION_PROJECT_ID = 'ipxhkwirzrigttpwzwbl'
export const STAGING_URL = `https://${STAGING_PROJECT_ID}.supabase.co`
export const TARGET_PORT = 3001
export const ALLOWED_HOSTS = ['127.0.0.1', 'localhost']

export const ALLOWED_OS_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CommonProgramFiles',
  'NODE_PATH',
  'LANG',
  'LC_ALL',
  'TERM',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'OS',
  'WINDIR',
]

/**
 * Decodifica o payload de um token JWT sem dependências externas.
 */
export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) {
    if (token.startsWith('sb_publishable_')) {
      return { type: 'publishable_key', raw: token }
    }
    return null
  }
  try {
    const raw = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Constrói um ambiente OS sanitizado a partir de allowlist estrita.
 */
export function buildCleanOsEnv(sourceEnv = process.env) {
  const cleanEnv = {}
  for (const key of ALLOWED_OS_ENV_KEYS) {
    // Busca case-insensitive no Windows
    const matchedKey = Object.keys(sourceEnv).find(k => k.toLowerCase() === key.toLowerCase())
    if (matchedKey && typeof sourceEnv[matchedKey] === 'string') {
      const val = sourceEnv[matchedKey]
      if (val.includes(PRODUCTION_PROJECT_ID)) {
        throw new Error(`[CRITICAL_SECURITY] Variável de sistema '${matchedKey}' contém referência ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
      }
      cleanEnv[matchedKey] = val
    }
  }
  return cleanEnv
}

/**
 * Faz parse de arquivo .env em um objeto chave-valor sem expor segredos.
 */
export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  const env = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

/**
 * Carrega a configuração estrita de staging com garantias criptográficas e estruturais.
 */
export function loadStagingConfig(projectRootDir = process.cwd()) {
  const stagingEnvPath = path.resolve(projectRootDir, '.env.staging.local')
  if (!fs.existsSync(stagingEnvPath)) {
    throw new Error(`Arquivo de configuração de staging '${stagingEnvPath}' não encontrado.`)
  }

  const stagingEnv = parseEnvFile(stagingEnvPath)
  const serviceRoleKey = stagingEnv.STAGING_SUPABASE_SERVICE_ROLE_KEY || stagingEnv.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = stagingEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || stagingEnv.STAGING_SUPABASE_ANON_KEY || 'sb_publishable__KT2STe7vpTeMctSqlZtvA_TrNDXCqD'
  const supabaseUrl = stagingEnv.NEXT_PUBLIC_SUPABASE_URL || stagingEnv.SUPABASE_URL || STAGING_URL

  if (!serviceRoleKey) {
    throw new Error('STAGING_SUPABASE_SERVICE_ROLE_KEY não localizada em .env.staging.local.')
  }

  // 1. Validação Criptográfica do JWT da Service Role Key
  const jwt = decodeJwtPayload(serviceRoleKey)
  if (jwt && jwt.ref) {
    if (jwt.ref === PRODUCTION_PROJECT_ID) {
      throw new Error(`[CRITICAL_SECURITY] A service_role informada pertence ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID})! Execução abortada imediatamente.`)
    }
    if (jwt.ref !== STAGING_PROJECT_ID) {
      throw new Error(`[INVALID_CREDENTIAL] A service_role pertence ao projeto '${jwt.ref}', divergindo do Staging (${STAGING_PROJECT_ID}).`)
    }
  } else if (serviceRoleKey.includes(PRODUCTION_PROJECT_ID)) {
    throw new Error(`[CRITICAL_SECURITY] service_role contém referência de texto a PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
  }

  // 2. Validação da URL
  if (!supabaseUrl.includes(STAGING_PROJECT_ID)) {
    throw new Error(`Supabase URL '${supabaseUrl}' não aponta para o projeto de Staging (${STAGING_PROJECT_ID}).`)
  }

  // 3. Comparação contra .env.local de produção (Garantia de Não-Coincidência)
  const prodEnvPath = path.resolve(projectRootDir, '.env.local')
  if (fs.existsSync(prodEnvPath)) {
    const prodEnv = parseEnvFile(prodEnvPath)
    if (prodEnv.SUPABASE_SERVICE_ROLE_KEY && prodEnv.SUPABASE_SERVICE_ROLE_KEY === serviceRoleKey) {
      throw new Error('[CRITICAL_SECURITY] A chave service_role configurada para Staging é IDÊNTICA à chave de PRODUÇÃO presente em .env.local!')
    }
    if (prodEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY && prodEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY === anonKey) {
      throw new Error('[CRITICAL_SECURITY] A chave anon configurada para Staging é IDÊNTICA à chave de PRODUÇÃO presente em .env.local!')
    }
    if (prodEnv.NEXT_PUBLIC_SUPABASE_URL && prodEnv.NEXT_PUBLIC_SUPABASE_URL === supabaseUrl) {
      throw new Error('[CRITICAL_SECURITY] A URL do Supabase configurada para Staging é IDÊNTICA à URL de PRODUÇÃO presente em .env.local!')
    }
  }

  const egressGuardPath = path.resolve(projectRootDir, 'scripts', 'egress-guard.cjs').replace(/\\/g, '/')

  return {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'disabled-in-homologation',
    VAPID_PRIVATE_KEY: 'disabled-in-homologation',
    VAPID_SUBJECT: 'disabled-in-homologation',
    EVOLUTION_API_URL: 'http://127.0.0.1:9',
    EVOLUTION_API_KEY: 'disabled-in-homologation',
    OPENAI_API_KEY: 'disabled-in-homologation',
    GEMINI_API_KEY: 'disabled-in-homologation',
    CRON_SECRET: 'staging-cron-secret-local-only',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(TARGET_PORT),
    HOSTNAME: '127.0.0.1',
    __NEXT_PROCESSED_ENV: 'true',
    NODE_OPTIONS: `--require "${egressGuardPath}"`,
  }
}

/**
 * Escaneia um diretório de bundle para verificar contaminação por strings de produção.
 */
export function scanBundleForForbiddenStrings(dirPath, forbiddenStrings = [PRODUCTION_PROJECT_ID]) {
  if (!fs.existsSync(dirPath)) return { scanned: 0, contaminated: [] }
  let scanned = 0
  const contaminated = []

  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (/\.(js|json|html|map)$/i.test(entry.name)) {
        scanned++
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          for (const forbidden of forbiddenStrings) {
            if (content.includes(forbidden)) {
              contaminated.push({ file: fullPath, stringFound: forbidden })
              break
            }
          }
        } catch {
          // Ignora arquivos inacessíveis
        }
      }
    }
  }

  scan(dirPath)
  return { scanned, contaminated }
}

/**
 * Verifica se a porta e host alvo estão disponíveis para bind loopback.
 */
export async function checkPortAvailability(port = TARGET_PORT, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => {
        resolve(false)
      })
      .once('listening', () => {
        tester.close(() => resolve(true))
      })
      .listen(port, host)
  })
}

/**
 * Executa a bateria de pré-flight fail-closed.
 */
export async function runPreflightCheck(options = {}) {
  const silent = options.silent || false
  const log = (...args) => { if (!silent) console.log(...args) }
  const errLog = (...args) => { if (!silent) console.error(...args) }

  log('=== [PRE-FLIGHT] INICIANDO VERIFICAÇÃO FAIL-CLOSED DO RUNTIME DE HOMOLOGAÇÃO ===')
  const failures = []
  const env = options.env || process.env
  const projectRootDir = options.projectRootDir || process.cwd()

  // 1. Verificação da URL do Supabase no Ambiente
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ''
  if (!supabaseUrl) {
    failures.push('NEXT_PUBLIC_SUPABASE_URL não configurada no ambiente.')
  } else if (!supabaseUrl.includes(STAGING_PROJECT_ID)) {
    failures.push(`NEXT_PUBLIC_SUPABASE_URL não aponta para o Staging autorizado (${STAGING_PROJECT_ID}). URL atual: ${supabaseUrl}`)
  }

  // 2. Verificação de Service Role Key e JWT
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!serviceRoleKey) {
    failures.push('SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente.')
  } else {
    const jwt = decodeJwtPayload(serviceRoleKey)
    if (jwt && jwt.ref) {
      if (jwt.ref === PRODUCTION_PROJECT_ID) {
        failures.push(`VIOLAÇÃO CRÍTICA: SUPABASE_SERVICE_ROLE_KEY é de PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
      } else if (jwt.ref !== STAGING_PROJECT_ID) {
        failures.push(`SUPABASE_SERVICE_ROLE_KEY aponta para ref desconhecida (${jwt.ref}), esperado: ${STAGING_PROJECT_ID}.`)
      }
    }
  }

  // 3. Verificação Absoluta de Produção em TODAS as variáveis de ambiente
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.includes(PRODUCTION_PROJECT_ID)) {
      failures.push(`VIOLAÇÃO CRÍTICA: Variável ${key} contém referência ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
    }
  }

  // 4. Verificação de Bind Host (Restrito estritamente a 127.0.0.1 / localhost)
  const host = env.HOSTNAME || '127.0.0.1'
  if (!ALLOWED_HOSTS.includes(host)) {
    failures.push(`[HOST_BIND_VIOLATION] Host '${host}' não autorizado. O runtime deve utilizar estritamente 127.0.0.1 ou localhost (0.0.0.0 PROIBIDO).`)
  }

  // 5. Verificação de Egress e Integrações Externas
  const evoUrl = env.EVOLUTION_API_URL || ''
  if (evoUrl && !evoUrl.includes('localhost') && !evoUrl.includes('127.0.0.1')) {
    failures.push(`EVOLUTION_API_URL configurada para host externo não seguro: ${evoUrl}. Deve ser vazia ou apontar para loopback.`)
  }

  // 6. Verificação de Integridade do Bundle compilado (.next)
  if (!options.skipBundleScan) {
    const targetNextDir = options.targetNextDir || path.resolve(projectRootDir, '.staging-workspace', '.next')
    const fallbackNextDir = path.resolve(projectRootDir, '.next')
    const dirToScan = fs.existsSync(targetNextDir) ? targetNextDir : (fs.existsSync(fallbackNextDir) ? fallbackNextDir : null)

    if (!dirToScan) {
      failures.push('Diretório .next não encontrado. Execute a compilação isolada para Staging antes de iniciar.')
    } else {
      // 6.1 Verificação de rotas compiladas no App Router (Evita builds vazios tipo /404 único)
      const appPathsManifestPath = path.join(dirToScan, 'server', 'app-paths-manifest.json')
      if (fs.existsSync(appPathsManifestPath)) {
        try {
          const manifestContent = JSON.parse(fs.readFileSync(appPathsManifestPath, 'utf8'))
          const routeCount = Object.keys(manifestContent).length
          if (routeCount === 0) {
            failures.push('[EMPTY_BUILD] app-paths-manifest.json está vazio (0 rotas reconhecidas). O App Router não foi compilado corretamente.')
          } else if (routeCount < 30) {
            failures.push(`[INCOMPLETE_BUILD] Apenas ${routeCount} rotas compiladas no app-paths-manifest.json. Esperado >= 34 rotas da aplicação.`)
          } else {
            log(`✔ Rotas compiladas no App Router verificadas: ${routeCount} rotas ativas.`)
          }
        } catch (err) {
          failures.push(`Falha ao ler app-paths-manifest.json: ${err.message}`)
        }
      }

      log(`Verificando se o bundle em '${path.relative(projectRootDir, dirToScan)}' possui URLs de produção embutidas...`)
      const scanResult = scanBundleForForbiddenStrings(dirToScan, [PRODUCTION_PROJECT_ID])
      if (scanResult.contaminated.length > 0) {
        for (const item of scanResult.contaminated) {
          failures.push(`Bundle contaminado: ${path.relative(projectRootDir, item.file)} contém referência a PRODUÇÃO (${item.stringFound}).`)
        }
      } else {
        log(`✔ Bundle verificado (${scanResult.scanned} arquivos): Zero referências a produção encontradas.`)
      }
    }
  }

  // 7. Verificação da Porta do Runtime (3001)
  if (!options.skipPortCheck) {
    const port = Number(env.PORT) || TARGET_PORT
    const portAvailable = await checkPortAvailability(port, host)
    if (!portAvailable) {
      failures.push(`Porta ${port} já está em uso por outro processo em ${host}. Encerre o processo anterior antes de iniciar.`)
    } else {
      log(`✔ Porta ${port} disponível para o runtime local em ${host}.`)
    }
  }

  // Conclusão Fail-Closed
  if (failures.length > 0) {
    errLog('\n❌ FALHA NO PRÉ-FLIGHT DE SEGURANÇA. MOTIVOS:')
    for (const f of failures) {
      errLog(`   - ${f}`)
    }
    errLog('\n[FAIL-CLOSED] O runtime local NÃO SERÁ INICIADO até que todos os itens acima sejam corrigidos.\n')
    return { ok: false, failures }
  }

  log('\n✅ TODOS OS CHECKS DE SEGURANÇA PASSARAM COM SUCESSO.')
  log('Ambiente blindado e autorizado para Staging (dkjrpdhymtkgbknocijy).\n')
  return { ok: true, failures: [] }
}

// Execução direta via CLI
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  let env = process.env
  try {
    const stagingConfig = loadStagingConfig()
    const cleanOs = buildCleanOsEnv(process.env)
    env = { ...cleanOs, ...stagingConfig }
  } catch (err) {
    console.error('Falha ao carregar staging config:', err.message)
    process.exit(1)
  }
  runPreflightCheck({ env }).then((res) => {
    process.exit(res.ok ? 0 : 1)
  })
}
