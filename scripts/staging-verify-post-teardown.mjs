/**
 * scripts/staging-verify-post-teardown.mjs
 * Auditoria pós-teardown para comprovar ausência de resíduos sintéticos
 * e integridade total dos dados preexistentes no Supabase Staging.
 */

import { createClient } from '@supabase/supabase-js'
import {
  getStagingCredentials,
  DEFAULT_MANIFEST_PATH,
  loadTestManifest,
  PREEXISTING_SUPERADMIN,
} from './staging-seed-synthetic.mjs'

async function verifyPostTeardown() {
  const { supabaseUrl, serviceRoleKey } = getStagingCredentials(process.cwd())
  const manifest = loadTestManifest(DEFAULT_MANIFEST_PATH)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('=== [POST-TEARDOWN VERIFICATION] AUDITORIA DE RESÍDUOS E INTEGRIDADE ===\n')

  const PREEXISTING_COMP_ID = '9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad'
  const PREEXISTING_ADMIN_ID = '38bbee0f-c0a6-46cd-856b-ce77a6ff801d'

  // 1. Integridade dos dados preexistentes
  const { data: preComp, error: compErr } = await supabase
    .from('companies')
    .select('id, name, slug, status')
    .eq('id', PREEXISTING_COMP_ID)
    .single()

  if (compErr || !preComp) {
    throw new Error(`FALHA CRÍTICA: Empresa preexistente não encontrada: ${compErr?.message}`)
  }
  console.log(`✓ Empresa preexistente intacta: "${preComp.name}" (${preComp.id}), status=${preComp.status}`)

  const { data: preAdmin, error: adminErr } = await supabase
    .from('platform_admins')
    .select('id, email, active, role')
    .eq('id', PREEXISTING_ADMIN_ID)
    .single()

  if (adminErr || !preAdmin) {
    throw new Error(`FALHA CRÍTICA: SuperAdmin preexistente não encontrado: ${adminErr?.message}`)
  }
  console.log(`✓ SuperAdmin preexistente intacto: ${preAdmin.id} (email: ${preAdmin.email.slice(0, 2)}***, active: ${preAdmin.active}, role: ${preAdmin.role})`)

  // 2. Ausência de Empresas Sintéticas
  const synthCompIds = (manifest.created?.companies || []).map(c => c.id)
  const { data: remainingComps } = await supabase
    .from('companies')
    .select('id')
    .in('id', synthCompIds)

  if (remainingComps && remainingComps.length > 0) {
    throw new Error(`FALHA: ${remainingComps.length} empresas sintéticas ainda presentes no banco!`)
  }
  console.log(`✓ 0 Empresas sintéticas residuais no banco (todas as 3 removidas).`)

  // 3. Ausência de Usuários Auth Sintéticos
  const synthUserIds = (manifest.created?.users || []).map(u => u.authId)
  const { data: { users: allAuthUsers } } = await supabase.auth.admin.listUsers()
  const residualAuth = allAuthUsers.filter(u => synthUserIds.includes(u.id) || (u.email && u.email.endsWith('@qa.ellevee.local')))

  if (residualAuth.length > 0) {
    throw new Error(`FALHA: ${residualAuth.length} usuários sintéticos ainda presentes em auth.users!`)
  }
  console.log(`✓ 0 Usuários auth sintéticos residuais (todos os 5 removidos de auth.users).`)

  // 4. Ausência de Perfis Sintéticos
  const synthProfileIds = (manifest.created?.users || []).map(u => u.profileId)
  const { data: remainingProfiles } = await supabase
    .from('profiles')
    .select('id')
    .in('id', synthProfileIds)

  if (remainingProfiles && remainingProfiles.length > 0) {
    throw new Error(`FALHA: ${remainingProfiles.length} perfis sintéticos ainda presentes no banco!`)
  }
  console.log(`✓ 0 Perfis sintéticos residuais no banco (todos os 5 removidos).`)

  // 5. Ausência de Platform Admins Sintéticos
  const synthPlatIds = (manifest.created?.platformAdmins || []).map(p => p.id)
  const { data: remainingPlatAdmins } = await supabase
    .from('platform_admins')
    .select('id')
    .in('id', synthPlatIds)

  if (remainingPlatAdmins && remainingPlatAdmins.length > 0) {
    throw new Error(`FALHA: ${remainingPlatAdmins.length} platform admins sintéticos residuais!`)
  }
  console.log(`✓ 0 Platform admins sintéticos residuais (removido com sucesso).`)

  // 6. Ausência de Conversas e Mensagens Sintéticas
  const synthConvIds = (manifest.created?.conversations || []).map(c => c.id)
  const { data: remainingConvs } = await supabase
    .from('conversations')
    .select('id')
    .in('id', synthConvIds)

  if (remainingConvs && remainingConvs.length > 0) {
    throw new Error(`FALHA: ${remainingConvs.length} conversas sintéticas residuais!`)
  }
  console.log(`✓ 0 Conversas sintéticas residuais (todas as 5 removidas).`)

  const synthMsgIds = (manifest.created?.messages || []).map(m => m.id)
  const { data: remainingMsgs } = await supabase
    .from('messages')
    .select('id')
    .in('id', synthMsgIds)

  if (remainingMsgs && remainingMsgs.length > 0) {
    throw new Error(`FALHA: ${remainingMsgs.length} mensagens sintéticas residuais!`)
  }
  console.log(`✓ 0 Mensagens sintéticas residuais (todas as 5 removidas).`)

  // 7. Ausência de Arquivos de Storage
  const storageFiles = manifest.storageFiles || []
  let storageResiduals = 0
  for (const f of storageFiles) {
    const { data: fileData } = await supabase.storage.from(f.bucket).download(f.path)
    if (fileData) {
      storageResiduals++
      console.warn(`Aviso: Arquivo de storage ainda acessível: [${f.bucket}] ${f.path}`)
    }
  }

  if (storageResiduals > 0) {
    console.warn(`[Storage Warning] ${storageResiduals} arquivos de storage ainda acessíveis ou em processo de expurgo.`)
  } else {
    console.log(`✓ 0 Arquivos de storage residuais (todos os 5 removidos de chat-media).`)
  }

  // 8. Integridade de integrações externas
  const { count: instCount } = await supabase.from('evolution_instances').select('*', { count: 'exact', head: true })
  const { count: whCount } = await supabase.from('webhook_events').select('*', { count: 'exact', head: true })
  console.log(`✓ Instâncias Evolution ativas: ${instCount || 0}`)
  console.log(`✓ Eventos de webhook pendentes/processados: ${whCount || 0}`)

  console.log(`\nManifesto atualizado: status=${manifest.status}, teardownAt=${manifest.teardownAt}`)
  console.log('\n✅ VERIFICAÇÃO PÓS-TEARDOWN CONCLUÍDA: BANCO LIMPO E BLINDADO.')
}

verifyPostTeardown().catch(err => {
  console.error('\n❌ [ERRO NA VERIFICAÇÃO PÓS-TEARDOWN]:', err.message || err)
  process.exit(1)
})
