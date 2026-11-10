/**
 * Retorna as variantes do número de telefone brasileiro (com e sem o 9º dígito).
 * Trata o caso comum no Brasil onde o contato é cadastrado no painel com o 9 (ex: 5551982751427)
 * mas o WhatsApp / Evolution API entrega a mensagem com o formato legado sem o 9 (ex: 555182751427).
 */
export function getBrazilianPhoneVariants(phone: string): string[] {
  if (!phone) return []
  const clean = phone.replace(/\D/g, '')
  if (!clean) return [phone]
  
  const variants = [clean]

  // Se tiver prefixo Brasil (55) e tamanho compatível (12 ou 13 dígitos)
  if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) {
    const ddd = clean.slice(2, 4)
    const rest = clean.slice(4)

    if (rest.length === 9 && rest.startsWith('9')) {
      // Tem 13 dígitos com o 9 -> gera variante de 12 dígitos sem o 9
      variants.push(`55${ddd}${rest.slice(1)}`)
    } else if (rest.length === 8 && ['6', '7', '8', '9'].includes(rest[0])) {
      // Tem 12 dígitos sem o 9 -> gera variante de 13 dígitos com o 9
      variants.push(`55${ddd}9${rest}`)
    }
  }

  // Também inclui variações com '+' se aplicável
  const withPlus = variants.map(v => `+${v}`)
  
  return Array.from(new Set([...variants, ...withPlus]))
}
