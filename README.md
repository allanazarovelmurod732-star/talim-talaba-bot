# Ta'lim Talaba — Telegram bot

Ta'lim sohasidagi yangiliklar, test platformasi va bot asoschisi haqida ma'lumot beruvchi Telegram bot. Tugmalarda Bot API 9.4 ning yangi imkoniyatlari — rangli tugmalar (`style: danger / success / primary`) va premium custom emoji (`icon_custom_emoji_id`) ishlatilgan.

## Tuzilma

```
talim-talaba-bot/
├── index.js          ← bot logikasi (Express + webhook, Render uchun tayyor)
├── package.json
├── .env.example       ← nusxalab .env qiling va to'ldiring
└── miniapp/
    └── index.html     ← Mini ilova (alohida serverga joylaysiz)
```

## 1-qadam — BotFather'da bot yaratish

1. @BotFather'ga yozing → `/newbot` → nom va username bering.
2. Olingan tokenni saqlab qo'ying (`.env` faylga `BOT_TOKEN` sifatida yoziladi).
3. **Muhim:** `icon_custom_emoji_id` va premium custom emojilar matn ichida to'liq ishlashi uchun, bot egasining (sizning) Telegram akkauntingizda **Telegram Premium** faol bo'lishi tavsiya etiladi — aks holda ba'zi premium emojilar oddiy ko'rinishda namoyon bo'lishi mumkin.

## 2-qadam — Mahalliy sozlash (ixtiyoriy, test uchun)

```bash
cp .env.example .env
# .env faylni oching va BOT_TOKEN, WEBHOOK_URL, MINI_APP_URL qiymatlarini kiriting
npm install
npm start
```

## 3-qadam — Render.com'ga deploy qilish

1. Ushbu papkani (yoki uni yuklagan GitHub repo'ni) Render'da **Web Service** sifatida ulang.
2. Sozlamalar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. **Environment** bo'limida quyidagilarni qo'shing:
   - `BOT_TOKEN` — BotFather tokeningiz
   - `WEBHOOK_URL` — Render bergan ochiq URL (masalan `https://talim-talaba-bot.onrender.com`). Birinchi marta deploy qilgandan keyin Render bergan haqiqiy domenni qo'yib, qayta deploy qilish kerak bo'lishi mumkin.
   - `MINI_APP_URL` — siz alohida joylaydigan `index.html` faylining ochiq https manzili (pastga qarang).
4. Deploy tugagach, bot avtomatik tarzda Telegram webhook'ini o'zi sozlaydi (`index.js` ichida `setWebHook` chaqiriladi).
5. Render bepul tarifda uxlab qolishi mumkin (15 daqiqa harakatsizlikdan keyin) — bu birinchi xabarga javobni biroz kechiktirishi mumkin, bu normal holat.

## 4-qadam — Mini ilovani joylash

`miniapp/index.html` — bu bot menyusidagi **"Mini ilova"** tugmasi orqali ochiladigan sahifa. Siz buni:

- Netlify, Vercel, GitHub Pages yoki Render Static Site kabi har qanday https hostingga joylashingiz mumkin.
- Joylab bo'lgach, olingan https manzilni `MINI_APP_URL` o'zgaruvchisiga yozing va botni qayta deploy qiling — bot menyu tugmasi va asosiy menyudagi "Mini ilovani ochish" tugmasi shu manzilga yo'naltiriladi.

**Eslatma:** Mini ilova sahifasida (oddiy veb-sahifa bo'lgani uchun) Telegram'ning haqiqiy premium custom emojilarini ko'rsatib bo'lmaydi — ular faqat Telegram ilovasi ichida, bot xabarlarida ishlaydi. Shu sababli sahifada vizual jihatdan mos keladigan oddiy emojilar ishlatilgan, bot bilan bir xil rang sxemasi (ko'k — asosiy, yashil — muvaffaqiyat, qizil — diqqat) saqlab qolingan.

## Menyu tuzilishi

- **/start** — asosiy menyu: 3 ta bo'lim tugmasi + (agar `MINI_APP_URL` berilgan bo'lsa) "Mini ilovani ochish" tugmasi.
  1. **Ta'lim kanalimiz** → kanal haqida ma'lumot + ko'k "Talaba" tugmasi (`t.me/talimtalaba`)
  2. **Test Platformamiz** → DTM test haqida ma'lumot + yashil "Yuklab olish" tugmasi (Play Store)
  3. **Elmurod Allanazarov** → asoschi haqida ma'lumot, qabul vaqti + Telegram (yashil) / Instagram (qizil) / Telefon (ko'k) tugmalari
- Har bir bo'limda **"⬅️ Orqaga"** tugmasi asosiy menyuga qaytaradi (xabar tahrirlanadi, yangi xabar yuborilmaydi).

## Custom emoji ID'larni o'zgartirish

Barcha premium emoji identifikatorlari `index.js` faylining yuqorisidagi `EMOJI` obyektida to'plangan — kerak bo'lsa shu yerdan almashtirishingiz mumkin.
