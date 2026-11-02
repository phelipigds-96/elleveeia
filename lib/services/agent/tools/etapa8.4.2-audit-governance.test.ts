// @ts-nocheck
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

// Importações do novo módulo central de auditoria
import {
  logPlatformAudit,
  executeAuditedAction,
  sanitizePayload,
  PlatformAuditError,
  type LogPlatformAuditParams,
  type PlatformAuditEventAction
} from '@/lib/services/platform/audit'

// Importações de autorização de admin.ts
import {
  requirePlatformAdmin,
  PlatformAuthError,
  logPlatformAudit as logPlatformAuditReexported,
  executeAuditedAction as executeAuditedActionReexported,
  PlatformAuditError as PlatformAuditErrorReexported,
  type PlatformOperatorContext
} from '@/lib/services/platform/admin'

describe('ETAPA 8.4.2 — Serviço Central de Auditoria e Governança da Plataforma', () => {
  const SUPERADMIN_ID = '00000000-0000-0000-0000-000000000001'
  const ATTENDANT_USER_ID = '00000000-0000-0000-0000-000000000099'
  const TARGET_COMPANY_ID = 'c1000000-0000-0000-0000-000000000001'

  // Banco de dados simulado em memória
  const operatorsDb: Record<string, any> = {
    [SUPERADMIN_ID]: {
      id: SUPERADMIN_ID,
      email: 'superadmin@elleveeia.com.br',
      full_name: 'Superadministrador Principal',
      role: 'superadmin',
      active: true,
      created_at: '2026-10-31T12:00:00Z',
      updated_at: '2026-10-31T12:00:00Z'
    }
  }

  const auditLogsCaptured: any[] = []

  function createAuthClient(userId: string, email: string) {
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: userId, email } },
          error: null
        })
      }
    }
  }

  function createMockAdminClient(options: { failOnAuditInsert?: boolean } = {}) {
    return {
      from: (table: string) => {
        if (table === 'platform_admins') {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                single: async () => {
                  const record = operatorsDb[val]
                  if (!record) {
                    return { data: null, error: { message: 'Row not found', code: 'PGRST116' } }
                  }
                  return { data: { ...record }, error: null }
                }
              })
            })
          }
        }
        if (table === 'platform_audit_logs') {
          return {
            insert: async (data: any) => {
              if (options.failOnAuditInsert) {
                return {
                  error: {
                    message: 'Simulated DB connection failure or constraint violation on platform_audit_logs',
                    code: '57P01'
                  }
                }
              }
              const row = {
                id: 'log-' + (auditLogsCaptured.length + 1),
                ...data,
                created_at: new Date().toISOString()
              }
              auditLogsCaptured.push(row)
              return { data: row, error: null }
            },
            update: () => ({
              eq: () => ({
                then: (resolve) => resolve({
                  data: null,
                  error: { message: 'Operação proibida: logs de auditoria da plataforma são estritamente imutáveis.', code: 'P0001' }
                })
              })
            }),
            delete: () => ({
              eq: () => ({
                then: (resolve) => resolve({
                  data: null,
                  error: { message: 'Operação proibida: logs de auditoria da plataforma são estritamente imutáveis.', code: 'P0001' }
                })
              })
            })
          }
        }
        return {
          select: () => ({ single: async () => ({ data: null, error: null }) }),
          insert: async () => ({ error: null })
        }
      }
    }
  }

  const standardAdminClient = createMockAdminClient()

  const validSuperContext: PlatformOperatorContext = {
    user: {
      id: SUPERADMIN_ID,
      email: 'superadmin@elleveeia.com.br'
    },
    operator: {
      id: SUPERADMIN_ID,
      email: 'superadmin@elleveeia.com.br',
      fullName: 'Superadministrador Principal',
      role: 'superadmin',
      active: true,
      createdAt: '2026-10-31T12:00:00Z',
      updatedAt: '2026-10-31T12:00:00Z'
    }
  }

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Registro de evento administrativo válido
  // ----------------------------------------------------------------------------
  test('1. Registro de evento administrativo válido', async () => {
    const initialCount = auditLogsCaptured.length
    await logPlatformAudit({
      actorId: SUPERADMIN_ID,
      actorEmail: 'superadmin@elleveeia.com.br',
      action: 'company.created',
      targetCompanyId: TARGET_COMPANY_ID,
      payloadSummary: { company_name: 'Nova Empresa SA', plan: 'pro' },
      reason: 'Cadastro inicial de cliente',
      status: 'success'
    }, standardAdminClient)

    assert.equal(auditLogsCaptured.length, initialCount + 1)
    const log = auditLogsCaptured[auditLogsCaptured.length - 1]
    assert.equal(log.actor_id, SUPERADMIN_ID)
    assert.equal(log.action, 'company.created')
    assert.equal(log.status, 'success')
    assert.equal(log.payload_summary.company_name, 'Nova Empresa SA')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Identificação correta do ator autenticado (sem confiar no frontend)
  // ----------------------------------------------------------------------------
  test('2. Identificação correta do ator autenticado a partir do contexto', async () => {
    // Tentativa maliciosa de informar no payload summary um ator forjado
    await executeAuditedAction(
      validSuperContext,
      {
        action: 'company.limits_changed',
        targetCompanyId: TARGET_COMPANY_ID,
        payloadSummary: {
          forged_actor_id: 'hacker-fake-id',
          forged_actor_email: 'hacker@malicious.com',
          max_users: 10
        }
      },
      async () => ({ updated: true }),
      standardAdminClient
    )

    const log = auditLogsCaptured[auditLogsCaptured.length - 1]
    // O log DEVE ter gravado exclusivamente o ator extraído do contexto seguro do servidor
    assert.equal(log.actor_id, SUPERADMIN_ID)
    assert.equal(log.actor_email, 'superadmin@elleveeia.com.br')
    assert.notEqual(log.actor_id, 'hacker-fake-id')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Registro de ação e empresa-alvo
  // ----------------------------------------------------------------------------
  test('3. Registro de ação padronizada e empresa-alvo', async () => {
    await executeAuditedAction(
      validSuperContext,
      {
        action: 'company.plan_changed',
        targetCompanyId: TARGET_COMPANY_ID,
        payloadSummary: { old_plan: 'standard', new_plan: 'enterprise' },
        reason: 'Upgrade comercial'
      },
      async () => ({ planUpdated: true }),
      standardAdminClient
    )

    const log = auditLogsCaptured[auditLogsCaptured.length - 1]
    assert.equal(log.action, 'company.plan_changed')
    assert.equal(log.target_company_id, TARGET_COMPANY_ID)
    assert.equal(log.reason, 'Upgrade comercial')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Sanitização recursiva de objetos
  // ----------------------------------------------------------------------------
  test('4. Sanitização recursiva de objetos', () => {
    const raw = {
      level1: {
        company_name: 'Empresa Alpha',
        level2: {
          active: true,
          level3: {
            db_password: 'super_secret_database_pass',
            webhook_secret: 'whsec_secret_hash_value',
            safe_metric: 120
          }
        }
      }
    }

    const sanitized = sanitizePayload(raw)
    assert.equal(sanitized.level1.company_name, 'Empresa Alpha')
    assert.equal(sanitized.level1.level2.active, true)
    assert.equal(sanitized.level1.level2.level3.safe_metric, 120)
    assert.equal(sanitized.level1.level2.level3.db_password, '[REDACTED]')
    assert.equal(sanitized.level1.level2.level3.webhook_secret, '[REDACTED]')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Sanitização recursiva de arrays
  // ----------------------------------------------------------------------------
  test('5. Sanitização recursiva de arrays', () => {
    const raw = {
      integrations: [
        { provider: 'openai', api_key: 'sk_mock_1234567890abcdef1234567890' },
        { provider: 'gemini', token: 'secret-token-value' },
        { provider: 'anthropic', connection_data: 'Bearer ya29.secret_bearer_token' },
        { provider: 'evolution', status: 'connected', webhook_url: 'https://api.empresa.com' }
      ]
    }

    const sanitized = sanitizePayload(raw)
    assert.equal(sanitized.integrations[0].provider, 'openai')
    assert.equal(sanitized.integrations[0].api_key, '[REDACTED]')
    assert.equal(sanitized.integrations[1].provider, 'gemini')
    assert.equal(sanitized.integrations[1].token, '[REDACTED]')
    assert.equal(sanitized.integrations[2].provider, 'anthropic')
    assert.equal(sanitized.integrations[2].connection_data, '[REDACTED_BEARER_TOKEN]')
    assert.equal(sanitized.integrations[3].provider, 'evolution')
    assert.equal(sanitized.integrations[3].status, 'connected')
    assert.equal(sanitized.integrations[3].webhook_url, 'https://api.empresa.com')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Proteção contra vazamento de JWT e Bearer tokens em valores
  // ----------------------------------------------------------------------------
  test('6. Proteção contra vazamento de JWT e Bearer tokens em campos genéricos', () => {
    const raw = {
      notes: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_content.signature',
      signature_blob: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN_dummy_sig',
      header_string: 'Bearer secret_access_token_xyz',
      safe_note: 'Observação regular sem credenciais'
    }

    const sanitized = sanitizePayload(raw)
    assert.equal(sanitized.notes, '[REDACTED_BEARER_TOKEN]')
    assert.equal(sanitized.signature_blob, '[REDACTED_JWT]')
    assert.equal(sanitized.header_string, '[REDACTED_BEARER_TOKEN]')
    assert.equal(sanitized.safe_note, 'Observação regular sem credenciais')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Proteção contra vazamento de API keys e service role
  // ----------------------------------------------------------------------------
  test('7. Proteção contra vazamento de API keys e service role', () => {
    const raw = {
      service_role_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service_role_secret.key',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-role-key-value',
      openai_key: 'sk_mock_123456789012345678901234567890',
      google_key: 'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567',
      innocuous_param: 'sk_mock_custom_api_key_without_key_in_name',
      normal_counter: 42
    }

    const sanitized = sanitizePayload(raw)
    assert.equal(sanitized.service_role_key, '[REDACTED]')
    assert.equal(sanitized.SUPABASE_SERVICE_ROLE_KEY, '[REDACTED]')
    assert.equal(sanitized.openai_key, '[REDACTED]')
    assert.equal(sanitized.google_key, '[REDACTED]')
    assert.equal(sanitized.innocuous_param, '[REDACTED_API_KEY]')
    assert.equal(sanitized.normal_counter, 42)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Proteção contra exposição de cookies e senhas
  // ----------------------------------------------------------------------------
  test('8. Proteção contra exposição de cookies e senhas', () => {
    const raw = {
      password: 'PlainPassword123!',
      senha_temporaria: 'TempPass999#',
      cookie: 'sb-localhost-auth-token=base64_cookie_content',
      session_cookie: 'session_id_xyz987',
      unrelated_cardinality: '1:N'
    }

    const sanitized = sanitizePayload(raw)
    assert.equal(sanitized.password, '[REDACTED]')
    assert.equal(sanitized.senha_temporaria, '[REDACTED]')
    assert.equal(sanitized.cookie, '[REDACTED]')
    assert.equal(sanitized.session_cookie, '[REDACTED]')
    assert.equal(sanitized.unrelated_cardinality, '1:N') // Não falso-positivo
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Não registrar conteúdo integral de conversas ou prompts
  // ----------------------------------------------------------------------------
  test('9. Não registrar conteúdo integral de conversas ou prompts', () => {
    const rawWithConversation = {
      company_id: TARGET_COMPANY_ID,
      event: 'chat_analysis',
      messages: [
        { role: 'user', content: 'Olá, qual é o preço da barra de chocolate 1kg?' },
        { role: 'assistant', content: 'O valor da cobertura Top Gotas é R$ 38,50.' },
        { role: 'user', content: 'Quero comprar 10 unidades com desconto.' }
      ],
      system_prompt: 'Você é um vendedor atencioso e prestativo da Sumel Embalagens...',
      llm_response: 'Certamente, para 10 unidades consigo aplicar o preço de atacado.'
    }

    const sanitized = sanitizePayload(rawWithConversation)
    assert.equal(sanitized.company_id, TARGET_COMPANY_ID)
    assert.equal(sanitized.event, 'chat_analysis')

    // As mensagens de conversas integrais foram resumidas/redigidas
    assert.equal(
      sanitized.messages,
      '[REDACTED_CHAT_TRANSCRIPT: 3 itens omitidos por política de privacidade]'
    )
    assert.match(sanitized.system_prompt, /\[REDACTED_PROMPT_CONTENT: \d+ caracteres omitidos/)
    assert.match(sanitized.llm_response, /\[REDACTED_PROMPT_CONTENT: \d+ caracteres omitidos/)

    // Garante que o texto cru das mensagens não vazou para a carga do log
    const serialized = JSON.stringify(sanitized)
    assert.ok(!serialized.includes('barra de chocolate'))
    assert.ok(!serialized.includes('preço de atacado'))
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Falha de inserção gera erro tipado (PlatformAuditError)
  // ----------------------------------------------------------------------------
  test('10. Falha de inserção gera erro tipado (PlatformAuditError)', async () => {
    const failingDbClient = createMockAdminClient({ failOnAuditInsert: true })

    await assert.rejects(
      async () => {
        await logPlatformAudit({
          actorId: SUPERADMIN_ID,
          actorEmail: 'superadmin@elleveeia.com.br',
          action: 'company.suspended',
          targetCompanyId: TARGET_COMPANY_ID,
          reason: 'Inadimplência contratual'
        }, failingDbClient)
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuditError)
        assert.equal(err.code, 'AUDIT_WRITE_FAILED')
        assert.match(err.message, /Falha crítica ao gravar log de auditoria/)
        assert.equal(err.operationExecuted, false)
        assert.equal(err.auditRecorded, false)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Falha da operação preserva o erro original
  // ----------------------------------------------------------------------------
  test('11. Falha da operação preserva o erro original', async () => {
    class CustomTenantConstraintError extends Error {
      errorCode = 'TENANT_LIMIT_EXCEEDED'
      constructor(msg: string) {
        super(msg)
        this.name = 'CustomTenantConstraintError'
      }
    }

    await assert.rejects(
      async () => {
        await executeAuditedAction(
          validSuperContext,
          {
            action: 'company.limits_changed',
            targetCompanyId: TARGET_COMPANY_ID,
            payloadSummary: { max_agents: 100 }
          },
          async () => {
            throw new CustomTenantConstraintError('Limite máximo de agentes não permitido no plano Standard.')
          },
          standardAdminClient
        )
      },
      (err: any) => {
        assert.ok(err instanceof CustomTenantConstraintError)
        assert.equal(err.errorCode, 'TENANT_LIMIT_EXCEEDED')
        assert.equal(err.message, 'Limite máximo de agentes não permitido no plano Standard.')
        return true
      }
    )

    // Confirma que a falha foi registrada na auditoria preservando o log com status 'failed'
    const lastLog = auditLogsCaptured[auditLogsCaptured.length - 1]
    assert.equal(lastLog.status, 'failed')
    assert.equal(lastLog.action, 'company.limits_changed')
    assert.equal(lastLog.error_message, 'Limite máximo de agentes não permitido no plano Standard.')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Falha da auditoria não retorna sucesso administrativo
  // ----------------------------------------------------------------------------
  test('12. Falha da auditoria não retorna sucesso administrativo', async () => {
    const failingDbClient = createMockAdminClient({ failOnAuditInsert: true })
    let operationExecuted = false

    await assert.rejects(
      async () => {
        await executeAuditedAction(
          validSuperContext,
          {
            action: 'company.reactivated',
            targetCompanyId: TARGET_COMPANY_ID
          },
          async () => {
            operationExecuted = true
            return { reactivated: true, timestamp: Date.now() }
          },
          failingDbClient
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuditError)
        assert.equal(err.code, 'AUDIT_WRITE_FAILED')
        return true
      }
    )

    // A operação de negócio executou, mas o chamador NUNCA recebeu o retorno de sucesso
    assert.equal(operationExecuted, true)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: Operação já executada não é apresentada como revertida quando auditoria falha
  // ----------------------------------------------------------------------------
  test('13. Operação já executada não é apresentada como revertida quando auditoria falha', async () => {
    const failingDbClient = createMockAdminClient({ failOnAuditInsert: true })

    await assert.rejects(
      async () => {
        await executeAuditedAction(
          validSuperContext,
          {
            action: 'company.suspended',
            targetCompanyId: TARGET_COMPANY_ID,
            reason: 'Suspensão temporária'
          },
          async () => {
            // Operação executada no banco
            return { status: 'suspended' }
          },
          failingDbClient
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuditError)
        // Confirma que o erro sinaliza explicitamente que a operação foi executada
        assert.equal(err.operationExecuted, true)
        assert.equal(err.auditRecorded, false)
        // Confirma que a mensagem adverte honestamente que a operação NÃO foi revertida
        assert.match(err.message, /NÃO foi revertida automaticamente/)
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 14: Operador sem autorização não executa ações administrativas
  // ----------------------------------------------------------------------------
  test('14. Operador sem autorização não executa ações administrativas', async () => {
    const attendantClient = createAuthClient(ATTENDANT_USER_ID, 'atendente@empresa.com.br')
    let sensitiveOperationExecuted = false

    // Tentativa de executar operação protegida por requirePlatformAdmin
    await assert.rejects(
      async () => {
        // Barreira central de autorização bloqueia atendente
        const ctx = await requirePlatformAdmin({
          client: attendantClient,
          adminClient: standardAdminClient
        })

        // Nunca deve alcançar esta linha:
        await executeAuditedAction(
          ctx,
          { action: 'company.cancelled', targetCompanyId: TARGET_COMPANY_ID },
          async () => {
            sensitiveOperationExecuted = true
            return { cancelled: true }
          },
          standardAdminClient
        )
      },
      (err: any) => {
        assert.ok(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        return true
      }
    )

    // Confirma que a operação de negócio protegida NUNCA foi disparada
    assert.equal(sensitiveOperationExecuted, false)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 15: Compatibilidade com chamadores existentes (re-exportação em admin.ts)
  // ----------------------------------------------------------------------------
  test('15. Compatibilidade com chamadores existentes (importações a partir de admin.ts)', async () => {
    // Confirma que as funções re-exportadas de admin.ts são as mesmas instâncias de audit.ts
    assert.equal(logPlatformAuditReexported, logPlatformAudit)
    assert.equal(executeAuditedActionReexported, executeAuditedAction)
    assert.equal(PlatformAuditErrorReexported, PlatformAuditError)

    // Executa uma chamada usando as importações re-exportadas
    const res = await executeAuditedActionReexported(
      validSuperContext,
      {
        action: 'operator.updated',
        payloadSummary: { email: 'superadmin@elleveeia.com.br', active: true }
      },
      async () => ({ success: true }),
      standardAdminClient
    )

    assert.deepEqual(res, { success: true })
    const lastLog = auditLogsCaptured[auditLogsCaptured.length - 1]
    assert.equal(lastLog.action, 'operator.updated')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 16: Preservação da imutabilidade da tabela platform_audit_logs
  // ----------------------------------------------------------------------------
  test('16. Preservação da imutabilidade da tabela platform_audit_logs', async () => {
    // Tentativa de UPDATE em platform_audit_logs é rejeitada pelo trigger do banco
    const updateResult = await standardAdminClient
      .from('platform_audit_logs')
      .update({ reason: 'Tentativa de adulteração de log' })
      .eq('id', 'log-1')

    assert.ok(updateResult.error)
    assert.equal(updateResult.error.code, 'P0001')
    assert.match(updateResult.error.message, /logs de auditoria da plataforma são estritamente imutáveis/)

    // Tentativa de DELETE em platform_audit_logs é rejeitada pelo trigger do banco
    const deleteResult = await standardAdminClient
      .from('platform_audit_logs')
      .delete()
      .eq('id', 'log-1')

    assert.ok(deleteResult.error)
    assert.equal(deleteResult.error.code, 'P0001')
    assert.match(deleteResult.error.message, /logs de auditoria da plataforma são estritamente imutáveis/)
  })
})
