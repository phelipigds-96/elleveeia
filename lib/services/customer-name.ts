export type CustomerNameSource =
  | 'manual'
  | 'agent_collected'
  | 'whatsapp_contact'
  | 'whatsapp_push'

const PORTUGUESE_PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])

const GENERIC_OR_NON_PERSON_TERMS = new Set([
  'cliente',
  'usuario',
  'whatsapp',
  'contato',
  'visitante',
  'desconhecido',
  'sem nome',
  'anonimo',
  'oi',
  'ola',
  'bom dia',
  'boa tarde',
  'boa noite',
  'amor',
  'vida',
  'linda',
  'lindo',
  'gata',
  'gato',
  'princesa',
  'principe',
  'rei',
  'rainha',
  'top',
  'vip',
  'adm',
  'admin',
  'suporte',
  'atendimento',
  'vendas',
  'loja',
  'shop',
  'store',
  'oficial',
  'empresa',
  'distribuidora',
  'confeitaria',
  'mercado',
  'supermercado',
  'padaria',
  'doceria',
  'atelie',
  'atelier',
  'studio',
  'boutique',
  'delivery',
])

const BUSINESS_KEYWORD_TOKENS = new Set([
  'loja',
  'store',
  'shop',
  'oficial',
  'distribuidora',
  'confeitaria',
  'padaria',
  'doceria',
  'atelie',
  'atelier',
  'mercado',
  'supermercado',
  'atacado',
  'varejo',
  'commerce',
  'ltda',
  'eireli',
  'mei',
  'delivery',
  'vendas',
  'suporte',
  'atendimento',
])

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Remove excessos de espaço e caracteres de controle sem destruir acentos válidos.
 */
export function normalizeRawName(rawName?: string | null): string {
  if (!rawName || typeof rawName !== 'string') return ''
  return rawName
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Formata um nome humano limpo aplicando capitalização natural quando veio todo em maiúsculas ou minúsculas.
 */
export function sanitizeCustomerName(rawName: string): string {
  const cleaned = normalizeRawName(rawName)
  if (!cleaned) return ''

  const isAllUpper = cleaned === cleaned.toUpperCase() && cleaned !== cleaned.toLowerCase()
  const isAllLower = cleaned === cleaned.toLowerCase() && cleaned !== cleaned.toUpperCase()

  if (!isAllUpper && !isAllLower) {
    return cleaned.slice(0, 120)
  }

  return cleaned
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (index > 0 && PORTUGUESE_PARTICLES.has(lower)) {
        return lower
      }
      if (!lower) return ''
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
    .slice(0, 120)
}

/**
 * Heurística híbrida: verifica se um nome vindo do WhatsApp (pushName) parece um nome real de pessoa.
 * Retorna false para emojis, símbolos, números de telefone, siglas, termos genéricos ou nomes de lojas/empresas,
 * sinalizando ao agente IA para confirmar o nome com gentileza no primeiro contato.
 */
export function isPlausibleHumanName(rawName?: string | null): boolean {
  const cleaned = normalizeRawName(rawName)
  if (!cleaned || cleaned.length < 2 || cleaned.length > 60) {
    return false
  }

  // Qualquer número indica telefone, código ou nome genérico ("Cliente 1234", "Loja 02")
  if (/\d/.test(cleaned)) {
    return false
  }

  // Rejeita emojis, pictógrafos, símbolos decorativos e pontuação estranha
  if (new RegExp('[\\p{Extended_Pictographic}\\p{So}\\p{Sk}\\p{Sc}]', 'u').test(cleaned)) {
    return false
  }

  // Aceita apenas letras Unicode, espaços, hífen e apóstrofo
  if (!new RegExp("^[\\p{L}\\s'-]+$", 'u').test(cleaned)) {
    return false
  }

  const normalizedLower = stripAccents(cleaned).toLowerCase()
  if (GENERIC_OR_NON_PERSON_TERMS.has(normalizedLower)) {
    return false
  }

  if (normalizedLower.startsWith('cliente ') || normalizedLower.startsWith('cliente(')) {
    return false
  }

  // Rejeita sequências repetidas sem sentido (ex: "aaaa", "kkkkk")
  if (/^(.)\1{2,}$/i.test(normalizedLower.replace(/\s+/g, ''))) {
    return false
  }

  const words = normalizedLower.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 5) {
    return false
  }

  // Nome comercial típico ("Confeitaria Doce Sabor", "Ateliê da Maria", "Loja Oficial")
  if (words.some((w) => BUSINESS_KEYWORD_TOKENS.has(w))) {
    return false
  }

  // Palavra única precisa ter pelo menos 2 letras válidas (e não apenas risadas comuns)
  if (words.length === 1) {
    if (words[0].length < 2) return false
    if (/^(k+|rs+|ha+|he+)$/.test(words[0])) return false
  }

  return true
}

/**
 * Extrai um fallback legível caso o nome do WhatsApp não seja utilizável como nome principal.
 */
export function buildFallbackCustomerName(phone?: string | null): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (digits.length >= 4) {
    return `Cliente (${digits.slice(-4)})`
  }
  return 'Cliente'
}

/**
 * Formata telefone brasileiro para exibição humana legível.
 */
export function formatCustomerPhone(phone?: string | null): string {
  if (!phone) return 'Sem telefone'
  const clean = phone.replace(/\D/g, '')
  if (!clean) return phone
  if (clean.length === 13 && clean.startsWith('55')) {
    return `(${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  }
  if (clean.length === 12 && clean.startsWith('55')) {
    return `(${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`
  }
  return phone
}
