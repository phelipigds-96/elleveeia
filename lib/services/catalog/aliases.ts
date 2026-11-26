export const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'pro', 'pras', 'pros',
  'com', 'sem', 'o', 'a', 'os', 'as', 'em', 'um', 'uma', 'uns', 'umas',
  'quanto', 'quantos', 'quanta', 'quantas', 'esta', 'ta', 'estao', 'tao',
  'tem', 'temos', 'teria', 'teriam', 'tinha', 'tinham',
  'tu', 'voce', 'voces', 'vc', 'vcs', 'te', 'ti', 'ele', 'ela',
  'quero', 'queria', 'preciso', 'precisa', 'gostaria', 'saber', 'sabe',
  'preco', 'precos', 'valor', 'valores', 'custa', 'custam',
  'qual', 'quais', 'e', 'que', 'se', 'fazer', 'comprar', 'ajudar', 'ajuda', 'me',
  'ola', 'oi', 'oii', 'oiii', 'opa', 'eae', 'bom', 'boa', 'dia', 'tarde', 'noite',
  'favor', 'por', 'acaso', 'gentileza',
  'ai', 'aqui', 'la', 'ainda', 'tambem',
  'algum', 'alguma', 'alguns', 'algumas',
  'amigo', 'amiga', 'moco', 'veja', 'olha',
  'nesse', 'nessa', 'neste', 'nesta', 'desse', 'dessa', 'deste', 'desta',
  'orcamento', 'pedido', 'carrinho', 'acrescenta', 'adiciona', 'coloca'
])

export interface MultiWordToken {
  canonical: string
  variants: string[]
  brand?: string
  category?: string
  flavor?: string
  form?: string
}

export const MULTI_WORD_TOKENS: MultiWordToken[] = [
  { canonical: 'meio amargo', variants: ['meio amargo', 'm amargo', 'm/amargo', 'm.amargo', 'meio-amargo', 'meio amarga', 'm amarga', 'meio-amarga'], flavor: 'meio amargo' },
  { canonical: 'ao leite', variants: ['ao leite', 'a leite', 'a/leite', 'a.leite', 'aoleite'], flavor: 'ao leite' },
  { canonical: 'leite condensado', variants: ['leite condensado', 'leite condenssado', 'leite condesado', 'leite cond', 'leiti condesado'], category: 'Laticínios' },
  { canonical: 'creme de leite', variants: ['creme de leite', 'creme leite', 'crem de leite'], category: 'Laticínios' },
  { canonical: 'doce de leite', variants: ['doce de leite', 'doce leite'], category: 'Doces' },
  { canonical: 'leite em po', variants: ['leite em po', 'leite em pó', 'leite po', 'leitepo'], category: 'Laticínios' },
  { canonical: 'semidesnatado', variants: ['semi desnatado', 'semi-desnatado', 'semidesnatado'], flavor: 'semidesnatado' },
  { canonical: 'zero lactose', variants: ['zero lactose', '0 lactose', 'sem lactose', 'zero lact', '0% lactose', 'zero lactos'], flavor: 'zero lactose' },
  { canonical: 'chocolate em po', variants: ['chocolate em po', 'choc em po', 'chocolate em pó', 'choc em pó', 'choc po'], category: 'Chocolate em Pó', form: 'po' },
  { canonical: 'pasta americana', variants: ['pasta americana', 'pasta americ'], category: 'Confeitaria', form: 'pasta' },
  { canonical: 'cobertura fracionada', variants: ['cobertura fracionada', 'choc fracionado', 'chocolate fracionado', 'fracionada', 'fracionado', 'cob fracionada'], category: 'Cobertura', form: 'fracionada' },
  { canonical: 'chocolate nobre', variants: ['chocolate nobre', 'choc nobre', 'nobre puro', 'chocolate puro', 'choc puro'], category: 'Chocolate Nobre', form: 'nobre' },
  { canonical: 'casquinha de ovo', variants: ['casquinha de ovo', 'casquinha de pascoa', 'casquinha do ovo', 'casquinha de trufa', 'fazer casquinha', 'para casquinha', 'pra casquinha', 'casquinhas'] },
  { canonical: 'ovo de pascoa', variants: ['ovo de pascoa', 'ovo de páscoa', 'ovos de pascoa', 'ovos de páscoa'] },
  { canonical: 'farinha de trigo', variants: ['farinha de trigo', 'farinha trigo'], category: 'Farinhas' },
  { canonical: 'fermento quimico', variants: ['fermento quimico', 'fermento químico', 'fermento em po', 'fermento em pó'], category: 'Fermentos' },
  
  // Nomes Populares & Linhas Específicas
  { canonical: 'leite moca', variants: ['leite moca', 'leite moça', 'leiti moca', 'moca lata'], brand: 'Nestle', category: 'Laticínios' },
  { canonical: 'po royal', variants: ['po royal', 'pó royal', 'fermento royal'], brand: 'Royal', category: 'Fermentos' },
  { canonical: 'harald top', variants: ['harald top', 'top harald', 'top gotas'], brand: 'Harald', category: 'Cobertura', form: 'fracionada' },
  { canonical: 'harald melken', variants: ['harald melken', 'melken harald', 'chocolate melken'], brand: 'Harald', category: 'Chocolate Nobre', form: 'nobre' },
  { canonical: 'sicao mais', variants: ['sicao mais', 'cobertura sicao'], brand: 'Sicao', category: 'Cobertura', form: 'fracionada' },
  { canonical: 'sicao gold', variants: ['sicao gold', 'chocolate sicao nobre'], brand: 'Sicao', category: 'Chocolate Nobre', form: 'nobre' },
  { canonical: 'callebaut 823', variants: ['callebaut 823', 'callebaut ao leite 823'], brand: 'Callebaut', category: 'Chocolate Nobre', flavor: 'ao leite' },
  { canonical: 'callebaut 811', variants: ['callebaut 811', 'callebaut meio amargo 811'], brand: 'Callebaut', category: 'Chocolate Nobre', flavor: 'meio amargo' },
  { canonical: 'callebaut w2', variants: ['callebaut w2', 'callebaut branco w2'], brand: 'Callebaut', category: 'Chocolate Nobre', flavor: 'branco' },
]

export const POPULAR_PRODUCT_MAPPINGS: Record<string, { brand?: string; category?: string; queryExpansion: string }> = {
  'leite moca': { brand: 'Nestle', category: 'Laticínios', queryExpansion: 'leite condensado moca nestle' },
  'moca': { brand: 'Nestle', category: 'Laticínios', queryExpansion: 'leite condensado moca nestle' },
  'po royal': { brand: 'Royal', category: 'Fermentos', queryExpansion: 'fermento quimico royal' },
  'royal': { brand: 'Royal', category: 'Fermentos', queryExpansion: 'fermento royal' },
  'amelia': { brand: 'Vigor', category: 'Confeitaria', queryExpansion: 'chantilly amelia vigor' },
  'chanty fest': { brand: 'Vigor', category: 'Confeitaria', queryExpansion: 'chantilly amelia vigor' }
}

export const CANONICAL_BRANDS: Record<string, { canonical: string; variants: string[] }> = {
  'nestle': { canonical: 'Nestle', variants: ['nestle', 'nestlé', 'nestlei', 'netle', 'nestlle', 'moca', 'moça', 'galak'] },
  'garoto': { canonical: 'Garoto', variants: ['garoto', 'garotto', 'garotoo'] },
  'lacta': { canonical: 'Lacta', variants: ['lacta', 'lakta'] },
  'harald': { canonical: 'Harald', variants: ['harald', 'harad', 'harld', 'top', 'melken'] },
  'sicao': { canonical: 'Sicao', variants: ['sicao', 'sicau', 'sicaoo', 'sicao mais', 'sicao gold'] },
  'callebaut': { canonical: 'Callebaut', variants: ['callebaut', 'calebaut', 'callebault', 'calebau', 'calrebaut', 'callebout', 'callebau'] },
  'italac': { canonical: 'Italac', variants: ['italac', 'itallac', 'italak', 'itac', 'italaque'] },
  'piracanjuba': { canonical: 'Piracanjuba', variants: ['piracanjuba', 'piracanjuva', 'piracanjub'] },
  'itambe': { canonical: 'Itambe', variants: ['itambe', 'itambé', 'itambee'] },
  'tirol': { canonical: 'Tirol', variants: ['tirol', 'tyrol'] },
  'triangulo': { canonical: 'Triangulo', variants: ['triangulo', 'triângulo', 'triangulu'] },
  'genuine': { canonical: 'Genuine', variants: ['genuine', 'genuina', 'genuino', 'cargill genuine'] },
  'dona jura': { canonical: 'Dona Jura', variants: ['dona jura', 'jurá', 'jura'] },
  'arcolor': { canonical: 'Arcolor', variants: ['arcolor', 'arcollor', 'ar color'] },
  'vigor': { canonical: 'Vigor', variants: ['vigor', 'amelia', 'amélia'] },
  'dori': { canonical: 'Dori', variants: ['dori', 'dory'] },
  'royal': { canonical: 'Royal', variants: ['royal', 'roial'] },
  'dona benta': { canonical: 'Dona Benta', variants: ['dona benta', 'benta'] },
  'mavalerio': { canonical: 'Mavalerio', variants: ['mavalerio', 'mavalério', 'mavaleri'] },
  'selecta': { canonical: 'Selecta', variants: ['selecta', 'selekta'] },
  'mix': { canonical: 'Mix', variants: ['mix'] }
}

export const KNOWN_FLAVORS = [
  'ao leite', 'meio amargo', 'amargo', 'branco', 'blend', 'marfim', 'galak',
  'zero lactose', 'semidesnatado', 'desnatado', 'integral', 'morango',
  '50% cacau', '33% cacau', '70% cacau', '50%', '33%', '70%', '100% cacau'
]

export const KNOWN_FORMS = [
  'barra', 'gotas', 'po', 'fracionada', 'nobre', 'tablete', 'recheio',
  'pasta', 'pasta americana', 'granulado', 'chantilly'
]

export const ALIASES: Record<string, string[]> = {
  // Chocolate/Cobertura
  'cobertura': ['cob', 'cobe', 'cober'],
  'chocolate': ['choc', 'xocolate', 'chocolat', 'choclete', 'chocolat'],
  
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
  'leite': ['leiti', 'leitte'],
  
  // Principais Marcas do Mercado
  'nestle': ['nestlé', 'nestlei', 'netle', 'nestlle', 'moca', 'moça'],
  'italac': ['itallac', 'italak', 'itac', 'italaque'],
  'piracanjuba': ['piracanjuva', 'piracanjub'],
  'itambe': ['itambé', 'itambee'],
  'harald': ['harad', 'harld', 'top', 'melken'],
  'sicao': ['sicau', 'sicaoo'],
  'callebaut': ['calebaut', 'callebault', 'calebau', 'calrebaut'],
  'trakinas': ['traquinas', 'trakina', 'traquina', 'bisc trakinas'],
  'royal': ['roial'],
  'amelia': ['amélia'],
  
  // Confeitaria & Ingredientes Comuns
  'chantilly': ['chantily', 'chantili', 'chantilhy'],
  'granulado': ['granulados', 'granualdo'],
  'brigadeiro': ['brigadeiros', 'brigadero'],
  'cacau': ['cacau em po'],
  'fermento': ['fermento em po', 'po royal', 'fermento royal'],
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
