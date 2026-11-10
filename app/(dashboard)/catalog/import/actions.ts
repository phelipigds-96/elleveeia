'use server'

import { createClient } from '@/lib/supabase/server'
import { requireActiveCompany } from '@/lib/services/platform/tenant-access'
import { importProductsBatch, type CatalogImportRow, type ImportProductsBatchOptions } from '@/lib/services/catalog/import-products'

export interface CatalogActionOptions {
  supabaseClient?: any
  adminClient?: any
}

function cleanPrice(priceRaw: string | undefined | null): number | null {
  if (!priceRaw) return null
  let clean = priceRaw.replace(/[^\d.,]/g, '').trim()
  if (!clean) return null

  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.')
  }

  const p = parseFloat(clean)
  return isNaN(p) ? null : p
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
    
    // 1. Decodificação inteligente com alta tolerância: UTF-8 com fallback para ISO-8859-1 (Latin1)
    let text = ''
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer)
    } catch {
      text = new TextDecoder('iso-8859-1').decode(arrayBuffer)
    }

    const lines = text.split(/\r?\n/)
    if (lines.length === 0) {
      return { error: 'O arquivo enviado está vazio.' }
    }

    // 2. Detecção dinâmica de delimitador (; ou ,)
    let semiCount = 0
    let commaCount = 0
    for (let i = 0; i < Math.min(25, lines.length); i++) {
      semiCount += (lines[i].match(/;/g) || []).length
      commaCount += (lines[i].match(/,/g) || []).length
    }
    const delimiter = semiCount >= commaCount ? ';' : ','

    // 3. Mapeamento inteligente de colunas
    let colMap = {
      codigo: 0,
      barras: 1 as number | null,
      nome: 2,
      preco: 3
    }

    let isSumelErp = false
    let headerRowIndex = -1

    for (let i = 0; i < Math.min(50, lines.length); i++) {
      const rawLine = lines[i].trim()
      if (!rawLine) continue
      const cols = rawLine.split(delimiter).map(c => c.trim().toLowerCase())

      // Formato ERP Sumel: "codigo;barras;;;;;;;"
      if (cols[0] === 'codigo' && cols[1] === 'barras') {
        headerRowIndex = i
        if (cols.length >= 10 && cols[7] && (cols[7].includes('nome') || cols[7].includes('desc'))) {
          // Legado 11 colunas
          colMap = { codigo: 0, barras: 3, nome: 7, preco: 10 }
        } else {
          // Sumel 9 colunas
          isSumelErp = true
          colMap = { codigo: 0, barras: 1, nome: 2, preco: 3 }
        }
        break
      }

      // Cabeçalho explícito com nomes de colunas (ordem flexível)
      let cIdx = -1, bIdx = -1, nIdx = -1, pIdx = -1
      for (let j = 0; j < cols.length; j++) {
        const col = cols[j]
        if (['codigo', 'código', 'cod', 'sku', 'id'].includes(col)) cIdx = j
        else if (['barras', 'barra', 'ean', 'gtin', 'barcode'].includes(col)) bIdx = j
        else if (['nome', 'descricao', 'descrição', 'produto', 'desc', 'item', 'title'].includes(col)) nIdx = j
        else if (['preco', 'preço', 'valor', 'venda', 'price'].includes(col)) pIdx = j
      }

      if (cIdx !== -1 && (nIdx !== -1 || pIdx !== -1)) {
        headerRowIndex = i
        colMap = {
          codigo: cIdx,
          barras: bIdx !== -1 ? bIdx : null,
          nome: nIdx !== -1 ? nIdx : (cIdx === 0 ? 1 : 0),
          preco: pIdx !== -1 ? pIdx : (nIdx === 1 ? 2 : 1)
        }
        break
      }
    }

    const parsedRows: CatalogImportRow[] = []
    const seenSkus = new Set<string>()
    const startIndex = headerRowIndex !== -1 ? headerRowIndex + 1 : 0

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const cols = line.split(delimiter)
      const firstCol = cols[0]?.trim()
      if (!firstCol) continue

      // Filtrar ruídos de relatórios ERP (cabeçalhos repetidos e rodapés de paginação)
      const firstLower = firstCol.toLowerCase()
      if (firstLower === 'codigo' || firstLower === 'código' || firstLower === 'sku') continue
      if (firstLower.startsWith('processado por:')) continue
      if (firstLower.startsWith('relatório') || firstLower.startsWith('relatorio')) continue
      if (firstLower.startsWith('quantidade de produtos')) continue
      if (firstLower.includes('alimentos') || firstLower.includes('ltda') || firstLower.includes('sistema de marketing')) continue

      // No caso específico de relatório ERP Sumel, o código é numérico
      if (isSumelErp && isNaN(Number(firstCol))) continue

      const codigo = (cols[colMap.codigo] || firstCol).trim()
      if (!codigo) continue

      const nome = cols[colMap.nome]?.trim()
      if (!nome) continue

      const barras = (colMap.barras !== null && cols[colMap.barras]) 
        ? cols[colMap.barras].trim() || null 
        : null

      const precoRaw = cols[colMap.preco]?.trim()
      const preco = cleanPrice(precoRaw)

      if (!seenSkus.has(codigo)) {
        seenSkus.add(codigo)
        parsedRows.push({
          codigo,
          barras,
          nome,
          preco
        })
      }
    }

    if (parsedRows.length === 0) {
      return { error: 'Nenhum produto válido foi identificado no arquivo. Verifique se o layout possui código, nome e preço.' }
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
