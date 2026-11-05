"use client"
import React from 'react'
import { Search, Plus } from 'lucide-react'

export default function CompaniesHeader({ onCreate }: { onCreate: () => void }) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div>
        <h1 className="text-3xl lg:text-4xl font-extrabold text-gray-900">Empresas e Clientes</h1>
        <p className="mt-2 text-sm text-gray-600">Gerencie tenants, planos e o status das empresas na plataforma.</p>
      </div>

      <div className="flex items-center gap-3">
        <label className="relative">
          <span className="sr-only">Buscar empresas</span>
          <input
            className="pl-10 pr-4 py-2 rounded-md border border-gray-200 bg-white text-sm shadow-sm placeholder-gray-400 w-64"
            placeholder="Buscar empresa, slug ou CNPJ"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
        </label>

        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700"
        >
          <Plus size={16} />
          Nova Empresa
        </button>
      </div>
    </header>
  )
}
