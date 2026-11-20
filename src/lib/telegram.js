// Telegram Bot API (ücretsiz): yazı işlerinin kullanıcıyla konuştuğu kanal — görüş onayı.
// Sunucu yok: hat her turda getUpdates ile yeni yanıtları çeker (en çok ~25 dk gecikme).
// Güvenlik: yalnız TELEGRAM_CHAT_ID'den gelen mesaj ve düğmeler dikkate alınır.
const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
};

export const telegramEnabled = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const chat = () => process.env.TELEGRAM_CHAT_ID;
export const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// buttons: [[{text, data}]] → satır satır düğmeler. Dönüş: mesaj kimliği.
export async function send(html, buttons) {
  const r = await api('sendMessage', {
    chat_id: chat(),
    text: html.slice(0, 4000),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
  });
  return r.message_id;
}

export async function sendPhoto(url, caption) {
  return (await api('sendPhoto', { chat_id: chat(), photo: url, caption: caption.slice(0, 1000), parse_mode: 'HTML' })).message_id;
}

// Yeni olaylar: [{type:'button', data, messageId, callbackId} | {type:'text', text, replyTo}]. offset sonraki çağrıya verilir.
export async function updates(offset = 0) {
  const list = await api('getUpdates', { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  const events = [];
  for (const u of list) {
    if (u.callback_query && String(u.callback_query.message?.chat?.id) === String(chat()))
      events.push({ type: 'button', data: u.callback_query.data, messageId: u.callback_query.message.message_id, callbackId: u.callback_query.id });
    else if (u.message?.text && String(u.message.chat.id) === String(chat()))
      events.push({ type: 'text', text: u.message.text, replyTo: u.message.reply_to_message?.message_id ?? null });
  }
  return { events, offset: list.length ? list.at(-1).update_id + 1 : offset };
}

export const ack = (callbackId, text) => api('answerCallbackQuery', { callback_query_id: callbackId, text }).catch(() => {});
export const clearButtons = (messageId) => api('editMessageReplyMarkup', { chat_id: chat(), message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
