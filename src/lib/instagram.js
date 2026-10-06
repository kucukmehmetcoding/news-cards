// Instagram Graph API (Instagram Login) ile içerik yayını.
const BASE = `https://graph.instagram.com${process.env.IG_API_VERSION ? '/' + process.env.IG_API_VERSION : ''}`;

async function call(method, path, params = {}) {
  const url = new URL(`${BASE}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  if (method === 'GET') url.search = body.toString();
  const res = await fetch(url, { method, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(60000) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`IG ${path}: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

async function waitReady(id) {
  for (let i = 0; i < 20; i++) {
    const { status_code } = await call('GET', id, { fields: 'status_code' });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`IG container ${id}: ${status_code}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`IG container ${id}: zaman aşımı`);
}

// Kapsayıcı FINISHED görünse de yayın isteği bazen "Media ID is not available / not ready" (9007/2207027) döner.
// Bu geçici durumda birkaç kez bekleyip yeniden denenir; başka hata hemen yukarı iletilir.
async function publishContainer(user, id) {
  for (let i = 0; ; i++) {
    try {
      return (await call('POST', `${user}/media_publish`, { creation_id: id })).id;
    } catch (e) {
      if (i >= 5 || !/"code":9007|2207027/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

export async function publish(imageUrls, caption) {
  const user = process.env.IG_USER_ID || 'me';
  let container;
  if (imageUrls.length === 1) {
    container = (await call('POST', `${user}/media`, { image_url: imageUrls[0], caption })).id;
  } else {
    const children = [];
    for (const image_url of imageUrls) {
      const { id } = await call('POST', `${user}/media`, { image_url, is_carousel_item: 'true' });
      await waitReady(id);
      children.push(id);
    }
    container = (await call('POST', `${user}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption })).id;
  }
  await waitReady(container);
  return publishContainer(user, container);
}

// Hikâye: tek görsel, açıklama ve bağlantı yok (bağlantı çıkartması API'de desteklenmiyor).
export async function publishStory(imageUrls) {
  const user = process.env.IG_USER_ID || 'me';
  const { id } = await call('POST', `${user}/media`, { media_type: 'STORIES', image_url: imageUrls[0] });
  await waitReady(id);
  return publishContainer(user, id);
}
