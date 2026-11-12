export type PlatformPlanKey = "trial" | "starter" | "pro" | "enterprise"

export interface PlatformPlan {
  id: string
  key: PlatformPlanKey
  name: string
  description: string
  priceMonthly: number
  maxMonthlyMessages: number
  maxAgents: number
  maxCatalogItems: number
  maxMonthlyQuotes: number
  defaultAiProvider: "openai" | "gemini" | "hybrid"
  defaultAiModel: string
  allowedLlmProviders: string[]
  features: string[]
  badge?: string | null
  isPopular: boolean
  active: boolean
  addonPackageUnitPriceBrl?: number
  overageUnitPriceBrl?: number
  updatedAt?: string
}

export interface UpdatePlatformPlanInput {
  name?: string
  description?: string
  priceMonthly?: number
  maxMonthlyMessages?: number
  maxAgents?: number
  maxCatalogItems?: number
  maxMonthlyQuotes?: number
  defaultAiProvider?: "openai" | "gemini" | "hybrid"
  defaultAiModel?: string
  allowedLlmProviders?: string[]
  badge?: string | null
  isPopular?: boolean
  active?: boolean
  addonPackageUnitPriceBrl?: number
  overageUnitPriceBrl?: number
  features?: string[]
}

export const DEFAULT_PLANS: PlatformPlan[] = [
  {
    id: "plan-trial",
    key: "trial",
    name: "Trial",
    description: "Ambiente de degustação e homologação para novos clientes validarem os agentes da Ellevee IA.",
    priceMonthly: 0,
    maxMonthlyMessages: 1000,
    maxAgents: 1,
    maxCatalogItems: 1000,
    maxMonthlyQuotes: 100,
    defaultAiProvider: "openai",
    defaultAiModel: "gpt-4o-mini",
    allowedLlmProviders: ["openai"],
    badge: "Degustação",
    isPopular: false,
    active: true,
    addonPackageUnitPriceBrl: 0,
    overageUnitPriceBrl: 0,
    features: [
      "1 Agente de IA Ativo",
      "1.000 mensagens incluídas/mês",
      "Catálogo de até 1.000 produtos",
      "OpenAI GPT-4o Mini nativo",
      "Auditoria e governança básica",
      "Suporte via comunidade e docs",
    ],
  },
  {
    id: "plan-starter",
    key: "starter",
    name: "Starter",
    description: "Ideal para pequenas operações de delivery e varejo iniciando no atendimento conversacional com IA.",
    priceMonthly: 297,
    maxMonthlyMessages: 5000,
    maxAgents: 2,
    maxCatalogItems: 10000,
    maxMonthlyQuotes: 1000,
    defaultAiProvider: "openai",
    defaultAiModel: "gpt-4o-mini",
    allowedLlmProviders: ["openai"],
    badge: null,
    isPopular: false,
    active: true,
    addonPackageUnitPriceBrl: 0.04,
    overageUnitPriceBrl: 0.07,
    features: [
      "Até 2 Agentes de Atendimento",
      "5.000 mensagens incluídas/mês",
      "Catálogo de até 10.000 itens",
      "OpenAI GPT-4o Mini de baixa latência",
      "Kanban de Atendimento integrado",
      "Disparo ativo via Outbox seguro",
    ],
  },
  {
    id: "plan-pro",
    key: "pro",
    name: "Pro",
    description: "Plano recomendado para operações de alto volume como a Sumel (Doceria e Delivery), com inteligência avançada.",
    priceMonthly: 697,
    maxMonthlyMessages: 25000,
    maxAgents: 5,
    maxCatalogItems: 50000,
    maxMonthlyQuotes: 5000,
    defaultAiProvider: "openai",
    defaultAiModel: "gpt-4o",
    allowedLlmProviders: ["openai"],
    badge: "Mais Popular · Recomendado Sumel",
    isPopular: true,
    active: true,
    addonPackageUnitPriceBrl: 0.04,
    overageUnitPriceBrl: 0.07,
    features: [
      "Até 5 Agentes de IA Especializados",
      "25.000 mensagens incluídas/mês",
      "Catálogo de até 50.000 produtos",
      "OpenAI GPT-4o (Raciocínio avançado)",
      "Funil Kanban personalizado por setor",
      "Histórico completo e auditoria avançada",
      "Suporte prioritário via WhatsApp",
    ],
  },
  {
    id: "plan-enterprise",
    key: "enterprise",
    name: "Enterprise",
    description: "Infraestrutura dedicada para redes e franquias com demandas intensivas e volume customizado.",
    priceMonthly: 1997,
    maxMonthlyMessages: 100000,
    maxAgents: 15,
    maxCatalogItems: 200000,
    maxMonthlyQuotes: 20000,
    defaultAiProvider: "openai",
    defaultAiModel: "gpt-4o",
    allowedLlmProviders: ["openai"],
    badge: "Corporativo",
    isPopular: false,
    active: true,
    addonPackageUnitPriceBrl: 0.04,
    overageUnitPriceBrl: 0.07,
    features: [
      "15+ Agentes e fluxos autônomos",
      "100.000 mensagens incluídas/mês",
      "Catálogo e orçamentos ilimitados",
      "OpenAI GPT-4o com throughput dedicado",
      "Impersonate auditado para suporte",
      "SLA garantido de 99,9%",
      "Gerente de conta e CS dedicado",
    ],
  },
]

/**
 * Consulta a lista consolidada de planos e limites da plataforma.
 * Lê do Supabase quando a tabela platform_plans estiver disponível,
 * ou recorre aos defaults resilientes de produção.
 */
export async function getPlatformPlans(options?: { adminClient?: any }): Promise<PlatformPlan[]> {
  try {
    let adminClient = options?.adminClient
    if (!adminClient) {
      const { createAdminClient } = await import("@/lib/supabase/service")
      adminClient = createAdminClient()
    }

    const { data: dbPlans, error } = await adminClient
      .from("platform_plans")
      .select("*")
      .order("price_monthly", { ascending: true })

    if (error || !dbPlans || dbPlans.length === 0) {
      return DEFAULT_PLANS
    }

    return DEFAULT_PLANS.map((defPlan) => {
      const found = dbPlans.find((p: any) => p.key === defPlan.key)
      if (!found) return defPlan

      return {
        id: found.id || defPlan.id,
        key: defPlan.key,
        name: found.name || defPlan.name,
        description: found.description || defPlan.description,
        priceMonthly: Number(found.price_monthly ?? defPlan.priceMonthly),
        maxMonthlyMessages: Number(found.max_monthly_messages ?? defPlan.maxMonthlyMessages),
        maxAgents: Number(found.max_agents ?? defPlan.maxAgents),
        maxCatalogItems: Number(found.max_catalog_items ?? defPlan.maxCatalogItems),
        maxMonthlyQuotes: Number(found.max_monthly_quotes ?? defPlan.maxMonthlyQuotes),
        defaultAiProvider: (found.default_ai_provider as any) || defPlan.defaultAiProvider,
        defaultAiModel: found.default_ai_model || defPlan.defaultAiModel,
        allowedLlmProviders: Array.isArray(found.allowed_llm_providers)
          ? found.allowed_llm_providers
          : defPlan.allowedLlmProviders,
        features: Array.isArray(found.features) && found.features.length > 0
          ? found.features
          : defPlan.features,
        badge: found.badge !== undefined ? found.badge : defPlan.badge,
        isPopular: found.is_popular !== undefined ? Boolean(found.is_popular) : defPlan.isPopular,
        active: found.active !== undefined ? Boolean(found.active) : defPlan.active,
        addonPackageUnitPriceBrl:
          found.addon_package_unit_price_brl !== undefined && found.addon_package_unit_price_brl !== null
            ? Number(found.addon_package_unit_price_brl)
            : defPlan.addonPackageUnitPriceBrl,
        overageUnitPriceBrl:
          found.overage_unit_price_brl !== undefined && found.overage_unit_price_brl !== null
            ? Number(found.overage_unit_price_brl)
            : defPlan.overageUnitPriceBrl,
        updatedAt: found.updated_at,
      }
    })
  } catch {
    return DEFAULT_PLANS
  }
}
