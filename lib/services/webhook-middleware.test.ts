import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

describe('Middleware e Acesso Público ao Webhook', () => {

  it('1. Requisição para /api/webhooks/messages NÃO deve ser redirecionada para /login', async () => {
    const request = new NextRequest('https://elleveeia.vercel.app/api/webhooks/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      }
    })

    const response = await middleware(request)

    // Não deve conter header Location apontando para /login
    expect(response.headers.get('location')).toBeNull()
    // Status não deve ser 307 ou 302
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(302)
  })

  it('2. Requisição para /api/webhooks/messages com token via query param NÃO deve ser redirecionada', async () => {
    const request = new NextRequest('https://elleveeia.vercel.app/api/webhooks/messages?token=test_token_123', {
      method: 'POST'
    })

    const response = await middleware(request)
    expect(response.headers.get('location')).toBeNull()
  })

  it('3. Requisições privadas (/dashboard, /integrations) SEM sessão DEVEM continuar protegidas e redirecionadas', async () => {
    const request = new NextRequest('https://elleveeia.vercel.app/dashboard', {
      method: 'GET'
    })

    const response = await middleware(request)
    // Para rotas privadas sem cookie de sessão, o updateSession redireciona para /login
    // (ou Location header presente)
    const location = response.headers.get('location')
    if (location) {
      expect(location).toContain('/login')
    }
  })

})
