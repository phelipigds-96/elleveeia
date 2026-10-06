export const STOP_WORDS = new Set([
  'de', 'da', 'do', 'para', 'com', 'o', 'a', 'os', 'as', 'em', 'um', 'uma', 
  'quanto', 'esta', 'ta', 'tem', 'gostaria', 'queria', 'saber', 'preco', 'valor', 'custa', 'qual', 'e', 'que'
])

export const MULTI_WORD_TOKENS = [
  { canonical: 'meio amargo', variants: ['meio amargo', 'm amargo', 'm/amargo', 'm.amargo', 'meio-amargo', 'meio amarga', 'm amarga', 'meio-amarga'] },
  { canonical: 'ao leite', variants: ['ao leite', 'a leite', 'a/leite', 'a.leite'] }
]

export const ALIASES: Record<string, string[]> = {
  // Chocolate/Cobertura
  'cobertura': ['cob', 'cobe', 'cober'],
  'chocolate': ['choc'],
  
  // Tipos
  'branco': ['bco', 'br', 'branca'],
  'blend': ['bl'],
  'amargo': ['amarga'],
  'preto': ['preta'],
  
  // Unidades
  'kg': ['quilo', 'kilo', 'quilograma'],
  'unidade': ['un', 'und', 'unid'],
  'pacote': ['pct', 'pcte'],
  'caixa': ['cx'],
  'display': ['disp', 'dp'],
  
  // Outros
  'recheio': ['rech'],
}

// We also need to normalize weights like "1 kg" to "1kg", "500 g" to "500g", "1.01kg" to "1 01kg" to match DB normalization.
// Wait, the DB's normalizeCatalogText removes punctuation!
// So "1.01kg" becomes "1 01kg". "1kg" stays "1kg".
