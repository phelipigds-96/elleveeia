import React from 'react'
import Link from 'next/link'
import { MessageSquare, ArrowRight, Bot, User, Clock } from 'lucide-react'
import { RecentActivityItem } from '@/lib/services/dashboard'

interface Props {
  items?: RecentActivityItem[]
}

export function RecentActivity({ items = [] }: Props) {
  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-xs text-gray-400">
        <MessageSquare className="h-8 w-8 text-gray-300 mb-2" />
        <p className="font-medium text-gray-600">Nenhum atendimento registrado no período</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Assim que uma nova mensagem for recebida pelo WhatsApp, ela aparecerá aqui instantaneamente.
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-ellevee-border/60">
      {items.map((item) => {
        const isHuman = item.status === 'human'
        const isClosed = item.status === 'closed'
        const isAi = item.status === 'open'

        return (
          <Link
            key={item.id}
            href={`/conversations?id=${item.id}`}
            className="flex items-center justify-between p-4 hover:bg-ellevee-warm-ivory/40 transition-colors group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Avatar com iniciais */}
              <div className="h-10 w-10 rounded-full bg-ellevee-warm-ivory text-ellevee-deep-ink border border-ellevee-border flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-105 transition-transform">
                {item.customerName.charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ellevee-deep-ink text-xs sm:text-sm truncate">
                    {item.customerName}
                  </span>
                  {item.customerPhone && (
                    <span className="text-[11px] text-ellevee-text-secondary font-mono truncate hidden sm:inline">
                      +{item.customerPhone}
                    </span>
                  )}
                </div>

                {/* Última Mensagem */}
                <p className="text-xs text-ellevee-text-secondary truncate max-w-[240px] sm:max-w-md mt-0.5">
                  {item.lastSenderType === 'agent' && (
                    <span className="font-medium text-ellevee-blue mr-1">IA:</span>
                  )}
                  {item.lastMessage}
                </p>
              </div>
            </div>

            {/* Status e Horário */}
            <div className="flex items-center gap-3 shrink-0 pl-3">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                  isAi
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : isHuman
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-ellevee-warm-ivory text-ellevee-text-secondary border border-ellevee-border'
                }`}
              >
                {isAi ? (
                  <>
                    <Bot className="h-3 w-3 text-emerald-600" />
                    IA Ativa
                  </>
                ) : isHuman ? (
                  <>
                    <User className="h-3 w-3 text-amber-600" />
                    Humano
                  </>
                ) : (
                  'Concluído'
                )}
              </span>

              <span className="text-[11px] text-ellevee-text-secondary whitespace-nowrap hidden sm:inline">
                {item.timeAgo}
              </span>

              <ArrowRight className="h-4 w-4 text-ellevee-text-secondary/50 group-hover:text-ellevee-deep-ink group-hover:translate-x-0.5 transition-all" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
