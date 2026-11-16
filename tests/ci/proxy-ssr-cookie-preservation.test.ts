// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'

describe('HOMOLOGAÇÃO PROXY SSR — Preservação Cirúrgica de Cookies em Redirects (Next.js 16)', () => {
  const originalEnvUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalEnvKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key'
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnvUrl
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalEnvKey
    setMockSupabaseClient(null)
  })

  test('1. Usuário autenticado acessando /login com renovação de token: redirect preserva cookies', async () => {
    setMockSupabaseClient((url, key, options) => ({
      auth: {
        async getUser() {
          options?.cookies?.setAll([
            {
              name: 'sb-localhost-auth-token',
              value: 'refreshed-token-abc-123',
              options: {
                httpOnly: true,
                secure: true,
                maxAge: 3600,
                path: '/',
                sameSite: 'lax',
              },
            },
          ])
          return {
            data: { user: { id: 'usr-1', email: 'atendente@ellevee.com' } },
            error: null,
          }
        },
      },
    }))

    const req = new NextRequest('http://localhost:3000/login', {
      headers: {
        cookie: 'sb-localhost-auth-token=stale-token',
      },
    })

    const res = await proxy(req)

    assert.equal(res.status, 307, 'Deve redirecionar usuário autenticado')
    assert.equal(res.headers.get('location'), 'http://localhost:3000/conversations')

    const preservedCookie = res.cookies.get('sb-localhost-auth-token')
    assert.ok(preservedCookie, 'Cookie de autenticação deve existir no redirect')
    assert.equal(preservedCookie.value, 'refreshed-token-abc-123', 'Cookie deve conter o token renovado')
    assert.equal(preservedCookie.httpOnly, true)
    assert.equal(preservedCookie.secure, true)
  })

  test('2. Usuário autenticado acessando /signup: redirect preserva cookies', async () => {
    setMockSupabaseClient((url, key, options) => ({
      auth: {
        async getUser() {
          options?.cookies?.setAll([
            {
              name: 'sb-localhost-auth-token',
              value: 'signup-renewed-token-xyz',
              options: {
                httpOnly: true,
                secure: true,
                maxAge: 3600,
                path: '/',
                sameSite: 'lax',
              },
            },
          ])
          return {
            data: { user: { id: 'usr-2', email: 'admin@ellevee.com' } },
            error: null,
          }
        },
      },
    }))

    const req = new NextRequest('http://localhost:3000/signup', {
      headers: {
        cookie: 'sb-localhost-auth-token=existing-token',
      },
    })

    const res = await proxy(req)

    assert.equal(res.status, 307)
    assert.equal(res.headers.get('location'), 'http://localhost:3000/conversations')

    const preserved = res.cookies.get('sb-localhost-auth-token')
    assert.ok(preserved)
    assert.equal(preserved.value, 'signup-renewed-token-xyz')
  })

  test('3. Usuário sem sessão acessando rota privada: redirect correto para /login', async () => {
    // Supabase não deve ser chamado quando não há auth cookie
    setMockSupabaseClient({
      auth: {
        async getUser() {
          throw new Error('Supabase não deve ser invocado sem cookie de autenticação!')
        },
      },
    })

    const req = new NextRequest('http://localhost:3000/dashboard')
    const res = await proxy(req)

    assert.equal(res.status, 307)
    assert.equal(res.headers.get('location'), 'http://localhost:3000/login')
    assert.equal(res.cookies.getAll().length, 0, 'Nenhum cookie de auth deve ser setado')
  })

  test('4. Múltiplos cookies emitidos pelo Supabase: todos preservados', async () => {
    setMockSupabaseClient((url, key, options) => ({
      auth: {
        async getUser() {
          options?.cookies?.setAll([
            {
              name: 'sb-localhost-auth-token.0',
              value: 'chunk-part-zero',
              options: { httpOnly: true, secure: true, maxAge: 7200, path: '/' },
            },
            {
              name: 'sb-localhost-auth-token.1',
              value: 'chunk-part-one',
              options: { httpOnly: true, secure: true, maxAge: 7200, path: '/' },
            },
            {
              name: 'sb-refresh-token',
              value: 'refresh-secret-token',
              options: { httpOnly: true, secure: true, maxAge: 604800, path: '/' },
            },
          ])
          return {
            data: { user: { id: 'usr-multi', email: 'multi@ellevee.com' } },
            error: null,
          }
        },
      },
    }))

    const req = new NextRequest('http://localhost:3000/login', {
      headers: {
        cookie: 'sb-localhost-auth-token=stale',
      },
    })

    const res = await proxy(req)

    assert.equal(res.status, 307)
    assert.equal(res.headers.get('location'), 'http://localhost:3000/conversations')

    const cookies = res.cookies.getAll()
    assert.equal(cookies.length, 3, 'Todos os 3 cookies emitidos pelo Supabase devem ser preservados')
    assert.equal(res.cookies.get('sb-localhost-auth-token.0')?.value, 'chunk-part-zero')
    assert.equal(res.cookies.get('sb-localhost-auth-token.1')?.value, 'chunk-part-one')
    assert.equal(res.cookies.get('sb-refresh-token')?.value, 'refresh-secret-token')
  })

  test('5. Cookies com atributos de segurança: atributos preservados', async () => {
    setMockSupabaseClient((url, key, options) => ({
      auth: {
        async getUser() {
          options?.cookies?.setAll([
            {
              name: 'sb-localhost-auth-token',
              value: 'secure-token-val',
              options: {
                httpOnly: true,
                secure: true,
                maxAge: 7200,
                path: '/',
                sameSite: 'strict',
              },
            },
          ])
          return {
            data: { user: { id: 'usr-secure' } },
            error: null,
          }
        },
      },
    }))

    const req = new NextRequest('http://localhost:3000/login', {
      headers: {
        cookie: 'sb-localhost-auth-token=init',
      },
    })

    const res = await proxy(req)
    const cookie = res.cookies.get('sb-localhost-auth-token')

    assert.ok(cookie)
    assert.equal(cookie.value, 'secure-token-val')
    assert.equal(cookie.httpOnly, true, 'Atributo httpOnly deve ser preservado')
    assert.equal(cookie.secure, true, 'Atributo secure deve ser preservado')
    assert.equal(cookie.maxAge, 7200, 'Atributo maxAge deve ser preservado')
    assert.equal(cookie.path, '/', 'Atributo path deve ser preservado')
    assert.equal(cookie.sameSite?.toLowerCase(), 'strict', 'Atributo sameSite deve ser preservado')
  })

  test('6. Sessão válida sem renovação: comportamento original mantido', async () => {
    setMockSupabaseClient({
      auth: {
        async getUser() {
          // Sessão válida mas sem emitir setAll
          return {
            data: { user: { id: 'usr-steady', email: 'admin@steady.com' } },
            error: null,
          }
        },
      },
    })

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: {
        cookie: 'sb-localhost-auth-token=active-token',
      },
    })

    const res = await proxy(req)

    assert.equal(res.status, 200, 'Não deve redirecionar; rota privada autorizada')
    assert.equal(res.headers.get('location'), null, 'Não deve conter header Location')
  })

  test('7. Sessão expirada ou inválida: comportamento seguro com preservação de cookies de limpeza', async () => {
    setMockSupabaseClient((url, key, options) => ({
      auth: {
        async getUser() {
          // Supabase limpa os cookies inválidos
          options?.cookies?.setAll([
            {
              name: 'sb-localhost-auth-token',
              value: '',
              options: { maxAge: 0, path: '/' },
            },
          ])
          return {
            data: { user: null },
            error: new Error('Invalid JWT: token has expired'),
          }
        },
      },
    }))

    const req = new NextRequest('http://localhost:3000/agent', {
      headers: {
        cookie: 'sb-localhost-auth-token=expired-token',
      },
    })

    const res = await proxy(req)

    assert.equal(res.status, 307, 'Deve redirecionar para /login')
    assert.equal(res.headers.get('location'), 'http://localhost:3000/login')

    const cleanCookie = res.cookies.get('sb-localhost-auth-token')
    assert.ok(cleanCookie, 'Cookie de limpeza deve estar presente no redirect para expirar no navegador')
    assert.equal(cleanCookie.maxAge, 0)
  })

  test('8. Falha ou timeout do Supabase: sem autenticação indevida', async () => {
    setMockSupabaseClient({
      auth: {
        async getUser() {
          return {
            data: { user: null },
            error: new Error('SUPABASE_AUTH_TIMEOUT_2500MS'),
          }
        },
      },
    })

    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: {
        cookie: 'sb-localhost-auth-token=stalled-token',
      },
    })

    const res = await proxy(req)

    assert.equal(res.status, 307, 'Deve redirecionar para /login por segurança em timeout')
    assert.equal(res.headers.get('location'), 'http://localhost:3000/login')
  })

  test('9. Ausência de regressão nos bypasses de webhooks, Cron, Outbox e recursos PWA', async () => {
    // Configura mock que lançaria erro se qualquer uma dessas rotas chamasse o Supabase
    setMockSupabaseClient({
      auth: {
        async getUser() {
          throw new Error('Supabase NUNCA deve ser invocado em rotas de bypass!')
        },
      },
    })

    const bypassRoutes = [
      '/sw.js',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/api/webhooks/messages',
      '/api/cron/outbox-worker',
      '/api/outbox/process',
    ]

    for (const route of bypassRoutes) {
      const req = new NextRequest(`http://localhost:3000${route}`)
      const res = await proxy(req)
      assert.equal(res.status, 200, `Rota ${route} deve executar bypass limpo (status 200)`)
      assert.equal(res.headers.get('location'), null, `Rota ${route} não deve redirecionar`)
    }
  })
})
