'use client'

import React, { useState } from 'react'
import {
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ExternalLink,
  X,
  Zap,
  Building2,
  Check
} from 'lucide-react'

export function WhatsAppOfficialCard() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleOpenCommercialChat = () => {
    const text = encodeURIComponent(
      'Olá! Gostaria de saber mais sobre a migração para o WhatsApp Oficial na Ellevee.'
    )
    window.open(`https://wa.me/5547991718483?text=${text}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      {/* CARD PRINCIPAL */}
      <div className="bg-gradient-to-br from-white to-[#f0fdf4] rounded-2xl border border-emerald-200/80 p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group">
        {/* Barra superior com gradiente oficial */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400" />

        <div className="space-y-4">
          {/* Cabeçalho do Card */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shrink-0 shadow-sm shadow-emerald-600/30">
                <ShieldCheck className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-semibold text-gray-900 text-base leading-tight">
                    WhatsApp Oficial
                  </h3>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 fill-emerald-100 shrink-0" />
                </div>
                <p className="text-xs text-gray-500 mt-0.5">WhatsApp Business API • Meta</p>
              </div>
            </div>

            {/* Badge Especial */}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100/80 text-emerald-800 border border-emerald-300/60 shrink-0 shadow-2xs">
              <Sparkles className="h-3 w-3 text-emerald-600" />
              Oficial
            </span>
          </div>

          {/* Resumo dos Diferenciais */}
          <div className="bg-white/80 border border-emerald-100 rounded-xl p-3.5 text-xs text-gray-700 space-y-2">
            <p className="leading-relaxed text-gray-600">
              A infraestrutura corporativa da Meta para empresas de alto volume. <strong>Sem risco de banimentos</strong> e com <strong>100% de estabilidade em nuvem</strong>.
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] font-medium text-emerald-900">
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-600 shrink-0" /> Zero Risco de Banimento
              </span>
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-600 shrink-0" /> Nuvem 24/7 sem Celular
              </span>
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-600 shrink-0" /> Selo Verde Verificado
              </span>
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-600 shrink-0" /> Escala Empresarial
              </span>
            </div>
          </div>
        </div>

        {/* Rodapé / Botão de Ação */}
        <div className="pt-4 border-t border-emerald-100/70 flex items-center justify-between gap-2 mt-4">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="w-full py-2.5 px-4 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 text-white rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center gap-2 shadow-xs transition-transform active:scale-[0.98]"
          >
            <span>Conhecer o WhatsApp Oficial</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* POP-UP / MODAL EXPLICATIVO */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal com Selo Meta */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-[#005d4b] via-[#004738] to-[#01352a] text-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-white/10 text-white">
                  <ShieldCheck className="h-6 w-6 text-emerald-300" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-base font-semibold text-white">WhatsApp Oficial</h3>
                    <CheckCircle2 className="h-4 w-4 text-emerald-300 fill-emerald-800" />
                  </div>
                  <p className="text-xs text-white/80">WhatsApp Business API • Infraestrutura Meta</p>
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

            {/* Conteúdo do Pop-up */}
            <div className="p-6 space-y-5">
              {/* Texto Principal sugerido pelo cliente */}
              <div className="p-4 bg-emerald-50/80 border border-emerald-100 rounded-xl">
                <p className="text-sm text-emerald-950 font-medium leading-relaxed">
                  O <strong>WhatsApp Oficial (WhatsApp Business API)</strong> é a solução ideal para empresas que desejam profissionalizar o atendimento e se comunicar com clientes de forma segura, escalável e confiável.
                </p>
              </div>

              {/* Grid de Benefícios */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Por que migrar para a API Oficial?
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/70 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      <span>Zero Risco de Bloqueios</span>
                    </div>
                    <p className="text-gray-500 text-[11px] leading-tight">
                      Linha 100% autorizada pela Meta, sem riscos de quedas repentinas ou banimento de número.
                    </p>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/70 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <Zap className="h-4 w-4 text-emerald-600" />
                      <span>Conexão em Nuvem 24/7</span>
                    </div>
                    <p className="text-gray-500 text-[11px] leading-tight">
                      Não depende de celular ligado à tomada, rede Wi-Fi ou bateria. Funciona diretamente nos servidores.
                    </p>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/70 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <Building2 className="h-4 w-4 text-emerald-600" />
                      <span>Identidade Corporativa</span>
                    </div>
                    <p className="text-gray-500 text-[11px] leading-tight">
                      Exibe o nome e marca da sua empresa no perfil do cliente, elegível ao selo verde oficial de verificação.
                    </p>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/70 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                      <span>Escalabilidade Ilimitada</span>
                    </div>
                    <p className="text-gray-500 text-[11px] leading-tight">
                      Disparo de mensagens em massa autorizadas, alta taxa de entrega e múltiplos atendentes simultâneos.
                    </p>
                  </div>
                </div>
              </div>

              {/* Botão de Ação / Redirecionamento Comercial */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleOpenCommercialChat}
                  className="w-full py-3.5 px-4 bg-[#005d4b] hover:bg-[#004738] text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-[0.98]"
                >
                  <span>Fale com nosso time comercial e migre sua conta</span>
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </button>
                <p className="text-[11px] text-center text-gray-400 mt-2">
                  Atendimento especializado Ellevee • Contato: (47) 99171-8483
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
