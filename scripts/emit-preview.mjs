/**
 * Gera a entrada estática publicável da prévia (index.html) a partir da
 * raiz do projeto, sem alterar o build de servidor do Next.js.
 *
 * O build do Next continua gerando a pasta .next (runtime com servidor,
 * Server Actions, API routes e middleware do Supabase). Este passo apenas
 * publica uma cópia do index.html estático na pasta out/, que é a saída
 * convention servida pela prévia estática.
 */
import { copyFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'index.html')
const outDir = path.join(root, 'out')
const target = path.join(outDir, 'index.html')

try {
  await access(source, constants.R_OK)
} catch {
  console.warn('[preview] index.html estático não encontrado em', source)
  process.exit(0)
}

await mkdir(outDir, { recursive: true })
await copyFile(source, target)
console.log('[preview] entrada estática publicada em', path.relative(root, target))
