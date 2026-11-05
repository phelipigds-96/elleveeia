import React from 'react'

export const metadata = {
  title: 'Painel Admin',
}

export default function PainelAdminPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-6 lg:p-12">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl lg:text-4xl font-extrabold text-gray-900">Painel Admin</h1>
          <p className="mt-2 text-sm text-gray-600">Visão geral das ferramentas administrativas da sua conta.</p>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800">Usuários</h2>
            <p className="mt-2 text-sm text-gray-600">Gerencie contas, papéis e permissões.</p>
            <div className="mt-4">
              <a className="inline-block px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm" href="#">
                Abrir usuários
              </a>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800">Configurações</h2>
            <p className="mt-2 text-sm text-gray-600">Ajustes globais da empresa e integrações.</p>
            <div className="mt-4">
              <a className="inline-block px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm" href="#">
                Abrir configurações
              </a>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800">Relatórios</h2>
            <p className="mt-2 text-sm text-gray-600">Veja uso, faturamento e atividade do sistema.</p>
            <div className="mt-4">
              <a className="inline-block px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm" href="#">
                Ver relatórios
              </a>
            </div>
          </div>
        </section>

        <section className="mt-10 bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-base font-semibold text-gray-800">Atalhos</h3>
          <div className="mt-4 flex flex-wrap gap-3">
            <a className="px-3 py-2 bg-gray-100 rounded text-sm text-gray-700" href="#">Importar catálogo</a>
            <a className="px-3 py-2 bg-gray-100 rounded text-sm text-gray-700" href="#">Logs de auditoria</a>
            <a className="px-3 py-2 bg-gray-100 rounded text-sm text-gray-700" href="#">Tokens de API</a>
          </div>
        </section>
      </div>
    </main>
  )
}
