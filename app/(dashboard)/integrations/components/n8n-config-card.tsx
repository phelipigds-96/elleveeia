'use client'

import { useState } from 'react'
import { saveN8nIntegration, disconnectN8n } from '@/lib/services/integrations'
import { CheckCircle2, XCircle, Settings2, Loader2, Link2 } from 'lucide-react'

export function N8nConfigCard({ initialData }: { initialData: any }) {
  const [url, setUrl] = useState(initialData?.config?.webhook_url || '')
  const [secret, setSecret] = useState(initialData?.credentials?.webhook_secret || '')
  
  const [isSaving, setIsSaving] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isConnected = !!initialData

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError(null)
    setSuccess(null)

    try {
      await saveN8nIntegration(url, secret)
      setSuccess('Conexão com n8n estabelecida e salva com sucesso!')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Tem certeza que deseja desconectar o n8n?')) return
    setIsDisconnecting(true)
    setError(null)
    try {
      await disconnectN8n()
      setUrl('')
      setSecret('')
      setSuccess('Integração removida com sucesso.')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow">
      <div className="p-6 flex flex-col space-y-1.5 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-rose-100 dark:bg-rose-900/20 rounded-md">
              <Settings2 className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            </div>
            <h3 className="font-semibold leading-none tracking-tight">n8n Workflow</h3>
          </div>
          {isConnected ? (
            <span className="flex items-center text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full dark:bg-emerald-900/30 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
            </span>
          ) : (
            <span className="flex items-center text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
              <XCircle className="h-3 w-3 mr-1" /> Desconectado
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground pt-2">
          Orquestrador externo para conectar o Ellevee ao WhatsApp e outros canais.
        </p>
      </div>

      <div className="p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">Webhook URL (n8n)</label>
            <input 
              type="url"
              required
              placeholder="https://seu-n8n.com/webhook/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">URL onde o Ellevee enviará os eventos (outbound).</p>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">Secret Token (Header: x-ellevee-api-key)</label>
            <input 
              type="password"
              required
              placeholder="Digite o token"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-600 dark:bg-emerald-950/50 dark:border-emerald-900 text-sm">
              {success}
            </div>
          )}

          {isConnected && initialData?.last_connected_at && (
            <p className="text-xs text-muted-foreground">
              Última comunicação: {new Date(initialData.last_connected_at).toLocaleString()}
            </p>
          )}

          <div className="pt-4 flex items-center justify-between gap-4">
            <button
              type="submit"
              disabled={isSaving || isDisconnecting}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isConnected ? 'Atualizar Conexão' : 'Testar e Conectar'}
            </button>

            {isConnected && (
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isSaving || isDisconnecting}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-destructive/10 text-destructive h-9 px-4 py-2 disabled:opacity-50"
              >
                Desconectar
              </button>
            )}
          </div>
        </form>
      </div>
      
      {/* Documentação Embutida de Inbound */}
      <div className="p-6 bg-muted/30 border-t border-dashed">
        <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <Link2 className="h-4 w-4" /> Webhook Inbound (n8n &rarr; Ellevee)
        </h4>
        <p className="text-xs text-muted-foreground mb-4">
          Para enviar mensagens do n8n para o Ellevee, configure no seu workflow do n8n:
        </p>
        <div className="space-y-2 text-xs">
          <div className="p-2 rounded bg-muted font-mono flex items-center justify-between">
            <span>POST /api/webhooks/messages</span>
          </div>
          <div className="p-2 rounded bg-muted font-mono flex flex-col gap-1">
            <span className="text-muted-foreground">Header obrigatório:</span>
            <span>x-ellevee-webhook-secret: &lt;SEU_API_KEY&gt;</span>
          </div>
        </div>
      </div>

    </div>
  )
}
