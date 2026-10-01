// Threads API ile görselli gönderi. Instagram'dan ayrı bir erişim anahtarı ister.
const BASE = `https://graph.threads.net${process.env.THREADS_API_VERSION ? '/' + process.env.THREADS_API_VERSION : '/v1.0'}`;

async function call(method, path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: process.env.THREADS_ACCESS_TOKEN });
  if (method === 'GET') url.search = body.toString();
  const res = await fetch(url, { method, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(60000) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Threads ${path}: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

async function waitReady(id) {
  for (let i = 0; i < 20; i++) {
    const { status, error_message } = await call('GET', id, { fields: 'status,error_message' });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Threads container ${id}: ${status} ${error_message ?? ''}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Threads container ${id}: zaman aşımı`);
}

export async function publish(imageUrls, text) {
  const user = process.env.THREADS_USER_ID || 'me';
  let container;
  if (imageUrls.length === 1) {
    container = (await call('POST', `${user}/threads`, { media_type: 'IMAGE', image_url: imageUrls[0], text })).id;
  } else {
    const children = [];
    for (const image_url of imageUrls) {
      const { id } = await call('POST', `${user}/threads`, { media_type: 'IMAGE', image_url, is_carousel_item: 'true' });
      await waitReady(id);
      children.push(id);
    }
    container = (await call('POST', `${user}/threads`, { media_type: 'CAROUSEL', children: children.join(','), text })).id;
  }
  await waitReady(container);
  return (await call('POST', `${user}/threads_publish`, { creation_id: container })).id;
}
