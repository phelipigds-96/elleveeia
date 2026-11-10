import React from 'react'
import { LucideIcon, TrendingUp } from 'lucide-react'

interface MetricCardProps {
  title: string
  value: number | string
  description: string
  Icon: LucideIcon
  badge?: string
  trend?: string
  accentColor?: 'emerald' | 'violet' | 'amber' | 'blue'
}

export function MetricCard({
  title,
  value,
  description,
  Icon,
  badge,
  trend,
  accentColor = 'emerald',
}: MetricCardProps) {
  const colorMap = {
    emerald: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-700',
      border: 'border-emerald-500/20',
      glow: 'group-hover:border-emerald-300',
    },
    violet: {
      bg: 'bg-violet-500/10',
      text: 'text-violet-700',
      border: 'border-violet-500/20',
      glow: 'group-hover:border-violet-300',
    },
    amber: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-700',
      border: 'border-amber-500/20',
      glow: 'group-hover:border-amber-300',
    },
    blue: {
      bg: 'bg-sky-500/10',
      text: 'text-sky-700',
      border: 'border-sky-500/20',
      glow: 'group-hover:border-sky-300',
    },
  }

  const c = colorMap[accentColor] || colorMap.emerald

  return (
    <div
      className={`group relative bg-white rounded-2xl border border-gray-200/90 p-5 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between ${c.glow}`}
    >
      <div>
        <div className="flex items-center justify-between pb-3">
          <span className="text-xs font-semibold text-gray-500 tracking-tight uppercase">
            {title}
          </span>
          <div
            className={`h-9 w-9 rounded-xl ${c.bg} ${c.text} ${c.border} border flex items-center justify-center shrink-0 transition-transform group-hover:scale-105`}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-bold font-display tracking-tight text-gray-900">
            {value}
          </div>
          {trend && (
            <span className="inline-flex items-center text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60">
              <TrendingUp className="h-3 w-3 mr-0.5" />
              {trend}
            </span>
          )}
        </div>
      </div>

      <div className="pt-3 mt-2 border-t border-gray-100 flex items-center justify-between">
        <p className="text-xs text-gray-500 font-medium">{description}</p>
        {badge && (
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
            {badge}
          </span>
        )}
      </div>
    </div>
  )
}

export function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-2xs flex flex-col animate-pulse">
      <div className="flex items-center justify-between pb-3">
        <div className="h-3 w-1/3 bg-gray-200 rounded"></div>
        <div className="h-9 w-9 bg-gray-200 rounded-xl"></div>
      </div>
      <div>
        <div className="h-8 w-1/2 bg-gray-200 rounded mb-2"></div>
        <div className="h-3 w-2/3 bg-gray-100 rounded"></div>
      </div>
    </div>
  )
}
