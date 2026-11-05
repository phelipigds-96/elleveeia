"use client"

import React, { useState } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react"
import { CompanyMock } from "./mock-companies"

interface CompanyStatusDialogProps {
  company: CompanyMock | null
  open: boolean
  onClose: () => void
  onSave?: (updated: CompanyMock) => void
}

export default function CompanyStatusDialog({
  company,
  open,
  onClose,
  onSave,
}: CompanyStatusDialogProps) {
  const [reason, setReason] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  if (!company) return null

  const isSuspending = company.status === "Ativo"

  const handleConfirm = () => {
    setIsProcessing(true)
    setTimeout(() => {
      setIsProcessing(false)
      if (onSave) {
        onSave({
          ...company,
          status: isSuspending ? "Suspenso" : "Ativo",
        })
      }
      setReason("")
      onClose()
    }, 500)
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <div className="flex items-center gap-2.5">
          <div
            className={`h-8 w-8 rounded-md flex items-center justify-center border ${
              isSuspending
                ? "bg-rose-50 border-rose-200 text-rose-600"
                : "bg-[#F4F8E8] border-[#D5E89B] text-[#3D5215]"
            }`}
          >
            {isSuspending ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          </div>
          <div>
            <DialogTitle>
              {isSuspending ? "Suspender Acesso da Empresa" : "Reativar Acesso da Empresa"}
            </DialogTitle>
            <DialogDescription>
              {isSuspending
                ? `Bloqueio temporário das operações de ${company.name}.`
                : `Reativação operacional imediata de ${company.name}.`}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="py-4 space-y-3">
        {isSuspending ? (
          <div className="rounded-md bg-stone-50 border border-stone-200 p-3 text-xs text-ellevee-ink flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-ellevee-ink">Impacto no Motor Transacional:</p>
              <p className="mt-0.5 text-ellevee-sage">
                O tráfego de mensagens na outbox e o agendamento de agentes serão suspensos via RLS e Server Actions de forma segura.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ellevee-sage">
            A empresa terá suas permissões e agentes restabelecidos imediatamente para atendimento e fluxos autônomos.
          </p>
        )}

        {isSuspending && (
          <div>
            <label className="block text-xs font-semibold text-ellevee-ink mb-1">
              Justificativa Operacional (Auditoria)
            </label>
            <textarea
              className="w-full h-20 rounded-md border border-ellevee-stone bg-white p-2.5 text-xs text-ellevee-ink focus:outline-none focus:ring-1 focus:ring-ellevee-ink placeholder:text-ellevee-sage/70"
              placeholder="Ex: Pendência de faturamento, solicitação contratual ou manutenção programada."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isProcessing}>
          Cancelar
        </Button>
        <Button
          variant={isSuspending ? "destructive" : "default"}
          onClick={handleConfirm}
          disabled={isProcessing}
        >
          {isProcessing
            ? "Processando..."
            : isSuspending
            ? "Confirmar Suspensão"
            : "Reativar Empresa"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
