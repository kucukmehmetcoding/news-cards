// Facebook Sayfası'na fotoğraflı gönderi (Graph API, Sayfa erişim anahtarı).
// Kişisel profile API ile gönderi atılamaz; hedef bir Sayfa olmalı.
const BASE = `https://graph.facebook.com${process.env.FB_API_VERSION ? '/' + process.env.FB_API_VERSION : ''}`;

async function post(path, params) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    body: new URLSearchParams({ ...params, access_token: process.env.FB_PAGE_TOKEN }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`FB ${path}: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

export async function publish(imageUrls, message) {
  const page = process.env.FB_PAGE_ID;
  if (imageUrls.length === 1) {
    const r = await post(`${page}/photos`, { url: imageUrls[0], caption: message });
    return r.post_id ?? r.id;
  }
  // Çok fotoğraflı gönderi: fotoğraflar yayımlanmadan yüklenir, sonra tek gönderiye eklenir.
  const attached = {};
  for (const [i, url] of imageUrls.entries()) {
    const { id } = await post(`${page}/photos`, { url, published: 'false' });
    attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  }
  return (await post(`${page}/feed`, { message, ...attached })).id;
}
