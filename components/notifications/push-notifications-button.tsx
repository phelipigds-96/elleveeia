'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Loader2,
  Send,
  Share,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'

interface PushNotificationsButtonProps {
  variant?: 'dark' | 'light'
}

interface PushStatusResponse {
  configured: boolean
  publicKey: string | null
  migrationPending?: boolean
  currentDeviceActive: boolean
  hasCurrentDeviceRow: boolean
  activeDevicesCount: number
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

function detectIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
}

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    Boolean((window.navigator as any).standalone)
  )
}

function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Navegador'
  const ua = navigator.userAgent || ''
  if (/iPhone/i.test(ua)) return 'iPhone (PWA)'
  if (/iPad/i.test(ua)) return 'iPad (PWA)'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac/i.test(ua)) return 'Mac'
  return 'Navegador'
}

export function PushNotificationsButton({ variant = 'dark' }: PushNotificationsButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)

  const [isIos, setIsIos] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [supportsPush, setSupportsPush] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [statusData, setStatusData] = useState<PushStatusResponse | null>(null)
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null)
  const [localSubscribed, setLocalSubscribed] = useState(false)

  const syncDeviceState = useCallback(async () => {
    try {
      const ios = detectIosDevice()
      const standalone = detectStandaloneMode()
      const supported =
        typeof window !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window

      setIsIos(ios)
      setIsStandalone(standalone)
      setSupportsPush(supported)

      if (typeof Notification !== 'undefined') {
        setPermission(Notification.permission)
      }

      let endpoint: string | null = null

      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
          if (supported && registration.pushManager) {
            const sub = await registration.pushManager.getSubscription()
            if (sub) {
              endpoint = sub.endpoint
              setLocalSubscribed(true)
            } else {
              setLocalSubscribed(false)
            }
          }
        } catch (swErr) {
          console.warn('[Push] Falha ao registrar Service Worker:', swErr)
        }
      }

      setCurrentEndpoint(endpoint)

      const url = endpoint
        ? `/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`
        : '/api/push/subscribe'
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const json = (await res.json()) as PushStatusResponse
        setStatusData(json)
      }
    } catch (err) {
      console.warn('[Push] Erro ao sincronizar estado:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void syncDeviceState()
  }, [syncDeviceState])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const isDeviceSubscribedAndActive = Boolean(
    localSubscribed &&
      permission === 'granted' &&
      statusData?.hasCurrentDeviceRow &&
      statusData?.currentDeviceActive
  )

  const isDeviceMuted = Boolean(
    localSubscribed &&
      permission === 'granted' &&
      statusData?.hasCurrentDeviceRow &&
      !statusData?.currentDeviceActive
  )

  const handleEnableNotifications = async () => {
    if (!supportsPush) {
      toast.error('Navegador sem suporte a notificações push.')
      return
    }
    if (!statusData?.configured || !statusData?.publicKey) {
      toast.error('Chaves de notificação push ainda não configuradas no servidor.')
      return
    }

    setSubmitting(true)
    try {
      const resultPermission = await Notification.requestPermission()
      setPermission(resultPermission)

      if (resultPermission !== 'granted') {
        toast.error('Permissão negada no navegador. Libere nas configurações para receber alertas.')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await navigator.serviceWorker.ready

      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            statusData.publicKey
          ) as unknown as BufferSource,
        })
      }

      const subJson = subscription.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh || '',
              auth: subJson.keys?.auth || '',
            },
          },
          deviceLabel: getDeviceLabel(),
          active: true,
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || 'Falha ao salvar inscrição push.')
      }

      toast.success('Alertas ativados neste aparelho!')
      await syncDeviceState()
    } catch (err: any) {
      toast.error('Não foi possível ativar as notificações', err?.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleMute = async (nextActive: boolean) => {
    if (!currentEndpoint) {
      if (nextActive) {
        await handleEnableNotifications()
      }
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/push/subscribe', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: currentEndpoint,
          active: nextActive,
        }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || 'Falha ao atualizar alertas.')
      }

      toast.success(
        nextActive ? 'Alertas reativados neste aparelho.' : 'Alertas silenciados neste aparelho.'
      )
      await syncDeviceState()
    } catch (err: any) {
      toast.error('Erro ao alterar notificações', err?.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemoveDevice = async () => {
    setSubmitting(true)
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        const sub = await registration?.pushManager?.getSubscription()
        const endpointToDelete = sub?.endpoint || currentEndpoint
        if (sub) {
          await sub.unsubscribe().catch(() => undefined)
        }
        if (endpointToDelete) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: endpointToDelete }),
          })
        }
      }
      toast.info('Aparelho desconectado das notificações.')
      await syncDeviceState()
    } catch (err: any) {
      toast.error('Erro ao remover aparelho', err?.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSendTest = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: currentEndpoint }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || 'Falha ao disparar teste.')
      }
      toast.success('Notificação de teste enviada!')
    } catch (err: any) {
      toast.error('Não foi possível enviar teste', err?.message)
      await syncDeviceState()
    } finally {
      setTesting(false)
    }
  }

  const needsIosInstall = isIos && !isStandalone

  const buttonClasses =
    variant === 'dark'
      ? 'p-1.5 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors relative cursor-pointer'
      : 'h-8 w-8 rounded-lg border border-ellevee-border bg-white hover:bg-slate-50 text-ellevee-text-secondary hover:text-ellevee-deep-ink flex items-center justify-center transition-colors relative cursor-pointer shadow-2xs'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void syncDeviceState()
        }}
        className={buttonClasses}
        title={
          isDeviceSubscribedAndActive
            ? 'Notificações ativas neste aparelho'
            : isDeviceMuted
              ? 'Notificações silenciadas neste aparelho'
              : 'Ativar notificações no aparelho'
        }
        aria-label="Notificações push"
      >
        {isDeviceSubscribedAndActive ? (
          <BellRing className="h-4 w-4" />
        ) : isDeviceMuted ? (
          <BellOff className="h-4 w-4 opacity-80" />
        ) : (
          <Bell className="h-4 w-4" />
        )}

        {!loading && isDeviceSubscribedAndActive && (
          <span
            className={`absolute ${
              variant === 'dark' ? 'top-1 right-1 ring-[#073D4A]' : 'top-1 right-1 ring-white'
            } h-2 w-2 rounded-full bg-emerald-400 ring-2`}
          />
        )}
        {!loading && isDeviceMuted && (
          <span
            className={`absolute ${
              variant === 'dark' ? 'top-1 right-1 ring-[#073D4A]' : 'top-1 right-1 ring-white'
            } h-2 w-2 rounded-full bg-amber-400 ring-2`}
          />
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-label="Configurações de notificação"
            className="fixed inset-x-3 top-14 sm:inset-x-auto sm:right-4 sm:top-14 sm:w-80 z-50 rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl p-4 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                  <Smartphone className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 leading-tight">
                    Alertas no aparelho
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium mt-0.5">
                    {isDeviceSubscribedAndActive ? (
                      <span className="text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Ativo neste aparelho
                      </span>
                    ) : isDeviceMuted ? (
                      <span className="text-amber-700">Silenciado neste aparelho</span>
                    ) : permission === 'denied' ? (
                      <span className="text-rose-600">Bloqueado no navegador</span>
                    ) : needsIosInstall ? (
                      <span className="text-sky-700">Requer instalar na tela inicial</span>
                    ) : (
                      <span className="text-slate-500">Desativado neste aparelho</span>
                    )}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              Zero spam: você só recebe alerta quando um cliente precisar de atendimento humano ou responder em uma conversa sua.
            </p>

            {needsIosInstall ? (
              <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 space-y-1.5 text-xs text-sky-950">
                <p className="font-semibold flex items-center gap-1.5">
                  <Share className="h-3.5 w-3.5 text-sky-700" />
                  Para receber alertas no iPhone/iPad:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-sky-900">
                  <li>Toque no ícone <strong>Compartilhar</strong> do Safari.</li>
                  <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
                  <li>Abra o app pela tela inicial e toque no sino.</li>
                </ol>
              </div>
            ) : permission === 'denied' ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 leading-relaxed">
                A permissão de notificações está bloqueada neste navegador. Toque no cadeado ao lado do endereço do site (ou nas configurações do aparelho) e permita <strong>Notificações</strong>.
              </div>
            ) : !supportsPush ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
                Este navegador não suporta notificações Web Push neste modo.
              </div>
            ) : statusData?.migrationPending ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
                Banco de dados aguardando migração de notificações (<code className="font-mono">push_subscriptions</code>).
              </div>
            ) : !statusData?.configured ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
                As chaves VAPID de notificação ainda não foram configuradas no servidor.
              </div>
            ) : (
              <div className="space-y-2">
                {!localSubscribed || !statusData?.hasCurrentDeviceRow ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleEnableNotifications}
                    className="w-full h-10 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <BellRing className="h-4 w-4" />
                    )}
                    Ativar notificações neste aparelho
                  </button>
                ) : isDeviceMuted ? (
                  <>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleToggleMute(true)}
                      className="w-full h-10 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <BellRing className="h-4 w-4" />
                      )}
                      Reativar alertas neste aparelho
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleRemoveDevice}
                      className="w-full h-8 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover inscrição deste aparelho
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={testing || submitting}
                      onClick={handleSendTest}
                      className="w-full h-9 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {testing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Testar notificação agora
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleToggleMute(false)}
                      className="w-full h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {submitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5" />
                      )}
                      Silenciar neste aparelho
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleRemoveDevice}
                      className="w-full h-8 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Desconectar aparelho
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span>Sua conta</span>
              <span className="font-medium text-slate-700">
                {statusData?.activeDevicesCount
                  ? `${statusData.activeDevicesCount} aparelho(s) ativo(s)`
                  : 'Nenhum aparelho ativo'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
