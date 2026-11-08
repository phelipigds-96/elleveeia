"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Building2, CheckCircle2, Shield, AlertCircle, Kanban, Copy, Check, Key } from "lucide-react"
import { WORKFLOW_TEMPLATES, WorkflowTemplate } from "@/lib/services/workflows/template-catalog"
import { getPlatformWorkflowTemplatesList } from "@/lib/services/workflows/templates-service"
import { CompanyMock } from "./mock-companies"
import { createCompanyAction } from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

interface CompanyFormProps {
  open: boolean
  onClose: () => void
  onSave?: (newCompany: Partial<CompanyMock>) => void
}

export default function CompanyForm({ open, onClose, onSave }: CompanyFormProps) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [cnpj, setCnpj] = useState("")
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [createdCredentials, setCreatedCredentials] = useState<{
    email?: string | null
    password?: string | null
    slug?: string
    name?: string
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const [plan, setPlan] = useState<"Trial" | "Starter" | "Pro" | "Enterprise">("Pro")
  const [aiProvider, setAiProvider] = useState<"openai" | "gemini" | "hybrid">("openai")
  const [workflowTemplateKey, setWorkflowTemplateKey] = useState<string>("none")
  const [dynamicTemplates, setDynamicTemplates] = useState<WorkflowTemplate[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (open) {
      getPlatformWorkflowTemplatesList()
        .then((list) => {
          if (list && list.length > 0) setDynamicTemplates(list)
        })
        .catch(() => {})
    }
  }, [open])

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
    if (errorMessage) setErrorMessage(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const res = await createCompanyAction({
        name,
        slug,
        plan,
        aiProvider,
        cnpj,
        adminEmail,
        adminPassword,
        workflowTemplateKey,
      })

      if (!res.success) {
        setErrorMessage(res.error || "Falha ao provisionar a empresa.")
        toast.error("Erro ao cadastrar empresa", res.error || "Falha ao provisionar a empresa.")
        setIsSubmitting(false)
        return
      }

      toast.success(
        "Empresa provisionada com sucesso",
        `A organização "${name}" (@${res.data?.slug || slug}) foi criada no banco de dados.`
      )
      setCreatedCredentials({
        name: res.data?.name || name,
        slug: res.data?.slug || slug,
        email: res.data?.adminEmail || adminEmail,
        password: res.data?.adminPassword || adminPassword || null,
      })
      setSuccess(true)
      setIsSubmitting(false)

      if (onSave) {
        onSave({
          id: res.data?.id,
          name,
          slug: res.data?.slug || slug,
          cnpj: cnpj || "00.000.000/0001-00",
          plan,
          status: "Ativo",
          aiProvider,
          createdAt: new Date().toISOString().split("T")[0],
          adminEmail: res.data?.adminEmail || adminEmail || `admin@${res.data?.slug || slug}.com`,
        })
      }

      router.refresh()
    } catch (err: any) {
      setErrorMessage(err.message || "Erro inesperado ao conectar ao servidor.")
      setIsSubmitting(false)
    }
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
                Provisione uma nova organização com isolamento de dados e limites no banco.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {errorMessage && (
          <div className="mt-3 p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {success ? (
          <div className="py-6 flex flex-col items-center justify-center text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-[#F4F8E8] border border-[#D5E89B] text-[#3D5215] flex items-center justify-center animate-in zoom-in">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-display text-base font-bold text-ellevee-ink">Empresa Provisionada com Sucesso</h4>
              <p className="text-xs text-ellevee-sage mt-0.5">
                Organização, limites, funil e conta de acesso foram criados no Supabase.
              </p>
            </div>

            {createdCredentials && (
              <div className="w-full text-left bg-[#FBFBFA] border border-ellevee-stone rounded-lg p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-ellevee-stone/60">
                  <span className="font-semibold text-ellevee-ink font-display">Credenciais de Acesso da Loja</span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = `Acesso Ellevee IA\nOrganização: ${createdCredentials.name} (@${createdCredentials.slug})\nLogin: ${createdCredentials.email || ""}\nSenha: ${createdCredentials.password || ""}`;
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-ellevee-ink hover:text-emerald-700 bg-white border border-ellevee-stone px-2 py-0.5 rounded shadow-2xs transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" />
                        Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copiar Acesso
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-ellevee-sage block text-[10px] uppercase font-mono">Organização</span>
                    <span className="font-semibold text-ellevee-ink">{createdCredentials.name}</span>
                    <span className="text-ellevee-sage font-mono text-[10px] block">@{createdCredentials.slug}</span>
                  </div>

                  <div>
                    <span className="text-ellevee-sage block text-[10px] uppercase font-mono">E-mail do Administrador</span>
                    <span className="font-mono font-medium text-ellevee-ink truncate block">
                      {createdCredentials.email || "Não informado"}
                    </span>
                  </div>
                </div>

                {createdCredentials.password && (
                  <div className="pt-2 border-t border-ellevee-stone/40">
                    <span className="text-ellevee-sage block text-[10px] uppercase font-mono">Senha Inicial</span>
                    <div className="inline-flex items-center gap-1.5 bg-white border border-ellevee-stone px-2 py-1 rounded font-mono text-xs font-bold text-ellevee-ink mt-0.5">
                      <Key className="h-3.5 w-3.5 text-ellevee-sage" />
                      {createdCredentials.password}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="w-full pt-2 flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setSuccess(false);
                  setName("");
                  setSlug("");
                  setCnpj("");
                  setAdminEmail("");
                  setAdminPassword("");
                  setCreatedCredentials(null);
                  setWorkflowTemplateKey("none");
                  setErrorMessage(null);
                  onClose();
                }}
                className="w-full font-semibold"
              >
                Concluir e Fechar
              </Button>
            </div>
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
                  onChange={(e) => {
                    setSlug(e.target.value)
                    if (errorMessage) setErrorMessage(null)
                  }}
                  required
                  className="font-mono text-xs"
                />
                <span className="text-[10px] text-ellevee-sage font-mono">Identificador único no banco de dados.</span>
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ellevee-ink mb-1">
                  Email do Responsável <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="email"
                  placeholder="admin@organizacao.com.br"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-ellevee-ink">
                    Senha Inicial
                  </label>
                  <span className="text-[10px] text-ellevee-sage font-medium">Opcional</span>
                </div>
                <Input
                  type="password"
                  placeholder="Gerar automaticamente"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
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

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-ellevee-ink flex items-center gap-1.5">
                  <Kanban className="h-3.5 w-3.5 text-ellevee-ink" />
                  Funil de Atendimento (Kanban)
                </label>
                <span className="text-[10px] text-ellevee-sage font-medium">Opcional</span>
              </div>
              <Select
                value={workflowTemplateKey}
                onChange={(e) => setWorkflowTemplateKey(e.target.value)}
              >
                <option value="none">Padrão da Plataforma (3 etapas básicas)</option>
                {(dynamicTemplates.length > 0 ? dynamicTemplates : Object.values(WORKFLOW_TEMPLATES)).map((tmpl) => (
                  <option key={tmpl.key} value={tmpl.key}>
                    {tmpl.label} ({tmpl.stages.length} etapas)
                  </option>
                ))}
              </Select>
              <p className="text-[10px] text-ellevee-sage mt-1">
                {workflowTemplateKey === "none"
                  ? "Provisiona o funil padrão com 3 etapas. Poderá ser personalizado a qualquer momento pelo Super Admin."
                  : (dynamicTemplates.find((t) => t.key === workflowTemplateKey)?.description ||
                     WORKFLOW_TEMPLATES[workflowTemplateKey]?.description)}
              </p>
            </div>

            <div className="rounded-md bg-[#FBFBFA] border border-ellevee-stone p-3 flex items-start gap-2 text-xs text-ellevee-ink">
              <Shield className="h-4 w-4 text-ellevee-sage shrink-0 mt-0.5" />
              <p className="text-[11px] text-ellevee-sage">
                A criação é atômica no Supabase: vincula limites padrão em <code className="font-mono text-ellevee-ink">company_limits</code> e gera trilha de auditoria.
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
