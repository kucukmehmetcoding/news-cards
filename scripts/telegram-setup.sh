#!/usr/bin/env bash
# Telegram onay botunu bağlar: bot anahtarını sorar (ekrana yazılmaz), bota attığın son mesajdan sohbet kimliğini bulur,
# ikisini GitHub secret olarak kaydeder ve bota deneme mesajı yollar. Önce Telegram'da botuna /start yaz.
set -euo pipefail
repo=kucukmehmetcoding/news-cards
read -rsp "BotFather'ın verdiği bot anahtarı: " token; echo
chat=$(curl -s "https://api.telegram.org/bot${token}/getUpdates" | jq -r '[.result[] | .message.chat.id // empty] | last // empty')
if [ -z "$chat" ]; then echo "Sohbet bulunamadı: Telegram'da botuna /start yazıp tekrar dene."; exit 1; fi
printf '%s' "$token" | gh secret set TELEGRAM_BOT_TOKEN -R "$repo"
printf '%s' "$chat" | gh secret set TELEGRAM_CHAT_ID -R "$repo"
curl -s -o /dev/null "https://api.telegram.org/bot${token}/sendMessage" -d chat_id="$chat" -d text="news-cards bağlandı. Yorum adayları buraya gelecek."
echo "Tamam: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID kaydedildi, bota deneme mesajı gitti."
