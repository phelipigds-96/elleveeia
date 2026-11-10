"use client"

import React, { useState, useMemo } from "react"
import { Plus, Edit2, Trash2, Zap, Search, Copy, Check, MessageSquareText, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import {
  QuickReply,
  saveQuickReplyAction,
  deleteQuickReplyAction,
  toggleQuickReplyAction,
} from "@/app/(dashboard)/settings/actions"

interface QuickRepliesManagementProps {
  initialQuickReplies: QuickReply[]
}

const CATEGORY_PRESETS = ["Geral", "Financeiro", "Vendas", "Suporte", "Horários"]

export function QuickRepliesManagement({ initialQuickReplies }: QuickRepliesManagementProps) {
  const [replies, setReplies] = useState<QuickReply[]>(initialQuickReplies)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("TODAS")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingReply, setEditingReply] = useState<QuickReply | null>(null)
  const [title, setTitle] = useState("")
  const [shortcut, setShortcut] = useState("")
  const [category, setCategory] = useState("Geral")
  const [content, setContent] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Extrai categorias únicas dinâmicas
  const categories = useMemo(() => {
    const set = new Set<string>()
    CATEGORY_PRESETS.forEach((c) => set.add(c))
    replies.forEach((r) => {
      if (r.category) set.add(r.category)
    })
    return Array.from(set)
  }, [replies])

  // Filtragem
  const filtered = useMemo(() => {
    return replies.filter((item) => {
      const matchSearch =
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.shortcut && item.shortcut.toLowerCase().includes(searchTerm.toLowerCase()))

      const matchCat =
        selectedCategory === "TODAS" ||
        item.category.toLowerCase() === selectedCategory.toLowerCase()

      return matchSearch && matchCat
    })
  }, [replies, searchTerm, selectedCategory])

  const handleOpenCreate = () => {
    setEditingReply(null)
    setTitle("")
    setShortcut("")
    setCategory("Geral")
    setContent("")
    setIsActive(true)
    setIsDialogOpen(true)
  }

  const handleOpenEdit = (reply: QuickReply) => {
    setEditingReply(reply)
    setTitle(reply.title)
    setShortcut(reply.shortcut || "")
    setCategory(reply.category || "Geral")
    setContent(reply.content)
    setIsActive(reply.isActive)
    setIsDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return

    setIsSaving(true)
    try {
      const res = await saveQuickReplyAction({
        id: editingReply?.id,
        title: title.trim(),
        shortcut: shortcut.trim() || undefined,
        category: category.trim() || "Geral",
        content: content.trim(),
        isActive,
      })

      if (res.success && res.data) {
        toast.success(
          editingReply ? "Mensagem rápida atualizada" : "Mensagem rápida cadastrada",
          `"${res.data.title}" salva com sucesso.`
        )

        if (editingReply) {
          setReplies((prev) =>
            prev.map((r) => (r.id === editingReply.id ? res.data! : r))
          )
        } else {
          setReplies((prev) => [...prev, res.data!])
        }

        setIsDialogOpen(false)
      } else {
        toast.error("Falha ao salvar", res.error || "Não foi possível registrar a mensagem rápida.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Erro de conexão.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string, replyTitle: string) => {
    if (!confirm(`Deseja realmente excluir a mensagem rápida "${replyTitle}"?`)) return

    setDeletingId(id)
    try {
      const res = await deleteQuickReplyAction(id)
      if (res.success) {
        toast.success("Mensagem excluída", `"${replyTitle}" foi removida.`)
        setReplies((prev) => prev.filter((r) => r.id !== id))
      } else {
        toast.error("Erro ao excluir", res.error || "Falha ao remover.")
      }
    } catch (err: any) {
      toast.error("Erro inesperado", err?.message || "Falha na comunicação.")
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggle = async (reply: QuickReply) => {
    const nextState = !reply.isActive
    // Optimistic
    setReplies((prev) =>
      prev.map((r) => (r.id === reply.id ? { ...r, isActive: nextState } : r))
    )

    try {
      const res = await toggleQuickReplyAction(reply.id, nextState)
      if (!res.success) {
        setReplies((prev) =>
          prev.map((r) => (r.id === reply.id ? { ...r, isActive: reply.isActive } : r))
        )
        toast.error("Erro", res.error || "Falha ao alternar status.")
      } else {
        toast.success(
          nextState ? "Mensagem ativada" : "Mensagem desativada",
          `"${reply.title}" ${nextState ? "disponível para envio rápido." : "oculta do chat."}`
        )
      }
    } catch {
      setReplies((prev) =>
        prev.map((r) => (r.id === reply.id ? { ...r, isActive: reply.isActive } : r))
      )
    }
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.info("Texto copiado", "Conteúdo copiado para a área de transferência.")
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Header com Ações e Busca */}
      <div className="rounded-xl border border-ellevee-border bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-ellevee-purple" />
              <h2 className="text-base font-bold text-ellevee-deep-ink">
                Mensagens Rápidas (Respostas Prontas)
              </h2>
            </div>
            <p className="text-xs text-ellevee-text-secondary mt-1">
              Agilize o atendimento criando textos pré-definidos para dados bancários, Pix, horários de entrega e respostas frequentes.
            </p>
          </div>

          <Button
            onClick={handleOpenCreate}
            className="bg-ellevee-deep-ink text-white hover:bg-black gap-1.5 text-xs font-semibold shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nova Mensagem Rápida
          </Button>
        </div>

        {/* Barra de Filtro e Busca */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-ellevee-border/60">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por título, atalho (/pix) ou texto..."
              className="pl-8 bg-[#F8F8F6] border-ellevee-border text-xs text-ellevee-deep-ink"
            />
          </div>

          {/* Categorias Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto scroll-slim pb-1 sm:pb-0">
            <button
              onClick={() => setSelectedCategory("TODAS")}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors shrink-0 ${
                selectedCategory === "TODAS"
                  ? "bg-ellevee-deep-ink text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Todas ({replies.length})
            </button>
            {categories.map((cat) => {
              const count = replies.filter((r) => r.category.toLowerCase() === cat.toLowerCase()).length
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors shrink-0 ${
                    selectedCategory.toLowerCase() === cat.toLowerCase()
                      ? "bg-ellevee-purple text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {cat} ({count})
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Grid de Cards de Mensagens Rápidas */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-ellevee-border bg-white p-12 text-center space-y-3 shadow-2xs">
          <MessageSquareText className="h-8 w-8 text-slate-300 mx-auto" />
          <p className="text-xs text-ellevee-text-secondary">
            Nenhuma mensagem rápida encontrada para os filtros atuais.
          </p>
          <Button
            variant="outline"
            onClick={handleOpenCreate}
            className="text-xs border-ellevee-border text-ellevee-deep-ink"
          >
            Cadastrar nova mensagem rápida
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((reply) => (
            <div
              key={reply.id}
              className={`rounded-xl border border-ellevee-border bg-white p-4 shadow-2xs flex flex-col justify-between transition-all ${
                reply.isActive ? "hover:border-ellevee-purple/50" : "opacity-60 bg-slate-50/50"
              }`}
            >
              <div className="space-y-2.5">
                {/* Header do Card */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-ellevee-deep-ink truncate">
                        {reply.title}
                      </span>
                      {reply.shortcut && (
                        <span className="font-mono text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded">
                          /{reply.shortcut}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-ellevee-text-secondary font-medium">
                      Categoria: <strong className="text-slate-700">{reply.category}</strong>
                    </span>
                  </div>

                  {/* Switch Ativo/Inativo */}
                  <button
                    type="button"
                    onClick={() => handleToggle(reply)}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      reply.isActive ? "bg-emerald-600" : "bg-slate-300"
                    }`}
                    title={reply.isActive ? "Desativar" : "Ativar"}
                  >
                    <span
                      className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        reply.isActive ? "translate-x-3" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Conteúdo da Mensagem */}
                <div className="p-3 rounded-lg bg-[#F8F8F6] border border-ellevee-border text-xs text-ellevee-deep-ink font-sans whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto scroll-slim">
                  {reply.content}
                </div>
              </div>

              {/* Rodapé do Card com Ações */}
              <div className="pt-3 mt-3 border-t border-ellevee-border/60 flex items-center justify-between text-xs">
                <span className="text-[10px] text-slate-400 font-mono">
                  {reply.content.length} caracteres
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(reply.id, reply.content)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 hover:text-ellevee-deep-ink hover:bg-slate-100 transition-colors"
                    title="Copiar texto"
                  >
                    {copiedId === reply.id ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span className="text-emerald-700">Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copiar</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(reply)}
                    className="p-1.5 text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(reply.id, reply.title)}
                    disabled={deletingId === reply.id}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40"
                    title="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Diálogo de Criação/Edição de Mensagem Rápida */}
      <Dialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)} className="max-w-lg">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ellevee-deep-ink">
              {editingReply ? "Editar Mensagem Rápida" : "Nova Mensagem Rápida"}
            </DialogTitle>
            <DialogDescription className="text-xs text-ellevee-text-secondary">
              Defina o texto padrão e atalho para inserção instantânea no chat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1.5">
                  Título Identificador <span className="text-rose-500">*</span>
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Chave Pix CNPJ"
                  className="bg-white border-ellevee-border text-xs text-ellevee-deep-ink"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1.5">
                  Atalho de Teclado <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs">
                    /
                  </span>
                  <Input
                    value={shortcut}
                    onChange={(e) => setShortcut(e.target.value.replace(/^\//, ""))}
                    placeholder="ex: pix, horario, dados"
                    className="pl-6 bg-white border-ellevee-border text-xs font-mono text-ellevee-deep-ink"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1.5">
                Categoria da Mensagem
              </label>
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                {CATEGORY_PRESETS.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
                      category.toLowerCase() === cat.toLowerCase()
                        ? "bg-purple-50 border-ellevee-purple text-purple-700 font-semibold"
                        : "bg-white border-ellevee-border text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Ou digite uma categoria customizada..."
                className="bg-white border-ellevee-border text-xs text-ellevee-deep-ink"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-ellevee-deep-ink">
                  Texto da Mensagem <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  {content.length} caracteres
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder="Digite a mensagem completa que será enviada para o cliente..."
                className="w-full text-xs p-3 rounded-lg border border-ellevee-border bg-white text-ellevee-deep-ink focus:outline-none focus:ring-1 focus:ring-ellevee-purple resize-none leading-relaxed"
                required
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-ellevee-border bg-[#F8F8F6]">
              <div>
                <span className="text-xs font-semibold text-ellevee-deep-ink block">
                  Mensagem Ativa
                </span>
                <span className="text-[11px] text-ellevee-text-secondary">
                  Se desativada, não aparecerá na barra de mensagens rápidas do chat.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isActive ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    isActive ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSaving}
              className="border-ellevee-border text-ellevee-deep-ink text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !title.trim() || !content.trim()}
              className="bg-ellevee-deep-ink text-white hover:bg-black text-xs font-semibold"
            >
              {isSaving ? "Salvando..." : editingReply ? "Salvar Alterações" : "Cadastrar Mensagem"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}
