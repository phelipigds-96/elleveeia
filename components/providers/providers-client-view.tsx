"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { ProviderStatus, PlatformInfraConfig } from "@/lib/services/platform/providers"
import { testProviderConnectionAction } from "@/app/(admin)/providers/actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Cpu,
  Sparkles,
  Zap,
  Activity,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Lock,
  Layers,
  Server,
  RefreshCw,
  Send,
} from "lucide-react"
import { toast } from "@/components/ui/toast"

interface ProvidersClientViewProps {
  initialProviders: ProviderStatus[]
  infraConfig: PlatformInfraConfig
}

export default function ProvidersClientView({
  initialProviders,
  infraConfig,
}: ProvidersClientViewProps) {
  const router = useRouter()
  const [providers, setProviders] = useState<ProviderStatus[]>(initialProviders)
  const [testingKey, setTestingKey] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    provider: string
    latencyMs: number
    message: string
  } | null>(null)

  const handleTestConnection = async (provider: ProviderStatus) => {
    setTestingKey(provider.key)
    setTestResult(null)

    try {
      if (provider.key === "anthropic") {
        toast.info("Provedor desabilitado", "A integração com Anthropic Claude está desativada no momento.")
        setTestingKey(null)
        return
      }

      const res = await testProviderConnectionAction(provider.key as any)

      if (!res.success) {
        toast.error("Erro na verificação", res.error || "Falha ao testar conectividade.")
        setTestingKey(null)
        return
      }

      toast.success(
        `Conexão OK (${res.latencyMs}ms)`,
        `O endpoint da ${provider.name} respondeu normalmente.`
      )

      setTestResult({
        provider: provider.name,
        latencyMs: res.latencyMs || 0,
        message: res.message || "Endpoint respondendo com saúde.",
      })

      // Atualiza a latência exibida
      if (res.latencyMs) {
        setProviders((prev) =>
          prev.map((p) => (p.key === provider.key ? { ...p, latencyMs: res.latencyMs! } : p))
        )
      }

      setTestingKey(null)
      router.refresh()
    } catch {
      toast.error("Falha de rede", "Não foi possível testar o provedor.")
      setTestingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-ellevee-border pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Provedores de Inteligência Artificial
            </h1>
            <Badge variant="outline" className="border-ellevee-border text-ellevee-deep-ink bg-white font-mono text-[10px] px-2 py-0.5">
              INFRAESTRUTURA & LLM
            </Badge>
          </div>
          <p className="text-xs text-ellevee-text-secondary leading-relaxed max-w-2xl">
            Supervisão e monitoramento dos motores de Inteligência Artificial, gateways de mensageria e políticas de inferência de toda a plataforma Ellevee IA.
          </p>
        </div>

        {/* Global LLM Provider Pill */}
        <div className="flex items-center gap-2.5 bg-white border border-ellevee-border rounded-xl px-3.5 py-2 shrink-0 shadow-2xs">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-ellevee-purple" />
              <span className="text-xs font-semibold text-ellevee-deep-ink">
                OpenAI Nativa (Produção)
              </span>
            </div>
            <span className="text-[10px] text-ellevee-text-secondary">
              GPT-4o Mini & GPT-4o por padrão
            </span>
          </div>
        </div>
      </div>

      {/* Seção 1: Cards de Provedores de LLM */}
      <div className="space-y-3">
        <h3 className="font-display text-sm font-bold text-ellevee-deep-ink flex items-center gap-2">
          <Cpu className="w-4 h-4 text-ellevee-deep-ink" />
          Motores de Inteligência Artificial Conectados
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {providers.map((p) => {
            const isPrimary = p.isPrimary
            const isStandby = p.status === "standby"
            const isDisabled = p.status === "disabled"

            return (
              <div
                key={p.key}
                className={`rounded-xl border bg-white p-5 shadow-card flex flex-col justify-between transition-all ${
                  isPrimary
                    ? "border-ellevee-purple/70 ring-1 ring-ellevee-purple/30 shadow-card-hover"
                    : "border-ellevee-border"
                }`}
              >
                <div>
                  {/* Header do Card */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-display text-base font-bold text-ellevee-deep-ink flex items-center gap-1.5">
                        {p.name}
                      </h4>
                      <span className="text-[10px] font-mono uppercase text-ellevee-text-secondary block mt-0.5">
                        {p.key}
                      </span>
                    </div>

                    {isPrimary ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-900 bg-emerald-100/80 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                        Primário Ativo
                      </span>
                    ) : isStandby ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ellevee-text-secondary bg-[#F8F8F6] border border-ellevee-border px-2 py-0.5 rounded-full">
                        Standby
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-ellevee-text-secondary bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
                        Desabilitado
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-ellevee-text-secondary mt-2 leading-relaxed">
                    {p.description}
                  </p>

                  {/* Indicadores Técnicos */}
                  <div className="mt-4 pt-3 border-t border-ellevee-border space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-ellevee-text-secondary">Modelos Suportados:</span>
                      <div className="flex items-center gap-1">
                        {p.supportedModels.map((m) => (
                          <span
                            key={m}
                            className="text-[10px] font-mono bg-[#F8F8F6] border border-ellevee-border px-1.5 py-0.5 rounded text-ellevee-deep-ink"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-ellevee-text-secondary">Latência Média:</span>
                      <span className="font-semibold text-[11px] text-ellevee-deep-ink">
                        {p.latencyMs > 0 ? `${p.latencyMs}ms` : "—"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-ellevee-text-secondary">Taxa de Sucesso:</span>
                      <span className="font-semibold text-[11px] text-emerald-800">
                        {p.successRatePercent > 0 ? `${p.successRatePercent}%` : "—"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-ellevee-text-secondary">Credencial de Acesso:</span>
                      <span className="font-mono text-[10px] text-ellevee-text-secondary flex items-center gap-1">
                        <Lock className="w-3 h-3 text-ellevee-text-secondary" />
                        {p.apiKeyConfigured ? "Cofre Protegido" : "Não Configurada"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Botão de Teste de Conexão */}
                <div className="mt-5 pt-3 border-t border-ellevee-border">
                  <Button
                    onClick={() => handleTestConnection(p)}
                    disabled={testingKey === p.key || isDisabled}
                    variant="outline"
                    size="sm"
                    className="w-full text-xs font-semibold border-ellevee-border text-ellevee-deep-ink hover:bg-ellevee-warm-ivory/60 transition-all flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        testingKey === p.key ? "animate-spin" : ""
                      }`}
                    />
                    {testingKey === p.key
                      ? "Verificando conexão..."
                      : isDisabled
                      ? "Indisponível"
                      : "Testar Conexão (Ping)"}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Feedback visual de teste */}
        {testResult && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-950 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <div>
              <span className="font-semibold">{testResult.provider}:</span>{" "}
              <span>{testResult.message}</span>
            </div>
          </div>
        )}
      </div>

      {/* Seção 2: Parâmetros de Inferência e Políticas Globais */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card: Parâmetros Cognitivos */}
        <div className="rounded-xl border border-ellevee-border bg-white p-5 shadow-card space-y-4">
          <div className="flex items-center gap-2 border-b border-ellevee-border pb-3">
            <Sparkles className="w-4 h-4 text-ellevee-deep-ink" />
            <h3 className="font-display text-sm font-bold text-ellevee-deep-ink">
              Políticas de Inferência Cognitiva
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Modelo Padrão de Atendimento</span>
                <span className="text-[11px] text-ellevee-text-secondary">Ultra-rápido para mensagens de WhatsApp</span>
              </div>
              <Badge variant="outline" className="font-mono text-[10px] border-ellevee-border text-ellevee-deep-ink">
                gpt-4o-mini
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Modelo Avançado para Orçamentos</span>
                <span className="text-[11px] text-ellevee-text-secondary">Raciocínio lógico e regras de frete complexas</span>
              </div>
              <Badge variant="outline" className="font-mono text-[10px] border-ellevee-border text-ellevee-deep-ink">
                gpt-4o
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Temperatura Padrão do Sistema</span>
                <span className="text-[11px] text-ellevee-text-secondary">Equilíbrio ideal entre precisão e fluidez</span>
              </div>
              <span className="font-mono font-semibold text-xs text-ellevee-deep-ink">0.7</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Timeout Máximo de Inferência</span>
                <span className="text-[11px] text-ellevee-text-secondary">Tempo limite antes de fallback para fila</span>
              </div>
              <span className="font-mono font-semibold text-xs text-ellevee-deep-ink">30s</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Política de Retry Automático</span>
                <span className="text-[11px] text-ellevee-text-secondary">Proteção com Exponential Backoff</span>
              </div>
              <span className="font-mono font-semibold text-xs text-emerald-800">
                3 tentativas
              </span>
            </div>
          </div>
        </div>

        {/* Card: Infraestrutura Transacional & Workers */}
        <div className="rounded-xl border border-ellevee-border bg-white p-5 shadow-card space-y-4">
          <div className="flex items-center gap-2 border-b border-ellevee-border pb-3">
            <ShieldCheck className="w-4 h-4 text-ellevee-deep-ink" />
            <h3 className="font-display text-sm font-bold text-ellevee-deep-ink">
              Segurança do Motor Transacional & Workers
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Worker da Outbox (Segundo Plano)</span>
                <span className="text-[11px] text-ellevee-text-secondary">Processamento e despacho assíncrono</span>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                Ativo (Saudável)
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Lease de Concorrência PostgreSQL</span>
                <span className="text-[11px] text-ellevee-text-secondary">Proteção com SKIP LOCKED contra duplicidade</span>
              </div>
              <span className="font-mono font-semibold text-xs text-ellevee-deep-ink">120 segundos</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Gateway Lock Transacional</span>
                <span className="text-[11px] text-ellevee-text-secondary">Tabela gateway_locks com chave UUID</span>
              </div>
              <span className="font-mono font-semibold text-xs text-emerald-800">Habilitado</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-ellevee-deep-ink block">Endpoint de Webhook WhatsApp</span>
                <span className="text-[11px] text-ellevee-text-secondary">Recepção de mensagens e status</span>
              </div>
              <span className="font-mono text-[10px] text-ellevee-text-secondary">
                /api/webhooks/messages
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
