self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = {
      title: 'Ellevee IA',
      body: event.data.text() || 'Nova mensagem aguardando atendimento.',
    }
  }

  const title = data.title || 'Ellevee IA'
  const conversationId = data.conversationId || null
  const url =
    data.url ||
    (conversationId
      ? `/conversations?id=${encodeURIComponent(conversationId)}`
      : '/conversations')
  const tag =
    data.tag || (conversationId ? `conv-${conversationId}` : 'ellevee-alert')

  const options = {
    body: data.body || 'Nova mensagem aguardando atendimento.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-96.png',
    tag,
    renotify: typeof data.renotify === 'boolean' ? data.renotify : false,
    data: {
      url,
      conversationId,
    },
    vibrate: [180, 80, 180],
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const isViewingSameConversation = clientList.some((client) => {
          if (client.visibilityState !== 'visible') return false
          try {
            const clientUrl = new URL(client.url)
            if (!clientUrl.pathname.startsWith('/conversations')) return false
            if (!conversationId) return false
            return clientUrl.searchParams.get('id') === conversationId
          } catch {
            return false
          }
        })

        if (isViewingSameConversation && !data.forceShow) {
          return Promise.resolve()
        }

        return self.registration.showNotification(title, options)
      })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/conversations'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        const resolvedTarget = new URL(targetUrl, self.location.origin).href

        for (const client of clientList) {
          try {
            const clientUrl = new URL(client.url)
            if (clientUrl.origin === self.location.origin) {
              if ('navigate' in client && client.url !== resolvedTarget) {
                await client.navigate(resolvedTarget)
              }
              if ('focus' in client) {
                return client.focus()
              }
            }
          } catch {
            // Ignora URL malformada de client
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(resolvedTarget)
        }
      })
  )
})
