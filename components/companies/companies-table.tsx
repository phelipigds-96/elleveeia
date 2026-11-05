"use client"
import React, { useMemo, useState } from 'react'
import { MoreHorizontal, Edit2, Trash2, Lock } from 'lucide-react'

type Company = {
  id: string
  name: string
  slug: string
  cnpj?: string
  plan: 'Trial' | 'Pro' | 'Enterprise'
  status: 'Ativo' | 'Suspenso'
  createdAt: string
}

const MOCK: Company[] = [
  { id: '1', name: 'Alfa Tech', slug: 'alfa-tech', cnpj: '12.345.678/0001-90', plan: 'Pro', status: 'Ativo', createdAt: '2026-09-12' },
  { id: '2', name: 'Beta Corp', slug: 'beta', cnpj: '98.765.432/0001-10', plan: 'Enterprise', status: 'Ativo', createdAt: '2026-07-01' },
  { id: '3', name: 'Gamma Labs', slug: 'gamma-labs', cnpj: '11.222.333/0001-44', plan: 'Trial', status: 'Suspenso', createdAt: '2026-10-05' },
  { id: '4', name: 'Delta Serviços', slug: 'delta-servicos', cnpj: '55.666.777/0001-00', plan: 'Pro', status: 'Ativo', createdAt: '2026-08-20' },
]

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${color}`}>{children}</span>
  )
}

export default function CompaniesTable() {
  const [rows, setRows] = useState<Company[]>(MOCK)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta empresa?')) return
    setRows((s) => s.filter((r) => r.id !== id))
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR')

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b">
        <h3 className="text-lg font-semibold text-gray-800">Lista de empresas</h3>
        <p className="mt-1 text-sm text-gray-600">Exibe empresas cadastradas e status de acesso.</p>
      </div>

      <div className="p-4">
        <div className="w-full overflow-x-auto">
          <table className="min-w-full divide-y">
            <thead className="bg-white">
              <tr className="text-left text-sm text-gray-500">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Plano</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 align-top">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-xs text-gray-500">{r.slug} • {r.cnpj}</div>
                  </td>

                  <td className="px-4 py-4 align-top">
                    {r.plan === 'Pro' && <Badge color="bg-blue-100 text-blue-800">Pro</Badge>}
                    {r.plan === 'Enterprise' && <Badge color="bg-purple-100 text-purple-800">Enterprise</Badge>}
                    {r.plan === 'Trial' && <Badge color="bg-gray-100 text-gray-700">Trial</Badge>}
                  </td>

                  <td className="px-4 py-4 align-top">
                    {r.status === 'Ativo' ? (
                      <Badge color="bg-green-100 text-green-800">Ativo</Badge>
                    ) : (
                      <Badge color="bg-red-100 text-red-800">Suspenso</Badge>
                    )}
                  </td>

                  <td className="px-4 py-4 align-top text-sm text-gray-600">{formatDate(r.createdAt)}</td>

                  <td className="px-4 py-4 align-top relative">
                    <button
                      onClick={() => setOpenMenu(openMenu === r.id ? null : r.id)}
                      className="p-2 rounded-md hover:bg-gray-100"
                      aria-label="Ações"
                    >
                      <MoreHorizontal size={18} />
                    </button>

                    {openMenu === r.id && (
                      <div className="absolute right-4 top-12 z-20 w-40 bg-white border rounded-md shadow-md">
                        <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <Edit2 size={14} /> Editar
                        </button>
                        <button className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2">
                          <Lock size={14} /> Bloquear
                        </button>
                        <button onClick={() => handleDelete(r.id)} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-50 flex items-center gap-2">
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
