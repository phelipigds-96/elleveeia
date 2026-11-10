'use client'

import React, { useState, useTransition } from 'react'
import {
  Server,
  Key,
  Globe,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  QrCode,
  Smartphone,
  Plus,
  Link as LinkIcon,
  Unlink,
  Trash2,
  PowerOff,
  Search,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Check,
  X,
  HelpCircle,
  Building2
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import {
  AdminInstancesOverview,
  CompanyInstanceItem,
  saveGlobalEvolutionConfigAction,
  testGlobalEvolutionConnectionAction,
  linkCompanyInstanceAction,
  unlinkCompanyInstanceAction,
  createEvolutionInstanceAction,
  getInstanceQrCodeAction,
  restartInstanceAction,
  disconnectInstanceAction,
  deleteEvolutionInstanceFromServerAction,
} from '../actions'

interface Props {
  initialData: AdminInstancesOverview
}

export default function InstancesClientView({ initialData }: Props) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()

  // Estados da Configuração Global
  const [globalUrl, setGlobalUrl] = useState(data.globalConfig.apiUrl || '')
  const [globalKey, setGlobalKey] = useState(data.globalConfig.apiKey || '')
  const [isSavingGlobal, setIsSavingGlobal] = useState(false)
  const [isTestingGlobal, setIsTestingGlobal] = useState(false)

  // Filtros
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'disconnected' | 'unassigned' | 'not_created'>('all')

  // Modal Vincular / Criar Instância
  const [editingCompany, setEditingCompany] = useState<CompanyInstanceItem | null>(null)
  const [targetInstanceName, setTargetInstanceName] = useState('')
  const [customApiUrl, setCustomApiUrl] = useState('')
  const [createOnServerImmediately, setCreateOnServerImmediately] = useState(true)
  const [isSubmittingModal, setIsSubmittingModal] = useState(false)

  // Modal QR Code SuperAdmin
  const [qrModalCompany, setQrModalCompany] = useState<CompanyInstanceItem | null>(null)
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null)
  const [isLoadingQr, setIsLoadingQr] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)

  // Ações em lote / loading por empresa
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // 1. Salvar Configuração Global
  const handleSaveGlobal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!globalUrl.trim() || !globalKey.trim()) {
      toast.error('Campos Obrigatórios', 'Informe a URL e a API Key da Evolution API.')
      return
    }

    setIsSavingGlobal(true)
    try {
      const res = await saveGlobalEvolutionConfigAction({
        apiUrl: globalUrl.trim(),
        apiKey: globalKey.trim(),
      })

      if (res.success) {
        toast.success('Configuração Salva!', 'Credenciais globais da Evolution API gravadas com sucesso.')
        // Atualiza estado local
        setData((prev) => ({
          ...prev,
          globalConfig: {
            apiUrl: globalUrl.trim(),
            apiKey: globalKey.trim(),
            isConfigured: true,
          },
        }))
      } else {
        toast.error('Falha ao salvar', res.error || 'Erro desconhecido.')
      }
    } catch (err: any) {
      toast.error('Erro', err?.message || 'Falha de comunicação.')
    } finally {
      setIsSavingGlobal(false)
    }
  }

  // 2. Testar Conexão Global
  const handleTestGlobal = async () => {
    if (!globalUrl.trim() || !globalKey.trim()) {
      toast.error('Dados Incompletos', 'Preencha a URL e a API Key antes de testar.')
      return
    }

    setIsTestingGlobal(true)
    try {
      const res = await testGlobalEvolutionConnectionAction({
        apiUrl: globalUrl.trim(),
        apiKey: globalKey.trim(),
      })

      if (res.success) {
        toast.success(
          'Servidor Conectado!',
          `Comunicação estabelecida com sucesso. ${res.totalInstances || 0} instâncias encontradas na Evolution API.`
        )
        setData((prev) => ({
          ...prev,
          serverStatus: {
            online: true,
            totalServerInstances: res.totalInstances || 0,
          },
        }))
      } else {
        toast.error('Servidor Inacessível', res.error || 'Não foi possível contatar o servidor informado.')
        setData((prev) => ({
          ...prev,
          serverStatus: {
            online: false,
            totalServerInstances: 0,
            error: res.error,
          },
        }))
      }
    } catch (err: any) {
      toast.error('Erro ao testar', err?.message || 'Falha de rede.')
    } finally {
      setIsTestingGlobal(false)
    }
  }

  // 3. Abrir Modal de Edição / Criação de Instância
  const handleOpenEditModal = (comp: CompanyInstanceItem) => {
    setEditingCompany(comp)
    // Sugestão de nome de instância baseado no slug da empresa
    const cleanSlug = comp.companySlug
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 30)

    setTargetInstanceName(comp.instanceName || `inst-${cleanSlug}`)
    setCustomApiUrl(comp.customApiUrl || '')
    setCreateOnServerImmediately(!comp.instanceName)
  }

  // 4. Submeter Vinculação ou Criação
  const handleSubmitInstanceModal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCompany) return

    const cleanName = targetInstanceName.trim()
    if (!cleanName) {
      toast.error('Nome Inválido', 'Informe o nome da instância.')
      return
    }

    setIsSubmittingModal(true)
    try {
      if (createOnServerImmediately) {
        // Cria fisicamente no servidor Evolution e vincula
        const res = await createEvolutionInstanceAction({
          companyId: editingCompany.companyId,
          instanceName: cleanName,
        })

        if (res.success) {
          toast.success('Instância Criada!', `A instância "${cleanName}" foi provisionada na Evolution API e vinculada à ${editingCompany.companyName}.`)
          updateLocalCompany(editingCompany.companyId, {
            instanceName: cleanName,
            status: 'close',
            hasIntegration: true,
          })
          setEditingCompany(null)
        } else {
          toast.error('Erro ao criar instância', res.error || 'Falha na Evolution API.')
        }
      } else {
        // Apenas vincula no banco
        const res = await linkCompanyInstanceAction({
          companyId: editingCompany.companyId,
          instanceName: cleanName,
          customApiUrl: customApiUrl.trim() || undefined,
        })

        if (res.success) {
          toast.success('Instância Vinculada!', `Instância "${cleanName}" associada à empresa com sucesso.`)
          updateLocalCompany(editingCompany.companyId, {
            instanceName: cleanName,
            customApiUrl: customApiUrl.trim() || undefined,
            isDedicatedServer: Boolean(customApiUrl.trim()),
            hasIntegration: true,
          })
          setEditingCompany(null)
        } else {
          toast.error('Erro ao vincular', res.error || 'Falha no banco de dados.')
        }
      }
    } catch (err: any) {
      toast.error('Erro', err?.message || 'Falha na operação.')
    } finally {
      setIsSubmittingModal(false)
    }
  }

  // 5. Desvincular Instância da Empresa
  const handleUnlink = async (comp: CompanyInstanceItem) => {
    if (!confirm(`Deseja desvincular a instância "${comp.instanceName}" da empresa "${comp.companyName}"? O cliente perderá a conexão no painel até nova vinculação.`)) {
      return
    }

    setActionLoadingId(comp.companyId)
    try {
      const res = await unlinkCompanyInstanceAction({ companyId: comp.companyId })
      if (res.success) {
        toast.success('Desvinculado', 'A instância foi removida da empresa.')
        updateLocalCompany(comp.companyId, {
          instanceName: '',
          status: 'unassigned',
          hasIntegration: false,
          phoneNumber: undefined,
          profileName: undefined,
        })
      } else {
        toast.error('Erro ao desvincular', res.error)
      }
    } catch (err: any) {
      toast.error('Erro', err?.message)
    } finally {
      setActionLoadingId(null)
    }
  }

  // 6. Abrir Modal de QR Code do SuperAdmin
  const handleOpenQrModal = async (comp: CompanyInstanceItem) => {
    setQrModalCompany(comp)
    setQrCodeBase64(null)
    setQrError(null)
    setIsLoadingQr(true)

    try {
      const res = await getInstanceQrCodeAction(comp.companyId)
      if (res.state === 'open') {
        toast.success('Já Conectado!', 'Esta instância já está conectada e operando.')
        updateLocalCompany(comp.companyId, { status: 'open' })
        setQrModalCompany(null)
        return
      }

      if (res.base64) {
        setQrCodeBase64(res.base64)
      } else if (res.error) {
        setQrError(res.error)
      }
    } catch (err: any) {
      setQrError(err?.message || 'Falha ao buscar QR Code.')
    } finally {
      setIsLoadingQr(false)
    }
  }

  // 7. Reiniciar Instância
  const handleRestart = async (comp: CompanyInstanceItem) => {
    setActionLoadingId(comp.companyId)
    try {
      const res = await restartInstanceAction(comp.companyId)
      if (res.success) {
        toast.success('Reiniciado', `Socket da instância "${comp.instanceName}" foi reiniciado.`)
      } else {
        toast.error('Falha ao reiniciar', res.error)
      }
    } catch (err: any) {
      toast.error('Erro', err?.message)
    } finally {
      setActionLoadingId(null)
    }
  }

  // 8. Desconectar Sessão
  const handleDisconnect = async (comp: CompanyInstanceItem) => {
    if (!confirm(`Desconectar sessão do WhatsApp da instância "${comp.instanceName}"?`)) return

    setActionLoadingId(comp.companyId)
    try {
      const res = await disconnectInstanceAction(comp.companyId)
      if (res.success) {
        toast.success('Desconectado', 'Sessão encerrada com sucesso.')
        updateLocalCompany(comp.companyId, { status: 'close', phoneNumber: undefined })
      } else {
        toast.error('Falha ao desconectar', res.error)
      }
    } catch (err: any) {
      toast.error('Erro', err?.message)
    } finally {
      setActionLoadingId(null)
    }
  }

  // Helper para atualizar empresa localmente sem refetch completo
  const updateLocalCompany = (companyId: string, partial: Partial<CompanyInstanceItem>) => {
    setData((prev) => ({
      ...prev,
      companies: prev.companies.map((c) =>
        c.companyId === companyId ? { ...c, ...partial } : c
      ),
    }))
  }

  // Filtros
  const filteredCompanies = data.companies.filter((c) => {
    const matchesSearch =
      c.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.companySlug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.instanceName.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch) return false

    if (statusFilter === 'all') return true
    if (statusFilter === 'open') return c.status === 'open'
    if (statusFilter === 'disconnected') return c.status === 'close' || c.status === 'disconnected'
    if (statusFilter === 'unassigned') return c.status === 'unassigned'
    if (statusFilter === 'not_created') return c.status === 'not_created'
    return true
  })

  // Contadores
  const totalCompanies = data.companies.length
  const totalOpen = data.companies.filter((c) => c.status === 'open').length
  const totalDisconnected = data.companies.filter((c) => c.status === 'close' || c.status === 'disconnected').length
  const totalUnassigned = data.companies.filter((c) => c.status === 'unassigned').length

  return (
    <div className="space-y-8 pb-16">
      {/* CABEÇALHO */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-ellevee-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-ellevee-deep-ink">
              Instâncias WhatsApp (Evolution API)
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                data.serverStatus.online
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  data.serverStatus.online ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                }`}
              />
              {data.serverStatus.online
                ? `Online (${data.serverStatus.totalServerInstances} instâncias)`
                : 'Offline / Não Conectado'}
            </span>
          </div>
          <p className="text-xs text-ellevee-text-secondary mt-1">
            Gerencie centralmente a conexão de gateway e instâncias de WhatsApp para todas as empresas da Ellevee. O cliente final só precisa escanear o QR Code.
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-ellevee-deep-ink bg-white border border-ellevee-border rounded-lg hover:bg-ellevee-warm-ivory/50 transition-colors shadow-2xs self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5 text-ellevee-text-secondary" />
          Atualizar Dados
        </button>
      </div>

      {/* CARD 1: SERVIDOR EVOLUTION API GLOBAL */}
      <div className="bg-white rounded-xl border border-ellevee-border shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-ellevee-border bg-[#F8F8F6] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 text-purple-700 border border-purple-500/20 rounded-xl">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-ellevee-deep-ink font-display">Servidor Gateway Global</h2>
              <p className="text-xs text-ellevee-text-secondary">
                Endereço mestre e chave de autenticação utilizados por padrão para todos os clientes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isTestingGlobal}
              onClick={handleTestGlobal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ellevee-deep-ink bg-white border border-ellevee-border rounded-lg hover:bg-ellevee-warm-ivory/50 transition-colors disabled:opacity-50"
            >
              {isTestingGlobal ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="h-3.5 w-3.5 text-ellevee-text-secondary" />
              )}
              Testar Conexão
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveGlobal} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
                URL da Evolution API <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Globe className="h-4 w-4 text-ellevee-text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  required
                  value={globalUrl}
                  onChange={(e) => setGlobalUrl(e.target.value)}
                  placeholder="https://evolution.seuservidor.com"
                  className="w-full pl-9 pr-3 py-2 bg-white border border-ellevee-border rounded-lg text-xs sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-ellevee-blue focus:border-ellevee-blue"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
                API Key Global (AUTHENTICATION_API_KEY) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Key className="h-4 w-4 text-ellevee-text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={globalKey}
                  onChange={(e) => setGlobalKey(e.target.value)}
                  placeholder="Chave mestre da Evolution API"
                  className="w-full pl-9 pr-3 py-2 bg-white border border-ellevee-border rounded-lg text-xs sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-ellevee-blue focus:border-ellevee-blue"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] text-ellevee-text-secondary flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Webhook padrão de mensagens: <code className="bg-ellevee-warm-ivory border border-ellevee-border px-1 py-0.5 rounded font-mono">/api/webhooks/messages</code>
            </p>

            <button
              type="submit"
              disabled={isSavingGlobal || !globalUrl.trim() || !globalKey.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ellevee-gradient hover:opacity-95 text-white text-xs font-semibold rounded-lg transition-opacity shadow-sm disabled:opacity-50"
            >
              {isSavingGlobal ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Salvar Configuração Global
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* CARD 2: DIRETÓRIO DE INSTÂNCIAS POR EMPRESA */}
      <div className="space-y-4">
        {/* Barra de Filtros e Contadores */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-ellevee-deep-ink font-display">
              Instâncias por Empresa
            </h2>
            <span className="text-xs text-ellevee-text-secondary">
              ({filteredCompanies.length} de {totalCompanies} empresas)
            </span>
          </div>

          {/* Cards Rápidos de Status */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                statusFilter === 'all'
                  ? 'bg-ellevee-deep-ink text-white border-ellevee-deep-ink shadow-2xs'
                  : 'bg-white text-ellevee-text-secondary border-ellevee-border hover:bg-ellevee-warm-ivory/60'
              }`}
            >
              Todas: {totalCompanies}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('open')}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                statusFilter === 'open'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                  : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50/60'
              }`}
            >
              🟢 Conectadas: {totalOpen}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('disconnected')}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                statusFilter === 'disconnected'
                  ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                  : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50/60'
              }`}
            >
              🔴 Desconectadas: {totalDisconnected}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('unassigned')}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                statusFilter === 'unassigned'
                  ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                  : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50/60'
              }`}
            >
              ⚪ Sem Instância: {totalUnassigned}
            </button>
          </div>
        </div>

        {/* Input de Busca */}
        <div className="relative">
          <Search className="h-4 w-4 text-ellevee-text-secondary/70 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome da empresa, slug ou nome da instância..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-ellevee-border rounded-xl text-xs sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-secondary/60 focus:outline-none focus:ring-1 focus:ring-ellevee-blue focus:border-ellevee-blue shadow-2xs"
          />
        </div>

        {/* TABELA DE INSTÂNCIAS */}
        <div className="bg-white rounded-xl border border-ellevee-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-ellevee-border bg-[#F8F8F6] text-ellevee-text-secondary uppercase font-semibold text-[11px] tracking-wider">
                  <th className="px-5 py-3.5">Empresa</th>
                  <th className="px-4 py-3.5">Instância Evolution</th>
                  <th className="px-4 py-3.5">Status WhatsApp</th>
                  <th className="px-4 py-3.5">Número Conectado</th>
                  <th className="px-5 py-3.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ellevee-border/60">
                {filteredCompanies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-ellevee-text-secondary">
                      Nenhuma empresa encontrada com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredCompanies.map((comp) => {
                    const isLoadingThis = actionLoadingId === comp.companyId

                    return (
                      <tr key={comp.companyId} className="hover:bg-ellevee-warm-ivory/40 transition-colors">
                        {/* Empresa */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-lg bg-ellevee-warm-ivory border border-ellevee-border flex items-center justify-center text-ellevee-deep-ink font-bold text-xs shrink-0 font-display">
                              {comp.companyName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-ellevee-deep-ink text-sm truncate font-display">
                                {comp.companyName}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono text-[10px] text-ellevee-text-secondary truncate max-w-[140px]">
                                  {comp.companySlug}
                                </span>
                                <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-medium bg-ellevee-warm-ivory text-ellevee-deep-ink border border-ellevee-border">
                                  {comp.companyPlan}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Instância */}
                        <td className="px-4 py-4">
                          {comp.instanceName ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-ellevee-warm-ivory text-ellevee-deep-ink border border-ellevee-border">
                                {comp.instanceName}
                              </span>
                              {comp.isDedicatedServer && (
                                <span className="block text-[10px] text-amber-700 font-medium">
                                  Servidor Dedicado
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-ellevee-warm-ivory text-ellevee-text-secondary border border-ellevee-border">
                              Não Vinculada
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4">
                          {comp.status === 'open' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                              Conectado
                            </span>
                          ) : comp.status === 'connecting' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              <span className="h-2 w-2 rounded-full bg-amber-500" />
                              Aguardando QR
                            </span>
                          ) : comp.status === 'not_created' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200" title="Instância mapeada no banco mas não existe no servidor Evolution">
                              <span className="h-2 w-2 rounded-full bg-purple-500" />
                              Não Criada no Servidor
                            </span>
                          ) : comp.status === 'unassigned' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-ellevee-warm-ivory text-ellevee-text-secondary border border-ellevee-border">
                              Sem Instância
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
                              <span className="h-2 w-2 rounded-full bg-rose-500" />
                              Desconectado
                            </span>
                          )}
                        </td>

                        {/* Número Conectado */}
                        <td className="px-4 py-4">
                          {comp.phoneNumber ? (
                            <div className="flex items-center gap-1.5 text-ellevee-deep-ink font-medium">
                              <Smartphone className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <span className="font-mono text-xs">+{comp.phoneNumber}</span>
                              {comp.profileName && (
                                <span className="text-ellevee-text-secondary text-[11px] truncate max-w-[120px]">
                                  ({comp.profileName})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-ellevee-text-secondary/60 text-xs">—</span>
                          )}
                        </td>

                        {/* Ações */}
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {/* Botão Ver QR Code (se tem instância) */}
                            {comp.instanceName && (
                              <button
                                type="button"
                                onClick={() => handleOpenQrModal(comp)}
                                disabled={isLoadingThis}
                                className="p-1.5 text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-warm-ivory rounded-lg transition-colors border border-transparent hover:border-ellevee-border"
                                title="Ver QR Code / Conectar"
                              >
                                <QrCode className="h-4 w-4" />
                              </button>
                            )}

                            {/* Botão Vincular / Editar */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(comp)}
                              disabled={isLoadingThis}
                              className="px-2.5 py-1.5 text-xs font-semibold text-ellevee-deep-ink bg-white hover:bg-ellevee-warm-ivory/60 border border-ellevee-border rounded-lg transition-colors shadow-2xs"
                              title="Configurar Instância da Empresa"
                            >
                              {comp.instanceName ? 'Editar' : 'Vincular / Criar'}
                            </button>

                            {/* Botão Reiniciar Sessão (se conectado ou desconectado com instância) */}
                            {comp.instanceName && (
                              <button
                                type="button"
                                onClick={() => handleRestart(comp)}
                                disabled={isLoadingThis}
                                className="p-1.5 text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-warm-ivory rounded-lg transition-colors border border-transparent hover:border-ellevee-border"
                                title="Reiniciar Socket da Instância"
                              >
                                {isLoadingThis ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </button>
                            )}

                            {/* Botão Desconectar (se open) */}
                            {comp.status === 'open' && (
                              <button
                                type="button"
                                onClick={() => handleDisconnect(comp)}
                                disabled={isLoadingThis}
                                className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                                title="Desconectar Sessão do WhatsApp"
                              >
                                <PowerOff className="h-4 w-4" />
                              </button>
                            )}

                            {/* Botão Desvincular (se tem integração) */}
                            {comp.hasIntegration && (
                              <button
                                type="button"
                                onClick={() => handleUnlink(comp)}
                                disabled={isLoadingThis}
                                className="p-1.5 text-ellevee-text-secondary hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                                title="Desvincular Instância desta Empresa"
                              >
                                <Unlink className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL 1: VINCULAR OU CRIAR INSTÂNCIA */}
      {editingCompany && (
        <div
          className="fixed inset-0 z-50 bg-[#202520]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => !isSubmittingModal && setEditingCompany(null)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full shadow-modal border border-ellevee-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-ellevee-border bg-[#202520] text-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-lg border border-white/10">
                  <Building2 className="h-5 w-5 text-ellevee-cyan" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-display">
                    {editingCompany.instanceName ? 'Editar Instância' : 'Vincular / Criar Instância'}
                  </h3>
                  <p className="text-xs text-white/70 font-sans">{editingCompany.companyName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSubmittingModal && setEditingCompany(null)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitInstanceModal} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
                  Nome da Instância na Evolution API <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={targetInstanceName}
                  onChange={(e) => setTargetInstanceName(e.target.value)}
                  placeholder="ex: cliente-clinica-sorriso"
                  className="w-full px-3 py-2 bg-white border border-ellevee-border rounded-lg text-xs sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-secondary/60 font-mono focus:outline-none focus:ring-1 focus:ring-ellevee-blue focus:border-ellevee-blue"
                />
                <p className="text-[11px] text-ellevee-text-secondary mt-1">
                  Identificador único da instância no servidor Evolution. Sem espaços ou caracteres especiais.
                </p>
              </div>

              {/* Checkbox: Criar no Servidor Agora */}
              <div className="p-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createOnServerImmediately}
                    onChange={(e) => setCreateOnServerImmediately(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded text-ellevee-deep-ink focus:ring-ellevee-blue border-ellevee-border"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-ellevee-deep-ink">
                      Provisionar fisicamente no servidor Evolution agora
                    </span>
                    <p className="text-ellevee-text-secondary mt-0.5">
                      Executa <code className="font-mono bg-white px-1 py-0.2 rounded border border-emerald-200">POST /instance/create</code> com o webhook padrão apontado para a Ellevee IA.
                    </p>
                  </div>
                </label>
              </div>

              {/* Opção Avançada: Servidor Dedicado */}
              <div className="pt-2 border-t border-ellevee-border">
                <details className="text-xs text-ellevee-text-secondary">
                  <summary className="font-semibold text-ellevee-deep-ink cursor-pointer hover:text-black select-none">
                    Configuração Avançada (Servidor Dedicado Opcional)
                  </summary>
                  <div className="pt-3 space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-ellevee-deep-ink mb-1">
                        URL Customizada (Deixe em branco para usar o Gateway Global)
                      </label>
                      <input
                        type="url"
                        value={customApiUrl}
                        onChange={(e) => setCustomApiUrl(e.target.value)}
                        placeholder="https://evolution-dedicado.cliente.com"
                        className="w-full px-3 py-2 bg-white border border-ellevee-border rounded-lg text-xs text-ellevee-deep-ink focus:outline-none focus:ring-1 focus:ring-ellevee-blue focus:border-ellevee-blue"
                      />
                    </div>
                  </div>
                </details>
              </div>

              {/* Botões */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-ellevee-border">
                <button
                  type="button"
                  disabled={isSubmittingModal}
                  onClick={() => setEditingCompany(null)}
                  className="px-4 py-2 text-xs font-semibold text-ellevee-deep-ink hover:bg-ellevee-warm-ivory/60 border border-ellevee-border rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal || !targetInstanceName.trim()}
                  className="px-5 py-2 text-xs font-semibold bg-ellevee-gradient hover:opacity-95 text-white rounded-lg transition-opacity flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {isSubmittingModal ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Salvar Instância
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: QR CODE SUPERADMIN */}
      {qrModalCompany && (
        <div
          className="fixed inset-0 z-50 bg-[#202520]/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setQrModalCompany(null)}
        >
          <div
            className="bg-white rounded-xl max-w-sm w-full shadow-modal border border-ellevee-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-ellevee-border bg-[#202520] text-white">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-ellevee-cyan" />
                <div>
                  <h3 className="text-sm font-bold text-white font-display">QR Code de Conexão</h3>
                  <p className="text-[11px] text-white/70">{qrModalCompany.companyName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQrModalCompany(null)}
                className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center space-y-4">
              <div className="relative p-3 bg-white rounded-xl border border-ellevee-border shadow-card flex items-center justify-center min-h-[220px] min-w-[220px]">
                {isLoadingQr ? (
                  <div className="flex flex-col items-center gap-2 text-ellevee-text-secondary">
                    <Loader2 className="h-7 w-7 animate-spin text-ellevee-purple" />
                    <span className="text-xs">Carregando QR Code...</span>
                  </div>
                ) : qrCodeBase64 ? (
                  <img
                    src={qrCodeBase64}
                    alt="QR Code WhatsApp"
                    className="h-52 w-52 object-contain rounded-lg"
                  />
                ) : (
                  <div className="p-3 text-center space-y-2">
                    <AlertCircle className="h-6 w-6 text-amber-500 mx-auto" />
                    <p className="text-xs text-ellevee-text-secondary">
                      {qrError || 'Não foi possível carregar o QR Code. A instância pode já estar conectada ou precisando ser reiniciada.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleOpenQrModal(qrModalCompany)}
                      className="px-3.5 py-1.5 bg-ellevee-gradient text-white text-xs rounded-lg font-semibold hover:opacity-95 shadow-sm"
                    >
                      Tentar Novamente
                    </button>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-ellevee-text-secondary">
                Instância: <code className="font-mono font-semibold text-ellevee-deep-ink bg-ellevee-warm-ivory px-1.5 py-0.5 rounded border border-ellevee-border">{qrModalCompany.instanceName}</code>
              </p>

              <button
                type="button"
                onClick={() => handleOpenQrModal(qrModalCompany)}
                disabled={isLoadingQr}
                className="inline-flex items-center gap-1.5 text-xs text-ellevee-blue hover:text-ellevee-purple font-semibold transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Atualizar QR Code
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
