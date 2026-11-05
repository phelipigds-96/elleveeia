'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Search, Sparkles, Send, Check, User, Clock } from 'lucide-react'

type Conversation = {
  id: string
  customers: { name: string; phone?: string }
  last_message_preview: string
  last_message_at: string
  unread_count: number
  status: string
  channel?: string
}

type Message = {
  id: string
  sender_type: 'customer' | 'bot' | 'human' | 'system'
  content: string
  created_at: string
  metadata?: { delivery_status?: string }
}

const mockConversations: Conversation[] = [
  {
    id: 'c1',
    customers: { name: 'Mariana Silva', phone: '+55 11 99999-0001' },
    last_message_preview: 'Olá, tenho uma dúvida sobre o pedido #1234',
    last_message_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    unread_count: 2,
    status: 'open',
    channel: 'WhatsApp'
  },
  {
    id: 'c2',
    customers: { name: 'Carlos Pereira', phone: '+55 21 98888-1111' },
    last_message_preview: 'Obrigado, problema resolvido.',
    last_message_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    unread_count: 0,
    status: 'closed',
    channel: 'SMS'
  },
  {
    id: 'c3',
    customers: { name: 'Loja ACME', phone: '+55 31 97777-2222' },
    last_message_preview: 'Estou aguardando um humano para confirmar o preço.',
    last_message_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    unread_count: 5,
    status: 'human',
    channel: 'Web'
  }
]

const mockMessages: Record<string, Message[]> = {
  c1: [
    { id: 'm1', sender_type: 'customer', content: 'Oi, comprei ontem e ainda não chegou.', created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() },
    { id: 'm2', sender_type: 'bot', content: 'Verificando seu pedido #1234...', created_at: new Date(Date.now() - 18 * 60 * 1000).toISOString(), metadata: { delivery_status: 'sent' } },
    { id: 'm3', sender_type: 'human', content: 'Olá Mariana, sou Carol e vou te ajudar.', created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), metadata: { delivery_status: 'sent' } }
  ],
  c2: [
    { id: 'm4', sender_type: 'customer', content: 'Problema resolvido, obrigado!', created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString() }
  ],
  c3: [
    { id: 'm5', sender_type: 'customer', content: 'Preciso que um humano confirme o orçamento.', created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
    { id: 'm6', sender_type: 'bot', content: 'Solicitando atendimento humano...', created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), metadata: { delivery_status: 'pending' } }
  ]
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins}m`
  const hours = Math.floor(mins / 60)
  return `há ${hours}h`
}

export function PainelClient() {
  const [conversations] = useState<Conversation[]>(mockConversations)
  const [activeTab, setActiveTab] = useState<'all'|'bot'|'human'|'closed'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(mockConversations[0].id)
  const [messages, setMessages] = useState<Message[]>(mockMessages[selectedId as string] || [])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMessages(mockMessages[selectedId as string] || [])
    // scroll to bottom when messages change
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [selectedId])

  const filtered = conversations.filter(c => {
    if (activeTab === 'bot' && c.status !== 'open') return false
    if (activeTab === 'human' && c.status !== 'human') return false
    if (activeTab === 'closed' && c.status !== 'closed') return false
    if (!search) return true
    return c.customers.name.toLowerCase().includes(search.toLowerCase()) || (c.last_message_preview || '').toLowerCase().includes(search.toLowerCase())
  })

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!input.trim() || !selectedId) return
    const newMsg: Message = { id: String(Date.now()), sender_type: 'human', content: input.trim(), created_at: new Date().toISOString(), metadata: { delivery_status: 'sent' } }
    setMessages((m) => [...m, newMsg])
    // update mock store
    mockMessages[selectedId] = [...(mockMessages[selectedId] || []), newMsg]
    setInput('')
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  return (
    <div className="h-[100vh] w-full grid grid-cols-12 gap-4 bg-white">
      {/* SIDEBAR - 30% */}
      <aside className="col-span-12 md:col-span-4 lg:col-span-3 border-r h-full flex flex-col">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente..." className="w-full pl-10 pr-3 py-2 border rounded-md text-sm" />
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            <button onClick={() => setActiveTab('all')} className={`px-2 py-1 rounded ${activeTab==='all'?'bg-slate-100':'hover:bg-slate-50'}`}>Todos</button>
            <button onClick={() => setActiveTab('bot')} className={`px-2 py-1 rounded ${activeTab==='bot'?'bg-slate-100':'hover:bg-slate-50'}`}>IA Atendendo</button>
            <button onClick={() => setActiveTab('human')} className={`px-2 py-1 rounded ${activeTab==='human'?'bg-slate-100':'hover:bg-slate-50'}`}>Aguardando Humano</button>
            <button onClick={() => setActiveTab('closed')} className={`px-2 py-1 rounded ${activeTab==='closed'?'bg-slate-100':'hover:bg-slate-50'}`}>Resolvidos</button>
          </div>
        </div>

        <div className="overflow-y-auto p-2 space-y-2 flex-1">
          {filtered.map(conv => (
            <button key={conv.id} onClick={() => setSelectedId(conv.id)} className={`w-full text-left flex items-center gap-3 p-3 rounded-md ${selectedId===conv.id?'bg-slate-50':''}`}>
              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-sm font-semibold text-green-700">{conv.customers.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</div>
              <div className="flex-1">
                <div className="flex justify-between items-center">
                  <div className="font-medium text-sm truncate pr-2">{conv.customers.name}</div>
                  <div className="text-xs text-gray-400">{timeAgo(conv.last_message_at)}</div>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <div className="text-xs text-gray-500 truncate max-w-[140px]">{conv.last_message_preview}</div>
                  <div className="flex items-center gap-2">
                    {conv.unread_count>0 && <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{conv.unread_count}</span>}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* CENTER - 70% */}
      <main className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col h-full">
        <header className="h-16 border-b px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center"><User className="h-5 w-5 text-slate-600" /></div>
            <div>
              <div className="font-semibold">{conversations.find(c=>c.id===selectedId)?.customers.name}</div>
              <div className="text-xs text-gray-500">{conversations.find(c=>c.id===selectedId)?.customers.phone}</div>
            </div>
          </div>
          <div>
            <button className="bg-emerald-600 text-white px-3 py-2 rounded-md text-sm">Assumir Conversa</button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-6 bg-slate-50">
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.length===0 && (
              <div className="text-center text-gray-400 mt-20">Selecione uma conversa para ver o histórico.</div>
            )}

            {messages.map(msg => (
              msg.sender_type==='system' ? (
                <div key={msg.id} className="flex justify-center"><span className="text-[11px] text-gray-500 uppercase">— {msg.content} —</span></div>
              ) : (
                <div key={msg.id} className={`flex ${msg.sender_type==='customer'?'justify-start':'justify-end'}`}>
                  <div className={`${msg.sender_type==='customer'?'bg-white text-gray-800':'bg-emerald-600 text-white'} p-3 rounded-lg shadow max-w-[70%]`}> 
                    <div className="flex items-end gap-2">
                      {msg.sender_type==='bot' && <Sparkles className={`${msg.sender_type==='bot'?'text-white':'text-emerald-600'}`} />}
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                    <div className="text-[11px] text-gray-300 mt-2 text-right flex items-center justify-end gap-2">
                      <span className={`${msg.sender_type==='customer'?'text-gray-400':'text-gray-200'}`}>{new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                      {msg.sender_type!=='customer' && <Check className="h-4 w-4 text-white/80" />}
                    </div>
                  </div>
                </div>
              )
            ))}
            <div ref={scrollRef}></div>
          </div>
        </section>

        <footer className="h-20 border-t px-4 py-3 flex items-center bg-white">
          <form onSubmit={handleSend} className="flex items-center gap-3 w-full max-w-4xl mx-auto">
            <textarea value={input} onChange={(e)=>setInput(e.target.value)} placeholder="Digite uma mensagem..." className="flex-1 resize-none h-12 p-3 border rounded-md text-sm" />
            <button type="submit" className="h-12 w-12 rounded-md bg-emerald-600 text-white flex items-center justify-center"><Send className="h-5 w-5" /></button>
          </form>
        </footer>
      </main>
    </div>
  )
}

export default PainelClient
