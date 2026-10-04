'use server'

import { getCompanyId } from '@/lib/services/conversations'
import { importProductsBatch, CatalogImportRow } from '@/lib/services/catalog/import-products'

export async function parseCsvFileAction(formData: FormData) {
  const companyId = await getCompanyId()
  if (!companyId) return { error: 'Usuário não autenticado.' }

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

export async function confirmImportAction(rows: CatalogImportRow[]) {
  const companyId = await getCompanyId()
  if (!companyId) return { success: false, error: 'Usuário não autenticado.' }

  if (!rows || rows.length === 0) {
    return { success: false, error: 'Nenhum registro para importar.' }
  }

  try {
    const result = await importProductsBatch(companyId, rows)
    return { success: true, ...result }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
