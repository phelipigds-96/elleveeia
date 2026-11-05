import React from "react"
import { ShieldCheck, Clock, UserCheck, AlertTriangle } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const MOCK_AUDIT_LOGS = [
  {
    id: "log-1",
    action: "company_limits_updated",
    target: "Coala Play Streaming (@coala-play)",
    actor: "Phelipi (SuperAdmin)",
    details: "Limite de mensagens expandido: 35.000 -> 50.000 msgs",
    timestamp: "Há 12 minutos",
    status: "success",
  },
  {
    id: "log-2",
    action: "company_plan_changed",
    target: "Clínica Bem Estar Odonto (@clinica-bem-estar)",
    actor: "Phelipi (SuperAdmin)",
    details: "Upgrade de plano: Starter -> Pro",
    timestamp: "Há 2 horas",
    status: "success",
  },
  {
    id: "log-3",
    action: "company_suspended",
    target: "Alpha Imóveis Prime (@alpha-imoveis)",
    actor: "Phelipi (SuperAdmin)",
    details: "Suspensão de acesso por inadimplência cadastral",
    timestamp: "Ontem às 18:42",
    status: "warning",
  },
  {
    id: "log-4",
    action: "tenant_provisioned",
    target: "Vanguard Advocacia (@vanguard-law)",
    actor: "Phelipi (SuperAdmin)",
    details: "Novo tenant criado com plano Trial de 14 dias",
    timestamp: "28/10/2026 14:15",
    status: "success",
  },
  {
    id: "log-5",
    action: "gateway_lock_reconciliation",
    target: "Worker Automático",
    actor: "Sistema Transacional",
    details: "Varredura periódica de outbox: 0 locks expirados",
    timestamp: "28/10/2026 10:00",
    status: "info",
  },
]

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 pb-2 border-b border-slate-200/80">
        <div className="h-9 w-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Auditoria & Governança</h1>
          <p className="text-xs text-slate-500">
            Registro imutável de todas as mutações administrativas no banco via triggers de auditoria.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ação</TableHead>
              <TableHead>Tenant Alvo</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead className="w-[380px]">Detalhes da Operação</TableHead>
              <TableHead className="text-right">Horário</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_AUDIT_LOGS.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <span className="font-mono text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded">
                    {log.action}
                  </span>
                </TableCell>
                <TableCell className="font-semibold text-xs text-slate-800">
                  {log.target}
                </TableCell>
                <TableCell className="text-xs text-slate-600 flex items-center gap-1.5 pt-4">
                  <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                  {log.actor}
                </TableCell>
                <TableCell className="text-xs text-slate-600">
                  {log.details}
                </TableCell>
                <TableCell className="text-xs text-slate-400 text-right font-mono">
                  {log.timestamp}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
