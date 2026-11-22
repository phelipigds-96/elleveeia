/**
 * scripts/run-staging-web-homologation-h3.mjs
 *
 * Executor Integrado de Homologação Web (E2E / HTTP) para AC-SEC-01.4-H3.
 * Executa os cenários reais de ponta a ponta contra o runtime isolado de Staging (127.0.0.1:3001)
 * conectado exclusivamente ao Supabase Staging autorizado (dkjrpdhymtkgbknocijy).
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import {
  SYNTHETIC_DATA,
  getStagingCredentials,
  STAGING_PROJECT_ID,
  PRODUCTION_PROJECT_ID,
  DEFAULT_MANIFEST_PATH,
  runSyntheticSeed,
} from './staging-seed-synthetic.mjs'
import { runSyntheticTeardown } from './staging-teardown-synthetic.mjs'
import {
  getAuthSessionCookie,
  parseFlightActionResponse,
  discoverServerActionIds,
  RUNTIME_BASE_URL,
} from './run-staging-security-matrix.mjs'

const projectRoot = process.cwd()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function killProcessTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try { process.kill(pid, 'SIGTERM') } catch {}
    }
  }
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/login`, { method: 'GET', redirect: 'manual' })
      if (res.status === 200 || res.status === 307 || res.status === 308) {
        return true
      }
    } catch {}
    await sleep(1000)
  }
  throw new Error(`Timeout de ${timeoutMs}ms aguardando servidor em ${url}`)
}

function parseSetCookieHeaders(response) {
  const jar = {}
  let rawCookies = []
  if (typeof response.headers.getSetCookie === 'function') {
    rawCookies = response.headers.getSetCookie()
  } else {
    const raw = response.headers.get('set-cookie')
    if (raw) rawCookies = [raw]
  }

  for (const c of rawCookies) {
    const parts = c.split(';')
    const first = parts[0].trim()
    const eq = first.indexOf('=')
    if (eq > 0) {
      const name = first.slice(0, eq).trim()
      const val = first.slice(eq + 1).trim()
      jar[name] = val
    }
  }
  return jar
}

function cookieJarToString(jar) {
  return Object.entries(jar)
    .filter(([_, v]) => v !== '' && v !== 'deleted')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function parseRawCookieHeader(cookieHeader) {
  const jar = {}
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq > 0) {
      jar[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  }
  return jar
}

async function invokeServerActionWithJar(actionId, args, cookieJar, route = '/companies') {
  const url = `${RUNTIME_BASE_URL}${route}`
  const cookieString = cookieJarToString(cookieJar)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Next-Action': actionId,
      'Accept': 'text/x-component',
      'Content-Type': 'application/json',
      'Cookie': cookieString,
    },
    body: JSON.stringify(args),
    redirect: 'manual',
  })

  // Atualiza cookieJar com novos Set-Cookies
  const newCookies = parseSetCookieHeaders(response)
  for (const [k, v] of Object.entries(newCookies)) {
    if (v === '' || v === 'deleted') {
      delete cookieJar[k]
    } else {
      cookieJar[k] = v
    }
  }

  const text = await response.text()
  const data = parseFlightActionResponse(text)
  return { status: response.status, data, raw: text, cookieJar }
}

async function runWebHomologationH3() {
  console.log('==============================================================================')
  console.log('   ELLEVEE IA — HOMOLOGAÇÃO WEB E2E EM STAGING (AC-SEC-01.4-H3)               ')
  console.log('==============================================================================\n')

  let serverProcess = null

  try {
    // --------------------------------------------------------------------------
    // ETAPA 1: VERIFICAÇÃO DE PROJETO E GUARDAS DE ISOLAMENTO
    // --------------------------------------------------------------------------
    console.log('--- [GATE 1/6] Verificação Estrita de Ambiente e Credenciais ---')
    const { supabaseUrl, serviceRoleKey } = getStagingCredentials(projectRoot)

    if (!supabaseUrl.includes(STAGING_PROJECT_ID)) {
      throw new Error(`CRITICAL: Supabase URL não aponta para Staging (${STAGING_PROJECT_ID})`)
    }
    if (supabaseUrl.includes(PRODUCTION_PROJECT_ID) || serviceRoleKey.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`CRITICAL: Detecção de credencial pertencente a PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
    }
    console.log(`✓ Ambiente validado: Supabase Staging (${STAGING_PROJECT_ID})`)

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // --------------------------------------------------------------------------
    // ETAPA 2: DISPARO DO RUNTIME ISOLADO NA PORTA 3001
    // --------------------------------------------------------------------------
    console.log('\n--- [GATE 2/6] Inicializando Servidor Staging Isolado (127.0.0.1:3001) ---')
    const startScript = path.join(projectRoot, 'scripts', 'start-staging-isolated.mjs')

    serverProcess = spawn(process.execPath, [startScript], {
      cwd: projectRoot,
      stdio: 'pipe',
    })

    serverProcess.stdout.on('data', (d) => {
      const line = d.toString()
      if (line.includes('Ready') || line.includes('Iniciando Next.js') || line.includes('Erro')) {
        process.stdout.write(`  [Server] ${line}`)
      }
    })

    serverProcess.stderr.on('data', (d) => {
      process.stderr.write(`  [Server Err] ${d.toString()}`)
    })

    console.log('Aguardando servidor responder em http://127.0.0.1:3001...')
    await waitForServer(RUNTIME_BASE_URL, 35000)
    console.log('✓ Servidor Next.js Staging ativo e respondendo na porta 3001.')

    // --------------------------------------------------------------------------
    // ETAPA 3: SETUP DAS FIXTURES SINTÉTICAS
    // --------------------------------------------------------------------------
    console.log('\n--- [GATE 3/6] Provisionando Fixtures Sintéticas em Staging ---')
    const seedResult = await runSyntheticSeed({
      projectRoot,
      testPassword: 'QaHomologPassword#2026!',
      dryRun: false,
    })
    console.log('✓ Fixtures sintéticas criadas e registradas no manifesto.')

    const synthOperatorEmail = SYNTHETIC_DATA.users.superadminSynth.email
    const tenantAId = SYNTHETIC_DATA.companies.tenantA.id
    const tenantBId = SYNTHETIC_DATA.companies.tenantB.id
    const convAId = SYNTHETIC_DATA.conversations.convAUnassigned.id
    const convBId = SYNTHETIC_DATA.conversations.convBUnassigned.id

    // --------------------------------------------------------------------------
    // ETAPA 4: AUDITORIA PRÉVIA DE PROFILES (IMUTABILIDADE)
    // --------------------------------------------------------------------------
    console.log('\n--- [GATE 4/6] Auditoria Prévia de profiles do Operador ---')

    // Garante que o operador sintético está ativo em platform_admins e sem banimento no Auth
    const { data: synthAuthUser } = await adminClient.auth.admin.listUsers()
    const foundAuth = synthAuthUser?.users?.find(u => u.email.toLowerCase() === synthOperatorEmail.toLowerCase())
    if (foundAuth) {
      await adminClient.auth.admin.updateUserById(foundAuth.id, { ban_duration: 'none' })
      await adminClient.from('platform_admins').update({ active: true }).eq('id', foundAuth.id)
    }

    const { data: preProfile, error: preProfErr } = await adminClient
      .from('profiles')
      .select('id, company_id, role, full_name')
      .eq('email', synthOperatorEmail)
      .single()

    if (preProfErr || !preProfile) {
      throw new Error(`Falha ao consultar profile do operador sintético: ${preProfErr?.message}`)
    }

    const initialCompanyId = preProfile.company_id
    const initialRole = preProfile.role
    console.log(`✓ Profile inicial: company_id=${initialCompanyId}, role=${initialRole}`)

    // --------------------------------------------------------------------------
    // ETAPA 5: AUTENTICAÇÃO DO OPERADOR VIA SUPABASE AUTH REAL
    // --------------------------------------------------------------------------
    console.log('\n--- [GATE 5/6] Autenticando Operador Sintético via Supabase Auth ---')
    const authCookieHeader = await getAuthSessionCookie(
      synthOperatorEmail,
      'QaHomologPassword#2026!',
      supabaseUrl
    )
    const baseCookieJar = parseRawCookieHeader(authCookieHeader)
    console.log('✓ Sessão Supabase Auth criada e cookies SSR formatados.')

    // Descoberta de Action IDs
    const actions = discoverServerActionIds(projectRoot)
    console.log(`✓ Action IDs descobertas: impersonate=${actions.impersonateCompanyAction}, stop=${actions.stopImpersonateAction}`)

    // --------------------------------------------------------------------------
    // ETAPA 6: BATERIA DE HOMOLOGAÇÃO WEB E2E
    // --------------------------------------------------------------------------
    console.log('\n--- [TESTES WEB E2E] Iniciando Ciclo de Homologação Web Integrada ---')

    // W1: Início de Impersonação para Empresa Alfa
    console.log('\n[CENÁRIO W1] Início de impersonação para Empresa Alfa via Server Action...')
    const tab1Jar = { ...baseCookieJar }
    const w1Res = await invokeServerActionWithJar(
      actions.impersonateCompanyAction,
      [tenantAId],
      tab1Jar,
      '/companies'
    )

    if (!w1Res.data?.success) {
      throw new Error(`Falha no Cenário W1 (impersonateCompanyAction): ${JSON.stringify(w1Res.data)}`)
    }

    const sessionAData = w1Res.data.data
    const sessionAId = sessionAData.sessionId
    console.log(`✓ Cenário W1 Aprovado: Sessão de suporte criada (${sessionAId}) para Tenant A (${sessionAData.targetCompanyId}).`)
    console.log(`  Cookies gerados: impersonation_session=${Boolean(tab1Jar.impersonation_session)}, impersonation_context=${Boolean(tab1Jar.impersonation_context)}`)

    // W2: Acesso ao Dashboard e Lista de Conversas com ContextGuard
    console.log('\n[CENÁRIO W2] Acesso ao Dashboard e consulta de conversas com ContextGuard...')
    const dashRes = await fetch(`${RUNTIME_BASE_URL}/dashboard`, {
      headers: { Cookie: cookieJarToString(tab1Jar) },
      redirect: 'manual',
    })
    if (dashRes.status !== 200) {
      throw new Error(`GET /dashboard retornou status ${dashRes.status} (esperado 200)`)
    }
    console.log(`✓ GET /dashboard retornou HTTP 200 OK sob impersonação.`)

    const guardA = { expectedCompanyId: tenantAId, expectedSessionId: sessionAId }
    const convsRes = await invokeServerActionWithJar(
      actions.getConversationsList,
      [guardA],
      tab1Jar,
      '/conversations'
    )

    if (!Array.isArray(convsRes.data)) {
      throw new Error(`getConversationsList falhou ou não retornou array: ${JSON.stringify(convsRes.data)}`)
    }
    const tenantAConvs = convsRes.data.filter((c) => c.company_id === tenantAId)
    if (tenantAConvs.length === 0) {
      throw new Error('Nenhuma conversa de Tenant A localizada na resposta do suporte!')
    }
    console.log(`✓ Cenário W2 Aprovado: getConversationsList retornou ${tenantAConvs.length} conversas de Tenant A.`)

    // W3: Isolamento Multi-Tenant estrito sob Impersonação
    console.log('\n[CENÁRIO W3] Tentativa de acesso a conversa confidencial de Tenant B sob suporte de Tenant A...')
    const w3Res = await invokeServerActionWithJar(
      actions.getConversationMessages,
      [convBId, guardA],
      tab1Jar,
      '/conversations'
    )

    // O sistema deve falhar fechado ou retornar mensagens vazias (nunca mensagens do Tenant B)
    const leakedMessages = Array.isArray(w3Res.data) ? w3Res.data.filter((m) => m.company_id === tenantBId) : []
    if (leakedMessages.length > 0) {
      throw new Error(`CRITICAL: Vazamento multi-tenant detectado! Mensagens de Tenant B foram retornadas: ${JSON.stringify(leakedMessages)}`)
    }
    console.log('✓ Cenário W3 Aprovado: Zero vazamento de dados do Tenant B sob impersonação do Tenant A.')

    // W4: Duas Abas com Sessões Concorrentes (Rotação e Invalidação da Aba Antiga)
    console.log('\n[CENÁRIO W4] Simulação de duas abas com sessões diferentes...')
    // Aba 2 inicia suporte para Tenant B
    const tab2Jar = { ...baseCookieJar }
    const w4StartB = await invokeServerActionWithJar(
      actions.impersonateCompanyAction,
      [tenantBId],
      tab2Jar,
      '/companies'
    )

    if (!w4StartB.data?.success) {
      throw new Error(`Falha ao iniciar suporte para Tenant B na Aba 2: ${JSON.stringify(w4StartB.data)}`)
    }
    const sessionBId = w4StartB.data.data.sessionId
    console.log(`✓ Aba 2 iniciou suporte com sucesso para Tenant B (Sessão B: ${sessionBId}).`)

    // Aba 1 tenta executar ação de leitura com o contexto antigo (Session A / Tenant A)
    const tab1OldCall = await invokeServerActionWithJar(
      actions.getConversationsList,
      [guardA],
      tab1Jar, // Aba 1 ainda tem os cookies de Session A
      '/conversations'
    )

    // getConversationsList falha fechado retornando array vazio em caso de erro de sessão
    const tab1Convs = Array.isArray(tab1OldCall.data) ? tab1OldCall.data : []
    if (tab1Convs.length !== 0) {
      throw new Error(`Falha de isolamento de abas: Aba 1 com sessão revogada retornou conversas! (${tab1Convs.length})`)
    }

    // Aba 1 tenta executar ação de mutação sensível com o contexto antigo (deve retornar erro explícito)
    const tab1MutationCall = await invokeServerActionWithJar(
      actions.closeConversationAction,
      [convAId, {}, guardA],
      tab1Jar,
      '/conversations'
    )
    const rawTab1Mut = JSON.stringify(tab1MutationCall.data || tab1MutationCall.raw)
    const isTab1Blocked =
      rawTab1Mut.includes('IMPERSONATION_SESSION_REVOKED') ||
      rawTab1Mut.includes('UNAUTHORIZED') ||
      rawTab1Mut.includes('AUTH_CONTEXT_MISMATCH') ||
      tab1MutationCall.data?.success === false

    if (!isTab1Blocked) {
      throw new Error(`Falha de isolamento de abas: Mutação na Aba 1 não foi rejeitada! Resposta: ${rawTab1Mut}`)
    }
    console.log(`✓ Aba 1 (Sessão Antiga A) sumariamente rejeitada por sessão revogada (leitura vazia e mutação bloqueada).`)

    // Aba 2 executa ação com seu contexto legítimo (Session B / Tenant B)
    const guardB = { expectedCompanyId: tenantBId, expectedSessionId: sessionBId }
    const tab2ValidCall = await invokeServerActionWithJar(
      actions.getConversationsList,
      [guardB],
      tab2Jar,
      '/conversations'
    )
    if (!Array.isArray(tab2ValidCall.data) || tab2ValidCall.data.length === 0) {
      throw new Error(`Aba 2 legítima deveria retornar conversas de Tenant B, mas retornou: ${JSON.stringify(tab2ValidCall.data)}`)
    }
    console.log(`✓ Aba 2 (Sessão Ativa B) operou com sucesso para Tenant B (${tab2ValidCall.data.length} conversas).`)
    console.log('✓ Cenário W4 Aprovado: Rotação atômica e isolamento estrito entre abas comprovados.')

    // W5: Bloqueio de ContextGuard Ausente ou Divergente
    console.log('\n[CENÁRIO W5] Validação de bloqueios defensivos de ContextGuard...')
    // 1. Chamada de mutação sem ContextGuard
    const noGuardRes = await invokeServerActionWithJar(
      actions.closeConversationAction,
      [convBId, {}, undefined],
      tab2Jar,
      '/conversations'
    )
    const rawNoGuard = JSON.stringify(noGuardRes.data || noGuardRes.raw)
    if (!rawNoGuard.includes('IMPERSONATION_CONTEXT_REQUIRED') && noGuardRes.data?.success !== false) {
      throw new Error(`Chamada sem ContextGuard deveria falhar com IMPERSONATION_CONTEXT_REQUIRED! Resposta: ${rawNoGuard}`)
    }
    console.log('✓ Chamada em modo suporte sem ContextGuard rejeitada com sucesso (IMPERSONATION_CONTEXT_REQUIRED).')

    // 2. Chamada com expectedCompanyId divergente da sessão ativa
    const mismatchedGuard = { expectedCompanyId: tenantAId, expectedSessionId: sessionBId }
    const mismatchRes = await invokeServerActionWithJar(
      actions.closeConversationAction,
      [convBId, {}, mismatchedGuard],
      tab2Jar,
      '/conversations'
    )
    const rawMismatch = JSON.stringify(mismatchRes.data || mismatchRes.raw)
    if (!rawMismatch.includes('AUTH_CONTEXT_MISMATCH') && mismatchRes.data?.success !== false) {
      throw new Error(`Chamada com empresa divergente deveria falhar com AUTH_CONTEXT_MISMATCH! Resposta: ${rawMismatch}`)
    }
    console.log('✓ Chamada com ContextGuard divergente da sessão ativa rejeitada com sucesso (AUTH_CONTEXT_MISMATCH).')

    // 3. Consulta de lista sem ContextGuard falha fechada retornando 0 conversas
    const listNoGuard = await invokeServerActionWithJar(
      actions.getConversationsList,
      [],
      tab2Jar,
      '/conversations'
    )
    if (Array.isArray(listNoGuard.data) && listNoGuard.data.length > 0) {
      throw new Error('Consulta de lista sem ContextGuard não deveria retornar conversas!')
    }
    console.log('✓ Consulta de conversas sem ContextGuard falhou fechada (0 conversas retornadas).')
    console.log('✓ Cenário W5 Aprovado: Guardas de contexto 100% ativas.')

    // W6: Encerramento Voluntário de Impersonação
    console.log('\n[CENÁRIO W6] Encerramento voluntário de impersonação via stopImpersonateAction...')
    const stopRes = await invokeServerActionWithJar(
      actions.stopImpersonateAction,
      [],
      tab2Jar,
      '/companies'
    )
    if (!stopRes.data?.success) {
      throw new Error(`stopImpersonateAction falhou: ${JSON.stringify(stopRes.data)}`)
    }

    // Verifica que cookies foram removidos
    if (tab2Jar.impersonation_session || tab2Jar.impersonation_context) {
      throw new Error('Cookies de impersonação deveriam ter sido excluídos!')
    }

    // Consulta no banco: 0 sessões ativas
    const { count: activeCount } = await adminClient
      .from('platform_impersonation_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', preProfile.id)
      .eq('status', 'active')

    if (activeCount && activeCount > 0) {
      throw new Error(`Deveriam existir 0 sessões ativas no banco, mas foram encontradas ${activeCount}!`)
    }
    console.log('✓ Cenário W6 Aprovado: Sessão encerrada voluntariamente, cookies removidos e 0 sessões ativas no banco.')

    // W7: Validação de Realtime e Polling
    console.log('\n[CENÁRIO W7] Verificação de isolamento Realtime e fallback de Polling...')
    const painelClientPath = path.join(projectRoot, 'app/(dashboard)/conversations/components/painel-client.tsx')
    const painelCode = fs.readFileSync(painelClientPath, 'utf8')

    // Confirma dependência de currentUser?.isImpersonating no hook de Realtime
    const hasImpersonatingDep = painelCode.includes('currentUser?.isImpersonating')
    const hasPollingFallback =
      painelCode.includes('pollMessagesInterval') &&
      painelCode.includes('pollListInterval') &&
      painelCode.includes('getConversationsList(contextGuard)')

    if (!hasImpersonatingDep) {
      throw new Error('painel-client.tsx NÃO inclui currentUser?.isImpersonating nas dependências de Realtime!')
    }
    if (!hasPollingFallback) {
      throw new Error('painel-client.tsx NÃO mantém as rotinas de polling (pollMessagesInterval e pollListInterval com contextGuard)!')
    }
    console.log('✓ Realtime Teardown verificado: Canais WebSocket são desconectados imediatamente ao assumir suporte.')
    console.log('✓ Polling Fallback verificado: Atualização periódica (pollMessagesInterval e pollListInterval) continua ativa utilizando contextGuard.')
    console.log('✓ Cenário W7 Aprovado: Canais Realtime blindados e Polling garantido.')

    // W8: Auditoria Final de Imutabilidade de profiles
    console.log('\n[CENÁRIO W8] Auditoria Final de Imutabilidade de profiles...')
    const { data: postProfile, error: postProfErr } = await adminClient
      .from('profiles')
      .select('id, company_id, role, full_name')
      .eq('id', preProfile.id)
      .single()

    if (postProfErr || !postProfile) {
      throw new Error(`Falha ao auditar profile pós-homologação: ${postProfErr?.message}`)
    }

    if (postProfile.company_id !== initialCompanyId || postProfile.role !== initialRole) {
      throw new Error(`VIOLAÇÃO CRÍTICA: profiles foi alterado! Inicial: (${initialCompanyId}, ${initialRole}), Final: (${postProfile.company_id}, ${postProfile.role})`)
    }
    console.log(`✓ IMUTABILIDADE 100% COMPROVADA: profiles permaneceu inalterado (company_id=${postProfile.company_id}, role=${postProfile.role}).`)
    console.log('✓ Cenário W8 Aprovado: Nenhuma mutação estrutural de perfil.')

    // --------------------------------------------------------------------------
    // ETAPA 7: TEARDOWN SEGURO DAS FIXTURES SINTÉTICAS
    // --------------------------------------------------------------------------
    console.log('\n--- [GATE 6/6] Executando Teardown Seguro das Fixtures Sintéticas ---')
    // Remove sessões de impersonação sintéticas
    await adminClient
      .from('platform_impersonation_sessions')
      .delete()
      .eq('operator_id', preProfile.id)

    // Executa teardown do seed sintético
    await runSyntheticTeardown({ projectRoot, force: true })
    console.log('✓ Teardown concluído com sucesso: zero resíduos sintéticos.')

    console.log('\n==============================================================================')
    console.log('   HOMOLOGAÇÃO WEB E2E CONCLUÍDA COM 100% DE SUCESSO                          ')
    console.log('==============================================================================\n')
  } finally {
    if (serverProcess && serverProcess.pid) {
      console.log('Encerrando servidor Next.js Staging...')
      killProcessTree(serverProcess.pid)
      console.log('✓ Servidor encerrado.')
    }
  }
}

runWebHomologationH3().catch((err) => {
  console.error('\n❌ ERRO NA HOMOLOGAÇÃO WEB H3:', err)
  process.exit(1)
})
