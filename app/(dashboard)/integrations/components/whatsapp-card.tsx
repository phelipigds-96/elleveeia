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
  Check,
  Settings,
  Server
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import {
  getWhatsAppStatusAction,
  getWhatsAppQrCodeAction,
  disconnectWhatsAppAction,
  restartWhatsAppAction,
  getEvolutionConfigAction,
  saveEvolutionConfigAction,
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

  // Estados do Modal de QR Code
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [isLoadingQr, setIsLoadingQr] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)

  // Estados do Modal de Configuração do Servidor
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
  const [serverUrl, setServerUrl] = useState('')
  const [serverApiKey, setServerApiKey] = useState('')
  const [serverInstance, setServerInstance] = useState('default')
  const [isSavingConfig, setIsSavingConfig] = useState(false)

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

  // 4. Carregar configurações salvas ao abrir modal de config
  const handleOpenConfigModal = async () => {
    try {
      const cfg = await getEvolutionConfigAction()
      if (cfg.apiUrl) setServerUrl(cfg.apiUrl)
      if (cfg.apiKey) setServerApiKey(cfg.apiKey)
      if (cfg.instanceName) setServerInstance(cfg.instanceName)
    } catch {
      // Ignora falha de leitura
    }
    setIsConfigModalOpen(true)
  }

  // 5. Salvar Configuração do Servidor Evolution
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl.trim() || !serverApiKey.trim()) {
      toast.error('Campos obrigatórios', 'Informe a URL e a API Key da Evolution API.')
      return
    }

    setIsSavingConfig(true)
    try {
      const res = await saveEvolutionConfigAction({
        apiUrl: serverUrl.trim(),
        apiKey: serverApiKey.trim(),
        instanceName: serverInstance.trim() || 'default',
      })

      if (res.success) {
        toast.success('Configuração Salva!', 'Servidor Evolution API configurado com sucesso.')
        setIsConfigModalOpen(false)
        await checkStatus()
      } else {
        toast.error('Erro ao salvar', res.error || 'Falha na persistência.')
      }
    } catch (err: any) {
      toast.error('Erro', err?.message || 'Falha na comunicação.')
    } finally {
      setIsSavingConfig(false)
    }
  }

  // 6. Desconectar Sessão
  const handleDisconnect = async () => {
    if (
      !confirm(
        'Tem certeza de que deseja desconectar este WhatsApp? A IA e os atendentes não poderão enviar mensagens até que o aparelho seja conectado novamente.'
      )
    ) {
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

  // 7. Reiniciar Conexão / Instância
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
  const isNotConfigured = status === 'not_configured'

  return (
    <>
      {/* CARD PRINCIPAL */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden">
        {/* Barra superior colorida de status */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 ${
            isConnected
              ? 'bg-emerald-500'
              : isNotConfigured
              ? 'bg-amber-400'
              : 'bg-gray-300'
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

            {/* Badges e Botão de Configuração */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleOpenConfigModal}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Configurações do Servidor Evolution"
              >
                <Settings className="h-4 w-4" />
              </button>

              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                  isConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                    : isNotConfigured
                    ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                    : 'bg-gray-100 text-gray-600 border border-gray-200/60'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isConnected
                      ? 'bg-emerald-500 animate-pulse'
                      : isNotConfigured
                      ? 'bg-amber-500'
                      : 'bg-gray-400'
                  }`}
                />
                {isConnected
                  ? 'Conectado'
                  : isNotConfigured
                  ? 'Não Configurado'
                  : 'Desconectado'}
              </span>
            </div>
          </div>

          {/* Detalhes do Número ou Instrução */}
          <div className="bg-gray-50/70 border border-gray-100 rounded-xl p-3.5 text-xs text-gray-600 space-y-2">
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
            ) : isNotConfigured ? (
              <div className="space-y-2">
                <p className="text-amber-800 leading-relaxed font-medium">
                  Servidor Evolution API ainda não configurado para esta conta.
                </p>
                <button
                  type="button"
                  onClick={handleOpenConfigModal}
                  className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                >
                  <Server className="h-3.5 w-3.5" />
                  Configurar Servidor Evolution
                </button>
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
              onClick={() => {
                if (isNotConfigured) {
                  handleOpenConfigModal()
                } else {
                  setIsModalOpen(true)
                }
              }}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-2 shadow-xs transition-transform active:scale-[0.98]"
            >
              {isNotConfigured ? (
                <>
                  <Settings className="h-4 w-4" />
                  Configurar Servidor Evolution
                </>
              ) : (
                <>
                  <QrCode className="h-4 w-4" />
                  Conectar WhatsApp via QR Code
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* MODAL 1: CONEXÃO COM QR CODE */}
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
                      Não foi possível carregar a imagem do QR Code. Verifique se o servidor da Evolution API está ativo e configurado.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={fetchQrCode}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg font-medium hover:bg-emerald-700 transition-colors"
                      >
                        Tentar Novamente
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsModalOpen(false)
                          handleOpenConfigModal()
                        }}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-lg font-medium transition-colors"
                      >
                        Ver Configurações
                      </button>
                    </div>
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
                  <li>
                    Acesse <strong>Configurações</strong> &gt; <strong>Aparelhos Conectados</strong>
                  </li>
                  <li>
                    Toque em <strong>Conectar um aparelho</strong>
                  </li>
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

      {/* MODAL 2: CONFIGURAÇÃO DO SERVIDOR EVOLUTION API */}
      {isConfigModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => !isSavingConfig && setIsConfigModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-[#005d4b] text-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-full bg-white/10 text-white">
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Configurar Evolution API</h3>
                  <p className="text-xs text-white/80">Endereço e chave do servidor gateway</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSavingConfig && setIsConfigModalOpen(false)}
                className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Formulário de Configuração */}
            <form onSubmit={handleSaveConfig} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  URL da Evolution API <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  required
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://evolution.seudominio.com.br"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b]"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Endereço público onde a sua Evolution API está hospedada.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  API Key Global <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={serverApiKey}
                  onChange={(e) => setServerApiKey(e.target.value)}
                  placeholder="AUTHENTICATION_API_KEY da Evolution"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b]"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Chave mestra configurada no .env da sua Evolution API.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nome da Instância <span className="text-gray-400 font-normal">(padrão: default)</span>
                </label>
                <input
                  type="text"
                  value={serverInstance}
                  onChange={(e) => setServerInstance(e.target.value)}
                  placeholder="default"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#005d4b]/20 focus:border-[#005d4b]"
                />
              </div>

              {/* Botões de Ação */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  disabled={isSavingConfig}
                  onClick={() => setIsConfigModalOpen(false)}
                  className="px-4 py-2 text-xs sm:text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig || !serverUrl.trim() || !serverApiKey.trim()}
                  className="px-5 py-2 text-xs sm:text-sm bg-[#005d4b] hover:bg-[#004738] text-white rounded-lg transition-colors font-medium flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  {isSavingConfig ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Salvar e Conectar
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
