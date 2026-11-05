"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react"
import { CompanyMock } from "./mock-companies"
import { updateCompanyStatusAction } from "@/app/(admin)/companies/actions"
import { toast } from "@/components/ui/toast"

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
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)

  if (!company) return null

  const isSuspending = company.status === "Ativo"

  const handleConfirm = async () => {
    setIsProcessing(true)
    try {
      const targetStatus = isSuspending ? "suspended" : "active"
      const result = await updateCompanyStatusAction(company.id, targetStatus, reason)

      if (result.success) {
        toast.success(
          isSuspending ? "Empresa suspensa com sucesso" : "Empresa reativada com sucesso",
          isSuspending
            ? `As operações de ${company.name} foram suspensas temporariamente.`
            : `O acesso e as operações de ${company.name} foram restabelecidos com sucesso.`
        )
        if (onSave) {
          onSave({
            ...company,
            status: isSuspending ? "Suspenso" : "Ativo",
          })
        }
        router.refresh()
        setReason("")
        onClose()
      } else {
        toast.error("Falha ao atualizar status", result.error || "Ocorreu um erro no servidor.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err.message || "Falha na comunicação com o servidor.")
    } finally {
      setIsProcessing(false)
    }
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
              disabled={isProcessing}
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
