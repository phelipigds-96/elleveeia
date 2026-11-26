/**
 * scripts/manage-synthetic-catalog-ac046.mjs
 * 
 * ELLEVEE IA — AC-04.6.1 | GERENCIADOR DO CATÁLOGO SINTÉTICO QA
 * 
 * Responsável pela preparação, inserção controlada, verificação, recuperação
 * e teardown cirúrgico das fixtures sintéticas do catálogo comercial da suíte AC-04.6.
 * 
 * DIRETRIZES DE SEGURANÇA E CONFIABILIDADE (AC-04.6.1):
 * 1. Proteção contra sobrescrita e colisões:
 *    - Verificação prévia no banco de colisões por ID, SKU e chaves de negócio do schema.
 *    - Verificação de chave única de preços: UNIQUE (company_id, product_id, price_type, min_quantity).
 *    - Rejeição fail-closed se colidir com registros sem marcadores da suíte AC-04.6 ou IDs divergentes.
 *    - Inserção controlada (INSERT) em vez de UPSERT cego.
 *    - Proteção estrita do modo --dry-run: NUNCA grava ou altera arquivos locais,
 *      mesmo quando o catálogo já se encontra 100% cadastrado no banco.
 * 2. Manifesto persistente e rastreabilidade estrita de propriedade:
 *    - Registro de manifesto atômico antes de iniciar qualquer escrita.
 *    - Gravação incremental de IDs efetivamente inseridos nesta execução.
 *    - No caminho alreadySeeded, NÃO atribui registros encontrados como "criados" por esta execução.
 *    - Fail-closed no teardown: NUNCA utiliza IDs planejados como fallback quando
 *      o manifesto está ausente, inválido, corrompido, vazio ou em 'requires_manual_review'.
 * 3. Recuperação ativa de interrupções (--recover):
 *    - Diferencia registros efetivamente criados de registros apenas descobertos.
 *    - Reconciliação baseada em evidência persistida de intenção/propriedade anterior à escrita (run_id/manifesto).
 *    - Na ausência de evidência suficiente de propriedade, sinaliza 'requires_manual_review'
 *      e bloqueia exclusão para preservar dados pré-existentes.
 * 4. Isolamento multi-tenant e segurança de credenciais:
 *    - Restrito exclusivamente ao Supabase Staging autorizado (dkjrpdhymtkgbknocijy).
 *    - Escopo exclusivo do tenant QA oficial (9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad).
 *    - Aborto imediato se qualquer variável referenciar o ID de Produção (ipxhkwirzrigttpwzwbl).
 *    - Preservação incondicional dos 9 produtos pré-existentes da etapa H4 (e1000000-*).
 *    - Zero dados reais ou confidenciais da Sumel.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// ==============================================================================
// CONSTANTES DE INFRAESTRUTURA E MARCADORES DE SEGURANÇA
// ==============================================================================

export const STAGING_PROJECT_ID = 'dkjrpdhymtkgbknocijy'
export const PRODUCTION_PROJECT_ID = 'ipxhkwirzrigttpwzwbl'
export const AUTHORIZED_STAGING_URL = `https://${STAGING_PROJECT_ID}.supabase.co`

// Tenant QA Oficial Confirmado no Supabase Staging
export const QA_COMPANY_ID = '9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad'
export const QA_COMPANY_NAME = 'Ellevée Homologação QA'

// Marcadores de Suíte e Rastreabilidade
export const SUITE_TAG = 'AC-04.6'
export const SYNTHETIC_SKU_PREFIX = 'SYNTH-AC046-'

// Prefixo protegido dos 9 produtos pré-existentes da etapa H4 (NUNCA MODIFICAR OU EXCLUIR)
export const H4_PRODUCT_ID_PREFIX = 'e1000000-'
export const H4_PRICE_ID_PREFIX = 'f1000000-'
export const H4_EXPECTED_PRODUCTS_COUNT = 9
export const H4_EXPECTED_PRICES_COUNT = 9
export const H4_PRODUCT_IDS = Array.from({ length: 9 }, (_, i) => `e1000000-0000-0000-0000-00000000000${i + 1}`)
export const H4_PRICE_IDS = Array.from({ length: 9 }, (_, i) => `f1000000-0000-0000-0000-00000000000${i + 1}`)

// Chaves estrangeiras pré-existentes no tenant QA
export const KNOWN_BRANDS = {
  TIROL: 'b1000000-0000-0000-0000-000000000002',
  HARALD: 'b1000000-0000-0000-0000-000000000006'
}

export const KNOWN_CATEGORIES = {
  LATICINIOS: 'c1000000-0000-0000-0000-000000000001',
  CHOCOLATES: 'c1000000-0000-0000-0000-000000000002'
}

export const MANIFEST_PATH = path.join(
  ROOT,
  '.staging-workspace',
  'manifest-catalog-ac046.json'
)

// ==============================================================================
// DEFINIÇÃO DAS FIXTURES SINTÉTICAS (6 PRODUTOS E 10 FAIXAS DE PREÇO)
// ==============================================================================

export const SYNTHETIC_PRODUCTS = [
  {
    id: 'e2000000-0000-0000-0000-000000000001',
    company_id: QA_COMPANY_ID,
    name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
    normalized_name: 'leite condensado semidesnatado tirol 395g cx c/ 27',
    sku: 'SYNTH-AC046-01',
    unit: 'UN',
    package_description: 'Caixa com 27 unidades',
    brand_id: KNOWN_BRANDS.TIROL,
    category_id: KNOWN_CATEGORIES.LATICINIOS,
    active: true,
    metadata: {
      units_per_package: 27,
      is_synthetic: true,
      suite: SUITE_TAG
    }
  },
  {
    id: 'e2000000-0000-0000-0000-000000000002',
    company_id: QA_COMPANY_ID,
    name: 'LEITE CONDENSADO INTEGRAL TIROL 395G CX C/ 27',
    normalized_name: 'leite condensado integral tirol 395g cx c/ 27',
    sku: 'SYNTH-AC046-02',
    unit: 'UN',
    package_description: 'Caixa com 27 unidades',
    brand_id: KNOWN_BRANDS.TIROL,
    category_id: KNOWN_CATEGORIES.LATICINIOS,
    active: true,
    metadata: {
      units_per_package: 27,
      is_synthetic: true,
      suite: SUITE_TAG
    }
  },
  {
    id: 'e2000000-0000-0000-0000-000000000003',
    company_id: QA_COMPANY_ID,
    name: 'LEITE UHT INTEGRAL TIROL 1L FD C/ 12',
    normalized_name: 'leite uht integral tirol 1l fd c/ 12',
    sku: 'SYNTH-AC046-03',
    unit: 'UN',
    package_description: 'Fardo com 12 unidades',
    brand_id: KNOWN_BRANDS.TIROL,
    category_id: KNOWN_CATEGORIES.LATICINIOS,
    active: true,
    metadata: {
      units_per_package: 12,
      is_synthetic: true,
      suite: SUITE_TAG
    }
  },
  {
    id: 'e2000000-0000-0000-0000-000000000004',
    company_id: QA_COMPANY_ID,
    name: 'CHOCOLATE EM PO 50% CACAU MELKEN 1KG CX C/ 10',
    normalized_name: 'chocolate em po 50% cacau melken 1kg cx c/ 10',
    sku: 'SYNTH-AC046-04',
    unit: 'UN',
    package_description: 'Pacote 1kg / Caixa com 10 unidades',
    brand_id: KNOWN_BRANDS.HARALD,
    category_id: KNOWN_CATEGORIES.CHOCOLATES,
    active: true,
    metadata: {
      units_per_package: 10,
      is_synthetic: true,
      suite: SUITE_TAG
    }
  },
  {
    id: 'e2000000-0000-0000-0000-000000000005',
    company_id: QA_COMPANY_ID,
    name: 'MISTURA PARA BOLO CHOCOLATE DONA BENTA 450G',
    normalized_name: 'mistura para bolo chocolate dona benta 450g',
    sku: 'SYNTH-AC046-05',
    unit: 'UN',
    package_description: null,
    brand_id: null,
    category_id: null,
    active: true,
    metadata: {
      units_per_package: null,
      is_synthetic: true,
      suite: SUITE_TAG
    }
  },
  {
    id: 'e2000000-0000-0000-0000-000000000006',
    company_id: QA_COMPANY_ID,
    name: 'ACUCAR CRISTAL UNIAO 1KG FD C/ 10 [INATIVO]',
    normalized_name: 'acucar cristal uniao 1kg fd c/ 10 [inativo]',
    sku: 'SYNTH-AC046-06',
    unit: 'UN',
    package_description: 'Fardo com 10 unidades',
    brand_id: null,
    category_id: null,
    active: false,
    metadata: {
      units_per_package: 10,
      is_synthetic: true,
      suite: SUITE_TAG
    }
  }
]

export const SYNTHETIC_PRICES = [
  // 1. Tirol Semidesnatado: Varejo R$ 6.50 / Atacado R$ 5.80 (>= 10 UN)
  {
    id: 'f2000000-0000-0000-0000-000000000001',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000001',
    price_type: 'retail',
    price: 6.50,
    min_quantity: 1,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },
  {
    id: 'f2000000-0000-0000-0000-000000000002',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000001',
    price_type: 'wholesale',
    price: 5.80,
    min_quantity: 10,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },

  // 2. Tirol Integral: Varejo R$ 7.20 / Atacado R$ 6.40 (>= 10 UN)
  {
    id: 'f2000000-0000-0000-0000-000000000003',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000002',
    price_type: 'retail',
    price: 7.20,
    min_quantity: 1,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },
  {
    id: 'f2000000-0000-0000-0000-000000000004',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000002',
    price_type: 'wholesale',
    price: 6.40,
    min_quantity: 10,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },

  // 3. Leite UHT Integral Tirol 1L: Varejo R$ 4.80 / Atacado R$ 4.20 (>= 12 UN)
  {
    id: 'f2000000-0000-0000-0000-000000000005',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000003',
    price_type: 'retail',
    price: 4.80,
    min_quantity: 1,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },
  {
    id: 'f2000000-0000-0000-0000-000000000006',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000003',
    price_type: 'wholesale',
    price: 4.20,
    min_quantity: 12,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },

  // 4. Chocolate Melken 50% 1kg: Varejo R$ 42.00 / Atacado R$ 38.00 (>= 5 UN)
  {
    id: 'f2000000-0000-0000-0000-000000000007',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000004',
    price_type: 'retail',
    price: 42.00,
    min_quantity: 1,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },
  {
    id: 'f2000000-0000-0000-0000-000000000008',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000004',
    price_type: 'wholesale',
    price: 38.00,
    min_quantity: 5,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },

  // 5. Mistura Bolo Dona Benta 450g: Varejo R$ 5.50
  {
    id: 'f2000000-0000-0000-0000-000000000009',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000005',
    price_type: 'retail',
    price: 5.50,
    min_quantity: 1,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  },

  // 6. Açúcar Cristal União 1kg Inativo: Varejo R$ 4.50
  {
    id: 'f2000000-0000-0000-0000-000000000010',
    company_id: QA_COMPANY_ID,
    product_id: 'e2000000-0000-0000-0000-000000000006',
    price_type: 'retail',
    price: 4.50,
    min_quantity: 1,
    active: true,
    metadata: { is_synthetic: true, suite: SUITE_TAG }
  }
]

// ==============================================================================
// FUNÇÕES AUXILIARES DE SEGURANÇA E AMBIENTE
// ==============================================================================

export function validateEnvironmentSecurity() {
  const allEnvKeys = Object.keys(process.env)
  for (const k of allEnvKeys) {
    const val = process.env[k] || ''
    if (val.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL_SECURITY] Referência ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID}) detectada na variável ${k}! Execução abortada.`)
    }
  }

  const envPath = path.join(ROOT, '.env.staging.local')
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    if (content.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL_SECURITY] Referência ao projeto de PRODUÇÃO em .env.staging.local!`)
    }
  }
}

export function getSupabaseClient() {
  validateEnvironmentSecurity()

  const envPath = path.join(ROOT, '.env.staging.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('Arquivo .env.staging.local não encontrado.')
  }
  const content = fs.readFileSync(envPath, 'utf8')

  const keyMatch = content.match(/STAGING_SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/)
  if (!keyMatch) {
    throw new Error('STAGING_SUPABASE_SERVICE_ROLE_KEY ausente em .env.staging.local.')
  }

  const serviceRoleKey = keyMatch[1].trim()
  return createClient(AUTHORIZED_STAGING_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

export function ensureManifestDir(manifestPath = MANIFEST_PATH) {
  const dir = path.dirname(manifestPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadOrCreateManifest(runId = crypto.randomUUID(), manifestPath = MANIFEST_PATH) {
  ensureManifestDir(manifestPath)
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (existing.suite === SUITE_TAG && existing.companyId === QA_COMPANY_ID) {
        return existing
      }
    } catch (_) {}
  }

  const newManifest = {
    suite: SUITE_TAG,
    runId,
    companyId: QA_COMPANY_ID,
    status: 'initializing',
    authorizedForDeletion: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannedProducts: SYNTHETIC_PRODUCTS.map(p => ({ id: p.id, sku: p.sku })),
    createdProductIds: [],
    discoveredProductIds: [],
    plannedPrices: SYNTHETIC_PRICES.map(p => ({ id: p.id, product_id: p.product_id, price_type: p.price_type, min_quantity: p.min_quantity })),
    createdPriceIds: [],
    discoveredPriceIds: [],
    errors: []
  }
  fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2), 'utf8')
  return newManifest
}

export function saveManifest(manifest, manifestPath = MANIFEST_PATH) {
  ensureManifestDir(manifestPath)
  manifest.updatedAt = new Date().toISOString()
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

// ==============================================================================
// OPERAÇÃO 1: INSPEÇÃO E VERIFICAÇÃO DO CATÁLOGO (CHECK)
// ==============================================================================

export async function checkFixtures(customClient = null) {
  const supabase = customClient || getSupabaseClient()
  console.log(`\n--- CHECAGEM DE FIXTURES SYNTH-AC046 NO STAGING (${STAGING_PROJECT_ID}) ---`)

  // 1. Valida existência da empresa
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, name, slug')
    .eq('id', QA_COMPANY_ID)
    .single()

  if (cErr || !company) {
    throw new Error(`Empresa QA (${QA_COMPANY_ID}) não encontrada no Staging: ${cErr?.message}`)
  }
  console.log(`✓ Empresa QA confirmada: "${company.name}" (${company.id})`)

  // 2. Consulta produtos AC-04.6
  const targetProductIds = SYNTHETIC_PRODUCTS.map(p => p.id)
  const { data: prods, error: pErr } = await supabase
    .from('products')
    .select('id, name, sku, active, metadata')
    .eq('company_id', QA_COMPANY_ID)
    .in('id', targetProductIds)

  if (pErr) throw new Error(`Erro ao consultar produtos: ${pErr.message}`)

  // 3. Consulta preços AC-04.6
  const targetPriceIds = SYNTHETIC_PRICES.map(p => p.id)
  const { data: prices, error: prErr } = await supabase
    .from('product_prices')
    .select('id, product_id, price, price_type, min_quantity, active, metadata')
    .eq('company_id', QA_COMPANY_ID)
    .in('id', targetPriceIds)

  if (prErr) throw new Error(`Erro ao consultar preços: ${prErr.message}`)

  console.log(`- Produtos SYNTH-AC046 presentes: ${prods.length} de ${SYNTHETIC_PRODUCTS.length}`)
  console.log(`- Preços SYNTH-AC046 presentes: ${prices.length} de ${SYNTHETIC_PRICES.length}`)

  // 4. Verificação de Integridade dos 9 produtos pré-existentes da H4
  const { count: h4ProdsCount, error: h4Err } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', QA_COMPANY_ID)
    .in('id', H4_PRODUCT_IDS)

  if (h4Err) throw new Error(`Erro ao verificar produtos H4: ${h4Err.message}`)
  console.log(`- Produtos H4 preservados: ${h4ProdsCount} de ${H4_EXPECTED_PRODUCTS_COUNT} (Status: ${h4ProdsCount === H4_EXPECTED_PRODUCTS_COUNT ? 'OK' : 'ALERTA'})`)

  if (prods.length > 0) {
    console.log('\nProdutos AC-04.6 Cadastrados:')
    console.table(prods.map(p => ({ id: p.id, sku: p.sku, name: p.name, active: p.active })))
  }

  if (prices.length > 0) {
    console.log('\nPreços AC-04.6 Cadastrados:')
    console.table(prices.map(pr => ({ id: pr.id, product_id: pr.product_id, type: pr.price_type, price: pr.price, min_qty: pr.min_quantity })))
  }

  return {
    productsPresent: prods.length,
    pricesPresent: prices.length,
    h4ProductsCount: h4ProdsCount,
    isComplete: prods.length === SYNTHETIC_PRODUCTS.length && prices.length === SYNTHETIC_PRICES.length
  }
}

// ==============================================================================
// OPERAÇÃO 2: INSERÇÃO CONTROLADA COM PROTEÇÃO CONTRA SOBREESCRITA (SEED)
// ==============================================================================

export async function seedFixtures(isDryRun = false, customClient = null, manifestPath = MANIFEST_PATH) {
  const supabase = customClient || getSupabaseClient()
  console.log(`\n==============================================================================`)
  console.log(`   ELLEVEE IA — SEED DO CATÁLOGO COMERCIAL QA ${isDryRun ? '[DRY-RUN]' : ''}   `)
  console.log(`==============================================================================`)

  // 1. Confirmação positiva de identidade do tenant
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', QA_COMPANY_ID)
    .single()

  if (cErr || !company) {
    throw new Error(`[IDENTITY GUARD] Empresa QA (${QA_COMPANY_ID}) não localizada no Staging!`)
  }
  if (company.name !== QA_COMPANY_NAME) {
    throw new Error(`[IDENTITY GUARD] Nome da empresa (${company.name}) diverge do marcador oficial (${QA_COMPANY_NAME})!`)
  }
  console.log(`✓ Tenant QA confirmado com sucesso: "${company.name}" (${company.id})`)

  // 2. Proteção contra Sobrescrita: Auditoria Prévia de Colisões
  console.log('\n--- AUDITORIA PRÉVIA CONTRA SOBREESCRITA E COLISÕES ---')
  const plannedProductIds = SYNTHETIC_PRODUCTS.map(p => p.id)
  const plannedSkus = SYNTHETIC_PRODUCTS.map(p => p.sku)

  // 2.1 Colisões de Produtos por ID ou SKU
  const { data: existingProds, error: epErr } = await supabase
    .from('products')
    .select('id, company_id, sku, name, metadata')
    .or(`id.in.(${plannedProductIds.join(',')}),sku.in.(${plannedSkus.join(',')})`)

  if (epErr) throw new Error(`Falha na verificação de colisões de produtos: ${epErr.message}`)

  const existingProdsMap = new Map()
  for (const ep of (existingProds || [])) {
    if (ep.company_id !== QA_COMPANY_ID) {
      throw new Error(`[CROSS-TENANT COLLISION] Produto ID ${ep.id} / SKU ${ep.sku} já existe em OUTRA empresa (${ep.company_id})! Operação abortada.`)
    }
    if (ep.metadata?.suite !== SUITE_TAG || ep.metadata?.is_synthetic !== true) {
      throw new Error(`[ALIEN DATA COLLISION] Registro pré-existente (ID ${ep.id}, SKU ${ep.sku}, Nome "${ep.name}") NÃO pertence à suíte ${SUITE_TAG}! Abortando para evitar sobrescrita indevida.`)
    }
    existingProdsMap.set(ep.id, ep)
  }

  // 2.2 Colisões de Preços por ID e pelas CHAVES DE NEGÓCIO do schema:
  // Chave de unicidade: UNIQUE (company_id, product_id, price_type, min_quantity)
  const plannedPriceIds = SYNTHETIC_PRICES.map(p => p.id)
  const { data: existingPrices, error: eprErr } = await supabase
    .from('product_prices')
    .select('id, company_id, product_id, price_type, min_quantity, metadata')
    .or(`id.in.(${plannedPriceIds.join(',')}),product_id.in.(${plannedProductIds.join(',')})`)

  if (eprErr) throw new Error(`Falha na verificação de colisões de preços: ${eprErr.message}`)

  const existingPricesMap = new Map()
  for (const epr of (existingPrices || [])) {
    if (epr.company_id !== QA_COMPANY_ID) {
      throw new Error(`[CROSS-TENANT COLLISION] Preço ID ${epr.id} já existe em OUTRA empresa (${epr.company_id})! Operação abortada.`)
    }

    if (epr.metadata?.suite !== SUITE_TAG || epr.metadata?.is_synthetic !== true) {
      throw new Error(
        `[ALIEN DATA COLLISION] Preço pré-existente (ID ${epr.id}, chave [product: ${epr.product_id}, type: ${epr.price_type}, min_qty: ${epr.min_quantity}]) ` +
        `NÃO pertence à suíte ${SUITE_TAG}! Abortando para evitar violação de unicidade ou sobrescrita indevida.`
      )
    }

    // Validação da chave de negócio contra a lista de fixtures planejadas
    const matchingPlannedPrice = SYNTHETIC_PRICES.find(sp =>
      sp.company_id === epr.company_id &&
      sp.product_id === epr.product_id &&
      sp.price_type === epr.price_type &&
      Number(sp.min_quantity) === Number(epr.min_quantity)
    )

    if (matchingPlannedPrice) {
      if (epr.id !== matchingPlannedPrice.id) {
        throw new Error(
          `[BUSINESS KEY ID MISMATCH] Conflito de chave única (company_id, product_id, price_type, min_quantity): ` +
          `já existe preço cadastrado com ID ${epr.id} para [product: ${epr.product_id}, type: ${epr.price_type}, min_qty: ${epr.min_quantity}], ` +
          `divergindo do ID planejado ${matchingPlannedPrice.id}!`
        )
      }
      existingPricesMap.set(matchingPlannedPrice.id, epr)
    } else {
      const matchingById = SYNTHETIC_PRICES.find(sp => sp.id === epr.id)
      if (matchingById) {
        throw new Error(
          `[BUSINESS KEY MISMATCH] Preço ID ${epr.id} existe no banco com parâmetros divergentes ` +
          `[product: ${epr.product_id}, type: ${epr.price_type}, min_qty: ${epr.min_quantity}] ` +
          `da fixture planejada [product: ${matchingById.product_id}, type: ${matchingById.price_type}, min_qty: ${matchingById.min_quantity}]!`
        )
      }
    }
  }

  // 3. Separação de Registros Pendentes (Política de Inserção Estrita)
  const productsToInsert = SYNTHETIC_PRODUCTS.filter(p => !existingProdsMap.has(p.id))
  const pricesToInsert = SYNTHETIC_PRICES.filter(p => !existingPricesMap.has(p.id))

  console.log(`- Produtos já presentes e validados: ${existingProdsMap.size} de ${SYNTHETIC_PRODUCTS.length}`)
  console.log(`- Produtos novos a inserir: ${productsToInsert.length}`)
  console.log(`- Preços já presentes e validados: ${existingPricesMap.size} de ${SYNTHETIC_PRICES.length}`)
  console.log(`- Preços novos a inserir: ${pricesToInsert.length}`)

  // GUARDA CRÍTICA 1: --dry-run NUNCA MODIFICA ARQUIVOS LOCAIS NEM BANCO (MESMO COM CATÁLOGO 100% COMPLETO)
  if (isDryRun) {
    const isComplete = productsToInsert.length === 0 && pricesToInsert.length === 0
    console.log(`\n[DRY-RUN] Simulação concluída com sucesso. Nenhuma alteração efetuada no banco nem em arquivos locais.`)
    console.log(`[DRY-RUN] Estado do catálogo no Staging: ${isComplete ? '100% COMPLETO' : 'INCOMPLETO (PENDÊNCIAS DETECTADAS)'}`)
    return {
      dryRun: true,
      alreadySeeded: isComplete,
      productsToInsert: productsToInsert.length,
      pricesToInsert: pricesToInsert.length
    }
  }

  // AJUSTE CRÍTICO 1: No caminho alreadySeeded, NÃO atribuir registros encontrados a createdProductIds/createdPriceIds
  if (productsToInsert.length === 0 && pricesToInsert.length === 0) {
    console.log('\n✓ Catálogo SYNTH-AC046 já está 100% íntegro e cadastrado no Staging. Zero escritas necessárias no banco.')
    const manifest = loadOrCreateManifest(crypto.randomUUID(), manifestPath)
    manifest.status = 'already_seeded'
    manifest.discoveredProductIds = SYNTHETIC_PRODUCTS.map(p => p.id)
    manifest.discoveredPriceIds = SYNTHETIC_PRICES.map(p => p.id)
    // Preserva createdProductIds se já existiam no manifesto prévio; caso contrário, mantém vazio
    manifest.createdProductIds = Array.isArray(manifest.createdProductIds) ? manifest.createdProductIds : []
    manifest.createdPriceIds = Array.isArray(manifest.createdPriceIds) ? manifest.createdPriceIds : []
    manifest.authorizedForDeletion = (manifest.createdProductIds.length > 0 || manifest.createdPriceIds.length > 0)
    saveManifest(manifest, manifestPath)
    return {
      alreadySeeded: true,
      createdProductIdsCount: manifest.createdProductIds.length,
      discoveredProductIdsCount: manifest.discoveredProductIds.length
    }
  }

  // 4. Início das Escritas com Gravação Incremental no Manifesto
  const manifest = loadOrCreateManifest(crypto.randomUUID(), manifestPath)
  manifest.status = 'in_progress'
  manifest.plannedProducts = productsToInsert.map(p => ({ id: p.id, sku: p.sku }))
  manifest.plannedPrices = pricesToInsert.map(p => ({ id: p.id, product_id: p.product_id, price_type: p.price_type, min_quantity: p.min_quantity }))
  manifest.authorizedForDeletion = true
  saveManifest(manifest, manifestPath)

  try {
    // 4.1 Inserção controlada de produtos (INSERT com vinculação de run_id nos metadados)
    for (const prod of productsToInsert) {
      console.log(`Inserindo produto ${prod.sku} (${prod.id})...`)
      const prodWithMeta = {
        ...prod,
        metadata: {
          ...prod.metadata,
          run_id: manifest.runId
        }
      }
      const { error: insErr } = await supabase
        .from('products')
        .insert(prodWithMeta)

      if (insErr) {
        throw new Error(`Falha ao inserir produto ${prod.sku}: ${insErr.message}`)
      }

      manifest.createdProductIds.push(prod.id)
      saveManifest(manifest, manifestPath)
      console.log(`✓ Produto ${prod.sku} inserido com sucesso.`)
    }

    // 4.2 Inserção controlada de preços (INSERT com vinculação de run_id nos metadados)
    for (const price of pricesToInsert) {
      console.log(`Inserindo preço ${price.price_type} min=${price.min_quantity} (${price.id})...`)
      const priceWithMeta = {
        ...price,
        metadata: {
          ...price.metadata,
          run_id: manifest.runId
        }
      }
      const { error: insPrErr } = await supabase
        .from('product_prices')
        .insert(priceWithMeta)

      if (insPrErr) {
        throw new Error(`Falha ao inserir preço ${price.id}: ${insPrErr.message}`)
      }

      manifest.createdPriceIds.push(price.id)
      saveManifest(manifest, manifestPath)
      console.log(`✓ Preço ${price.id} inserido com sucesso.`)
    }

    // 5. Finalização com Sucesso
    manifest.status = 'completed'
    manifest.authorizedForDeletion = true
    saveManifest(manifest, manifestPath)
    console.log('\n✓ TODAS AS FIXTURES SYNTH-AC046 FORAM INSERIDAS E VALIDADAS COM SUCESSO!')
    console.log(`Manifesto salvo em: ${manifestPath}`)
    return manifest

  } catch (err) {
    manifest.status = 'failed'
    manifest.errors.push(err.message)
    saveManifest(manifest, manifestPath)
    console.error(`\n❌ FALHA DURANTE INSERÇÃO DE FIXTURES: ${err.message}`)
    console.error(`Manifesto marcado como 'failed'. Execute --recover para reconciliar e tratar registros parciais.`)
    throw err
  }
}

// ==============================================================================
// OPERAÇÃO 3: TEARDOWN SEGURO E AUDITÁVEL (TEARDOWN)
// ==============================================================================

export async function teardownFixtures(isDryRun = false, customClient = null, manifestPath = MANIFEST_PATH) {
  const supabase = customClient || getSupabaseClient()
  console.log(`\n==============================================================================`)
  console.log(`   ELLEVEE IA — TEARDOWN CIRÚRGICO DE FIXTURES ${isDryRun ? '[DRY-RUN]' : ''}   `)
  console.log(`==============================================================================`)

  // 1. Confirmação do Tenant
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', QA_COMPANY_ID)
    .single()

  if (cErr || !company) {
    throw new Error(`[TEARDOWN GUARD] Tenant QA (${QA_COMPANY_ID}) não localizado para teardown: ${cErr?.message}`)
  }
  if (company.name !== QA_COMPANY_NAME) {
    throw new Error(`[TEARDOWN GUARD] Nome do tenant (${company.name}) diverge do marcador oficial (${QA_COMPANY_NAME})!`)
  }
  console.log(`✓ Tenant QA confirmado para teardown: "${company.name}" (${company.id})`)

  // 2. Identificação Estrita dos Alvos a partir do Manifesto (GUARDA CRÍTICA 2: ZERO FALLBACK PARA IDS PLANEJADOS)
  const allowedProductIds = new Set(SYNTHETIC_PRODUCTS.map(p => p.id))
  const allowedPriceIds = new Set(SYNTHETIC_PRICES.map(p => p.id))

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[TEARDOWN GUARD] Manifesto de execução ausente (${manifestPath}). ` +
      `Proibido utilizar IDs planejados como fallback. ` +
      `Se houver fixtures no banco a reconciliar, execute primeiro '--recover' para registrar os IDs criados.`
    )
  }

  let manifest
  try {
    const rawContent = fs.readFileSync(manifestPath, 'utf8')
    manifest = JSON.parse(rawContent)
  } catch (parseErr) {
    throw new Error(
      `[TEARDOWN GUARD] Manifesto corrompido ou formato JSON inválido (${manifestPath}): ${parseErr.message}. ` +
      `Proibido utilizar IDs planejados como fallback. Execute '--recover' para reconciliar com o banco.`
    )
  }

  if (!manifest || manifest.suite !== SUITE_TAG || manifest.companyId !== QA_COMPANY_ID) {
    throw new Error(
      `[TEARDOWN GUARD] Manifesto inválido ou pertencente a outra suíte/empresa (Suite: ${manifest?.suite}, Company: ${manifest?.companyId}). ` +
      `Proibido utilizar IDs planejados como fallback.`
    )
  }

  // Validação estrita de runId no manifesto (AC-04.6.1)
  if (!manifest.runId || typeof manifest.runId !== 'string' || manifest.runId.trim() === '') {
    throw new Error(
      `[TEARDOWN GUARD] O manifesto não possui um runId válido (${manifest?.runId}). ` +
      `Teardown bloqueado para prevenir exclusão sem vínculo comprovado com a execução.`
    )
  }

  // AJUSTE CRÍTICO 3: Bloqueio fail-closed se requer revisão manual ou ausência de autorização de exclusão
  if (manifest.status === 'requires_manual_review') {
    throw new Error(
      `[TEARDOWN GUARD] Teardown bloqueado: o manifesto está marcado como 'requires_manual_review'. ` +
      `Motivo: ${manifest.manualReviewReason || 'Propriedade dos registros não comprovada'}. ` +
      `Exclusão não autorizada para preservar dados pré-existentes.`
    )
  }

  if (manifest.authorizedForDeletion === false) {
    throw new Error(`[TEARDOWN GUARD] Teardown bloqueado: authorizedForDeletion é false no manifesto.`)
  }

  const createdProductIds = Array.isArray(manifest.createdProductIds) ? manifest.createdProductIds : []
  const createdPriceIds = Array.isArray(manifest.createdPriceIds) ? manifest.createdPriceIds : []

  // Filtra estritamente pelos IDs que foram comprovadamente criados por esta execução e pertencem à suíte permitida
  const targetProductIds = createdProductIds.filter(id => allowedProductIds.has(id))
  const targetPriceIds = createdPriceIds.filter(id => allowedPriceIds.has(id))

  if (targetProductIds.length === 0 && targetPriceIds.length === 0) {
    throw new Error(
      `[TEARDOWN GUARD] O manifesto não contém nenhum ID registrado como criado pela suíte ${SUITE_TAG}. ` +
      `Proibido utilizar IDs planejados como fallback. Se houver resíduos no Staging, execute '--recover' para reconciliá-los.`
    )
  }

  // 2.1 Proteção Absoluta contra Exclusão dos Registros H4 (Defesa em profundidade)
  for (const pid of targetProductIds) {
    if (pid.startsWith(H4_PRODUCT_ID_PREFIX)) {
      throw new Error(`[CRITICAL_TEARDOWN_GUARD] Tentativa indevida de exclusão de produto pré-existente da H4 (${pid})! Teardown abortado imediatamente.`)
    }
  }
  for (const prid of targetPriceIds) {
    if (prid.startsWith(H4_PRICE_ID_PREFIX)) {
      throw new Error(`[CRITICAL_TEARDOWN_GUARD] Tentativa indevida de exclusão de preço pré-existente da H4 (${prid})! Teardown abortado imediatamente.`)
    }
  }

  // 3. Auditoria Prévia no Banco antes de Excluir com validação estrita de run_id
  const safePriceIdsToDelete = []
  if (targetPriceIds.length > 0) {
    const { data: verifiedPrices, error: vpErr } = await supabase
      .from('product_prices')
      .select('id, company_id, metadata')
      .eq('company_id', QA_COMPANY_ID)
      .in('id', targetPriceIds)

    if (vpErr) throw new Error(`Falha ao auditar preços para teardown: ${vpErr.message}`)

    for (const pr of (verifiedPrices || [])) {
      const isSuiteMatch = pr.metadata?.suite === SUITE_TAG && pr.metadata?.is_synthetic === true
      const isRunMatch = Boolean(
        manifest.runId &&
        pr.metadata?.run_id &&
        pr.metadata.run_id === manifest.runId
      )
      if (isSuiteMatch && isRunMatch) {
        safePriceIdsToDelete.push(pr.id)
      } else if (!pr.metadata?.run_id) {
        console.warn(`[TEARDOWN GUARD] Preço ${pr.id} possui run_id ausente no metadata. Preservado.`)
      } else if (pr.metadata.run_id !== manifest.runId) {
        console.warn(`[TEARDOWN GUARD] Preço ${pr.id} possui run_id divergente (${pr.metadata.run_id} !== ${manifest.runId}). Preservado.`)
      }
    }
  }

  const safeProductIdsToDelete = []
  if (targetProductIds.length > 0) {
    const { data: verifiedProds, error: vprErr } = await supabase
      .from('products')
      .select('id, company_id, sku, metadata')
      .eq('company_id', QA_COMPANY_ID)
      .in('id', targetProductIds)

    if (vprErr) throw new Error(`Falha ao auditar produtos para teardown: ${vprErr.message}`)

    for (const p of (verifiedProds || [])) {
      const isSuiteMatch = p.sku?.startsWith(SYNTHETIC_SKU_PREFIX) && p.metadata?.suite === SUITE_TAG && p.metadata?.is_synthetic === true
      const isRunMatch = Boolean(
        manifest.runId &&
        p.metadata?.run_id &&
        p.metadata.run_id === manifest.runId
      )
      if (isSuiteMatch && isRunMatch) {
        safeProductIdsToDelete.push(p.id)
      } else if (!p.metadata?.run_id) {
        console.warn(`[TEARDOWN GUARD] Produto ${p.id} possui run_id ausente no metadata. Preservado.`)
      } else if (p.metadata.run_id !== manifest.runId) {
        console.warn(`[TEARDOWN GUARD] Produto ${p.id} possui run_id divergente (${p.metadata.run_id} !== ${manifest.runId}). Preservado.`)
      }
    }
  }

  if (safePriceIdsToDelete.length === 0 && safeProductIdsToDelete.length === 0) {
    throw new Error(
      `[TEARDOWN GUARD] Nenhum dos registros alvo possui propriedade comprovada correspondente ao runId do manifesto (${manifest.runId}). ` +
      `Exclusão abortada para preservar dados pré-existentes ou de outra execução.`
    )
  }

  console.log(`- Preços AC-04.6 confirmados para exclusão: ${safePriceIdsToDelete.length} de ${targetPriceIds.length} registrados`)
  console.log(`- Produtos AC-04.6 confirmados para exclusão: ${safeProductIdsToDelete.length} de ${targetProductIds.length} registrados`)

  if (isDryRun) {
    console.log('\n[DRY-RUN] Teardown simulado. Nenhuma exclusão efetuada no banco nem em arquivos locais.')
    return { dryRun: true, safePriceIdsToDelete, safeProductIdsToDelete }
  }

  // 4. Execução Cirúrgica Respeitando Chaves Estrangeiras (Preços primeiro, depois Produtos)
  if (safePriceIdsToDelete.length > 0) {
    console.log(`Excluindo ${safePriceIdsToDelete.length} preços sintéticos...`)
    const { error: dPrErr } = await supabase
      .from('product_prices')
      .delete()
      .eq('company_id', QA_COMPANY_ID)
      .in('id', safePriceIdsToDelete)

    if (dPrErr) throw new Error(`Falha ao excluir preços sintéticos: ${dPrErr.message}`)
    console.log('✓ Preços sintéticos excluídos com sucesso.')
  }

  if (safeProductIdsToDelete.length > 0) {
    console.log(`Excluindo ${safeProductIdsToDelete.length} produtos sintéticos...`)
    const { error: dPErr } = await supabase
      .from('products')
      .delete()
      .eq('company_id', QA_COMPANY_ID)
      .in('id', safeProductIdsToDelete)

    if (dPErr) throw new Error(`Falha ao excluir produtos sintéticos: ${dPErr.message}`)
    console.log('✓ Produtos sintéticos excluídos com sucesso.')
  }

  // 5. Confirmação Estrita de Ausência de Resíduos dos IDs Alvo
  console.log('\nVerificando ausência de resíduos dos itens excluídos no Staging...')
  if (targetProductIds.length > 0) {
    const { count: residualProds } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', QA_COMPANY_ID)
      .in('id', targetProductIds)

    if (residualProds > 0) {
      throw new Error(`[RESÍDUO DETECTADO] ${residualProds} produtos alvos do teardown ainda constam no banco!`)
    }
  }

  if (targetPriceIds.length > 0) {
    const { count: residualPrices } = await supabase
      .from('product_prices')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', QA_COMPANY_ID)
      .in('id', targetPriceIds)

    if (residualPrices > 0) {
      throw new Error(`[RESÍDUO DETECTADO] ${residualPrices} preços alvos do teardown ainda constam no banco!`)
    }
  }

  // 6. Verificação de Preservação dos 9 Produtos H4
  const { count: preservedH4Count } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', QA_COMPANY_ID)
    .in('id', H4_PRODUCT_IDS)

  if (preservedH4Count !== H4_EXPECTED_PRODUCTS_COUNT) {
    throw new Error(`[CORRUPÇÃO DE DADOS] A contagem de produtos H4 diverge após teardown! Esperado: ${H4_EXPECTED_PRODUCTS_COUNT}, Encontrado: ${preservedH4Count}`)
  }
  console.log(`✓ 9 produtos pré-existentes da etapa H4 rigorosamente intactos e preservados.`)

  // 7. Remoção Segura do Manifesto
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath)
    console.log(`✓ Manifesto ${manifestPath} removido com sucesso.`)
  }

  console.log('✓ TEARDOWN CIRÚRGICO CONCLUÍDO COM 100% DE SUCESSO.')
  return { success: true, deletedPricesCount: safePriceIdsToDelete.length, deletedProductsCount: safeProductIdsToDelete.length }
}

// ==============================================================================
// OPERAÇÃO 4: RECUPERAÇÃO E RECONCILIAÇÃO DE SESSÕES INTERROMPIDAS (--recover)
// ==============================================================================

/**
 * Reconcilia registros órfãos ou inserções parciais confirmadas no Supabase Staging.
 * Diferencia registros efetivamente criados de registros apenas descobertos com base
 * em evidência persistida de intenção/propriedade anterior à escrita (AJUSTE CRÍTICO 2).
 */
export async function reconcileOrphanedFixtures(supabase, isDryRun = false, manifestPath = MANIFEST_PATH) {
  console.log(`\n--- RECONCILIAÇÃO DE FIXTURES ÓRFÃS NO SUPABASE (${STAGING_PROJECT_ID}) ---`)

  // 1. Consulta produtos sintéticos existentes no Supabase Staging
  const plannedProductIds = SYNTHETIC_PRODUCTS.map(p => p.id)
  const { data: dbProds, error: pErr } = await supabase
    .from('products')
    .select('id, sku, name, company_id, metadata')
    .eq('company_id', QA_COMPANY_ID)
    .in('id', plannedProductIds)

  if (pErr) throw new Error(`Falha ao consultar produtos para reconciliação: ${pErr.message}`)

  // Validação rigorosa dos produtos encontrados
  const validDbProds = []
  for (const p of (dbProds || [])) {
    if (p.company_id !== QA_COMPANY_ID) {
      throw new Error(`[RECONCILE ERROR] Produto ${p.id} pertence a tenant diferente (${p.company_id})!`)
    }
    if (p.metadata?.suite !== SUITE_TAG || p.metadata?.is_synthetic !== true) {
      throw new Error(`[RECONCILE ERROR] Produto ${p.id} não possui marcadores sintéticos da suíte ${SUITE_TAG}!`)
    }
    validDbProds.push(p)
  }

  // 2. Consulta preços sintéticos existentes no Supabase Staging
  const plannedPriceIds = SYNTHETIC_PRICES.map(p => p.id)
  const { data: dbPrices, error: prErr } = await supabase
    .from('product_prices')
    .select('id, product_id, price_type, min_quantity, company_id, metadata')
    .eq('company_id', QA_COMPANY_ID)
    .in('id', plannedPriceIds)

  if (prErr) throw new Error(`Falha ao consultar preços para reconciliação: ${prErr.message}`)

  const validDbPrices = []
  for (const pr of (dbPrices || [])) {
    if (pr.company_id !== QA_COMPANY_ID) {
      throw new Error(`[RECONCILE ERROR] Preço ${pr.id} pertence a tenant diferente (${pr.company_id})!`)
    }
    if (pr.metadata?.suite !== SUITE_TAG || pr.metadata?.is_synthetic !== true) {
      throw new Error(`[RECONCILE ERROR] Preço ${pr.id} não possui marcadores sintéticos da suíte ${SUITE_TAG}!`)
    }
    validDbPrices.push(pr)
  }

  // 3. Inspeção de Evidência Persistida de Intenção/Propriedade
  let manifest = null
  let manifestExisted = false
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (existing.suite === SUITE_TAG && existing.companyId === QA_COMPANY_ID) {
        manifest = existing
        manifestExisted = true
      }
    } catch (_) {}
  }

  // Se não existe manifesto prévio em disco, não há evidência persistida de intenção da sessão
  if (!manifest) {
    manifest = {
      suite: SUITE_TAG,
      runId: crypto.randomUUID(),
      companyId: QA_COMPANY_ID,
      status: 'initializing',
      authorizedForDeletion: false,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plannedProducts: SYNTHETIC_PRODUCTS.map(p => ({ id: p.id, sku: p.sku })),
      createdProductIds: [],
      discoveredProductIds: [],
      plannedPrices: SYNTHETIC_PRICES.map(p => ({ id: p.id, product_id: p.product_id, price_type: p.price_type, min_quantity: p.min_quantity })),
      createdPriceIds: [],
      discoveredPriceIds: [],
      errors: []
    }
  }

  // Validação estrita de runId no manifesto para reconciliação (AC-04.6.1)
  if (!manifest.runId || typeof manifest.runId !== 'string' || manifest.runId.trim() === '') {
    throw new Error(
      `[RECONCILE GUARD] O manifesto não possui um runId válido (${manifest?.runId}). ` +
      `Reconciliação bloqueada para prevenir apropriação indevida.`
    )
  }

  // Conjuntos de registros previamente gravados no manifesto desta execução
  const previouslyCreatedProdSet = new Set(manifest.createdProductIds || [])
  const previouslyCreatedPriceSet = new Set(manifest.createdPriceIds || [])
  const activeRunId = manifest.runId

  // Verifica se o manifesto tinha uma execução ativa/interrompida
  const hasActiveRunIntent = manifestExisted && (
    manifest.status === 'in_progress' ||
    manifest.status === 'failed' ||
    manifest.status === 'reconciled_partial'
  )

  const provenCreatedProductIds = []
  const discoveredUnownedProductIds = []

  for (const p of validDbProds) {
    // Evidência consistente de propriedade (AC-04.6.1):
    // Exige obrigatoriamente manifest.runId válido e metadata.run_id === manifest.runId.
    // Sem qualquer exceção de !p.metadata?.run_id ou !manifest.runId.
    // Registros sem run_id ou com run_id divergente NUNCA são classificados como criados pela execução.
    const hasMatchingRunId = Boolean(
      activeRunId &&
      typeof activeRunId === 'string' &&
      activeRunId.trim() !== '' &&
      p.metadata?.run_id &&
      typeof p.metadata.run_id === 'string' &&
      p.metadata.run_id === activeRunId
    )

    if (hasMatchingRunId) {
      provenCreatedProductIds.push(p.id)
    } else {
      // Sem run_id correspondente ou pertencente a outra execução -> APENAS DESCOBERTO (NÃO AUTORIZADO)
      discoveredUnownedProductIds.push(p.id)
    }
  }

  const provenCreatedPriceIds = []
  const discoveredUnownedPriceIds = []

  for (const pr of validDbPrices) {
    const hasMatchingRunId = Boolean(
      activeRunId &&
      typeof activeRunId === 'string' &&
      activeRunId.trim() !== '' &&
      pr.metadata?.run_id &&
      typeof pr.metadata.run_id === 'string' &&
      pr.metadata.run_id === activeRunId
    )

    if (hasMatchingRunId) {
      provenCreatedPriceIds.push(pr.id)
    } else {
      discoveredUnownedPriceIds.push(pr.id)
    }
  }

  manifest.discoveredProductIds = validDbProds.map(p => p.id)
  manifest.discoveredPriceIds = validDbPrices.map(pr => pr.id)
  manifest.discoveredUnownedProductIds = discoveredUnownedProductIds
  manifest.discoveredUnownedPriceIds = discoveredUnownedPriceIds
  manifest.updatedAt = new Date().toISOString()

  // REGRA DE SEGURANÇA:
  // Se houver registros descobertos sem comprovação de propriedade,
  // sinaliza para revisão manual e NÃO autoriza exclusão!
  if (discoveredUnownedProductIds.length > 0 || discoveredUnownedPriceIds.length > 0) {
    manifest.status = 'requires_manual_review'
    manifest.authorizedForDeletion = false
    manifest.manualReviewReason = (
      `Foram detectados ${discoveredUnownedProductIds.length} produto(s) e ${discoveredUnownedPriceIds.length} preço(s) ` +
      `no banco sem evidência de intenção persistida (run_id/manifesto divergente ou ausente). ` +
      `Exclusão bloqueada para prevenir a destruição de dados pré-existentes.`
    )
    console.warn(`\n⚠️  ATENÇÃO: Registros órfãos descobertos SEM evidência de intenção/propriedade anterior!`)
    console.warn(`- Produtos sem propriedade comprovada: ${discoveredUnownedProductIds.length}`)
    console.warn(`- Preços sem propriedade comprovada: ${discoveredUnownedPriceIds.length}`)
    console.warn(`- Status definido para: 'requires_manual_review'. Exclusão NÃO AUTORIZADA.`)
  } else {
    // Todos os registros encontrados possuem evidência de intenção/propriedade
    manifest.createdProductIds = provenCreatedProductIds
    manifest.createdPriceIds = provenCreatedPriceIds
    manifest.authorizedForDeletion = (provenCreatedProductIds.length > 0 || provenCreatedPriceIds.length > 0)

    const isComplete = provenCreatedProductIds.length === SYNTHETIC_PRODUCTS.length && provenCreatedPriceIds.length === SYNTHETIC_PRICES.length
    if (isComplete) {
      manifest.status = 'completed'
    } else if (provenCreatedProductIds.length > 0 || provenCreatedPriceIds.length > 0) {
      manifest.status = 'reconciled_partial'
    } else {
      manifest.status = 'clean'
    }
    console.log(`- Produtos com propriedade comprovada: ${provenCreatedProductIds.length}`)
    console.log(`- Preços com propriedade comprovada: ${provenCreatedPriceIds.length}`)
    console.log(`- Status resultante: '${manifest.status}' (authorizedForDeletion: ${manifest.authorizedForDeletion})`)
  }

  if (isDryRun) {
    console.log(`[DRY-RUN] Reconciliação simulada. Manifesto NÃO foi gravado nem modificado no disco.`)
  } else {
    saveManifest(manifest, manifestPath)
    console.log(`✓ Manifesto reconciliado e salvo com sucesso em: ${manifestPath}`)
  }

  return {
    manifest,
    provenCreatedProductsCount: provenCreatedProductIds.length,
    provenCreatedPricesCount: provenCreatedPriceIds.length,
    discoveredUnownedProductsCount: discoveredUnownedProductIds.length,
    discoveredUnownedPricesCount: discoveredUnownedPriceIds.length,
    status: manifest.status,
    authorizedForDeletion: manifest.authorizedForDeletion === true,
    manifestExisted
  }
}

export async function recoverInterruptedRun(isDryRun = false, options = {}, customClient = null, manifestPath = MANIFEST_PATH) {
  const supabase = customClient || getSupabaseClient()
  console.log(`\n==============================================================================`)
  console.log(`   ELLEVEE IA — RECUPERAÇÃO E RECONCILIAÇÃO AC-04.6 ${isDryRun ? '[DRY-RUN]' : ''}   `)
  console.log(`==============================================================================`)

  // 1. Executa reconciliação ativa contra o banco Supabase
  const reconciliation = await reconcileOrphanedFixtures(supabase, isDryRun, manifestPath)

  // 2. Se a flag clean estiver ativa, efetua o teardown seguro usando o manifesto agora reconciliado
  if (options.clean) {
    if (!reconciliation.authorizedForDeletion) {
      throw new Error(
        `[RECOVER CLEAN BLOCKED] Limpeza automática recusada: ${reconciliation.manifest.manualReviewReason || 'Propriedade dos registros não comprovada'}. ` +
        `Revisão manual necessária antes de qualquer exclusão.`
      )
    }
    console.log('\nOpção --clean solicitada e autorizada. Prosseguindo com teardown das fixtures reconciliadas...')
    await teardownFixtures(isDryRun, supabase, manifestPath)
    console.log('✓ Teardown das fixtures reconciliadas finalizado com sucesso.')
  } else {
    console.log('\nReconciliação finalizada.')
    if (reconciliation.status === 'requires_manual_review') {
      console.log(`Status: 'requires_manual_review'. Registros foram apenas descobertos. Exclusão bloqueada.`)
    } else if (reconciliation.provenCreatedProductsCount > 0 || reconciliation.provenCreatedPricesCount > 0) {
      console.log(`Ações disponíveis:`)
      console.log(`  - Para limpar fixtures comprovadas: node scripts/manage-synthetic-catalog-ac046.mjs --teardown`)
      console.log(`  - Para completar o seed: node scripts/manage-synthetic-catalog-ac046.mjs --seed`)
    }
  }

  return reconciliation
}

// ==============================================================================
// CLI ENTRY POINT
// ==============================================================================

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')
  const isClean = args.includes('--clean')

  if (args.includes('--check')) {
    await checkFixtures()
  } else if (args.includes('--teardown')) {
    await teardownFixtures(isDryRun)
  } else if (args.includes('--recover')) {
    await recoverInterruptedRun(isDryRun, { clean: isClean })
  } else if (args.includes('--seed')) {
    await seedFixtures(isDryRun)
  } else {
    console.log('Modo padrão: Executando pré-flight em modo --dry-run.')
    console.log('Opções disponíveis: --seed, --check, --teardown, --recover, --clean, --dry-run.')
    await seedFixtures(true)
    await checkFixtures()
  }
}

const isDirectExecution = Boolean(
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)

if (isDirectExecution) {
  main().catch(err => {
    console.error('\n❌ EXECUÇÃO ABORTADA:', err.message)
    process.exit(1)
  })
}
