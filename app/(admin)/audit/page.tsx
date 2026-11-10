import React from "react"
import { ShieldCheck, UserCheck, CheckCircle2, Clock, FileText, AlertCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getPlatformAuditLogs } from "@/lib/services/platform/admin-metrics"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Auditoria & Governança | SuperAdmin Ellevee IA",
  description: "Registro imutável de mutações operacionais e governança multi-tenant da plataforma.",
}

export default async function AuditPage() {
  const logs = await getPlatformAuditLogs(100)

  return (
    <div className="space-y-6">
      {/* Header com badge de Registro Oficial */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Auditoria & Governança
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
              Registro Imutável
            </span>
          </div>
          <p className="text-xs text-ellevee-text-secondary mt-1 font-sans">
            Trilha de auditoria oficial de provisionamento, mudanças de plano, limites e sessões administrativas.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-ellevee-border bg-white shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-ellevee-border bg-[#F8F8F6]">
              <TableHead className="w-[190px] text-ellevee-text-secondary">Operação</TableHead>
              <TableHead className="w-[240px] text-ellevee-text-secondary">Organização Alvo</TableHead>
              <TableHead className="w-[220px] text-ellevee-text-secondary">Responsável</TableHead>
              <TableHead className="text-ellevee-text-secondary">Detalhes da Transação</TableHead>
              <TableHead className="text-right w-[160px] text-ellevee-text-secondary">Registro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-xs text-ellevee-text-secondary">
                  Nenhum evento de auditoria registrado no banco até o momento.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id} className="hover:bg-ellevee-warm-ivory/40 transition-colors border-b border-ellevee-border/60">
                  {/* Operação */}
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs font-semibold text-ellevee-deep-ink bg-ellevee-warm-ivory border border-ellevee-border px-2 py-0.5 rounded inline-block w-fit">
                        {log.action}
                      </span>
                      <span className="text-[10px] text-ellevee-text-secondary font-mono">
                        {log.rawAction}
                      </span>
                    </div>
                  </TableCell>

                  {/* Organização Alvo */}
                  <TableCell className="font-semibold text-xs text-ellevee-deep-ink font-display">
                    {log.target}
                  </TableCell>

                  {/* Responsável */}
                  <TableCell className="text-xs text-ellevee-text-secondary">
                    <div className="flex items-center gap-1.5 truncate">
                      <UserCheck className="h-3.5 w-3.5 text-ellevee-text-secondary shrink-0" />
                      <span className="font-medium text-ellevee-deep-ink truncate" title={log.actorEmail}>
                        {log.actorEmail}
                      </span>
                    </div>
                  </TableCell>

                  {/* Detalhes */}
                  <TableCell className="text-xs text-ellevee-deep-ink font-sans">
                    <div>{log.details}</div>
                    {log.reason && log.reason !== log.details && (
                      <div className="text-[11px] text-ellevee-text-secondary italic mt-0.5">
                        Motivo: {log.reason}
                      </div>
                    )}
                  </TableCell>

                  {/* Timestamp */}
                  <TableCell className="text-xs text-right">
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-ellevee-deep-ink font-medium">
                        {log.timestamp}
                      </span>
                      <span className="text-[10px] text-ellevee-text-secondary font-mono">
                        {log.relativeTime}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="px-6 py-3 border-t border-ellevee-border bg-[#F8F8F6] flex items-center justify-between text-xs text-ellevee-text-secondary">
          <span className="font-mono">
            Mostrando <strong>{logs.length}</strong> eventos de auditoria gravados no PostgreSQL
          </span>
          <span className="text-[11px] font-mono text-ellevee-text-secondary">
            Engine: PostgreSQL Service Role + Platform Audit Logs
          </span>
        </div>
      </div>
    </div>
  )
}
