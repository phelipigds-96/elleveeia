"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Award, Check } from "lucide-react"
import { CompanyMock } from "./mock-companies"
import { updateCompanyPlanAction } from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

interface CompanyPlanDialogProps {
  company: CompanyMock | null
  open: boolean
  onClose: () => void
  onSave?: (updated: CompanyMock) => void
}

const PLANS = [
  {
    name: "Trial",
    badge: "outline" as const,
    price: "Grátis",
    msgs: "1.000 msgs/mês",
    tokens: "100K tokens",
    agents: "1 agente",
  },
  {
    name: "Starter",
    badge: "secondary" as const,
    price: "R$ 490/mês",
    msgs: "5.000 msgs/mês",
    tokens: "500K tokens",
    agents: "2 agentes",
  },
  {
    name: "Pro",
    badge: "default" as const,
    price: "R$ 1.490/mês",
    msgs: "25.000 msgs/mês",
    tokens: "2.0M tokens",
    agents: "5 agentes",
  },
  {
    name: "Enterprise",
    badge: "accent" as const,
    price: "Sob Consulta",
    msgs: "100.000 msgs/mês",
    tokens: "10.0M tokens",
    agents: "15+ agentes",
  },
] as const

export default function CompanyPlanDialog({
  company,
  open,
  onClose,
  onSave,
}: CompanyPlanDialogProps) {
  const router = useRouter()
  const [selectedPlan, setSelectedPlan] = useState<"Trial" | "Starter" | "Pro" | "Enterprise">("Pro")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (company) setSelectedPlan(company.plan)
  }, [company])

  if (!company) return null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const result = await updateCompanyPlanAction(company.id, selectedPlan)

      if (result.success) {
        toast.success(
          "Plano atualizado com sucesso",
          `O plano de ${company.name} foi atualizado para ${selectedPlan}.`
        )

        const defaultLimits = {
          Trial: { msgs: 1000, agents: 1, tokens: 100000 },
          Starter: { msgs: 5000, agents: 2, tokens: 500000 },
          Pro: { msgs: 25000, agents: 5, tokens: 2000000 },
          Enterprise: { msgs: 100000, agents: 15, tokens: 10000000 },
        }[selectedPlan]

        if (onSave) {
          onSave({
            ...company,
            plan: selectedPlan,
            messagesLimit: defaultLimits.msgs,
            maxAgents: defaultLimits.agents,
            tokensLimit: defaultLimits.tokens,
          })
        }

        router.refresh()
        onClose()
      } else {
        toast.error("Falha ao alterar plano", result.error || "Ocorreu um erro no servidor.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha na comunicação com o servidor.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-ellevee-warm-ivory border border-ellevee-border text-ellevee-deep-ink flex items-center justify-center">
            <Award className="h-4 w-4 text-ellevee-purple" />
          </div>
          <div>
            <DialogTitle className="font-display text-base font-bold text-ellevee-deep-ink">Alterar Plano Contratado</DialogTitle>
            <DialogDescription className="text-xs text-ellevee-text-secondary">
              Selecione o tier de assinatura para <span className="font-semibold text-ellevee-deep-ink">{company.name}</span>
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-4">
        {PLANS.map((p) => {
          const isSelected = selectedPlan === p.name
          return (
            <div
              key={p.name}
              onClick={() => setSelectedPlan(p.name as any)}
              className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                isSelected
                  ? "border-ellevee-purple bg-ellevee-warm-ivory/40 shadow-card ring-1 ring-ellevee-purple/30"
                  : "border-ellevee-border hover:border-ellevee-purple/40 bg-white"
              }`}
            >
              {isSelected && (
                <div className="absolute top-3.5 right-3.5 h-4 w-4 rounded-full bg-ellevee-purple text-white flex items-center justify-center">
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-sm text-ellevee-deep-ink">{p.name}</span>
                <Badge variant={p.badge}>{p.price}</Badge>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-ellevee-text-secondary font-mono">
                <li>• {p.msgs}</li>
                <li>• {p.tokens}</li>
                <li>• {p.agents}</li>
              </ul>
            </div>
          )
        })}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving} className="border-ellevee-border text-ellevee-deep-ink">
          Cancelar
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Atualizando..." : "Confirmar Alteração de Plano"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
