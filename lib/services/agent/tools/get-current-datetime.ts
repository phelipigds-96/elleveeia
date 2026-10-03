import { z } from 'zod'
import { ToolDefinition } from '../tools'

export const getCurrentDatetimeTool: ToolDefinition = {
  name: 'get_current_datetime',
  description: 'Retorna a data e hora atuais no fuso horário local da empresa. Sempre chame isso antes de realizar ações que dependem de datas ou horários.',
  schema: z.object({
    reason: z.string().describe('O motivo pelo qual você precisa saber a data atual.')
  }),
  execute: async (input, context) => {
    // Nesta versão inicial, o fuso horário padrão é America/Sao_Paulo.
    // Futuramente, pode ser obtido através de preferences de companyId do context.
    const timeZone = 'America/Sao_Paulo'
    
    const now = new Date()
    
    // Converte para string formatada
    const options: Intl.DateTimeFormatOptions = {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }

    const formatter = new Intl.DateTimeFormat('pt-BR', options)
    const formattedDate = formatter.format(now)

    // Formato iso fake ou real? Vamos extrair local ISO
    // Melhor construir os retornos simples
    const dateParts = formattedDate.split(', ') // ex: '03/10/2026, 11:45:00'
    const dateSegment = dateParts[0].split('/').reverse().join('-') // '2026-10-03'
    const timeSegment = dateParts[1] // '11:45:00'

    return {
      date: dateSegment,
      time: timeSegment,
      timezone: timeZone,
      iso: `${dateSegment}T${timeSegment}-03:00`,
      reason_acknowledged: input.reason
    }
  }
}
