"use client"

import React, { useState, useEffect } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Award, Check } from "lucide-react"
import { CompanyMock } from "./mock-companies"

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
  const [selectedPlan, setSelectedPlan] = useState<"Trial" | "Starter" | "Pro" | "Enterprise">("Pro")
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (company) setSelectedPlan(company.plan)
  }, [company])

  if (!company) return null

  const handleSave = () => {
    setIsSaving(true)
    setTimeout(() => {
      setIsSaving(false)
      if (onSave) {
        onSave({
          ...company,
          plan: selectedPlan,
        })
      }
      onClose()
    }, 400)
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md bg-[#F3F2ED] border border-ellevee-stone text-ellevee-ink flex items-center justify-center">
            <Award className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle>Alterar Plano Contratado</DialogTitle>
            <DialogDescription>
              Selecione o tier de assinatura para <span className="font-semibold text-ellevee-ink">{company.name}</span>
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
              className={`p-4 rounded-lg border transition-all cursor-pointer relative ${
                isSelected
                  ? "border-ellevee-ink bg-[#FBFBFA] shadow-sm ring-1 ring-ellevee-ink/10"
                  : "border-ellevee-stone hover:border-ellevee-ink/40 bg-white"
              }`}
            >
              {isSelected && (
                <div className="absolute top-3.5 right-3.5 h-4 w-4 rounded-full bg-ellevee-ink text-white flex items-center justify-center">
                  <Check className="h-2.5 w-2.5 stroke-[3]" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-sm text-ellevee-ink">{p.name}</span>
                <Badge variant={p.badge}>{p.price}</Badge>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-ellevee-sage font-mono">
                <li>• {p.msgs}</li>
                <li>• {p.tokens}</li>
                <li>• {p.agents}</li>
              </ul>
            </div>
          )
        })}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSaving}>
          Cancelar
        </Button>
        <Button variant="default" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Atualizando..." : "Confirmar Alteração de Plano"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
