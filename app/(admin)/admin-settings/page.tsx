import React from "react"
import { Settings, Zap, Key, Shield, Database, Lock } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-2 border-b border-slate-200/80">
        <div className="h-9 w-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
          <Settings className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Configurações Globais</h1>
          <p className="text-xs text-slate-500">
            Parâmetros do motor de inteligência artificial e credenciais de infraestrutura.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card: Provedores LLM Globais */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              <CardTitle>Provedores de Inteligência Artificial</CardTitle>
            </div>
            <CardDescription>Chaves de API globais do servidor (nunca expostas ao cliente)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                OpenAI API Key
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="sk-proj-********************************"
                  readOnly
                  className="font-mono text-xs bg-slate-50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                  Ativo (GPT-4o)
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Google Gemini API Key
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="AIzaSy********************************"
                  readOnly
                  className="font-mono text-xs bg-slate-50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                  Ativo (Gemini Flash)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card: Segurança & Worker */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-600" />
              <CardTitle>Segurança do Motor Transacional</CardTitle>
            </div>
            <CardDescription>Políticas de lease e tokens de automação</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                CRON_SECRET (Worker de Reconciliação)
              </label>
              <div className="relative">
                <Input
                  type="password"
                  value="super_secret_cron_token_****************"
                  readOnly
                  className="font-mono text-xs bg-slate-50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 font-semibold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                  Protegido
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/50 space-y-1">
              <span className="text-xs font-semibold text-slate-800">Lease de Concorrência: 120s</span>
              <p className="text-[11px] text-slate-500">
                Garante que dois workers não peguem a mesma mensagem da outbox usando PostgreSQL SKIP LOCKED.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
