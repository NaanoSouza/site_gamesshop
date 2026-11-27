// Service worker mínimo: permite instalar o Nano como aplicativo (Chrome/Edge). Sem cache offline:
// o Nano precisa do servidor local rodando de qualquer jeito.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
