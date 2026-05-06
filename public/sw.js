// JuxBox service worker: cache-first for /uploads/*.mp3, with HTTP Range support
const CACHE_NAME = 'juxbox-audio-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/uploads/')) return;
  if (!/\.(mp3|wav|ogg|m4a)$/i.test(url.pathname)) return;
  event.respondWith(handleAudio(event.request));
});

async function handleAudio(request) {
  const cache = await caches.open(CACHE_NAME);
  // Always use a Range-less GET as the cache key so one cached entry serves
  // both full-file fetches and partial Range requests from the <audio> element.
  const key = new Request(request.url, { method: 'GET' });
  let cached = await cache.match(key);

  if (!cached) {
    try {
      const networkResponse = await fetch(key);
      if (networkResponse.ok && networkResponse.status === 200) {
        cache.put(key, networkResponse.clone()).catch(() => {});
        cached = networkResponse;
      } else {
        return networkResponse;
      }
    } catch (e) {
      return new Response('Offline and not cached', { status: 503 });
    }
  }

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) return makeRangeResponse(cached, rangeHeader);
  return cached;
}

async function makeRangeResponse(fullResponse, rangeHeader) {
  const buffer = await fullResponse.clone().arrayBuffer();
  const total = buffer.byteLength;
  const m = /^bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!m) return fullResponse.clone();
  const start = parseInt(m[1], 10);
  const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
  if (Number.isNaN(start) || start >= total || start > end) {
    return new Response('', {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}` },
    });
  }
  const slice = buffer.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': fullResponse.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(slice.byteLength),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'invalidate' && data.url) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(new Request(data.url, { method: 'GET' }));
    })());
  }
});
