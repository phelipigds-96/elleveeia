import React from "react"
import { Settings, Zap, Key, Shield, Database, Lock, Cpu, Server } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Configurações Globais
            </h1>
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider text-emerald-800 bg-emerald-50 border-emerald-200">
              Produção
            </Badge>
          </div>
          <p className="text-xs text-ellevee-text-secondary mt-1 font-sans">
            Parâmetros do motor de inteligência artificial e integridade de infraestrutura.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card: Provedores LLM Globais */}
        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="border-b border-ellevee-border pb-4 bg-[#F8F8F6]/50">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-ellevee-purple" />
              <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                Provedores de Inteligência Artificial
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
              Chaves de API globais do servidor (mantidas criptografadas no cofre).
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1 font-sans">
                OpenAI API Key
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="sk-proj-********************************"
                  readOnly
                  className="font-mono text-xs bg-[#F8F8F6] border-ellevee-border text-ellevee-deep-ink"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Ativo (GPT-4o)
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1 font-sans">
                Google Gemini API Key
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="AIzaSy********************************"
                  readOnly
                  className="font-mono text-xs bg-[#F8F8F6] border-ellevee-border text-ellevee-deep-ink"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ellevee-deep-ink font-semibold bg-ellevee-warm-ivory px-2 py-0.5 rounded border border-ellevee-border">
                  Ativo (Gemini Flash)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card: Segurança & Motor Transacional */}
        <Card className="bg-white border-ellevee-border shadow-card rounded-xl">
          <CardHeader className="border-b border-ellevee-border pb-4 bg-[#F8F8F6]/50">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-ellevee-deep-ink" />
              <CardTitle className="font-display text-base font-bold text-ellevee-deep-ink">
                Segurança do Motor Transacional
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-ellevee-text-secondary mt-0.5 font-sans">
              Políticas de lease e tokens para workers em segundo plano.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1 font-sans">
                CRON_SECRET (Worker de Reconciliação)
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="super_secret_cron_token_****************"
                  readOnly
                  className="font-mono text-xs bg-[#F8F8F6] border-ellevee-border text-ellevee-deep-ink"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ellevee-text-secondary font-semibold bg-ellevee-warm-ivory px-2 py-0.5 rounded border border-ellevee-border">
                  Protegido
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-ellevee-border p-3 bg-[#F8F8F6] space-y-1">
              <span className="text-xs font-semibold text-ellevee-deep-ink font-display">Lease de Concorrência: 120s</span>
              <p className="text-[11px] text-ellevee-text-secondary">
                Garante que dois workers não processem a mesma mensagem da outbox usando PostgreSQL SKIP LOCKED.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
