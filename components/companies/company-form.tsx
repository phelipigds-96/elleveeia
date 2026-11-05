"use client"
import React, { useState } from 'react'
import { X } from 'lucide-react'

export default function CompanyForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState('Trial')
  const [status, setStatus] = useState('Ativo')

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // apenas mock: fechar painel
    onClose()
    setName('')
    setSlug('')
    setPlan('Trial')
    setStatus('Ativo')
    alert('Empresa criada (mock)')
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1" onClick={onClose} />

      <aside className="w-full max-w-md bg-white h-full shadow-xl p-6 overflow-auto">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Criar nova empresa</h2>
            <p className="mt-1 text-sm text-gray-600">Preencha os dados para criar um tenant na plataforma.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-gray-100">
            <X />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Nome da Empresa</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md" />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Slug</label>
            <input required value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md" />
            <p className="text-xs text-gray-500 mt-1">Identificador usado em subdomínio ou URL da empresa.</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Plano</label>
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md">
              <option>Trial</option>
              <option>Pro</option>
              <option>Enterprise</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block w-full px-3 py-2 border rounded-md">
              <option>Ativo</option>
              <option>Suspenso</option>
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md border">Cancelar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-indigo-600 text-white">Criar Empresa</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
