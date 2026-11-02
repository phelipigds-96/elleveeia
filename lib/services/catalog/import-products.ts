import { createAdminClient } from '@/lib/supabase/service'
import { normalizeCatalogText } from './normalization'

export interface CatalogImportRow {
  codigo: string
  barras: string | null
  nome: string
  preco: number | null
  price_type?: string
  min_quantity?: number
  max_quantity?: number | null
  valid_from?: string | null
  valid_until?: string | null
}

export interface CatalogImportResult {
  successCount: number
  errorCount: number
  errors: string[]
}

/**
 * Serviço genérico para importar produtos de um arquivo.
 * Recebe o formato limpo validado pelo Server Action.
 * Utiliza o ID externo (código/sku) como chave de idempotência do produto
 * e (company_id, product_id, price_type, min_quantity) como chave de preço.
 */
export async function importProductsBatch(companyId: string, rows: CatalogImportRow[]): Promise<CatalogImportResult> {
  const supabase = createAdminClient()
  
  let successCount = 0
  let errorCount = 0
  const errors: string[] = []

  // Processa em lotes (batches) de 500 para não estourar memória / limite da API
  const BATCH_SIZE = 500
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    
    // 1. Mapear Produtos para UPSERT
    const productsPayload = batch.map(row => ({
      company_id: companyId,
      external_id: row.codigo, // Usamos o código como external_id
      sku: row.codigo,         // E também como SKU (chave única com company_id)
      barcode: row.barras || null,
      name: row.nome,
      normalized_name: normalizeCatalogText(row.nome),
      active: true,
      updated_at: new Date().toISOString()
    }))

    // Faz o Upsert dos Produtos
    const { data: upsertedProducts, error: prodErr } = await supabase
      .from('products')
      .upsert(productsPayload, { 
        onConflict: 'company_id,sku', 
        ignoreDuplicates: false 
      })
      .select('id, sku')

    if (prodErr || !upsertedProducts) {
      errorCount += batch.length
      errors.push(`Erro ao importar lote ${i/BATCH_SIZE + 1}: ${prodErr?.message}`)
      continue
    }

    // 2. Mapear Preços para UPSERT (permitindo múltiplas faixas por produto)
    const pricesPayload = []
    for (const row of batch) {
      if (row.preco !== null && row.preco > 0) {
        // Encontra o ID interno gerado/retornado pelo Upsert do Produto
        const productDb = upsertedProducts.find(p => p.sku === row.codigo)
        if (productDb) {
          const priceType = row.price_type || 'retail'
          const minQuantity = row.min_quantity && row.min_quantity > 0 ? Number(row.min_quantity) : 1

          pricesPayload.push({
            company_id: companyId,
            product_id: productDb.id,
            price_type: priceType,
            min_quantity: minQuantity,
            max_quantity: row.max_quantity != null ? Number(row.max_quantity) : null,
            price: row.preco,
            active: true,
            valid_from: row.valid_from ?? null,
            valid_until: row.valid_until ?? null,
            updated_at: new Date().toISOString()
          })
        }
      }
    }

    if (pricesPayload.length > 0) {
      const { error: priceErr } = await supabase
        .from('product_prices')
        .upsert(pricesPayload, {
          onConflict: 'company_id,product_id,price_type,min_quantity',
          ignoreDuplicates: false
        })

      if (priceErr) {
        errors.push(`Erro ao importar preços do lote ${i/BATCH_SIZE + 1}: ${priceErr.message}`)
        // Não incrementa errorCount total porque o produto salvou, apenas falhou o preço
      }
    }

    successCount += batch.length
  }

  return { successCount, errorCount, errors }
}
