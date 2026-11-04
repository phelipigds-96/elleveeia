'use server'

import {
  getInboundWebhookInfoInternal,
  rotateInboundWebhookTokenInternal,
  getN8nIntegrationInternal,
  saveN8nIntegrationInternal,
  disconnectN8nInternal
} from './integrations-internal'

/**
 * Server Action pública: obtém as informações do webhook de entrada.
 * Identidade e permissões são extraídas exclusivamente da sessão do servidor.
 * Não aceita parâmetros injetados pelo cliente.
 */
export async function getInboundWebhookInfo(): Promise<{ token: string } | null> {
  return await getInboundWebhookInfoInternal()
}

/**
 * Server Action pública: rotaciona o token do webhook de entrada da empresa autenticada.
 * Operação atômica que preserva o token prévio em caso de falha de gravação.
 * Não aceita parâmetros injetados pelo cliente.
 */
export async function rotateInboundWebhookToken(): Promise<{ success: boolean; token?: string; error?: string; code?: string }> {
  return await rotateInboundWebhookTokenInternal()
}

/**
 * Server Action pública: consulta a integração n8n ativa da empresa autenticada.
 * Não aceita parâmetros injetados pelo cliente.
 */
export async function getN8nIntegration() {
  return await getN8nIntegrationInternal()
}

/**
 * Server Action pública: salva ou atualiza a integração com o n8n.
 * Aceita exclusivamente os dados de configuração (url e secret).
 * Não aceita clientes Supabase, identificadores de tenant ou de usuário pelo navegador.
 */
export async function saveN8nIntegration(
  url: string, 
  secret: string
): Promise<{ success: boolean; error?: string; code?: string }> {
  return await saveN8nIntegrationInternal(url, secret)
}

/**
 * Server Action pública: desconecta a integração n8n da empresa autenticada.
 * Não aceita parâmetros injetados pelo cliente.
 */
export async function disconnectN8n(): Promise<{ success: boolean; error?: string; code?: string }> {
  return await disconnectN8nInternal()
}
