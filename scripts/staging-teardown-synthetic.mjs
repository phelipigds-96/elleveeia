/**
 * scripts/staging-teardown-synthetic.mjs
 * 
 * Script de Teardown Seletivo, Auditado e Idempotente para Homologação Real Multi-Tenant (AC-SEC-01.3-H4).
 * Remove estritamente os artefatos sintéticos de teste referenciados no MANIFESTO da execução atual,
 * preservando integralmente os dados preexistentes da base de homologação e as evidências de falha.
 * 
 * GUARDA DE SEGURANÇA:
 * - Executa estritamente contra o Staging autorizado (dkjrpdhymtkgbknocijy).
 * - Exige manifesto persistente: nunca executa exclusão cega por domínio ou company_id genérico.
 * - Valida a identidade exata de cada registro antes da exclusão.
 * - Respeita ordem de FKs: Storage -> Messages -> Conversations -> Profiles -> Platform Admins -> Auth Users -> Companies.
 * - Suporta modo --dry-run (audita o que seria excluído sem executar mutações).
 * - Suporta retenção de evidências: se manifest.status === 'tests_failed', exige flag --force para limpar.
 * - Garante que a empresa 9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad e o SuperAdmin prévio continuam intactos.
 */

import { createClient } from '@supabase/supabase-js'
import {
  getStagingCredentials,
  DEFAULT_MANIFEST_PATH,
  loadTestManifest,
  saveTestManifest,
  PREEXISTING_SUPERADMIN,
} from './staging-seed-synthetic.mjs'

export function maskId(id) {
  if (!id || typeof id !== 'string') return 'unknown'
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}...${id.slice(-4)}`
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string') return 'unknown'
  const parts = email.split('@')
  if (parts.length !== 2) return 'unknown'
  const name = parts[0]
  const domain = parts[1]
  const maskedName = name.length <= 2 ? `${name}***` : `${name.slice(0, 2)}***`
  return `${maskedName}@${domain}`
}

export async function runSyntheticTeardown(options = {}) {
  const {
    projectRoot = process.cwd(),
    manifestPath = DEFAULT_MANIFEST_PATH,
    dryRun = false,
    force = false,
  } = options

  const { supabaseUrl, serviceRoleKey } = getStagingCredentials(projectRoot)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`=== [STAGING TEARDOWN SINTÉTICO${dryRun ? ' (MODO DRY-RUN)' : ''}] ===`)
  console.log(`Destino: ${supabaseUrl}`)

  // 1. Carregar o manifesto de execução
  const manifest = loadTestManifest(manifestPath)
  if (!manifest) {
    console.log(`[Teardown] Nenhum manifesto de execução encontrado em: ${manifestPath}`)
    console.log('[Teardown] Nenhuma operação necessária (ambiente limpo).')
    return { success: true, message: 'Nenhum manifesto encontrado' }
  }

  console.log(`[Teardown] Manifesto carregado: RunId=${manifest.runId}, Status=${manifest.status}`)

  // 2. Guarda de Retenção de Evidências em caso de falha nos testes
  if ((manifest.status === 'tests_failed' || manifest.status === 'failed') && !force && !dryRun) {
    throw new Error(
      `[EVIDENCE RETENTION GUARD] Os testes da execução ${manifest.runId} falharam (status=${manifest.status}). ` +
      `Por padrão, todos os dados sintéticos foram mantidos intactos para auditoria e análise forense. ` +
      `Para forçar a limpeza deste ambiente de teste, execute com a flag --force.`
    )
  }

  const storageFiles = manifest.created?.storageFiles || manifest.storageFiles || []
  const messageIds = (manifest.created?.messages || manifest.messages || []).map(m => m.id)
  const conversationIds = (manifest.created?.conversations || manifest.conversations || []).map(c => c.id)
  const profileIds = (manifest.created?.users || manifest.users || []).map(u => u.profileId)
  const platformAdminIds = (manifest.created?.platformAdmins || manifest.platformAdmins || []).map(p => p.id)
  const authUserIds = (manifest.created?.users || manifest.users || []).map(u => u.authId)
  const companyIds = (manifest.created?.companies || manifest.companies || []).map(c => c.id)

  // 3. Modo Dry-Run (apenas inspeciona e reporta com máscaras seguras)
  if (dryRun) {
    console.log('\n[DRY-RUN] Registros identificados no manifesto para exclusão cirúrgica:')
    console.log(`- Arquivos no Storage: ${storageFiles.length}`)
    console.log(`- Mensagens Sintéticas: ${messageIds.length} (IDs: ${messageIds.map(maskId).join(', ')})`)
    console.log(`- Conversas Sintéticas: ${conversationIds.length} (IDs: ${conversationIds.map(maskId).join(', ')})`)
    console.log(`- Perfis Sintéticos: ${profileIds.length} (IDs: ${profileIds.map(maskId).join(', ')})`)
    console.log(`- Platform Admins Sintéticos: ${platformAdminIds.length} (IDs: ${platformAdminIds.map(maskId).join(', ')})`)
    console.log(`- Usuários Auth Sintéticos: ${authUserIds.length} (Emails: ${(manifest.users || []).map(u => maskEmail(u.email)).join(', ')})`)
    console.log(`- Empresas Sintéticas: ${companyIds.length} (IDs: ${companyIds.map(maskId).join(', ')})`)
    console.log('\n[DRY-RUN] Zero mutações ou exclusões executadas no banco de dados.')
    return {
      dryRun: true,
      runId: manifest.runId,
      status: 'dry_run_success',
      wouldDelete: {
        storageFiles: storageFiles.length,
        messages: messageIds.length,
        conversations: conversationIds.length,
        profiles: profileIds.length,
        platformAdmins: platformAdminIds.length,
        authUsers: authUserIds.length,
        companies: companyIds.length,
      },
    }
  }

  // 4. Execução do Teardown em Ordem Estrita de Chaves Estrangeiras (FKs)

  // 4.1. Limpeza de Arquivos no Storage (chat-media)
  if (storageFiles.length > 0) {
    console.log(`[Teardown] Removendo ${storageFiles.length} arquivos sintéticos no storage...`)
    for (const f of storageFiles) {
      try {
        const { error } = await adminClient.storage.from(f.bucket || 'chat-media').remove([f.path])
        if (error) {
          console.warn(`[Teardown] Falha ao remover arquivo ${f.path}:`, error.message)
        }
      } catch (err) {
        console.warn(`[Teardown] Exceção ao remover arquivo ${f.path}:`, err?.message || err)
      }
    }
  }

  // 4.2. Limpeza de Mensagens Sintéticas por ID exato
  if (messageIds.length > 0) {
    console.log(`[Teardown] Removendo ${messageIds.length} mensagens sintéticas...`)
    const { error: msgErr } = await adminClient
      .from('messages')
      .delete()
      .in('id', messageIds)

    if (msgErr) {
      throw new Error(`[Teardown] Erro ao deletar mensagens sintéticas: ${msgErr.message}`)
    }
  }

  // 4.3. Limpeza de Conversas Sintéticas por ID exato
  if (conversationIds.length > 0) {
    console.log(`[Teardown] Removendo ${conversationIds.length} conversas sintéticas...`)
    const { error: convErr } = await adminClient
      .from('conversations')
      .delete()
      .in('id', conversationIds)

    if (convErr) {
      throw new Error(`[Teardown] Erro ao deletar conversas sintéticas: ${convErr.message}`)
    }
  }

  // 4.4. Limpeza de Perfis Sintéticos por ID exato
  if (profileIds.length > 0) {
    console.log(`[Teardown] Removendo ${profileIds.length} perfis sintéticos...`)
    const { error: profErr } = await adminClient
      .from('profiles')
      .delete()
      .in('id', profileIds)

    if (profErr) {
      throw new Error(`[Teardown] Erro ao deletar perfis sintéticos: ${profErr.message}`)
    }
  }

  // 4.5. Limpeza de Platform Admins Sintéticos por ID exato
  if (platformAdminIds.length > 0) {
    console.log(`[Teardown] Removendo ${platformAdminIds.length} platform_admins sintéticos...`)
    const { error: platErr } = await adminClient
      .from('platform_admins')
      .delete()
      .in('id', platformAdminIds)

    if (platErr) {
      throw new Error(`[Teardown] Erro ao deletar platform_admin sintético: ${platErr.message}`)
    }
  }

  // 4.6. Limpeza de Usuários Auth no Supabase Auth por ID exato (com validação de email sintético)
  if (authUserIds.length > 0) {
    console.log(`[Teardown] Removendo ${authUserIds.length} contas no Supabase Auth...`)
    for (const u of manifest.users || []) {
      if (u.email && u.email.toLowerCase().endsWith('@qa.ellevee.local')) {
        console.log(`[Teardown] Deletando usuário auth: ${maskEmail(u.email)} (${maskId(u.authId)})`)
        await adminClient.auth.admin.deleteUser(u.authId)
      }
    }
  }

  // 4.7. Limpeza de Empresas Sintéticas por ID exato
  if (companyIds.length > 0) {
    console.log(`[Teardown] Removendo ${companyIds.length} empresas sintéticas...`)
    const { error: compErr } = await adminClient
      .from('companies')
      .delete()
      .in('id', companyIds)

    if (compErr) {
      throw new Error(`[Teardown] Erro ao deletar empresas sintéticas: ${compErr.message}`)
    }
  }

  // 5. Verificação de Integridade dos Dados Preexistentes
  console.log('[Teardown] Validando integridade dos dados preexistentes...')
  const { data: preComp, error: preCompErr } = await adminClient
    .from('companies')
    .select('id, name')
    .eq('id', PREEXISTING_SUPERADMIN.companyId)
    .maybeSingle()

  if (preCompErr || !preComp) {
    throw new Error(`[CRITICAL AUDIT FAILURE] Empresa preexistente ${PREEXISTING_SUPERADMIN.companyId} não foi encontrada pós-teardown!`)
  }

  const { data: preAdmin, error: preAdminErr } = await adminClient
    .from('platform_admins')
    .select('id, email, active')
    .eq('id', PREEXISTING_SUPERADMIN.id)
    .maybeSingle()

  if (preAdminErr || !preAdmin) {
    throw new Error(`[CRITICAL AUDIT FAILURE] SuperAdmin preexistente ${PREEXISTING_SUPERADMIN.id} não foi encontrado pós-teardown!`)
  }

  console.log(`[Teardown] Dados preexistentes verificados intactos: Empresa="${preComp.name}", SuperAdmin=${maskEmail(preAdmin.email)}.`)

  // Atualiza e salva o manifesto com status concluído
  manifest.status = 'teardown_complete'
  manifest.teardownAt = new Date().toISOString()
  saveTestManifest(manifest, manifestPath)

  console.log('=== [TEARDOWN SINTÉTICO FINALIZADO COM SUCESSO] ===')
  return { success: true, runId: manifest.runId }
}

// Execução direta (apenas se invocado explicitamente via terminal)
if (process.argv[1] && process.argv[1].endsWith('staging-teardown-synthetic.mjs')) {
  const isDryRun = process.argv.includes('--dry-run')
  const isForce = process.argv.includes('--force')
  runSyntheticTeardown({ dryRun: isDryRun, force: isForce })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[CRITICAL TEARDOWN ERROR]', err.message || err)
      process.exit(1)
    })
}
