import { createClient } from '@/lib/supabase/server'

export type DashboardMetrics = {
  total_conversations: number
  open_conversations: number
  transfers: number
  unique_customers: number
}

export async function getDashboardMetrics(period: 'today' | '7days' | '30days'): Promise<DashboardMetrics> {
  const supabase = createClient()
  
  let days = 0
  if (period === '7days') days = 7
  if (period === '30days') days = 30

  const { data, error } = await supabase.rpc('get_dashboard_metrics', {
    p_days: days
  })

  if (error || !data) {
    console.error('Error fetching dashboard metrics:', error)
    return {
      total_conversations: 0,
      open_conversations: 0,
      transfers: 0,
      unique_customers: 0
    }
  }

  // Typecast or handle json response
  const metrics = data as any
  if (metrics.error) {
    console.error('Server error fetching metrics:', metrics.error)
  }

  return {
    total_conversations: metrics.total_conversations || 0,
    open_conversations: metrics.open_conversations || 0,
    transfers: metrics.transfers || 0,
    unique_customers: metrics.unique_customers || 0
  }
}
