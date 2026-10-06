import { z } from 'zod'
import { ToolDefinition } from '../tools'

export const getCurrentDatetimeTool: ToolDefinition = {
  name: 'get_current_datetime',
  description: 'Retorna data/hora atual.',
  metadata: { category: 'datetime', capabilities: ['system.time'] },
  schema: z.object({}),
  execute: async () => {
    const now = new Date()
    return {
      success: true,
      data: {
        iso: now.toISOString(),
        locale: now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      }
    }
  }
}
