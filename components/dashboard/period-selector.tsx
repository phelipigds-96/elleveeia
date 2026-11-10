'use client'

import React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Calendar } from 'lucide-react'

export function PeriodSelector() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPeriod = searchParams.get('period') || '7days'

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    router.push(`/dashboard?period=${value}`)
  }

  return (
    <div className="relative inline-flex items-center">
      <Calendar className="h-3.5 w-3.5 text-ellevee-text-secondary absolute left-3 pointer-events-none" />
      <select
        value={currentPeriod}
        onChange={handlePeriodChange}
        className="appearance-none pl-8 pr-8 py-2 bg-white border border-ellevee-border rounded-xl text-xs font-semibold text-ellevee-deep-ink shadow-2xs hover:bg-ellevee-warm-ivory/50 focus:outline-none focus:ring-1 focus:ring-ellevee-blue focus:border-ellevee-blue cursor-pointer transition-colors"
      >
        <option value="today">Hoje (24 horas)</option>
        <option value="7days">Últimos 7 dias</option>
        <option value="30days">Últimos 30 dias</option>
      </select>
      <div className="pointer-events-none absolute right-2.5 text-ellevee-text-secondary text-xs">
        ▾
      </div>
    </div>
  )
}
