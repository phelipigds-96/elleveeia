"use client"

import React, { useState } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Building2, CheckCircle2, Shield } from "lucide-react"
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
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink flex items-center justify-center">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Nova Empresa / Tenant</DialogTitle>
              <DialogDescription>
                Provisione uma nova organização com isolamento de dados e limites.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-[#F4F8E8] border border-[#D5E89B] text-[#3D5215] flex items-center justify-center animate-in zoom-in">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h4 className="font-display text-base font-bold text-ellevee-ink">Empresa Provisionada com Sucesso</h4>
            <p className="text-xs text-ellevee-sage">As políticas RLS e quotas da nova organização foram estabelecidas.</p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-ink mb-1">
                Nome da Empresa <span className="text-rose-500">*</span>
              </label>
              <Input
                placeholder="Ex: Alfa Logística Corporativa Ltda"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ellevee-ink mb-1">
                  Slug do Tenant (Identificador Único)
                </label>
                <Input
                  placeholder="alfa-logistica"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                  className="font-mono text-xs"
                />
                <span className="text-[10px] text-ellevee-sage font-mono">Identificador no isolamento RLS.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ellevee-ink mb-1">
                  CNPJ / Documento Fiscal
                </label>
                <Input
                  placeholder="00.000.000/0001-00"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-ink mb-1">
                Email do Administrador Responsável
              </label>
              <Input
                type="email"
                placeholder="admin@organizacao.com.br"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-ellevee-ink mb-1">
                  Plano Contratado
                </label>
                <Select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as any)}
                >
                  <option value="Trial">Trial (1K msgs · 1 Agente)</option>
                  <option value="Starter">Starter (5K msgs · 2 Agentes)</option>
                  <option value="Pro">Pro (25K msgs · 5 Agentes)</option>
                  <option value="Enterprise">Enterprise (100K msgs · 15+ Agentes)</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ellevee-ink mb-1">
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

            <div className="rounded-md bg-[#FBFBFA] border border-ellevee-stone p-3 flex items-start gap-2 text-xs text-ellevee-ink">
              <Shield className="h-4 w-4 text-ellevee-sage shrink-0 mt-0.5" />
              <p className="text-[11px] text-ellevee-sage">
                A infraestrutura alocará automaticamente os registros na tabela de limites com isolamento criptográfico por tenant.
              </p>
            </div>
          </div>
        )}

        {!success && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="default" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? "Provisionando..." : "Criar Empresa"}
            </Button>
          </DialogFooter>
        )}
      </form>
    </Dialog>
  )
}
