import React from 'react'
import Link from 'next/link'
import {
  MessageSquare,
  Bot,
  Zap,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ArrowUpRight
} from 'lucide-react'
import { IntegrationStatusItem } from '@/lib/services/dashboard'

interface Props {
  items?: IntegrationStatusItem[]
}

export function IntegrationStatus({ items = [] }: Props) {
  const getIcon = (key: string) => {
    switch (key) {
      case 'whatsapp':
        return (
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.086.159.058 1.011.477 1.184.564.173.087.289.13.332.202.043.072.043.419-.101.824z" />
            </svg>
          </div>
        )
      case 'ai':
        return (
          <div className="h-8 w-8 rounded-lg bg-violet-500/10 text-violet-700 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4" />
          </div>
        )
      case 'n8n':
        return (
          <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-700 border border-sky-500/20 flex items-center justify-center shrink-0">
            <Zap className="h-4 w-4" />
          </div>
        )
      case 'catalog':
      default:
        return (
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 flex items-center justify-center shrink-0">
            <ShoppingBag className="h-4 w-4" />
          </div>
        )
    }
  }

  if (!items || items.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-500">
        Nenhuma integração carregada.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isConnected = item.status === 'connected'

        return (
          <Link
            key={item.key}
            href={item.href}
            className="flex items-center justify-between p-3 rounded-xl bg-gray-50/70 hover:bg-white border border-gray-100 hover:border-gray-200 transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              {getIcon(item.key)}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-semibold text-gray-900 truncate">
                    {item.name}
                  </p>
                  <ArrowUpRight className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-[11px] text-gray-500 truncate max-w-[210px] sm:max-w-xs">
                  {item.description}
                </p>
              </div>
            </div>

            <div className="shrink-0 pl-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  isConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                    : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
                  }`}
                />
                {item.statusText}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
