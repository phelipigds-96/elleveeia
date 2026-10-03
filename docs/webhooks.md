# Webhooks e API Externa do Ellevee IA

O Ellevee IA possui um motor de mensageria assíncrono projetado para lidar com integrações externas (n8n, Evolution API, Zendesk, etc.).

A API foi projetada tendo em mente três premissas fundamentais:
1. **Tenant Isolation**: Eventos só são processados em nome de uma empresa se o `x-ellevee-webhook-secret` corresponder exatamente a essa empresa na tabela `api_keys`.
2. **Idempotência Absoluta**: Se o mesmo pacote (ou falha de rede do n8n) acionar o webhook duas ou mil vezes, o banco de dados e o motor (`webhook_events`) recusam o retrabalho silenciosamente usando constraints na chave `(company_id, event_id)`, retornando um `200` amigável de duplicidade.
3. **Robustez Estrutural (Cascata)**: Criamos e recuperamos o Customer, depois a Conversa e por fim a Mensagem, tudo guiado apenas por chaves de negócio (telefone e canais) abstraindo o peso estrutural para os *adaptadores externos*.

## Endpoint de Recepção de Mensagens

- **Rota:** `POST /api/webhooks/messages`
- **Autenticação:** Header `x-ellevee-webhook-secret` 
- **Content-Type:** `application/json`

### Exemplo de Payload Esperado

```json
{
  "event_id": "evt_987654321",
  "event_type": "message.received",
  "channel": "whatsapp",
  "external_customer_id": "5511999999999",
  "customer": {
    "name": "Cliente de Teste",
    "phone": "5511999999999",
    "email": "cliente@teste.com"
  },
  "conversation": {
    "external_id": "ticket_1234"
  },
  "message": {
    "external_id": "msg_0001",
    "sender_type": "customer",
    "content": "Olá, queria ver a disponibilidade do agente IA.",
    "message_type": "text",
    "created_at": "2026-10-03T12:00:00Z"
  },
  "metadata": {}
}
```

### Exemplo de Resposta (Sucesso)
```json
{
  "success": true,
  "duplicate": false,
  "event_id": "evt_987654321",
  "conversation_id": "c13511eb-...",
  "message_id": "f51b51ab-..."
}
```

### Exemplo de Resposta (Evento Repetido)
```json
{
  "success": true,
  "duplicate": true,
  "event_id": "evt_987654321"
}
```

## Como testar localmente
Crie um cadastro falso na tabela `api_keys` associado à sua Empresa manualmente pelo SQL Editor:
```sql
INSERT INTO public.api_keys (company_id, key, description) 
VALUES ('<SEU-COMPANY-ID-AQUI>', 'TEST_SECRET_123', 'Postman Dev');
```

E rode o curl apontando para `localhost:3000`:
```bash
curl -X POST \
  http://localhost:3000/api/webhooks/messages \
  -H "Content-Type: application/json" \
  -H "x-ellevee-webhook-secret: TEST_SECRET_123" \
  -d '{ ... payload ... }'
```
