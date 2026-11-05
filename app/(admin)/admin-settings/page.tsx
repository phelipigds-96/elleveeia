import React from "react"
import { Settings, Zap, Key, Shield, Database, Lock, Cpu, Server } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-stone">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-ink">
              Configurações Globais
            </h1>
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider text-ellevee-sage">
              Simulação
            </Badge>
          </div>
          <p className="text-xs text-ellevee-sage mt-1 font-sans">
            Parâmetros do motor de inteligência artificial e integridade de infraestrutura.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card: Provedores LLM Globais */}
        <Card className="bg-white border-ellevee-stone shadow-sm">
          <CardHeader className="border-b border-ellevee-stone/60 pb-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-ellevee-ink" />
              <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                Provedores de Inteligência Artificial
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
              Chaves de API globais do servidor (mantidas criptografadas no cofre).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-ink mb-1 font-sans">
                OpenAI API Key
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="sk-proj-********************************"
                  readOnly
                  className="font-mono text-xs bg-[#FBFBFA]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-emerald-800 font-semibold bg-[#F4F8E8] px-2 py-0.5 rounded border border-[#D5E89B]/60">
                  Ativo (GPT-4o)
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-ink mb-1 font-sans">
                Google Gemini API Key
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="AIzaSy********************************"
                  readOnly
                  className="font-mono text-xs bg-[#FBFBFA]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ellevee-ink font-semibold bg-[#F3F2ED] px-2 py-0.5 rounded border border-ellevee-stone">
                  Ativo (Gemini Flash)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card: Segurança & Motor Transacional */}
        <Card className="bg-white border-ellevee-stone shadow-sm">
          <CardHeader className="border-b border-ellevee-stone/60 pb-4">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-ellevee-ink" />
              <CardTitle className="font-display text-base font-bold text-ellevee-ink">
                Segurança do Motor Transacional
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-ellevee-sage mt-0.5 font-sans">
              Políticas de lease e tokens para workers em segundo plano.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-ink mb-1 font-sans">
                CRON_SECRET (Worker de Reconciliação)
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="super_secret_cron_token_****************"
                  readOnly
                  className="font-mono text-xs bg-[#FBFBFA]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ellevee-sage font-semibold bg-[#F3F2ED] px-2 py-0.5 rounded border border-ellevee-stone">
                  Protegido
                </span>
              </div>
            </div>

            <div className="rounded-md border border-ellevee-stone p-3 bg-[#FBFBFA] space-y-1">
              <span className="text-xs font-semibold text-ellevee-ink">Lease de Concorrência: 120s</span>
              <p className="text-[11px] text-ellevee-sage">
                Garante que dois workers não processem a mesma mensagem da outbox usando PostgreSQL SKIP LOCKED.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
