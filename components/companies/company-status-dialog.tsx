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
        <div className="flex items-center gap-2">
          <div
            className={`h-8 w-8 rounded-lg flex items-center justify-center ${
              isSuspending
                ? "bg-rose-50 border border-rose-200 text-rose-600"
                : "bg-emerald-50 border border-emerald-200 text-emerald-600"
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
                ? `Você está prestes a bloquear o acesso de ${company.name}.`
                : `Você está reativando as operações de ${company.name}.`}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div className="py-4 space-y-3">
        {isSuspending ? (
          <div className="rounded-lg bg-rose-50 border border-rose-200/80 p-3 text-xs text-rose-900 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Efeito Imediato no Motor Transacional:</p>
              <p className="mt-1 text-rose-800">
                O envio e recebimento de mensagens e o ciclo autônomo dos agentes desta empresa serão suspensos no banco via RLS e Server Actions.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-600">
            A empresa terá suas credenciais e agentes reabilitados imediatamente para atendimento e disparos.
          </p>
        )}

        {isSuspending && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Motivo da Suspensão (Registrado em Auditoria)
            </label>
            <textarea
              className="w-full h-20 rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-600 placeholder:text-slate-400"
              placeholder="Ex: Inadimplência na fatura, solicitação do cliente ou violação de termos de uso."
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
          variant={isSuspending ? "destructive" : "primary"}
          onClick={handleConfirm}
          disabled={isProcessing}
        >
          {isProcessing
            ? "Processando..."
            : isSuspending
            ? "Confirmar Bloqueio"
            : "Reativar Empresa"}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
