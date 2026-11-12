import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const violations = []

function walkFiles(dir, exts) {
  const fullDir = path.join(ROOT, dir)
  if (!fs.existsSync(fullDir)) return []
  const out = []
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(rel, exts))
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(rel)
    }
  }
  return out
}

const sourceFiles = [
  ...walkFiles('app', ['.ts', '.tsx']),
  ...walkFiles('components', ['.ts', '.tsx']),
  ...walkFiles('lib', ['.ts', '.tsx']),
].filter((file) => !file.endsWith('.test.ts'))

// 1. Client boundary check: nenhum arquivo "use client" pode importar service-role ou ler SUPABASE_SERVICE_ROLE_KEY
for (const file of sourceFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const firstNonEmpty = content.trimStart().slice(0, 30)
  const isClient = firstNonEmpty.startsWith("'use client'") || firstNonEmpty.startsWith('"use client"')
  if (isClient) {
    if (content.includes('@/lib/supabase/service') || content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      violations.push(`[ClientBoundary] Arquivo client "${file}" referencia service-role do Supabase.`)
    }
  }

  // 2. Exposição de segredos em NEXT_PUBLIC_
  const publicVarMatches = content.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) || []
  for (const varName of publicVarMatches) {
    if (/(SERVICE_ROLE|CRON_SECRET|N8N_INTERNAL_SECRET|OPENAI_API_KEY|GEMINI_API_KEY|PRIVATE_KEY)/i.test(varName)) {
      violations.push(`[PublicEnvLeak] Variável sensível exposta como pública em "${file}": ${varName}`)
    }
  }
}

// 3. Guard do endpoint legado /api/outbox/process (410 Gone) e ausência de dispatchOutboxMessage em conversations/actions.ts
const legacyRoutePath = path.join(ROOT, 'app/api/outbox/process/route.ts')
if (!fs.existsSync(legacyRoutePath)) {
  violations.push('[OutboxGuard] Arquivo app/api/outbox/process/route.ts não encontrado.')
} else {
  const legacySrc = fs.readFileSync(legacyRoutePath, 'utf8')
  if (!legacySrc.includes('410')) {
    violations.push('[OutboxGuard] app/api/outbox/process/route.ts deve retornar HTTP 410 Gone.')
  }
}

const convActionsPath = path.join(ROOT, 'app/(dashboard)/conversations/actions.ts')
if (fs.existsSync(convActionsPath)) {
  const convSrc = fs.readFileSync(convActionsPath, 'utf8')
  if (/\bdispatchOutboxMessage\b/.test(convSrc)) {
    violations.push('[OutboxGuard] app/(dashboard)/conversations/actions.ts não deve chamar dispatchOutboxMessage.')
  }
}

// 4. Server Actions do SuperAdmin devem chamar requirePlatformAdmin(
const adminActionFiles = walkFiles('app/(admin)', ['.ts'])
for (const file of adminActionFiles) {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const trimmed = content.trimStart()
  const isUseServer = trimmed.startsWith("'use server'") || trimmed.startsWith('"use server"')
  if (isUseServer && !content.includes('requirePlatformAdmin(')) {
    violations.push(`[AdminAuthGuard] Server Action administrativa "${file}" não chama requirePlatformAdmin().`)
  }
}

// 5. Higiene e unicidade de prefixos nas migrations SQL
const migrationsDir = path.join(ROOT, 'supabase/migrations')
if (!fs.existsSync(migrationsDir)) {
  violations.push('[MigrationGuard] Diretório supabase/migrations não encontrado.')
} else {
  const sqlFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const requiredEnterpriseMigrations = [
    '2026111201_engine_reliability_2b.sql',
    '2026111202_enterprise_observability_3a.sql',
    '2026111203_enterprise_governance_3b.sql',
  ]
  for (const reqFile of requiredEnterpriseMigrations) {
    if (!sqlFiles.includes(reqFile)) {
      violations.push(`[MigrationGuard] Migration obrigatória ausente: ${reqFile}`)
    }
  }

  for (const file of sqlFiles) {
    if (file.startsWith('20261112')) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      if (/\b(DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i.test(sql)) {
        violations.push(`[MigrationGuard] Migration aditiva "${file}" contém comando destrutivo DROP/TRUNCATE.`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('❌ CI Security & Integrity Check FALHOU:')
  for (const v of violations) {
    console.error(`  - ${v}`)
  }
  process.exit(1)
}

console.log(`✅ CI Security & Integrity Check aprovado (${sourceFiles.length} arquivos fonte verificados, 0 violações).`)
