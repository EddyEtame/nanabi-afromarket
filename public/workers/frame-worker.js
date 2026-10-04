// Fetches and decodes film frames off the main thread (Firefox and Safari decode on the main thread otherwise).
// Compressed blobs are cached for the worker's lifetime; decoded bitmaps are transferred, never kept here.
//   in:  { type: 'init', urls }           absolute frame URLs
//        { type: 'fetch', i }             low-priority prefetch of frame i
//        { type: 'decode', i }            fetch (high priority) + decode frame i
//   out: { type: 'fetched', i, bytes } | { type: 'bitmap', i, bmp, ms } | { type: 'error', i, stage }

let urls = [];
const blobs = new Map();
const pending = new Map();

function load(i, priority) {
  const hit = blobs.get(i);
  if (hit) return Promise.resolve(hit);
  let request = pending.get(i);
  if (!request) {
    request = fetch(urls[i], { priority })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        blobs.set(i, blob);
        return blob;
      })
      .finally(() => pending.delete(i));
    pending.set(i, request);
  }
  return request;
}

self.onmessage = async ({ data: msg }) => {
  if (msg.type === 'init') {
    urls = msg.urls;
    return;
  }
  if (msg.type === 'fetch') {
    try {
      const blob = await load(msg.i, 'low');
      self.postMessage({ type: 'fetched', i: msg.i, bytes: blob.size });
    } catch {
      self.postMessage({ type: 'error', i: msg.i, stage: 'fetch' });
    }
    return;
  }
  if (msg.type === 'decode') {
    try {
      const blob = await load(msg.i, 'high');
      const start = performance.now();
      const bmp = await createImageBitmap(blob);
      self.postMessage({ type: 'bitmap', i: msg.i, bmp, ms: performance.now() - start }, [bmp]);
    } catch {
      self.postMessage({ type: 'error', i: msg.i, stage: 'decode' });
    }
  }
};
