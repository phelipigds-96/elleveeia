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
      <Calendar className="h-3.5 w-3.5 text-gray-500 absolute left-3 pointer-events-none" />
      <select
        value={currentPeriod}
        onChange={handlePeriodChange}
        className="appearance-none pl-8 pr-8 py-2 bg-white border border-gray-200/90 rounded-xl text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b] cursor-pointer transition-colors"
      >
        <option value="today">Hoje (24 horas)</option>
        <option value="7days">Últimos 7 dias</option>
        <option value="30days">Últimos 30 dias</option>
      </select>
      <div className="pointer-events-none absolute right-2.5 text-gray-400 text-xs">
        ▾
      </div>
    </div>
  )
}
