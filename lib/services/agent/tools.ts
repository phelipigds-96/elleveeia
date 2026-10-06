import { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'

export interface ToolExecutionContext {
  companyId: string
  agentId: string
  conversationId: string
}

export interface InternalToolCall {
  callId: string
  toolName: string
  arguments: any
  providerMetadata?: any
}

export interface InternalToolResult {
  callId: string
  toolName: string
  success: boolean
  data?: any
  error?: {
    code: string
    message: string
  }
}

export interface ToolMetadata {
  category: 'catalog' | 'pricing' | 'commercial' | 'quotes' | 'datetime' | 'general'
  capabilities?: string[]
}

export interface ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  schema: T
  metadata?: ToolMetadata
  execute: (input: z.infer<T>, context: ToolExecutionContext) => Promise<any>
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  register(definition: ToolDefinition) {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool ${definition.name} ja esta registrada.`)
    }
    this.tools.set(definition.name, definition)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  getProviderPayload(selectedTools?: ToolDefinition[]) {
    let toolsToMap = selectedTools ? [...selectedTools] : Array.from(this.tools.values())
    // Ordenacao deterministica estrita para estabilidade de Prompt Caching Nativo
    toolsToMap.sort((a, b) => a.name.localeCompare(b.name))

    return toolsToMap.map(tool => {
      const jsonSchema = zodToJsonSchema(tool.schema, 'mySchema') as any
      const properties = jsonSchema.definitions?.mySchema?.properties || jsonSchema.properties || {}
      const required = jsonSchema.definitions?.mySchema?.required || jsonSchema.required || []

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          required
        }
      }
    })
  }
}

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(call: InternalToolCall, context: ToolExecutionContext): Promise<InternalToolResult> {
    try {
      const tool = this.registry.get(call.toolName)
      
      if (!tool) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          success: false,
          error: {
            code: 'TOOL_NOT_FOUND',
            message: `A ferramenta solicitada '${call.toolName}' nao foi encontrada ou nao esta habilitada.`
          }
        }
      }

      const parseResult = tool.schema.safeParse(call.arguments)
      if (!parseResult.success) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          success: false,
          error: {
            code: 'INVALID_ARGUMENTS',
            message: `Argumentos invalidos: ${parseResult.error.message}`
          }
        }
      }

      const resultData = await tool.execute(parseResult.data, context)

      return {
        callId: call.callId,
        toolName: call.toolName,
        success: true,
        data: resultData
      }
    } catch (err: any) {
      console.error(`[ToolExecutor Error - ${call.toolName}]`, err)
      return {
        callId: call.callId,
        toolName: call.toolName,
        success: false,
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: err.message || 'Erro desconhecido ao executar a ferramenta.'
        }
      }
    }
  }
}
