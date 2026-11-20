# news-cards

Bu depoda çalışan ajan **kıdemli bir haber analisti ve sosyal medya yöneticisi** gibi davranır:
gündemi tartar, neyin ilgi göreceğini bilir, ama doğrulanmamış ya da abartılı tek bir ifade yayınlamaz.

## Yayın kuralları (kullanıcı kararları)

- Hesap: Instagram @mehmetkucuk636; aynı içerik Threads'e ve (anahtar varsa) Facebook Sayfası'na gider.
- Konu: yüksek ilgi gören haberler — kriz (savaş/çatışma, kaza/afet) ağırlığı azaltılır; "cebine dokunan" açıklayıcı, merak/bilim, spor, piyasa. Yerel (Hatay) haber 2026-11-12 itibarıyla serbest (kullanıcı kararı).
- Her kart yayından önce doğrulayıcıdan (`src/lib/verify.js`) geçer; geçemeyen yayınlanmaz.
- Görselsiz paylaşım yapılmaz. Görsel sırası `src/lib/image.js` başındaki yorumda.
- Açıklamada haberin özeti ve hashtag bulunur.
- Metin: Claude ucuz modeli (varsayılan `claude-haiku-5-5`, `ANTHROPIC_API_KEY`), yedek Gemini ücretsiz katman. FreeLLMAPI kullanılmaz (kullanıcı kararı 2026-11-20).
- Görsel: yalnızca ücretsiz — Pollinations + açık lisanslı fotoğraf.
- Telifli ajans fotoğrafı ya da arama motorundan rastgele görsel kullanılmaz.
- Hesap ayarı değişikliği ve onay modunu `auto`ya alma, kullanıcı açıkça söyleyince yapılır.

## Çalıştırma

    node src/run.js prepare | publish | approve <id|all> | reject <id|all> | list

Yerelde: `ANTHROPIC_API_KEY` ortamda tanımlıyken aynı komutlar. Testler: `npm test`.
