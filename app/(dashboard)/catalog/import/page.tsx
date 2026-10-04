'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseCsvFileAction, confirmImportAction } from './actions'
import type { CatalogImportRow } from '@/lib/services/catalog/import-products'
import { Loader2, UploadCloud, CheckCircle2 } from 'lucide-react'

export default function CatalogImportPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [parsedData, setParsedData] = useState<CatalogImportRow[]>([])
  const [importResult, setImportResult] = useState<any>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0])
      setErrorMsg(null)
    }
  }

  const handleAnalyze = async () => {
    if (!file) {
      setErrorMsg('Selecione um arquivo CSV primeiro.')
      return
    }

    setLoading(true)
    setErrorMsg(null)

    const formData = new FormData()
    formData.append('file', file)

    const res = await parseCsvFileAction(formData)
    setLoading(false)

    if (res.error) {
      setErrorMsg(res.error)
    } else if (res.data) {
      setParsedData(res.data)
      setStep(2)
    }
  }

  const handleConfirm = async () => {
    setLoading(true)
    setErrorMsg(null)

    const res = await confirmImportAction(parsedData)
    setLoading(false)

    if (!res.success) {
      setErrorMsg(res.error || 'Falha ao confirmar importação.')
    } else {
      setImportResult(res)
      setStep(3)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Importar Catálogo (CSV)</h2>
        <p className="text-muted-foreground">
          Faça upload da sua planilha de produtos.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-destructive/50 text-destructive px-4 py-3">
          <h5 className="mb-1 font-medium leading-none tracking-tight">Erro</h5>
          <div className="text-sm opacity-90">{errorMsg}</div>
        </div>
      )}

      {step === 1 && (
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Etapa 1: Enviar Arquivo</h3>
            <p className="text-sm text-muted-foreground">O arquivo deve estar no formato CSV, separado por ponto-e-vírgula (;).</p>
          </div>
          <div className="p-6 pt-0 space-y-4">
            <div className="grid w-full max-w-sm items-center gap-1.5">
              <input id="file" type="file" accept=".csv" onChange={handleFileChange} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex items-center p-6 pt-0">
            <button className="inline-flex items-center bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50" onClick={handleAnalyze} disabled={!file || loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Analisar Arquivo
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Etapa 2: Prévia e Validação</h3>
            <p className="text-sm text-muted-foreground">Resumo dos dados encontrados no arquivo {file?.name}</p>
          </div>
          <div className="p-6 pt-0 space-y-4">
            <div className="p-4 bg-muted rounded-lg space-y-2 text-sm">
              <p><strong>Total de registros lidos:</strong> {parsedData.length}</p>
              <p><strong>Ação:</strong> Os produtos serão criados ou atualizados. Chave de identificação: Código (SKU).</p>
            </div>

            <div className="rounded-md border max-h-[300px] overflow-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-medium">Código</th>
                    <th className="px-4 py-2 font-medium">Cód. Barras</th>
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium">Preço (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground">{row.codigo}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.barras || '-'}</td>
                      <td className="px-4 py-2 font-medium">{row.nome}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.preco ? row.preco.toFixed(2) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedData.length > 50 && (
                <div className="p-3 text-center text-sm text-muted-foreground bg-muted/20">
                  Mostrando os 50 primeiros registros de {parsedData.length}...
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 p-6 pt-0">
            <button className="inline-flex items-center border hover:bg-muted px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50" onClick={() => setStep(1)} disabled={loading}>Voltar</button>
            <button className="inline-flex items-center bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50" onClick={handleConfirm} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Importação
            </button>
          </div>
        </div>
      )}

      {step === 3 && importResult && (
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <h3 className="font-semibold leading-none tracking-tight">Importação Concluída</h3>
                <p className="text-sm text-muted-foreground">O catálogo foi atualizado com sucesso.</p>
              </div>
            </div>
          </div>
          <div className="p-6 pt-0 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg bg-green-50/50 dark:bg-green-950/20">
                <p className="text-sm font-medium text-muted-foreground">Produtos Processados (Sucesso)</p>
                <p className="text-3xl font-bold text-green-600">{importResult.successCount}</p>
              </div>
              <div className="p-4 border rounded-lg bg-red-50/50 dark:bg-red-950/20">
                <p className="text-sm font-medium text-muted-foreground">Falhas</p>
                <p className="text-3xl font-bold text-red-600">{importResult.errorCount}</p>
              </div>
            </div>
            {importResult.errors?.length > 0 && (
              <div className="p-4 bg-muted text-sm text-destructive rounded-lg overflow-auto max-h-40">
                {importResult.errors.map((err: string, i: number) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center p-6 pt-0">
            <button className="inline-flex items-center bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium" onClick={() => router.push('/catalog')}>Ir para Catálogo</button>
          </div>
        </div>
      )}
    </div>
  )
}
