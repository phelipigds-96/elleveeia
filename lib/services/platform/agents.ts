export interface PlatformAgent {
  id: string
  companyId: string
  companyName: string
  companySlug: string
  name: string
  segment?: string | null
  personality?: string | null
  instructions?: string | null
  model: string
  provider: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentBlueprintTemplate {
  key: string
  name: string
  segment: string
  description: string
  recommendedModel: string
  recommendedProvider: string
  targetAudience: string
  sampleInstructions: string
  badge: string
}

export const AGENT_BLUEPRINTS: AgentBlueprintTemplate[] = [
  {
    key: "retail-confectionery",
    name: "Varejo & Doceria (Modelo Sumel)",
    segment: "Confeitaria & Varejo",
    description: "Especialista em atendimento rápido de pedidos de bolos, doces finos, cálculo de taxa de entrega e envio de chave Pix.",
    recommendedModel: "gpt-4o-mini",
    recommendedProvider: "openai",
    targetAudience: "Docerias, confeitarias, padarias e delivery de alimentos.",
    badge: "Recomendado Sumel",
    sampleInstructions: "Você é o assistente virtual da doceria. Apresente o cardápio com cordialidade e entusiasmo, tire dúvidas sobre sabores, recheios e prazos de encomenda, e colete os itens do pedido com clareza antes de calcular o total.",
  },
  {
    key: "customer-support-sac",
    name: "SAC & Atendimento ao Cliente",
    segment: "Geral",
    description: "Resolução ágil de dúvidas sobre horários de funcionamento, políticas de troca, localização física e suporte pós-venda.",
    recommendedModel: "gpt-4o-mini",
    recommendedProvider: "openai",
    targetAudience: "Comércio varejista, clínicas, escritórios e prestadores de serviços.",
    badge: "Essencial",
    sampleInstructions: "Você é o atendente de suporte ao cliente. Responda com clareza, empatia e brevidade às dúvidas frequentes. Caso o cliente solicite falar com um humano, transfira para a equipe de atendimento no Kanban.",
  },
  {
    key: "lead-qualification",
    name: "Qualificação & Vendas Consultivas",
    segment: "Vendas",
    description: "Identifica o perfil do lead, coleta nome, interesse de compra e canal de preferência antes de transferir para o consultor.",
    recommendedModel: "gpt-4o",
    recommendedProvider: "openai",
    targetAudience: "Empresas B2B, distribuidoras, consultorias e atacado.",
    badge: "Conversão",
    sampleInstructions: "Você é o consultor de pré-vendas. Cumprimente o cliente, entenda sua necessidade específica em poucas perguntas estratégicas e qualifique a intenção de compra antes de acionar a equipe comercial.",
  },
  {
    key: "quotes-calculator",
    name: "Calculadora de Orçamentos Rápidos",
    segment: "Orçamentos",
    description: "Consulta a tabela de produtos/serviços e emite orçamentos automáticos em PDF/texto estruturado no WhatsApp.",
    recommendedModel: "gpt-4o",
    recommendedProvider: "openai",
    targetAudience: "Prestadores de serviços, buffets e indústrias leves.",
    badge: "Produtividade",
    sampleInstructions: "Você é o especialista em orçamentos. Liste os itens solicitados pelo cliente com os valores unitários do catálogo, aplique as regras comerciais e apresente um resumo organizado para aprovação imediata.",
  },
]

/**
 * Consulta a lista consolidada de agentes de todas as empresas clientes
 */
export async function getPlatformAgentsList(options?: { adminClient?: any }): Promise<PlatformAgent[]> {
  try {
    let adminClient = options?.adminClient
    if (!adminClient) {
      const { createAdminClient } = await import("@/lib/supabase/service")
      adminClient = createAdminClient()
    }

    const { data: rows, error } = await adminClient
      .from("agents")
      .select(`
        id,
        company_id,
        name,
        segment,
        personality,
        instructions,
        model,
        provider,
        is_active,
        created_at,
        updated_at,
        companies:company_id (
          id,
          name,
          slug
        )
      `)
      .order("created_at", { ascending: false })

    if (error || !rows) {
      return []
    }

    return rows.map((r: any) => {
      const comp = Array.isArray(r.companies) ? r.companies[0] : r.companies
      return {
        id: r.id,
        companyId: r.company_id,
        companyName: comp?.name || "Empresa Desconhecida",
        companySlug: comp?.slug || "empresa",
        name: r.name,
        segment: r.segment,
        personality: r.personality,
        instructions: r.instructions,
        model: r.model || "gpt-4o-mini",
        provider: r.provider || "openai",
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }
    })
  } catch {
    return []
  }
}
