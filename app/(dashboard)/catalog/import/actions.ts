'use server'

import { createClient } from '@/lib/supabase/server'
import { requireActiveCompany } from '@/lib/services/platform/tenant-access'
import { importProductsBatch, type CatalogImportRow, type ImportProductsBatchOptions } from '@/lib/services/catalog/import-products'

export interface CatalogActionOptions {
  supabaseClient?: any
  adminClient?: any
}

export async function parseCsvFileAction(formData: FormData, options?: CatalogActionOptions) {
  let supabase: any
  try {
    supabase = options?.supabaseClient || createClient()
  } catch {
    supabase = options?.supabaseClient
  }
  if (!supabase) return { error: 'Falha ao inicializar contexto de autenticação.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id) return { error: 'Perfil de empresa não localizado.' }

  if (!['admin', 'owner'].includes(profile.role)) {
    return { error: 'Não autorizado: apenas administradores podem importar catálogo.' }
  }

  try {
    await requireActiveCompany(profile.company_id, { adminClient: options?.adminClient })
  } catch (err: any) {
    return { error: err.message, code: err.code }
  }

  const file = formData.get('file') as File
  if (!file) return { error: 'Arquivo não encontrado.' }

  try {
    const arrayBuffer = await file.arrayBuffer()
    // Decodifica usando latin1 (ISO-8859-1) para corrigir caracteres estranhos "Descrio"
    const decoder = new TextDecoder('iso-8859-1')
    const text = decoder.decode(arrayBuffer)

    const lines = text.split(/\r?\n/)
    
    const parsedRows: CatalogImportRow[] = []
    let dataStarted = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const cols = line.split(';')

      // Identifica o cabeçalho
      if (!dataStarted) {
        if (cols[0]?.toLowerCase() === 'codigo' && cols.length >= 10) {
          dataStarted = true
        }
        continue
      }

      // Linhas finais do arquivo a ignorar
      if (cols[0] && cols[0].startsWith('Processado por:')) continue
      if (cols[0] === '') continue // Linha vazia de dados
      
      const codigo = cols[0]?.trim()
      if (!codigo || isNaN(Number(codigo))) continue

      const barras = cols[3]?.trim() || null
      const nome = cols[7]?.trim()
      if (!nome) continue

      let preco = null
      const precoRaw = cols[10]?.trim()
      if (precoRaw) {
        const p = parseFloat(precoRaw.replace(',', '.'))
        if (!isNaN(p)) preco = p
      }

      parsedRows.push({
        codigo,
        barras,
        nome,
        preco
      })
    }

    return { success: true, data: parsedRows }
  } catch (error: any) {
    console.error('Erro no parser CSV:', error)
    return { error: 'Falha ao analisar o arquivo: ' + error.message }
  }
}

export async function confirmImportAction(rows: CatalogImportRow[], options?: CatalogActionOptions) {
  let supabase: any
  try {
    supabase = options?.supabaseClient || createClient()
  } catch {
    supabase = options?.supabaseClient
  }
  if (!supabase) return { success: false, error: 'Falha ao inicializar contexto de autenticação.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Usuário não autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id) return { success: false, error: 'Perfil de empresa não localizado.' }

  if (!['admin', 'owner'].includes(profile.role)) {
    return { success: false, error: 'Não autorizado: apenas administradores podem importar catálogo.' }
  }

  const companyId = profile.company_id

  if (!rows || rows.length === 0) {
    return { success: false, error: 'Nenhum registro para importar.' }
  }

  try {
    // 1. Validação defensiva na camada da Server Action
    await requireActiveCompany(companyId, { adminClient: options?.adminClient })

    // 2. Execução da importação em lote com proteção redundante na camada de serviço
    const result = await importProductsBatch(companyId, rows, { adminClient: options?.adminClient })
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err.message, code: err.code }
  }
}
