import React from "react"
import { ShieldCheck, UserCheck, CheckCircle2, Clock, FileText } from "lucide-react"
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
    statusBadge: "outline" as const,
  },
  {
    id: "log-2",
    action: "company_plan_changed",
    target: "Clínica Bem Estar Odonto (@clinica-bem-estar)",
    actor: "Phelipi (SuperAdmin)",
    details: "Upgrade de plano: Starter -> Pro (25.000 msgs/mês)",
    timestamp: "Há 2 horas",
    statusBadge: "default" as const,
  },
  {
    id: "log-3",
    action: "company_suspended",
    target: "Alpha Imóveis Prime (@alpha-imoveis)",
    actor: "Phelipi (SuperAdmin)",
    details: "Suspensão de acesso por pendência cadastral e faturamento",
    timestamp: "Ontem às 18:42",
    statusBadge: "destructive" as const,
  },
  {
    id: "log-4",
    action: "tenant_provisioned",
    target: "Vanguard Advocacia (@vanguard-law)",
    actor: "Phelipi (SuperAdmin)",
    details: "Novo tenant criado com plano Trial de 14 dias (1.000 msgs)",
    timestamp: "28/10/2026 14:15",
    statusBadge: "accent" as const,
  },
  {
    id: "log-5",
    action: "gateway_lock_reconciliation",
    target: "Worker Automático",
    actor: "Sistema Transacional",
    details: "Varredura periódica de outbox: 0 locks expirados, fila saudável",
    timestamp: "28/10/2026 10:00",
    statusBadge: "secondary" as const,
  },
]

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-stone">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-ink">
              Auditoria & Governança
            </h1>
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider text-ellevee-sage">
              Simulação
            </Badge>
          </div>
          <p className="text-xs text-ellevee-sage mt-1 font-sans">
            Registro imutável de mutações operacionais e governança multi-tenant da plataforma.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-ellevee-stone bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Operação</TableHead>
              <TableHead className="w-[260px]">Organização Alvo</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead className="w-[360px]">Detalhes da Transação</TableHead>
              <TableHead className="text-right">Registro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_AUDIT_LOGS.map((log) => (
              <TableRow key={log.id} className="hover:bg-[#FBFBFA]">
                <TableCell>
                  <span className="font-mono text-xs font-semibold text-ellevee-ink bg-[#F3F2ED] border border-ellevee-stone px-2 py-0.5 rounded">
                    {log.action}
                  </span>
                </TableCell>
                <TableCell className="font-semibold text-xs text-ellevee-ink">
                  {log.target}
                </TableCell>
                <TableCell className="text-xs text-ellevee-sage">
                  <div className="flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-ellevee-sage" />
                    <span className="font-medium text-ellevee-ink">{log.actor}</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-ellevee-sage font-sans">
                  {log.details}
                </TableCell>
                <TableCell className="text-xs text-ellevee-sage text-right font-mono">
                  {log.timestamp}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="px-6 py-3 border-t border-ellevee-stone bg-[#FBFBFA] flex items-center justify-between text-xs text-ellevee-sage">
          <span className="font-mono">
            Mostrando 5 eventos de auditoria gravados
          </span>
          <span className="text-[11px] font-mono text-ellevee-sage">
            Engine: PostgreSQL Triggers + Immutable Log Table
          </span>
        </div>
      </div>
    </div>
  )
}
