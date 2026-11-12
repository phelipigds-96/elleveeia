export async function runAgentEngine() {
  return {
    success: true,
    message: 'Resposta autônoma de teste',
    provider: 'openai',
    model: 'gpt-4o-mini',
    metadata: {
      working_memory: {
        activeProduct: { id: 'prod-1', name: 'Produto Teste' },
      },
    },
    toolResults: [],
    toolsUsed: [],
    usedToolFallback: false,
    runDurationMs: 12,
  }
}
