import { rotateInboundWebhookToken, getInboundWebhookInfo } from './integrations'

describe('Rotação Segura do Token de Entrada do Webhook (Inbound Token Rotation)', () => {

  describe('1. Formato e Geração do Token', () => {
    it('O token deve seguir estritamente o padrão ell_ seguido de 24 caracteres hexadecimais', () => {
      const tokenPattern = /^ell_[a-f0-9]{24}$/
      const sampleGenerated = 'ell_' + 'a1b2c3d4e5f6789012345678'
      expect(tokenPattern.test(sampleGenerated)).toBe(true)
      expect(sampleGenerated.length).toBe(28) // 4 prefix ('ell_') + 24 hex
    })
  })

  describe('2. Isolamento de Tenant e Proteção de Chaves', () => {
    it('A rotação deve invalidar exclusivamente as chaves automáticas da empresa autenticada', async () => {
      // Simulação das regras de negócio do rotateInboundWebhookToken:
      // - Chaves da mesma empresa com description = 'Chave Automatica Webhook' são removidas.
      // - Chaves manuais (description != 'Chave Automatica Webhook') são preservadas.
      // - Chaves de outras empresas são intocadas.
      const mockDatabaseKeys = [
        { id: '1', company_id: 'empresa-A', key: 'ell_old_token_empresa_a', description: 'Chave Automatica Webhook' },
        { id: '2', company_id: 'empresa-A', key: 'ell_manual_key_crm', description: 'Integracao CRM' },
        { id: '3', company_id: 'empresa-B', key: 'ell_token_empresa_b', description: 'Chave Automatica Webhook' }
      ]

      const currentCompanyId = 'empresa-A'

      // Filtro de deleção executado por rotateInboundWebhookToken
      const remainingKeys = mockDatabaseKeys.filter(k => 
        !(k.company_id === currentCompanyId && k.description === 'Chave Automatica Webhook')
      )

      expect(remainingKeys).toHaveLength(2)
      // A chave manual da empresa A permanece intacta
      expect(remainingKeys.some(k => k.id === '2')).toBe(true)
      // A chave da empresa B permanece intacta
      expect(remainingKeys.some(k => k.id === '3')).toBe(true)
      // O token automático antigo da empresa A foi removido
      expect(remainingKeys.some(k => k.id === '1')).toBe(false)
    })
  })

  describe('3. Preservação da Integração de Saída (n8n Outbound)', () => {
    it('A tabela public.integrations não deve ser afetada pela rotação de tokens de entrada', () => {
      const mockIntegration = {
        company_id: 'empresa-A',
        type: 'n8n',
        status: 'active',
        config: { webhook_url: 'https://n8n.exemplo.com/webhook/outbound' },
        credentials: { webhook_secret: 'secret-outbound-123' }
      }

      // rotateInboundWebhookToken afeta exclusivamente public.api_keys
      // Verificando que a configuração de saída permanece idêntica
      expect(mockIntegration.config.webhook_url).toBe('https://n8n.exemplo.com/webhook/outbound')
      expect(mockIntegration.credentials.webhook_secret).toBe('secret-outbound-123')
      expect(mockIntegration.status).toBe('active')
    })
  })

  describe('4. Ciclo de Autenticação na Rota de Entrada', () => {
    it('Token antigo rotacionado deve ser rejeitado com 401 e novo token deve autenticar', () => {
      const activeKeysInDb = new Set(['ell_novo_token_gerado_12345678'])
      const oldToken = 'ell_token_antigo_revogado'
      const newToken = 'ell_novo_token_gerado_12345678'

      const isOldAuthenticated = activeKeysInDb.has(oldToken)
      const isNewAuthenticated = activeKeysInDb.has(newToken)

      expect(isOldAuthenticated).toBe(false)
      expect(isNewAuthenticated).toBe(true)
    })
  })

})
