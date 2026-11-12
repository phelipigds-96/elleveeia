import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LOADER_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(LOADER_DIR, '..', '..')
const MOCKS_DIR = path.join(LOADER_DIR, 'mocks')

function resolveWithTsExtensions(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.mjs'),
    path.join(basePath, 'index.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return pathToFileURL(candidate).href
    }
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,',
    }
  }

  if (specifier === '@supabase/supabase-js') {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(MOCKS_DIR, 'supabase-mock.mjs')).href,
    }
  }

  if (specifier === '@supabase/ssr') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export function createServerClient(){return {}}',
    }
  }

  if (specifier === 'next/headers') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export function cookies(){return {getAll(){return []},set(){}}} export function headers(){return new Headers()}',
    }
  }

  if (specifier === 'next/server') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export class NextResponse extends Response { static json(body, init = {}) { const headers = new Headers(init.headers); if (!headers.has("content-type")) headers.set("content-type", "application/json"); return new Response(JSON.stringify(body), { ...init, headers }); } }',
    }
  }

  if (specifier === 'next/cache') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export function revalidatePath(){} export function revalidateTag(){}',
    }
  }

  if (specifier === '@google/genai') {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(MOCKS_DIR, 'genai-mock.mjs')).href,
    }
  }

  if (specifier === '@/lib/services/agent/engine' && process.env.MOCK_AGENT_ENGINE === '1') {
    return {
      shortCircuit: true,
      url: pathToFileURL(path.join(MOCKS_DIR, 'agent-mock.mjs')).href,
    }
  }

  if (specifier.startsWith('@/')) {
    const target = path.join(REPO_ROOT, specifier.slice(2))
    const resolved = resolveWithTsExtensions(target)
    if (resolved) {
      return { shortCircuit: true, url: resolved }
    }
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL))
    const target = path.resolve(parentDir, specifier)
    const resolved = resolveWithTsExtensions(target)
    if (resolved) {
      return { shortCircuit: true, url: resolved }
    }
  }

  return nextResolve(specifier, context)
}
