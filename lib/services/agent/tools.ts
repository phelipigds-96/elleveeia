// ==============================================================================
// FASE 7: TOOL CALLING ARCHITECTURE STUBS
// ==============================================================================

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required: string[]
    }
  }
}

export type ToolExecutor = (args: any, context: any) => Promise<any>

export class ToolRegistry {
  private tools: Map<string, { def: ToolDefinition, executor: ToolExecutor }> = new Map()

  register(definition: ToolDefinition, executor: ToolExecutor) {
    this.tools.set(definition.function.name, { def: definition, executor })
  }

  getOpenAIToolsPayload(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.def)
  }

  async execute(name: string, args: any, context: any): Promise<any> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`Tool ${name} não encontrada no registry.`)
    }
    return tool.executor(args, context)
  }
}

// Futuramente, no Agent Engine:
// 1. Instanciar ToolRegistry.
// 2. Opcionalmente registrar ferramentas baseadas no array de "agent.tools".
// 3. Passar getOpenAIToolsPayload() para a função callOpenAI.
// 4. Tratar `tool_calls` na resposta da OpenAI invocando registry.execute().
// 5. Retornar os tool results para a OpenAI gerar a resposta final.
