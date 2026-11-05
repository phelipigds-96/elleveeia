"use client"

import React, { useState } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Building2, Sparkles, CheckCircle2 } from "lucide-react"
import { CompanyMock } from "./mock-companies"

interface CompanyFormProps {
  open: boolean
  onClose: () => void
  onSave?: (newCompany: Partial<CompanyMock>) => void
}

export default function CompanyForm({ open, onClose, onSave }: CompanyFormProps) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [cnpj, setCnpj] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [plan, setPlan] = useState<"Trial" | "Starter" | "Pro" | "Enterprise">("Pro")
  const [aiProvider, setAiProvider] = useState<"openai" | "gemini" | "hybrid">("openai")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  // Auto-slug generation from name
  const handleNameChange = (val: string) => {
    setName(val)
    const generated = val
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
    setSlug(generated)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)

    setTimeout(() => {
      setIsSubmitting(false)
      setSuccess(true)

      const created: Partial<CompanyMock> = {
        name,
        slug: slug || "empresa-nova",
        cnpj: cnpj || "00.000.000/0001-00",
        adminEmail: adminEmail || "admin@tenant.local",
        plan,
        aiProvider,
        status: "Ativo",
        messagesUsed: 0,
        messagesLimit: plan === "Trial" ? 1000 : plan === "Starter" ? 5000 : plan === "Pro" ? 25000 : 100000,
        tokensUsed: 0,
        tokensLimit: plan === "Trial" ? 100000 : plan === "Starter" ? 500000 : plan === "Pro" ? 2000000 : 10000000,
        agentsCount: 1,
        maxAgents: plan === "Trial" ? 1 : plan === "Starter" ? 2 : plan === "Pro" ? 5 : 15,
        createdAt: new Date().toISOString().split("T")[0],
      }

      if (onSave) onSave(created)

      setTimeout(() => {
        setSuccess(false)
        setName("")
        setSlug("")
        setCnpj("")
        setAdminEmail("")
        onClose()
      }, 900)
    }, 600)
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Nova Empresa / Tenant</DialogTitle>
              <DialogDescription>
                Cadastre um novo cliente com provisionamento automático de limites.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center animate-in zoom-in">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h4 className="text-base font-bold text-slate-800">Empresa Cadastrada com Sucesso!</h4>
            <p className="text-xs text-slate-500">O novo tenant foi provisionado na infraestrutura multi-tenant.</p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome da Empresa <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="Ex: Acme Tecnologia Ltda"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Slug do Tenant (Identificador Único)
                </label>
                <div className="relative">
                  <Input
                    placeholder="acme-tecnologia"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    required
                  />
                </div>
                <span className="text-[10px] text-slate-400">Usado no subdomínio e isolamento RLS.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  CNPJ / Documento
                </label>
                <Input
                  placeholder="00.000.000/0001-00"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email do Administrador Responsável
              </label>
              <Input
                type="email"
                placeholder="admin@empresa.com.br"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Plano Contratado
                </label>
                <Select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as any)}
                >
                  <option value="Trial">Trial (1K msgs · 1 Agente)</option>
                  <option value="Starter">Starter (5K msgs · 2 Agentes)</option>
                  <option value="Pro">Pro (25K msgs · 5 Agentes)</option>
                  <option value="Enterprise">Enterprise (100K msgs · 15 Agentes)</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Provedor de IA Padrão
                </label>
                <Select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value as any)}
                >
                  <option value="openai">OpenAI (GPT-4o Mini / 4o)</option>
                  <option value="gemini">Google Gemini (Flash 1.5)</option>
                  <option value="hybrid">Híbrido (Multi-Model Routing)</option>
                </Select>
              </div>
            </div>

            <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-3 flex items-start gap-2 text-xs text-indigo-900">
              <Sparkles className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
              <p>
                Os limites de tokens e mensagens serão associados automaticamente à tabela <code className="font-mono text-indigo-700">company_limits</code> do tenant.
              </p>
            </div>
          </div>
        )}

        {!success && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? "Provisionando..." : "Criar Empresa"}
            </Button>
          </DialogFooter>
        )}
      </form>
    </Dialog>
  )
}
