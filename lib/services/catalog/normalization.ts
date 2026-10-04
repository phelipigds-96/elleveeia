/**
 * Função utilitária para normalizar strings para busca no banco de dados.
 * Converte para minúsculas, remove acentos, espaços extras e pontuação indesejada.
 * 
 * Exemplo: "CHOC. SICÃO 1.01KG" -> "choc sicao 1 01kg"
 */
export function normalizeCatalogText(text: string | null | undefined): string {
  if (!text) return ''

  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9\s]/g, ' ') // Substitui pontuação por espaço
    .replace(/\s+/g, ' ') // Remove espaços duplicados
    .trim()
}
