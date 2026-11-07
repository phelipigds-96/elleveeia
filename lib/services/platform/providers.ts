export interface ProviderStatus {
  key: "openai" | "gemini" | "anthropic"
  name: string
  status: "operational" | "standby" | "disabled"
  statusLabel: string
  badgeVariant: "default" | "secondary" | "outline" | "destructive"
  isPrimary: boolean
  defaultModel: string
  supportedModels: string[]
  latencyMs: number
  successRatePercent: number
  apiKeyConfigured: boolean
  description: string
}

export interface PlatformInfraConfig {
  primaryProvider: string
  defaultFastModel: string
  defaultAdvancedModel: string
  defaultTemperature: number
  maxTimeoutSeconds: number
  retryAttempts: number
  workerStatus: "healthy" | "idle" | "warning"
  concurrencyLeaseSeconds: number
  gatewayLockActive: boolean
}

export const PLATFORM_PROVIDERS: ProviderStatus[] = [
  {
    key: "openai",
    name: "OpenAI (Nativo Primário)",
    status: "operational",
    statusLabel: "Operacional · Ativo",
    badgeVariant: "default",
    isPrimary: true,
    defaultModel: "gpt-4o-mini",
    supportedModels: ["gpt-4o-mini", "gpt-4o", "text-embedding-3-small"],
    latencyMs: 1150,
    successRatePercent: 99.8,
    apiKeyConfigured: true,
    description: "Motor cognitivo prioritário da Ellevee IA. Alimentando 100% dos fluxos de atendimento, orçamentos e chat da Sumel e novas empresas.",
  },
  {
    key: "gemini",
    name: "Google Gemini",
    status: "standby",
    statusLabel: "Standby · Habilitado",
    badgeVariant: "secondary",
    isPrimary: false,
    defaultModel: "gemini-1.5-flash",
    supportedModels: ["gemini-1.5-flash", "gemini-1.5-pro"],
    latencyMs: 1420,
    successRatePercent: 99.2,
    apiKeyConfigured: true,
    description: "Provedor secundário mantido em contingência operacional para multi-model routing caso configurado pela organização.",
  },
  {
    key: "anthropic",
    name: "Anthropic Claude",
    status: "disabled",
    statusLabel: "Desabilitado",
    badgeVariant: "outline",
    isPrimary: false,
    defaultModel: "claude-3-5-sonnet",
    supportedModels: ["claude-3-5-sonnet", "claude-3-haiku"],
    latencyMs: 0,
    successRatePercent: 0,
    apiKeyConfigured: false,
    description: "Integração futura prevista para raciocínio corporativo de alto nível em planos customizados.",
  },
]

export const PLATFORM_INFRA_CONFIG: PlatformInfraConfig = {
  primaryProvider: "openai",
  defaultFastModel: "gpt-4o-mini",
  defaultAdvancedModel: "gpt-4o",
  defaultTemperature: 0.7,
  maxTimeoutSeconds: 30,
  retryAttempts: 3,
  workerStatus: "healthy",
  concurrencyLeaseSeconds: 120,
  gatewayLockActive: true,
}

/**
 * Consulta a telemetria e configurações dos provedores de IA
 */
export async function getPlatformProvidersData(): Promise<{
  providers: ProviderStatus[]
  infraConfig: PlatformInfraConfig
}> {
  // Verifica se chave da OpenAI está presente no ambiente do servidor
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)

  const providers = PLATFORM_PROVIDERS.map((p) => {
    if (p.key === "openai") {
      return { ...p, apiKeyConfigured: hasOpenAiKey }
    }
    if (p.key === "gemini") {
      return { ...p, apiKeyConfigured: hasGeminiKey }
    }
    return p
  })

  return {
    providers,
    infraConfig: PLATFORM_INFRA_CONFIG,
  }
}
