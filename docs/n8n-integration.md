# Integração Ellevee IA & n8n

A fase 6 oficializou o n8n como o orquestrador padrão para comunicação do Ellevee com o mundo exterior (como WhatsApp).

A arquitetura garante que todo o *Message Engine* (processamento de fila, cliente, inteligência) fique contido no Ellevee, enquanto o n8n atua apenas como "carteiro".

## Fluxo Inbound (Recebendo do n8n)
O n8n captura o webhook do provedor (WhatsApp) e envia um POST JSON padronizado para o Ellevee:
- **Endpoint:** `POST /api/webhooks/messages`
- **Header:** `x-ellevee-webhook-secret` (Configurado na tabela api_keys da empresa)

Veja a estrutura do payload no documento [webhooks.md](./webhooks.md).

## Fluxo Outbound (Enviando para o n8n)
Quando o humano responde pela Central de Conversas (ou futuramente o Agente IA):
1. O Ellevee salva a mensagem localmente no banco de dados (`messages`).
2. O Ellevee busca na tabela `integrations` a URL do webhook do n8n cadastrada pela empresa.
3. O Ellevee faz um **POST** para essa URL, assinando o header com o token configurado pela empresa.

### Payload de Saída (Outbound)

O n8n deve estar com um "Webhook Node" escutando chamadas POST com o seguinte formato:

```json
{
  "event_id": "outbound-0123",
  "event_type": "message.send",
  "channel": "whatsapp",
  "conversation_id": "c13511eb-...",
  "customer": {
    "phone": "5511999999999"
  },
  "message": {
    "content": "Olá, humano respondendo do Ellevee!",
    "message_type": "text"
  },
  "metadata": {}
}
```

### Segurança e Idempotência
1. O Ellevee testa a URL do n8n para **proteger contra SSRF**, bloqueando endpoints internos como `localhost`.
2. As credenciais nunca ficam expostas no front-end.
3. Todo evento de ida ou volta é logado com o `event_id` na tabela `integration_events` e na `webhook_events`, permitindo retry futuro seguro.
