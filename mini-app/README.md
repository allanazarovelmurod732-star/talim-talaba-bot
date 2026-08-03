# Mandat reyestri — Telegram Mini App

`mandat.uzbmb.uz` ma'lumotlariga asoslangan, "Ta'lim Talaba" botining Telegram
**Mini App**i. Netlify'da bepul joylashadi (statik frontend + serverless
functions), maxsus server kerak emas.

## Nima qiladi

Uchta bo'lim, botdagi tugmalarga mos:

| Bo'lim | Vazifasi |
|---|---|
| 🆔 **ID bo'yicha** | 7 xonali abituriyent ID'i bo'yicha ism, ball, holat va (fanlar majmuasi aniqlansa) reytingdagi o'rnini ko'rsatadi |
| 🔎 **Kengaytirilgan** | Fanlar majmuasi + til bo'yicha to'liq ro'yxatni sahifalab ko'rsatadi, yoki ID orqali shu ro'yxatdagi o'z o'rningizni topadi |
| 📊 **189 ball** | Fanlar majmuasi + til + istalgan ball (standart: 189) bo'yicha, aynan shu ballni va undan yuqorisini nechta abituriyent to'plaganini hisoblaydi |

Barcha ma'lumot **jonli** — mandat.uzbmb.uz saytidan real vaqtda olinadi,
hech narsa oldindan yig'ib saqlanmaydi.

## Tuzilishi

```
mini-app/
├── netlify.toml                  # Netlify config (publish + functions + /api redirect)
├── package.json
├── netlify/functions/
│   ├── _lib/mandat.js            # mandat.uzbmb.uz bilan ishlash (parsing, binary search)
│   ├── mandat-id.js              # GET /api/mandat-id?id=1234567
│   ├── kq-list.js                # GET /api/kq-list?subject=...&lang=1&page=1
│   ├── kq-rank.js                # GET /api/kq-rank?subject=...&lang=1&id=1234567
│   └── ball-stats.js             # GET /api/ball-stats?subject=...&lang=1&score=189
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## Netlify'ga joylash

**Eng oson yo'l — Netlify Drop:**
1. https://app.netlify.com/drop ga kiring
2. Ushbu `mini-app` papkasini (butun holicha, `netlify.toml` bilan birga)
   brauzerga sudrab tashlang
3. Netlify avtomatik build qiladi va sizga `https://xxxxx.netlify.app`
   manzilini beradi

**Tavsiya etiladigan yo'l — GitHub orqali (keyingi yangilashlar oson bo'lishi uchun):**
1. Ushbu papkani GitHub repo'siga yuklang
2. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an
   existing project** → repo'ni tanlang
3. Build sozlamalari `netlify.toml`dan avtomatik olinadi (`publish = public`,
   `functions = netlify/functions`) — hech narsa qo'lda kiritish shart emas
4. **Deploy** tugmasini bosing

Joylashgandan keyin sizga `https://SIZNING-NOMINGIZ.netlify.app` manzili
beriladi (yoki Netlify sozlamalaridan o'z domeningizni bog'lashingiz mumkin).

## Botga ulash

`index.js` faylidagi `.env`ga shu manzilni qo'shing:

```
MINI_APP_URL=https://SIZNING-NOMINGIZ.netlify.app
```

Bot qayta ishga tushganda, asosiy menyudagi **"Mini ilovani ochish"** tugmasi
va chat menyu tugmasi shu mini ilovaga olib boradi.

## Muhim eslatmalar

- **Vaqt chegarasi:** Netlify Functions odatda ~10 soniyagacha ishlaydi.
  "189 ball" va "ID orqali o'rnim" so'rovlari mandat.uzbmb.uz saytiga bir
  nechta ketma-ket so'rov yuboradi (binary search orqali, sahifama-sahifa
  emas) — odatda 1-3 soniyada tugaydi, lekin juda sekin javob beradigan
  paytlarda (saytning o'zi sekinlashsa) vaqt chegarasiga urilishi mumkin.
  Agar buni tez-tez ko'rsangiz, Netlify **Pro** rejasida funksiyalar
  vaqtini 26 soniyagacha oshirish mumkin.
- **`MAX_SEARCH_PAGES`** (`netlify/functions/_lib/mandat.js` ichida, 3000ga
  o'rnatilgan) — bu binary search qidira oladigan eng katta sahifa raqami
  (≈30 000 kishigacha). Juda ommabop fanlar majmualarida (masalan,
  Matematika + Fizika) ba'zan bundan ham katta ro'yxat bo'lishi mumkin —
  agar shunday holat uchrasa, shu sonni oshirishingiz mumkin (lekin bu
  so'rovlar sonini va vaqtni ham oshiradi).
- **CORS/xavfsizlik:** funksiyalar faqat GET so'rovlarni qabul qiladi va
  hech qanday foydalanuvchi ma'lumotini saqlamaydi — har bir so'rov to'g'ridan-
  to'g'ri mandat.uzbmb.uz'ga yo'naltiriladi (bot koddagi izohlarda aytilganidek).
- Mini ilova Telegramdan tashqarida (oddiy brauzerda) ham ochiladi va ishlaydi
  — Telegram WebApp SDK topilmasa, shunchaki oddiy veb-sahifa sifatida ishlaydi.

## Mahalliy sinov (ixtiyoriy)

Agar Netlify CLI o'rnatilgan bo'lsa:

```bash
npm install -g netlify-cli
cd mini-app
netlify dev
```

Bu `http://localhost:8888` manzilida frontend + functionsni birga ishga
tushiradi (haqiqiy mandat.uzbmb.uz'ga so'rov yuboradi).
