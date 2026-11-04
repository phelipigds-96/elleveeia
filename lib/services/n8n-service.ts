'use server'

import { testN8nConnectionActionInternal } from './n8n-internal'

/**
 * Server Action pública protegida para teste de conectividade com o n8n.
 * 
 * Assinatura estrita: aceita exclusivamente os parâmetros de configuração (url e secret).
 * Identidade, perfil e autorizações são resolvidos estritamente pelo contexto da sessão no servidor.
 * Não aceita clientes Supabase ou opções de autorização fornecidos pelo navegador.
 */
export async function testN8nConnection(
  url: string, 
  secret: string
): Promise<{ success: boolean; message: string; error?: string; code?: string }> {
  return await testN8nConnectionActionInternal(url, secret)
}
