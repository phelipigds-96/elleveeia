export const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'pro', 'pras', 'pros',
  'com', 'sem', 'o', 'a', 'os', 'as', 'em', 'um', 'uma', 'uns', 'umas',
  'quanto', 'quantos', 'quanta', 'quantas', 'esta', 'ta', 'estao', 'tao',
  'tem', 'temos', 'teria', 'teriam', 'tinha', 'tinham',
  'tu', 'voce', 'voces', 'vc', 'vcs', 'te', 'ti', 'ele', 'ela',
  'gostaria', 'queria', 'saber', 'preco', 'precos', 'valor', 'valores', 'custa', 'custam',
  'qual', 'quais', 'e', 'que', 'se',
  'ola', 'oi', 'oii', 'oiii', 'opa', 'eae', 'bom', 'boa', 'dia', 'tarde', 'noite',
  'favor', 'por', 'acaso', 'gentileza',
  'ai', 'aqui', 'la', 'ainda', 'tambem',
  'algum', 'alguma', 'alguns', 'algumas',
  'amigo', 'amiga', 'moco', 'moca', 'veja', 'olha'
])

export const MULTI_WORD_TOKENS = [
  { canonical: 'meio amargo', variants: ['meio amargo', 'm amargo', 'm/amargo', 'm.amargo', 'meio-amargo', 'meio amarga', 'm amarga', 'meio-amarga'] },
  { canonical: 'ao leite', variants: ['ao leite', 'a leite', 'a/leite', 'a.leite'] }
]

export const ALIASES: Record<string, string[]> = {
  // Chocolate/Cobertura
  'cobertura': ['cob', 'cobe', 'cober'],
  'chocolate': ['choc'],
  
  // Segmentos / Finalidades de Compra
  'confeitaria': ['barra', 'confeiteiro', 'confeiteira', 'culinario', 'culinaria', 'cobertura', 'gotas', 'recheio', 'pasta'],
  'consumo': ['tablete', 'bombom', 'snack', 'unitario', 'avulso'],
  'docinho': ['tablete', 'bombom', 'snack', 'chocolate'],

  // Tipos
  'branco': ['bco', 'br', 'branca', 'marfim', 'galak'],
  'blend': ['bl'],
  'amargo': ['amarga'],
  'preto': ['preta'],
  
  // Unidades e Embalagens
  'kg': ['quilo', 'kilo', 'quilograma'],
  'unidade': ['un', 'und', 'unid'],
  'pacote': ['pct', 'pcte'],
  'caixa': ['cx', 'caixas'],
  'display': ['disp', 'dp'],
  'fardo': ['fd', 'fardos'],
  'revenda': ['cx', 'caixa', 'fardo', 'display', 'atacado'],
  'atacado': ['cx', 'caixa', 'fardo', 'display', 'revenda'],
  
  // Outros
  'recheio': ['rech'],
}

// We also need to normalize weights like "1 kg" to "1kg", "500 g" to "500g", "1.01kg" to "1 01kg" to match DB normalization.
// Wait, the DB's normalizeCatalogText removes punctuation!
// So "1.01kg" becomes "1 01kg". "1kg" stays "1kg".
