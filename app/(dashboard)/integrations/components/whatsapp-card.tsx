'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  QrCode,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  PowerOff,
  Phone,
  Smartphone,
  X,
  ExternalLink,
  ShieldCheck,
  Check
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import {
  getWhatsAppStatusAction,
  getWhatsAppQrCodeAction,
  disconnectWhatsAppAction,
  restartWhatsAppAction,
} from '../actions'

interface WhatsAppCardProps {
  initialStatus?: {
    configured: boolean
    state: 'open' | 'connecting' | 'close' | 'disconnected' | 'not_configured'
    instanceName?: string
    phoneNumber?: string
    profileName?: string
    profilePictureUrl?: string
  }
}

export function WhatsAppCard({ initialStatus }: WhatsAppCardProps) {
  const [status, setStatus] = useState<'open' | 'connecting' | 'close' | 'disconnected' | 'not_configured'>(
    initialStatus?.state || 'disconnected'
  )
  const [phoneNumber, setPhoneNumber] = useState(initialStatus?.phoneNumber || '')
  const [profileName, setProfileName] = useState(initialStatus?.profileName || '')
  const [profilePictureUrl, setProfilePictureUrl] = useState(initialStatus?.profilePictureUrl || '')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [isLoadingQr, setIsLoadingQr] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)

  // 1. Checagem de status no backend
  const checkStatus = useCallback(async () => {
    try {
      const res = await getWhatsAppStatusAction()
      setStatus(res.state)
      if (res.phoneNumber) setPhoneNumber(res.phoneNumber)
      if (res.profileName) setProfileName(res.profileName)
      if (res.profilePictureUrl) setProfilePictureUrl(res.profilePictureUrl)
      return res.state
    } catch {
      return 'disconnected'
    }
  }, [])

  // 2. Busca o QR Code ao vivo
  const fetchQrCode = useCallback(async () => {
    setIsLoadingQr(true)
    try {
      const res = await getWhatsAppQrCodeAction()
      if (res.state === 'open') {
        setStatus('open')
        setIsModalOpen(false)
        toast.success('WhatsApp Conectado!', 'Seu aparelho já está emparelhado e ativo.')
        await checkStatus()
        return
      }

      if (res.base64) {
        setQrCodeBase64(res.base64)
      }
      if (res.pairingCode) {
        setPairingCode(res.pairingCode)
      }

      if (!res.base64 && !res.pairingCode && res.error) {
        toast.error('Erro ao gerar QR Code', res.error)
      }
    } catch (err: any) {
      toast.error('Erro no servidor', err?.message || 'Falha ao solicitar QR Code.')
    } finally {
      setIsLoadingQr(false)
    }
  }, [checkStatus])

  // 3. Ao abrir o modal, busca o QR Code imediatamente e inicia polling a cada 3s
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (isModalOpen) {
      fetchQrCode()

      interval = setInterval(async () => {
        const currentState = await checkStatus()
        if (currentState === 'open') {
          setIsModalOpen(false)
          toast.success('WhatsApp Conectado!', 'Seu WhatsApp foi vinculado com sucesso à Ellevee!')
        }
      }, 3000)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isModalOpen, fetchQrCode, checkStatus])

  // 4. Desconectar Sessão
  const handleDisconnect = async () => {
    if (!confirm('Tem certeza de que deseja desconectar este WhatsApp? A IA e os atendentes não poderão enviar mensagens até que o aparelho seja conectado novamente.')) {
      return
    }

    setIsDisconnecting(true)
    try {
      const res = await disconnectWhatsAppAction()
      if (res.success) {
        setStatus('disconnected')
        setPhoneNumber('')
        setProfileName('')
        setProfilePictureUrl('')
        toast.success('Desconectado', 'A sessão do WhatsApp foi encerrada.')
      } else {
        toast.error('Falha ao desconectar', res.error || 'Erro no servidor.')
      }
    } catch (err: any) {
      toast.error('Erro', err?.message || 'Falha na comunicação.')
    } finally {
      setIsDisconnecting(false)
    }
  }

  // 5. Reiniciar Conexão / Instância
  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      const res = await restartWhatsAppAction()
      if (res.success) {
        toast.success('Reiniciado', 'A conexão do WhatsApp foi reiniciada.')
        await checkStatus()
      } else {
        toast.error('Erro ao reiniciar', res.error || 'Não foi possível reiniciar.')
      }
    } catch (err: any) {
      toast.error('Erro', err?.message || 'Falha na comunicação.')
    } finally {
      setIsRestarting(false)
    }
  }

  const isConnected = status === 'open'

  return (
    <>
      {/* CARD PRINCIPAL */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden">
        {/* Barra superior colorida de status */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            isConnected ? 'bg-emerald-500' : 'bg-amber-400'
          }`}
        />

        <div className="space-y-4">
          {/* Cabeçalho do Card */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-12 w-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white shrink-0 shadow-sm shadow-emerald-500/20">
                <svg
                  className="h-6 w-6 fill-current"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.044.101-.116.433-.506.549-.68.116-.173.231-.145.39-.086.159.058 1.011.477 1.184.564.173.087.289.13.332.202.043.072.043.419-.101.824z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-base leading-tight">
                  WhatsApp (QR Code)
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Conexão Rápida • Evolution API</p>
              </div>
            </div>

            {/* Badge de Status */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${
                isConnected
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                  : 'bg-amber-50 text-amber-700 border border-amber-200/60'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                }`}
              />
              {isConnected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>

          {/* Detalhes do Número ou Instrução */}
          <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 text-xs text-gray-600 space-y-1.5">
            {isConnected ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-emerald-600" />
                  <span className="font-medium text-gray-900">
                    {phoneNumber ? `+${phoneNumber}` : 'Número Conectado'}
                  </span>
                  {profileName && <span className="text-gray-400">({profileName})</span>}
                </div>
                <span className="text-[11px] text-emerald-600 font-medium">Sessão Ativa</span>
              </div>
            ) : (
              <p className="leading-relaxed">
                Escaneie o QR Code com a câmera do seu celular para sincronizar o WhatsApp e permitir o envio e recepção automática de mensagens.
              </p>
            )}
          </div>
        </div>

        {/* Rodapé / Botões de Ação */}
        <div className="pt-4 border-t border-gray-100 flex items-center justify-between gap-2 mt-4">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={handleRestart}
                disabled={isRestarting || isDisconnecting}
                className="text-xs text-gray-500 hover:text-gray-800 font-medium flex items-center gap-1.5 p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                title="Reiniciar sessão do socket"
              >
                {isRestarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Reiniciar Conexão
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isDisconnecting || isRestarting}
                className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1.5 p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                title="Desconectar este aparelho"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PowerOff className="h-3.5 w-3.5" />
                )}
                Desconectar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-2 shadow-xs transition-transform active:scale-[0.98]"
            >
              <QrCode className="h-4 w-4" />
              Conectar WhatsApp via QR Code
            </button>
          )}
        </div>
      </div>

      {/* MODAL DE CONEXÃO COM QR CODE */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#005d4b] text-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-full bg-white/10 text-white">
                  <QrCode className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Conectar WhatsApp</h3>
                  <p className="text-xs text-white/80">Escaneie o código com seu smartphone</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Conteúdo do QR Code */}
            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="relative p-3 bg-white rounded-2xl border-2 border-emerald-500/20 shadow-md flex items-center justify-center min-h-[260px] min-w-[260px]">
                {isLoadingQr ? (
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                    <span className="text-xs">Gerando QR Code seguro...</span>
                  </div>
                ) : qrCodeBase64 ? (
                  <img
                    src={qrCodeBase64}
                    alt="QR Code WhatsApp"
                    className="h-60 w-60 object-contain rounded-lg"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-4 text-center">
                    <AlertCircle className="h-8 w-8 text-amber-500" />
                    <span className="text-xs text-gray-600">
                      Não foi possível carregar a imagem do QR Code. Verifique se a Evolution API está ativa.
                    </span>
                    <button
                      type="button"
                      onClick={fetchQrCode}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg font-medium hover:bg-emerald-700 transition-colors"
                    >
                      Tentar Novamente
                    </button>
                  </div>
                )}
              </div>

              {/* Instruções */}
              <div className="w-full bg-gray-50 border border-gray-200/70 rounded-xl p-3 text-left text-xs text-gray-700 space-y-1.5">
                <p className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5 text-emerald-600" /> Como conectar:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>Abra o WhatsApp no seu celular</li>
                  <li>Acesse <strong>Configurações</strong> &gt; <strong>Aparelhos Conectados</strong></li>
                  <li>Toque em <strong>Conectar um aparelho</strong></li>
                  <li>Aponte a câmera para o QR Code acima</li>
                </ol>
              </div>

              {/* Botão de Atualizar QR Code */}
              <div className="flex items-center justify-between w-full pt-1">
                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Aguardando leitura do código...
                </span>
                <button
                  type="button"
                  onClick={fetchQrCode}
                  disabled={isLoadingQr}
                  className="text-xs text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1 hover:underline disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Atualizar QR Code
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
