'use client'

import React, { useState } from 'react'
import { Sparkles, BarChart2 } from 'lucide-react'

export interface ChartDataPoint {
  label: string
  dateStr: string
  value: number
  isPeak?: boolean
}

export function ActivityChart({ data = [] }: { data?: ChartDataPoint[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-56 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl p-6">
        <BarChart2 className="h-8 w-8 text-gray-300 mb-2" />
        <p className="font-medium text-gray-600">Aguardando novos atendimentos</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Suas conversas e picos de volume aparecerão aqui automaticamente.
        </p>
      </div>
    )
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const totalPeriod = data.reduce((acc, curr) => acc + curr.value, 0)
  const peakPoint = data.find((d) => d.isPeak)

  return (
    <div className="flex flex-col w-full h-full justify-between space-y-4">
      {/* Mini resumo do gráfico */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-gray-500">
          <span className="h-2 w-2 rounded-full bg-[#005d4b]" />
          <span>Volume por dia</span>
        </div>
        {peakPoint && peakPoint.value > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
            <Sparkles className="h-3 w-3 text-emerald-600" />
            Pico: {peakPoint.value} convs ({peakPoint.label})
          </span>
        )}
      </div>

      {/* Área das Barras */}
      <div className="flex items-end justify-between h-48 w-full gap-2 pt-4 px-2">
        {data.map((item, i) => {
          const heightPercentage = Math.max(Math.round((item.value / maxValue) * 100), item.value > 0 ? 12 : 4)
          const isHovered = hoveredIndex === i

          return (
            <div
              key={i}
              className="flex flex-col items-center flex-1 h-full justify-end group relative cursor-pointer"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* Tooltip flutuante no hover */}
              <div
                className={`absolute -top-10 z-20 transition-all duration-200 pointer-events-none ${
                  isHovered ? 'opacity-100 scale-100 -translate-y-1' : 'opacity-0 scale-95'
                }`}
              >
                <div className="bg-gray-900 text-white text-[11px] font-medium py-1 px-2.5 rounded-lg shadow-lg whitespace-nowrap">
                  <span className="font-bold text-emerald-400">{item.value}</span> conversas
                  <span className="text-gray-400 text-[10px] block font-mono">{item.dateStr}</span>
                </div>
              </div>

              {/* Barra */}
              <div className="w-full relative h-36 flex items-end justify-center">
                <div
                  className={`w-full max-w-[38px] rounded-t-lg transition-all duration-300 relative overflow-hidden ${
                    item.value > 0
                      ? item.isPeak
                        ? 'bg-gradient-to-t from-[#005d4b] to-emerald-500 shadow-sm shadow-emerald-500/20'
                        : 'bg-gradient-to-t from-[#005d4b]/90 to-emerald-600/80 hover:to-emerald-500'
                      : 'bg-gray-100 group-hover:bg-gray-200'
                  }`}
                  style={{ height: `${heightPercentage}%` }}
                >
                  {/* Linha de brilho no topo da barra */}
                  {item.value > 0 && (
                    <div className="absolute top-0 left-0 right-0 h-1 bg-white/40" />
                  )}
                </div>
              </div>

              {/* Rótulo inferior */}
              <span
                className={`text-[11px] mt-2 truncate w-full text-center transition-colors font-medium ${
                  isHovered || item.isPeak ? 'text-gray-900 font-bold' : 'text-gray-500'
                }`}
              >
                {item.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Rodapé informativo */}
      <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span>
          Total contabilizado: <strong className="text-gray-900">{totalPeriod} conversas</strong>
        </span>
        <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/50">
          ● Tempo de resposta: &lt; 15 seg
        </span>
      </div>
    </div>
  )
}
