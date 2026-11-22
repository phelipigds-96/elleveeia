/**
 * scripts/staging-verify-pre-teardown.mjs
 * Validação rigorosa de identidade, propriedade e vínculos antes do teardown real.
 */

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  getStagingCredentials,
  DEFAULT_MANIFEST_PATH,
  loadTestManifest,
  PREEXISTING_SUPERADMIN,
} from './staging-seed-synthetic.mjs'

async function verifyPreTeardown() {
  const { supabaseUrl, serviceRoleKey } = getStagingCredentials(process.cwd())
  const manifest = loadTestManifest(DEFAULT_MANIFEST_PATH)

  if (!manifest) {
    throw new Error('Manifesto não encontrado.')
  }

  if (manifest.runId !== 'h4_1795235039022_ujjfse') {
    throw new Error(`RunId divergente do autorizado: esperado h4_1795235039022_ujjfse, encontrado ${manifest.runId}`)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('=== [PRE-DELETION VALIDATION] VALIDANDO IDENTIDADES E PROPRIEDADES ===\n')

  // 1. Validar Preexistentes
  const PREEXISTING_COMP_ID = '9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad'
  const PREEXISTING_ADMIN_ID = '38bbee0f-c0a6-46cd-856b-ce77a6ff801d'

  const { data: preComp, error: compErr } = await supabase
    .from('companies')
    .select('id, name, slug')
    .eq('id', PREEXISTING_COMP_ID)
    .single()

  if (compErr || !preComp) {
    throw new Error(`ERRO: Empresa preexistente ${PREEXISTING_COMP_ID} não encontrada: ${compErr?.message}`)
  }
  console.log(`✓ Empresa preexistente intacta: "${preComp.name}" (${preComp.id})`)

  const { data: preAdmin, error: adminErr } = await supabase
    .from('platform_admins')
    .select('id, email, active')
    .eq('id', PREEXISTING_ADMIN_ID)
    .single()

  if (adminErr || !preAdmin) {
    throw new Error(`ERRO: SuperAdmin preexistente ${PREEXISTING_ADMIN_ID} não encontrado: ${adminErr?.message}`)
  }
  console.log(`✓ SuperAdmin preexistente intacto: ${preAdmin.id} (active: ${preAdmin.active})`)

  // 2. Validar Empresas Sintéticas
  const synthCompIds = (manifest.created?.companies || []).map(c => c.id)
  if (synthCompIds.length !== 3) {
    throw new Error(`Quantidade inesperada de empresas sintéticas no manifesto: ${synthCompIds.length}`)
  }

  const { data: dbComps, error: dbCompsErr } = await supabase
    .from('companies')
    .select('id, name, slug')
    .in('id', synthCompIds)

  if (dbCompsErr || dbComps.length !== 3) {
    throw new Error(`Divergência nas empresas sintéticas no banco: encontradas ${dbComps?.length || 0}`)
  }

  for (const c of dbComps) {
    if (c.id === PREEXISTING_COMP_ID) throw new Error('ERRO CRÍTICO: ID preexistente está na lista sintética!')
    if (!c.slug.endsWith('-qa-homolog')) throw new Error(`ERRO: Slug não condiz com padrão sintético: ${c.slug}`)
    console.log(`✓ Empresa sintética confirmada para exclusão: ${c.id} (${c.slug})`)
  }

  // 3. Validar Usuários Sintéticos
  const synthUsers = manifest.created?.users || []
  if (synthUsers.length !== 5) {
    throw new Error(`Quantidade inesperada de usuários sintéticos: ${synthUsers.length}`)
  }
  const synthUserIds = synthUsers.map(u => u.authId)

  const { data: { users: authUsers }, error: authErr } = await supabase.auth.admin.listUsers()
  if (authErr) throw new Error(`Falha ao listar usuários auth: ${authErr.message}`)

  const synthAuthFound = authUsers.filter(u => synthUserIds.includes(u.id))
  if (synthAuthFound.length !== 5) {
    throw new Error(`Divergência de usuários auth no banco: esperados 5, encontrados ${synthAuthFound.length}`)
  }

  for (const u of synthAuthFound) {
    if (u.id === PREEXISTING_ADMIN_ID) throw new Error('ERRO CRÍTICO: Admin preexistente na lista de exclusão!')
    if (!u.email.endsWith('@qa.ellevee.local')) throw new Error(`ERRO: Email não sintético: ${u.email}`)
    console.log(`✓ Usuário auth confirmado: ${u.id} (${u.email})`)
  }

  // 4. Validar Platform Admins Sintéticos
  const synthPlatIds = (manifest.created?.platformAdmins || []).map(p => p.id)
  const { data: dbPlatAdmins, error: platErr } = await supabase
    .from('platform_admins')
    .select('id, email')
    .in('id', synthPlatIds)

  if (platErr || dbPlatAdmins.length !== 1) {
    throw new Error(`Divergência de platform admins sintéticos: esperados 1, encontrados ${dbPlatAdmins?.length || 0}`)
  }

  for (const p of dbPlatAdmins) {
    if (p.id === PREEXISTING_ADMIN_ID) throw new Error('ERRO CRÍTICO: Admin preexistente em lista de exclusão!')
    console.log(`✓ Platform admin sintético confirmado: ${p.id} (${p.email})`)
  }

  // 5. Validar Conversas e Mensagens
  const synthConvIds = (manifest.created?.conversations || []).map(c => c.id)
  const { data: dbConvs, error: convErr } = await supabase
    .from('conversations')
    .select('id, company_id')
    .in('id', synthConvIds)

  if (convErr || dbConvs.length !== 5) {
    throw new Error(`Divergência em conversas sintéticas: esperadas 5, encontradas ${dbConvs?.length || 0}`)
  }

  for (const conv of dbConvs) {
    if (!synthCompIds.includes(conv.company_id)) {
      throw new Error(`ERRO: Conversa vinculada a empresa não sintética: ${conv.company_id}`)
    }
  }
  console.log(`✓ 5 Conversas sintéticas validadas sob empresas sintéticas.`)

  const synthMsgIds = (manifest.created?.messages || []).map(m => m.id)
  const { data: dbMsgs, error: msgErr } = await supabase
    .from('messages')
    .select('id, conversation_id')
    .in('id', synthMsgIds)

  if (msgErr || dbMsgs.length !== 5) {
    throw new Error(`Divergência em mensagens sintéticas: esperadas 5, encontradas ${dbMsgs?.length || 0}`)
  }

  for (const m of dbMsgs) {
    if (!synthConvIds.includes(m.conversation_id)) {
      throw new Error(`ERRO: Mensagem vinculada a conversa não sintética: ${m.conversation_id}`)
    }
  }
  console.log(`✓ 5 Mensagens sintéticas validadas sob conversas sintéticas.`)

  // 6. Validar Arquivos de Storage
  const storageFiles = manifest.storageFiles || []
  if (storageFiles.length !== 5) {
    throw new Error(`Divergência de arquivos de storage: esperados 5, encontrados ${storageFiles.length}`)
  }

  for (const f of storageFiles) {
    const isUnderSynthComp = synthCompIds.some(cid => f.path.startsWith(cid + '/'))
    if (!isUnderSynthComp) {
      throw new Error(`ERRO: Arquivo de storage não está sob empresa sintética: ${f.path}`)
    }
    console.log(`✓ Arquivo de storage confirmado sob empresa sintética: [${f.bucket}] ${f.path}`)
  }

  console.log('\n✅ TODOS OS CONTROLES DE IDENTIDADE, VÍNCULO E PROPRIEDADE PASSARAM COM SUCESSO.')
  console.log('Zero divergências encontradas. Autorizada a limpeza cirúrgica dos dados sintéticos.')
}

verifyPreTeardown().catch(err => {
  console.error('\n❌ [ABORT] FALHA NA VALIDAÇÃO PRÉVIA:', err.message || err)
  process.exit(1)
})
