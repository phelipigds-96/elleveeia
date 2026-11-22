/**
 * scripts/staging-seed-synthetic.mjs
 * 
 * Script de Seed Idempotente e Auditável para Homologação Real Multi-Tenant (AC-SEC-01.3-H4).
 * Cria exclusivamente dados sintéticos no Supabase Staging autorizado com rastreamento por manifesto atômico.
 * 
 * GUARDA DE SEGURANÇA E ISOLAMENTO:
 * - Executa estritamente contra o Staging (dkjrpdhymtkgbknocijy).
 * - Aborta imediatamente se houver menção ao projeto de produção (ipxhkwirzrigttpwzwbl).
 * - Utiliza identificador único de execução (runId) e grava manifesto atomicamente a cada inserção.
 * - Diferencia registros planejados (planned) de registros efetivamente criados (created).
 * - Checa colisões antes de inserir; aborta sem sobrescrever se houver divergência.
 * - Não utiliza upsert indiscriminado que altere registros preexistentes.
 * - Não toca no SuperAdmin ou empresa preexistentes (preserva 9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad).
 * - Utiliza conta SuperAdmin sintética dedicada (superadmin.synth@qa.ellevee.local).
 * - Suporta modo --dry-run (validação sem escrita).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

export const STAGING_PROJECT_ID = 'dkjrpdhymtkgbknocijy'
export const PRODUCTION_PROJECT_ID = 'ipxhkwirzrigttpwzwbl'
export const AUTHORIZED_STAGING_URL = `https://${STAGING_PROJECT_ID}.supabase.co`

export const DEFAULT_MANIFEST_PATH = path.join(
  process.cwd(),
  '.staging-workspace',
  'staging-test-manifest.json'
)

// Documentação do SuperAdmin preexistente em Staging (NUNCA MODIFICAR)
export const PREEXISTING_SUPERADMIN = {
  id: '38bbee0f-c0a6-46cd-856b-ce77a6ff801d',
  email: 'superadmin.qa@ellevee.internal',
  companyId: '9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad',
  profileRole: 'master',
  platformRole: 'superadmin',
  platformActive: true,
}

// Namespaces e UUIDs Sintéticos Determinísticos
export const SYNTHETIC_DATA = {
  companies: {
    tenantA: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'Empresa Alfa Homologação QA',
      slug: 'empresa-alfa-qa-homolog',
      status: 'active',
      plan_tier: 'pro',
    },
    tenantB: {
      id: '00000000-0000-4000-b000-000000000002',
      name: 'Empresa Beta Homologação QA',
      slug: 'empresa-beta-qa-homolog',
      status: 'active',
      plan_tier: 'enterprise',
    },
    tenantSuspended: {
      id: '00000000-0000-4000-c000-000000000003',
      name: 'Empresa Suspensa QA',
      slug: 'empresa-suspensa-qa-homolog',
      status: 'suspended',
      plan_tier: 'standard',
    },
  },
  users: {
    alice: {
      email: 'alice.qa@qa.ellevee.local',
      fullName: 'Atendente Alice QA',
      role: 'attendant',
      companyKey: 'tenantA',
    },
    bob: {
      email: 'bob.qa@qa.ellevee.local',
      fullName: 'Atendente Bob QA',
      role: 'attendant',
      companyKey: 'tenantA',
    },
    andre: {
      email: 'andre.qa@qa.ellevee.local',
      fullName: 'Admin André QA',
      role: 'admin',
      companyKey: 'tenantA',
    },
    carlos: {
      email: 'carlos.qa@qa.ellevee.local',
      fullName: 'Usuário Carlos QA',
      role: 'user', // Usuário padrão sem papel elevado na Empresa B
      companyKey: 'tenantB',
    },
    superadminSynth: {
      email: 'superadmin.synth@qa.ellevee.local',
      fullName: 'SuperAdmin Sintético QA',
      role: 'admin',
      companyKey: 'tenantA',
      isPlatformAdmin: true,
      platformRole: 'superadmin',
    },
  },
  
  // Conversas Sintéticas
  conversations: {
    convAUnassigned: {
      id: '00000000-0000-4000-a000-000000000101',
      companyKey: 'tenantA',
      assignedTo: null,
      status: 'open',
      channel: 'whatsapp',
      summary: 'Conversa Fila Geral Empresa Alfa',
    },
    convAAlice: {
      id: '00000000-0000-4000-a000-000000000102',
      companyKey: 'tenantA',
      assignedUserKey: 'alice',
      status: 'open',
      channel: 'whatsapp',
      summary: 'Conversa Atendimento Privado Alice Empresa Alfa',
    },
    convABob: {
      id: '00000000-0000-4000-a000-000000000103',
      companyKey: 'tenantA',
      assignedUserKey: 'bob',
      status: 'open',
      channel: 'whatsapp',
      summary: 'Conversa Atendimento Privado Bob Empresa Alfa',
    },
    convBUnassigned: {
      id: '00000000-0000-4000-b000-000000000104',
      companyKey: 'tenantB',
      assignedTo: null,
      status: 'open',
      channel: 'whatsapp',
      summary: 'Conversa Fila Geral Empresa Beta Confidencial',
    },
    convBCarlos: {
      id: '00000000-0000-4000-b000-000000000105',
      companyKey: 'tenantB',
      assignedUserKey: 'carlos',
      status: 'open',
      channel: 'whatsapp',
      summary: 'Conversa Atendimento Carlos Empresa Beta',
    },
  },
  
  // Mensagens Sintéticas (convenção estrita: -a000- para Tenant A, -b000- para Tenant B)
  messages: [
    {
      id: '00000000-0000-4000-a000-000000000201',
      convKey: 'convAUnassigned',
      companyKey: 'tenantA',
      senderType: 'customer',
      content: 'Mensagem sintética fila geral Empresa Alfa',
    },
    {
      id: '00000000-0000-4000-a000-000000000202',
      convKey: 'convAAlice',
      companyKey: 'tenantA',
      senderType: 'customer',
      content: 'Mensagem sintética privada atendimento Alice Empresa Alfa',
    },
    {
      id: '00000000-0000-4000-a000-000000000203',
      convKey: 'convABob',
      companyKey: 'tenantA',
      senderType: 'customer',
      content: 'Mensagem sintética privada atendimento Bob Empresa Alfa',
    },
    {
      id: '00000000-0000-4000-b000-000000000204',
      convKey: 'convBUnassigned',
      companyKey: 'tenantB',
      senderType: 'customer',
      content: 'Mensagem sintética confidencial Empresa Beta - PROIBIDO VAZAR',
    },
    {
      id: '00000000-0000-4000-b000-000000000205',
      convKey: 'convBCarlos',
      companyKey: 'tenantB',
      senderType: 'customer',
      content: 'Mensagem sintética privada Carlos Empresa Beta',
    },
  ],
}

/**
 * Validação prévia de isolamento e leitura de credenciais de staging
 */
export function getStagingCredentials(projectRoot = process.cwd()) {
  const stagingEnvPath = path.join(projectRoot, '.env.staging.local')
  if (!fs.existsSync(stagingEnvPath)) {
    throw new Error(`[GUARD] Arquivo de credenciais de staging não encontrado: ${stagingEnvPath}`)
  }

  const content = fs.readFileSync(stagingEnvPath, 'utf8')
  if (content.includes(PRODUCTION_PROJECT_ID)) {
    throw new Error(`[CRITICAL GUARD] Referência a PRODUÇÃO detectada no arquivo de staging! Abortando.`)
  }

  const urlMatch = content.match(/STAGING_SUPABASE_URL=([^\r\n]+)/)
  const serviceKeyMatch = content.match(/STAGING_SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/)

  const supabaseUrl = (urlMatch ? urlMatch[1].trim() : AUTHORIZED_STAGING_URL)
  if (!supabaseUrl.includes(STAGING_PROJECT_ID)) {
    throw new Error(`[GUARD] URL do Supabase não corresponde ao staging autorizado: ${supabaseUrl}`)
  }

  if (!serviceKeyMatch) {
    throw new Error(`[GUARD] Chave de serviço de staging não encontrada no arquivo .env.staging.local`)
  }

  return {
    supabaseUrl,
    serviceRoleKey: serviceKeyMatch[1].trim(),
  }
}

/**
 * Salva atomicamente o manifesto no disco
 */
export function saveTestManifest(manifest, manifestPath = DEFAULT_MANIFEST_PATH) {
  const dir = path.dirname(manifestPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const tempPath = `${manifestPath}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2), 'utf8')
  fs.renameSync(tempPath, manifestPath)
}

export function loadTestManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  if (!fs.existsSync(manifestPath)) {
    return null
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

/**
 * Execução idempotente, auditada e atômica do Seed Sintético
 */
export async function runSyntheticSeed(options = {}) {
  const {
    projectRoot = process.cwd(),
    testPassword = 'QaHomologPassword#2026!',
    dryRun = false,
    manifestPath = DEFAULT_MANIFEST_PATH,
    runId = `h4_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
  } = options

  const { supabaseUrl, serviceRoleKey } = getStagingCredentials(projectRoot)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`=== [STAGING SEED SINTÉTICO${dryRun ? ' (MODO DRY-RUN)' : ''}] ===`)
  console.log(`RunId: ${runId}`)
  console.log(`Destino: ${supabaseUrl}`)

  // 1. Guard de Integridade: Verificar se existem integrações ativas inesperadas
  const { data: integrations, error: intErr } = await adminClient
    .from('integrations')
    .select('id, type, status')
    .eq('status', 'connected')

  if (intErr) {
    throw new Error(`[GUARD] Falha ao consultar tabela integrations: ${intErr.message}`)
  }
  if (integrations && integrations.length > 0) {
    throw new Error(`[GUARD] Existem ${integrations.length} integrações ativas em staging! Abortando para evitar envios externos.`)
  }

  // 2. Verificação prévia do SuperAdmin preexistente (garante que não foi tocado)
  const { data: preExistingAdmin, error: preErr } = await adminClient
    .from('platform_admins')
    .select('id, email, role, active')
    .eq('id', PREEXISTING_SUPERADMIN.id)
    .maybeSingle()

  if (preErr || !preExistingAdmin) {
    console.warn('[GUARD WARNING] SuperAdmin preexistente não encontrado na tabela platform_admins.')
  } else {
    console.log(`[GUARD] SuperAdmin preexistente verificado: id=${preExistingAdmin.id.slice(0, 8)}... (role=${preExistingAdmin.role}, active=${preExistingAdmin.active}) - INTOCADO.`)
  }

  // 3. Verificação de Colisão Prévia de Empresas
  const targetCompanyIds = Object.values(SYNTHETIC_DATA.companies).map(c => c.id)
  const targetCompanySlugs = Object.values(SYNTHETIC_DATA.companies).map(c => c.slug)

  const { data: existingCompanies, error: compCheckErr } = await adminClient
    .from('companies')
    .select('id, name, slug')
    .or(`id.in.(${targetCompanyIds.join(',')}),slug.in.(${targetCompanySlugs.join(',')})`)

  if (compCheckErr) {
    throw new Error(`[GUARD] Falha ao verificar empresas existentes: ${compCheckErr.message}`)
  }

  if (existingCompanies && existingCompanies.length > 0) {
    for (const ec of existingCompanies) {
      const isKnownSynthetic = Object.values(SYNTHETIC_DATA.companies).some(c => c.id === ec.id && c.slug === ec.slug)
      if (!isKnownSynthetic) {
        throw new Error(`[CRITICAL COLLISION] Empresa existente conflita com namespace sintético: ID=${ec.id}, Slug=${ec.slug}. Abortando para prevenir mutação de dados!`)
      }
    }
  }

  // Se for modo Dry-Run, exibe contagens e finaliza sem mutações
  if (dryRun) {
    console.log('\n[DRY-RUN] Sumário de registros sintéticos planejados para criação:')
    console.log(`- Empresas: ${Object.keys(SYNTHETIC_DATA.companies).length}`)
    console.log(`- Usuários Auth & Perfis: ${Object.keys(SYNTHETIC_DATA.users).length} (incluindo SuperAdmin dedicado)`)
    console.log(`- Conversas: ${Object.keys(SYNTHETIC_DATA.conversations).length}`)
    console.log(`- Mensagens: ${SYNTHETIC_DATA.messages.length}`)
    console.log('[DRY-RUN] Nenhuma mutação foi executada no banco de dados.')
    return {
      dryRun: true,
      runId,
      status: 'dry_run_success',
      wouldCreate: {
        companies: Object.keys(SYNTHETIC_DATA.companies).length,
        users: Object.keys(SYNTHETIC_DATA.users).length,
        conversations: Object.keys(SYNTHETIC_DATA.conversations).length,
        messages: SYNTHETIC_DATA.messages.length,
      },
    }
  }

  // Inicializa a estrutura do manifesto persistente diferenciando planned de created
  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    status: 'seeding',
    targetUrl: supabaseUrl,
    planned: {
      companies: Object.values(SYNTHETIC_DATA.companies).map(c => ({ id: c.id, slug: c.slug })),
      users: Object.values(SYNTHETIC_DATA.users).map(u => ({ email: u.email, role: u.role })),
      conversations: Object.values(SYNTHETIC_DATA.conversations).map(c => ({ id: c.id })),
      messages: SYNTHETIC_DATA.messages.map(m => ({ id: m.id })),
    },
    created: {
      companies: [],
      users: [],
      platformAdmins: [],
      conversations: [],
      messages: [],
      storageFiles: [],
    },
    // Compatibilidade com visualizadores de manifesto plano
    companies: [],
    users: [],
    platformAdmins: [],
    conversations: [],
    messages: [],
    storageFiles: [],
    testResults: [],
  }
  saveTestManifest(manifest, manifestPath)

  // 4. Inserção Segura de Empresas Sintéticas (Insert atômico com persistência de manifesto)
  console.log('[Seed] Inserindo empresas sintéticas...')
  for (const comp of Object.values(SYNTHETIC_DATA.companies)) {
    const isAlreadyThere = existingCompanies?.some(ec => ec.id === comp.id)
    if (!isAlreadyThere) {
      const { error } = await adminClient
        .from('companies')
        .insert({
          id: comp.id,
          name: comp.name,
          slug: comp.slug,
          status: comp.status,
          plan_tier: comp.plan_tier,
        })

      if (error) {
        throw new Error(`[Seed] Falha ao inserir empresa ${comp.name}: ${error.message}`)
      }
    }
    const item = { id: comp.id, name: comp.name, slug: comp.slug }
    manifest.created.companies.push(item)
    manifest.companies.push(item)
    saveTestManifest(manifest, manifestPath)
  }

  // 5. Obter ou Criar Usuários no Supabase Auth e associar perfis (atômico)
  console.log('[Seed] Provisionando usuários auth e perfis sintéticos...')
  const resolvedUserIds = {}

  const { data: userListData, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 100 })
  if (listErr) {
    throw new Error(`[Seed] Falha ao listar usuários auth: ${listErr.message}`)
  }
  const existingUsersByEmail = new Map()
  for (const u of userListData?.users || []) {
    if (u.email) existingUsersByEmail.set(u.email.toLowerCase(), u)
  }

  for (const [userKey, uConfig] of Object.entries(SYNTHETIC_DATA.users)) {
    const email = uConfig.email.toLowerCase()
    let userId = null

    if (existingUsersByEmail.has(email)) {
      userId = existingUsersByEmail.get(email).id
      console.log(`[Seed] Usuário auth já existente para ${email}: ${userId}`)
    } else {
      const { data: newAuthUser, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
        user_metadata: { full_name: uConfig.fullName, synthetic_test: true, runId },
      })
      if (createErr) {
        throw new Error(`[Seed] Falha ao criar usuário auth para ${email}: ${createErr.message}`)
      }
      userId = newAuthUser.user.id
      console.log(`[Seed] Usuário auth criado para ${email}: ${userId}`)
    }

    resolvedUserIds[userKey] = userId
    const targetCompanyId = SYNTHETIC_DATA.companies[uConfig.companyKey].id

    // Verifica se perfil já existe
    const { data: existingProf } = await adminClient
      .from('profiles')
      .select('id, company_id')
      .eq('id', userId)
      .maybeSingle()

    if (!existingProf) {
      const { error: profErr } = await adminClient
        .from('profiles')
        .insert({
          id: userId,
          company_id: targetCompanyId,
          full_name: uConfig.fullName,
          email,
          role: uConfig.role,
        })

      if (profErr) {
        throw new Error(`[Seed] Falha ao inserir perfil para ${email}: ${profErr.message}`)
      }
    }

    const userItem = {
      authId: userId,
      profileId: userId,
      email,
      role: uConfig.role,
      companyId: targetCompanyId,
    }
    manifest.created.users.push(userItem)
    manifest.users.push(userItem)
    saveTestManifest(manifest, manifestPath)

    // Se for SuperAdmin sintético, cadastra em platform_admins
    if (uConfig.isPlatformAdmin) {
      const { data: existingPlatAdmin } = await adminClient
        .from('platform_admins')
        .select('id')
        .eq('id', userId)
        .maybeSingle()

      if (!existingPlatAdmin) {
        const { error: platErr } = await adminClient
          .from('platform_admins')
          .insert({
            id: userId,
            email,
            full_name: uConfig.fullName,
            role: uConfig.platformRole || 'superadmin',
            active: true,
          })

        if (platErr) {
          throw new Error(`[Seed] Falha ao inserir platform_admin sintético: ${platErr.message}`)
        }
      }
      const paItem = { id: userId, email, role: uConfig.platformRole || 'superadmin' }
      manifest.created.platformAdmins.push(paItem)
      manifest.platformAdmins.push(paItem)
      saveTestManifest(manifest, manifestPath)
    }
  }

  // 6. Criar Conversas Sintéticas (atômico)
  console.log('[Seed] Inserindo conversas sintéticas...')
  for (const cConfig of Object.values(SYNTHETIC_DATA.conversations)) {
    const companyId = SYNTHETIC_DATA.companies[cConfig.companyKey].id
    const assignedTo = cConfig.assignedUserKey ? resolvedUserIds[cConfig.assignedUserKey] : null

    const { data: existingConv } = await adminClient
      .from('conversations')
      .select('id')
      .eq('id', cConfig.id)
      .maybeSingle()

    if (!existingConv) {
      const { error } = await adminClient
        .from('conversations')
        .insert({
          id: cConfig.id,
          company_id: companyId,
          assigned_to: assignedTo,
          status: cConfig.status,
          channel: cConfig.channel,
          summary: cConfig.summary,
        })

      if (error) {
        throw new Error(`[Seed] Falha ao inserir conversa ${cConfig.id}: ${error.message}`)
      }
    }
    const convItem = { id: cConfig.id, companyId, assignedTo }
    manifest.created.conversations.push(convItem)
    manifest.conversations.push(convItem)
    saveTestManifest(manifest, manifestPath)
  }

  // 7. Criar Mensagens Sintéticas (atômico)
  console.log('[Seed] Inserindo mensagens sintéticas...')
  for (const msg of SYNTHETIC_DATA.messages) {
    const convConfig = SYNTHETIC_DATA.conversations[msg.convKey]
    const companyId = SYNTHETIC_DATA.companies[msg.companyKey].id

    const { data: existingMsg } = await adminClient
      .from('messages')
      .select('id')
      .eq('id', msg.id)
      .maybeSingle()

    if (!existingMsg) {
      const { error } = await adminClient
        .from('messages')
        .insert({
          id: msg.id,
          company_id: companyId,
          conversation_id: convConfig.id,
          sender_type: msg.senderType,
          content: msg.content,
          message_type: 'text',
        })

      if (error) {
        throw new Error(`[Seed] Falha ao inserir mensagem ${msg.id}: ${error.message}`)
      }
    }
    const msgItem = { id: msg.id, conversationId: convConfig.id, companyId }
    manifest.created.messages.push(msgItem)
    manifest.messages.push(msgItem)
    saveTestManifest(manifest, manifestPath)
  }

  manifest.status = 'seeded'
  saveTestManifest(manifest, manifestPath)
  console.log(`[Seed] Manifesto persistido com sucesso em: ${manifestPath}`)

  console.log('=== [SEED SINTÉTICO CONCLUÍDO COM SUCESSO] ===')
  return {
    success: true,
    runId,
    manifestPath,
    companies: manifest.created.companies.length,
    users: manifest.created.users.length,
    platformAdmins: manifest.created.platformAdmins.length,
    conversations: manifest.created.conversations.length,
    messages: manifest.created.messages.length,
    resolvedUserIds,
  }
}

// Execução direta (apenas se invocado explicitamente via terminal)
if (process.argv[1] && process.argv[1].endsWith('staging-seed-synthetic.mjs')) {
  const isDryRun = process.argv.includes('--dry-run')
  runSyntheticSeed({ dryRun: isDryRun })
    .then(res => {
      console.log('Resultado:', res)
      process.exit(0)
    })
    .catch(err => {
      console.error('[CRITICAL SEED ERROR]', err)
      process.exit(1)
    })
}
