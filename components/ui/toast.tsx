"use client"

import React, { useEffect, useState } from "react"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"

export interface ToastItem {
  id: string
  title: string
  description?: string
  variant?: "default" | "success" | "destructive" | "info"
  duration?: number
}

type ToastListener = (toast: ToastItem) => void
const listeners = new Set<ToastListener>()

export const toast = {
  success: (title: string, description?: string, duration = 4000) => {
    emit({
      id: Math.random().toString(36).substring(2, 9),
      title,
      description,
      variant: "success",
      duration,
    })
  },
  error: (title: string, description?: string, duration = 5000) => {
    emit({
      id: Math.random().toString(36).substring(2, 9),
      title,
      description,
      variant: "destructive",
      duration,
    })
  },
  info: (title: string, description?: string, duration = 4000) => {
    emit({
      id: Math.random().toString(36).substring(2, 9),
      title,
      description,
      variant: "info",
      duration,
    })
  },
}

function emit(toastItem: ToastItem) {
  listeners.forEach((listener) => listener(toastItem))
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const handleAddToast = (newToast: ToastItem) => {
      setToasts((prev) => [...prev, newToast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newToast.id))
      }, newToast.duration || 4000)
    }

    listeners.add(handleAddToast)
    return () => {
      listeners.delete(handleAddToast)
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 pointer-events-none max-w-sm w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg border p-3.5 shadow-2xl flex items-start gap-3 transition-all duration-200 animate-in slide-in-from-bottom-5 ${
            t.variant === "destructive"
              ? "bg-[#251515] border-rose-800/80 text-white"
              : t.variant === "success"
              ? "bg-ellevee-ink text-white border-white/10"
              : "bg-white text-ellevee-ink border-ellevee-stone"
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {t.variant === "destructive" ? (
              <AlertCircle className="h-4 w-4 text-rose-400" />
            ) : t.variant === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-ellevee-accent" />
            ) : (
              <Info className="h-4 w-4 text-ellevee-sage" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold leading-tight font-display">{t.title}</p>
            {t.description && (
              <p
                className={`text-[11px] mt-0.5 leading-snug font-sans ${
                  t.variant === "destructive" ? "text-rose-200" : "text-[#A6B5A6]"
                }`}
              >
                {t.description}
              </p>
            )}
          </div>
          <button
            onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
            className="text-white/60 hover:text-white shrink-0 p-0.5"
            aria-label="Fechar notificação"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
