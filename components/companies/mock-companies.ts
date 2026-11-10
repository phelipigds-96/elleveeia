export interface CompanyMock {
  id: string
  name: string
  slug: string
  cnpj: string
  plan: "Trial" | "Starter" | "Pro" | "Enterprise"
  status: "Ativo" | "Suspenso"
  agentsCount: number
  maxAgents: number
  messagesUsed: number
  messagesLimit: number
  tokensUsed: number
  tokensLimit: number
  aiProvider: "openai" | "gemini" | "hybrid"
  createdAt: string
  adminEmail: string
  requireCloseReason?: boolean
}

export const INITIAL_MOCK_COMPANIES: CompanyMock[] = [
  {
    id: "1",
    name: "Coala Play Streaming",
    slug: "coala-play",
    cnpj: "45.892.110/0001-34",
    plan: "Enterprise",
    status: "Ativo",
    agentsCount: 3,
    maxAgents: 10,
    messagesUsed: 48500,
    messagesLimit: 50000,
    tokensUsed: 3800000,
    tokensLimit: 5000000,
    aiProvider: "hybrid",
    createdAt: "2026-07-01",
    adminEmail: "contato@coalaplay.com",
  },
  {
    id: "2",
    name: "Clínica Bem Estar Odonto",
    slug: "clinica-bem-estar",
    cnpj: "12.345.678/0001-90",
    plan: "Pro",
    status: "Ativo",
    agentsCount: 2,
    maxAgents: 5,
    messagesUsed: 14200,
    messagesLimit: 25000,
    tokensUsed: 1100000,
    tokensLimit: 2000000,
    aiProvider: "openai",
    createdAt: "2026-08-15",
    adminEmail: "gestao@bemestarodonto.com.br",
  },
  {
    id: "3",
    name: "Studio Bella Estética",
    slug: "studio-bella",
    cnpj: "33.222.111/0001-22",
    plan: "Starter",
    status: "Ativo",
    agentsCount: 1,
    maxAgents: 2,
    messagesUsed: 4100,
    messagesLimit: 5000,
    tokensUsed: 350000,
    tokensLimit: 500000,
    aiProvider: "gemini",
    createdAt: "2026-09-02",
    adminEmail: "bella@studiobella.com",
  },
  {
    id: "4",
    name: "Nexus Logística & Cargas",
    slug: "nexus-log",
    cnpj: "98.765.432/0001-10",
    plan: "Enterprise",
    status: "Ativo",
    agentsCount: 8,
    maxAgents: 15,
    messagesUsed: 92400,
    messagesLimit: 100000,
    tokensUsed: 7400000,
    tokensLimit: 10000000,
    aiProvider: "openai",
    createdAt: "2026-06-10",
    adminEmail: "operacoes@nexuslog.com.br",
  },
  {
    id: "5",
    name: "Alpha Imóveis Prime",
    slug: "alpha-imoveis",
    cnpj: "77.888.999/0001-55",
    plan: "Pro",
    status: "Suspenso",
    agentsCount: 2,
    maxAgents: 5,
    messagesUsed: 24800,
    messagesLimit: 25000,
    tokensUsed: 1980000,
    tokensLimit: 2000000,
    aiProvider: "openai",
    createdAt: "2026-08-20",
    adminEmail: "diretoria@alphaimoveis.com",
  },
  {
    id: "6",
    name: "Vanguard Advocacia",
    slug: "vanguard-law",
    cnpj: "11.444.777/0001-88",
    plan: "Trial",
    status: "Ativo",
    agentsCount: 1,
    maxAgents: 1,
    messagesUsed: 800,
    messagesLimit: 1000,
    tokensUsed: 80000,
    tokensLimit: 100000,
    aiProvider: "gemini",
    createdAt: "2026-10-25",
    adminEmail: "financeiro@vanguardlaw.com.br",
  },
]

export function formatCompactNumber(value: number): string {
  if (value >= 1000000) {
    const val = value / 1000000
    return val % 1 === 0 ? `${val}M` : `${val.toFixed(1).replace(".", ",")}M`
  }
  if (value >= 1000) {
    const val = value / 1000
    return val % 1 === 0 ? `${val}K` : `${val.toFixed(1).replace(".", ",")}K`
  }
  return value.toString()
}

export function calculateUsagePercent(used: number, limit: number): number {
  if (!limit || limit === 0) return 0
  return Math.round((used / limit) * 100)
}

export function getUsageStatus(percent: number): {
  barColor: string
  textColor: string
  label: string
} {
  if (percent > 100) {
    return {
      barColor: "bg-rose-700",
      textColor: "text-rose-700 font-bold",
      label: "Excedente",
    }
  }
  if (percent >= 95) {
    return {
      barColor: "bg-rose-600",
      textColor: "text-rose-600 font-bold",
      label: "Alerta Crítico",
    }
  }
  if (percent >= 80) {
    return {
      barColor: "bg-amber-500",
      textColor: "text-amber-700 font-semibold",
      label: "Atenção",
    }
  }
  return {
    barColor: "bg-ellevee-sage",
    textColor: "text-ellevee-sage font-medium",
    label: "Normal",
  }
}

