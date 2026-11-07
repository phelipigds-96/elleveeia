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
  'amigo', 'amiga', 'moco', 'veja', 'olha'
])

export const MULTI_WORD_TOKENS = [
  { canonical: 'meio amargo', variants: ['meio amargo', 'm amargo', 'm/amargo', 'm.amargo', 'meio-amargo', 'meio amarga', 'm amarga', 'meio-amarga'] },
  { canonical: 'ao leite', variants: ['ao leite', 'a leite', 'a/leite', 'a.leite'] },
  { canonical: 'leite condensado', variants: ['leite condensado', 'leite condenssado', 'leite condesado', 'leite cond', 'leite moca', 'leite moça'] },
  { canonical: 'creme de leite', variants: ['creme de leite', 'creme leite', 'crem de leite'] },
  { canonical: 'doce de leite', variants: ['doce de leite', 'doce leite'] },
  { canonical: 'leite em po', variants: ['leite em po', 'leite em pó', 'leite po'] },
  { canonical: 'semi desnatado', variants: ['semi desnatado', 'semi-desnatado', 'semidesnatado'] },
  { canonical: 'zero lactose', variants: ['zero lactose', '0 lactose', 'sem lactose', 'zero lact'] },
  { canonical: 'chocolate em po', variants: ['chocolate em po', 'choc em po', 'chocolate em pó', 'choc em pó'] },
  { canonical: 'pasta americana', variants: ['pasta americana', 'pasta americ'] }
]

export const ALIASES: Record<string, string[]> = {
  // Chocolate/Cobertura
  'cobertura': ['cob', 'cobe', 'cober'],
  'chocolate': ['choc'],
  
  // Segmentos / Finalidades de Compra
  'confeitaria': ['barra', 'confeiteiro', 'confeiteira', 'culinario', 'culinaria', 'cobertura', 'gotas', 'recheio', 'pasta'],
  'consumo': ['tablete', 'bombom', 'snack', 'unitario', 'avulso'],
  'docinho': ['tablete', 'bombom', 'snack', 'chocolate'],

  // Tipos e Sabores
  'branco': ['bco', 'br', 'branca', 'marfim', 'galak'],
  'blend': ['bl'],
  'amargo': ['amarga'],
  'preto': ['preta'],
  'morango': ['morang', 'morango'],
  
  // Principais Marcas do Mercado
  'nestle': ['nestlé', 'nestlei', 'netle', 'nestlle'],
  'italac': ['itallac', 'italak', 'itac'],
  'piracanjuba': ['piracanjuva', 'piracanjub'],
  'itambe': ['itambé', 'itambee'],
  'harald': ['harad', 'harld'],
  'sicao': ['sicau', 'sicaoo'],
  'callebaut': ['calebaut', 'callebault', 'calebau'],
  'trakinas': ['traquinas', 'trakina', 'traquina', 'bisc trakinas'],
  
  // Confeitaria & Ingredientes Comuns
  'chantilly': ['chantily', 'chantili', 'chantilhy'],
  'granulado': ['granulados', 'granualdo'],
  'brigadeiro': ['brigadeiros', 'brigadero'],
  'cacau': ['cacau em po'],
  'fermento': ['fermento em po', 'po royal'],
  'recheio': ['rech'],

  // Unidades e Embalagens
  'kg': ['quilo', 'kilo', 'quilograma'],
  '395g': ['395g', '395', '395gr', '39', '390g', '400g'],
  '395': ['395g', '395', '395gr', '39', '390g', '400g'],
  '39': ['395g', '395'],
  'unidade': ['un', 'und', 'unid'],
  'pacote': ['pct', 'pcte'],
  'caixa': ['cx', 'caixas'],
  'display': ['disp', 'dp'],
  'fardo': ['fd', 'fardos'],
  'revenda': ['cx', 'caixa', 'fardo', 'display', 'atacado'],
  'atacado': ['cx', 'caixa', 'fardo', 'display', 'revenda']
}
