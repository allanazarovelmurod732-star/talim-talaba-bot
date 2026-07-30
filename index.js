require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Asosiy menyu tepasidagi banner rasm (assets papkasida bo'lishi shart)
const MAIN_BANNER_PATH = path.join(__dirname, 'assets', 'banner.jpg');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const MINI_APP_URL = process.env.MINI_APP_URL || '';
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
// Mini ilovadagi "Fikr-mulohaza" formasidan kelgan xabarlar shu chatga yuboriladi
// (bo'lmasa, faqat konsolga yoziladi)
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

if (!BOT_TOKEN) {
  console.error("XATOLIK: BOT_TOKEN environment o'zgaruvchisi topilmadi (.env faylga qarang).");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { webHook: { port: false } });

// ---------------------------------------------------------------------------
// Stikerlar
// ---------------------------------------------------------------------------
const GREETING_STICKER_ID =
  'CAACAgIAAxkBAAEgvKVqYLQXonir0ZoEH8vO88MM9iAHigAC4lEAAgF6EEsLnWR0Hxx9Lj0E';

// ---------------------------------------------------------------------------
// DATA_DIR — ma'lumotlar saqlanadigan joy.
// Agar hostingda "persistent disk/volume" bo'lsa, .env fayliga
// DATA_DIR=/path/to/persistent/folder qo'shib, ma'lumotlarni shu doimiy
// diskka yo'naltiring — aks holda deploy/restart vaqtida ular o'chib ketishi mumkin.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[DATA] Ma'lumotlar shu papkada saqlanadi: ${DATA_DIR}`);
} catch (err) {
  console.error("[DATA] Ma'lumotlar papkasini tayyorlashda xatolik:", err.message);
}

// ---------------------------------------------------------------------------
// "Yo'nalish bo'yicha qidirish" — infoedu.uz'dan yig'ilgan grant/kontrakt bazasi
// Fayl formati: [{ nomi, yonalishlar: [{ nomi, talimShakli, til, grantKvota,
//   grantBall, kontraktKvota, kontraktBall, fanlar }] }, ...] (universitet bo'yicha guruhlangan)
// Faylni DATA_DIR ichiga "yonalishlar.json" nomi bilan joylashtiring.
// ---------------------------------------------------------------------------
const YONALISH_DB_PATH = path.join(DATA_DIR, 'yonalishlar.json');

// Xotirada tekis (flat) ro'yxat sifatida saqlanadi — qidiruv tezroq bo'lishi uchun
let YONALISH_FLAT = [];

function loadYonalishDb() {
  try {
    const raw = fs.readFileSync(YONALISH_DB_PATH, 'utf8');
    const universitetlar = JSON.parse(raw);
    const flat = [];
    for (const uni of universitetlar) {
      for (const y of uni.yonalishlar || []) {
        flat.push({ otm: uni.nomi, ...y });
      }
    }
    YONALISH_FLAT = flat;
    console.log(`[YONALISH] ${universitetlar.length} ta OTM, ${flat.length} ta yozuv yuklandi.`);
  } catch (err) {
    console.warn(`[YONALISH] "${YONALISH_DB_PATH}" topilmadi yoki noto'g'ri — qidiruv bo'sh natija beradi.`);
    YONALISH_FLAT = [];
  }
}
loadYonalishDb();

// ---------------------------------------------------------------------------
// "Mening 5 ta tanlovim" — O'zbekistonda abituriyentlar hujjat topshirishda
// 5 tagacha yo'nalish tanlashadi. Bu yerda foydalanuvchi "Mandat tanlash"
// natijalaridan yoqqan yo'nalishlarni o'z ro'yxatiga (5 tagacha) qo'shib
// boradi. Ro'yxat diskka (TANLOV_DB_PATH) saqlanadi — bot qayta ishga
// tushsa ham foydalanuvchi tanlovlari yo'qolmaydi.
// ---------------------------------------------------------------------------
const TANLOV_DB_PATH = path.join(DATA_DIR, 'tanlovlar.json');
const TANLOV_MAX = 5;

// userId (string) -> [{ key, otm, nomi, talimShakli, til, grantBall,
//   grantKvota, kontraktBall, kontraktKvota, fanlar }, ...]
let TANLOV_DB = new Map();

function tanlovItemKey(item) {
  return normalizeText(`${item.otm}|${item.nomi}|${item.talimShakli}|${item.til}`);
}

function loadTanlovDb() {
  try {
    const raw = fs.readFileSync(TANLOV_DB_PATH, 'utf8');
    const obj = JSON.parse(raw);
    TANLOV_DB = new Map(Object.entries(obj));
    console.log(`[TANLOV] ${TANLOV_DB.size} ta foydalanuvchi tanlovi yuklandi.`);
  } catch (err) {
    TANLOV_DB = new Map();
  }
}
loadTanlovDb();

function saveTanlovDb() {
  try {
    const obj = Object.fromEntries(TANLOV_DB);
    fs.writeFileSync(TANLOV_DB_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[TANLOV] Saqlashda xatolik:', err.message);
  }
}

function getUserTanlov(userId) {
  return TANLOV_DB.get(String(userId)) || [];
}

// Yo'nalishni foydalanuvchining tanlovlar ro'yxatiga qo'shadi.
// Natija: { ok: true } — muvaffaqiyatli qo'shildi
//         { ok: false, reason: 'full' } — allaqachon 5 ta to'lgan
//         { ok: false, reason: 'duplicate' } — bu yo'nalish ro'yxatda bor
function addToTanlov(userId, item) {
  const key = tanlovItemKey(item);
  const list = getUserTanlov(userId);

  if (list.some((x) => x.key === key)) {
    return { ok: false, reason: 'duplicate' };
  }
  if (list.length >= TANLOV_MAX) {
    return { ok: false, reason: 'full' };
  }

  const entry = {
    key,
    otm: item.otm,
    nomi: item.nomi,
    talimShakli: item.talimShakli,
    til: item.til,
    grantBall: item.grantBall,
    grantKvota: item.grantKvota,
    kontraktBall: item.kontraktBall,
    kontraktKvota: item.kontraktKvota,
    fanlar: item.fanlar,
  };
  list.push(entry);
  TANLOV_DB.set(String(userId), list);
  saveTanlovDb();
  return { ok: true };
}

// Tanlovlar ro'yxatidan bitta yo'nalishni o'chiradi (0-based index bo'yicha)
function removeFromTanlov(userId, index) {
  const list = getUserTanlov(userId);
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  TANLOV_DB.set(String(userId), list);
  saveTanlovDb();
  return true;
}

// Matnni solishtirish uchun kichik harfga o'tkazadi, tirnoqlarni va ortiqcha
// bo'shliqlarni tozalaydi
function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Foydalanuvchi tanlagan/yozgan fanlar majmuasiga ("Matematika + Fizika" kabi)
// mos keladigan yo'nalishlarni qidiradi — bazadagi "fanlar" maydoni bilan
// solishtiradi. "+" bo'yicha bo'lib, har bir fan nomi mavjudligini tekshiradi,
// shuning uchun fanlar tartibi yoki yozilishi biroz farq qilsa ham topadi.
function subjectMatches(itemFanlar, subjectQuery) {
  const itemNorm = normalizeText(itemFanlar || '');
  if (!itemNorm) return false;
  const parts = String(subjectQuery)
    .split('+')
    .map((p) => normalizeText(p))
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => itemNorm.includes(p));
}

function searchYonalishBySubject(subject) {
  return YONALISH_FLAT.filter((item) => subjectMatches(item.fanlar, subject));
}

// Bazadagi "til" va "talimShakli" maydonlarini foydalanuvchi tanlagan
// ta'lim tili / shakli bilan solishtiradi (moslashuvchan — qisman mos kelsa ham topadi)
function matchesTilShakl(item, til, shakl) {
  const itemTil = normalizeText(item.til || '');
  const itemShakl = normalizeText(item.talimShakli || '');
  const wantTil = normalizeText(til || '');
  const wantShakl = normalizeText(shakl || '');

  const tilOk = !wantTil || itemTil.includes(wantTil);
  const shaklOk = !wantShakl || itemShakl.includes(wantShakl);

  return tilOk && shaklOk;
}

// Eslatma — ballar qaysi qabul yiliga tegishli ekani
const YONALISH_YIL_ESLATMASI =
  "<i>Eslatma: bu ballar 2025/2026-o'quv yiliga tegishli.</i>";

// Rasmiy ma'lumotlarga ko'ra, bundan past ball bilan hech qanday yo'nalishga
// (na grant, na kontrakt) kirish imkoni yo'q — shuning uchun bu balldan past
// bo'lsa, bot yo'nalishlarni ro'yxat qilib o'tirmasdan darhol shu haqda ogohlantiradi.
const MIN_KIRISH_BALL = 56.7;

// Har bir sahifada ko'rsatiladigan yo'nalishlar soni (xabar juda uzun
// bo'lib ketmasligi uchun "Keyingisi/Oldingisi" tugmalari bilan sahifalanadi)
const YONALISH_ITEMS_PER_PAGE = 5;

// userId -> { subject, ball, items, page } — foydalanuvchining qidiruv
// natijalari va hozirgi sahifasi shu yerda saqlanadi
const yonalishResultsState = new Map();

// Berilgan ball bilan shu yo'nalishga (grant yoki kontrakt asosida) kirish
// mumkinmi-yo'qmi va qaysi holat ekanini aniqlaydi
function classifyYonalishItem(item, ball) {
  const grantBall = item.grantBall !== undefined && item.grantBall !== null && item.grantBall !== '' ? Number(item.grantBall) : null;
  const kontraktBall = item.kontraktBall !== undefined && item.kontraktBall !== null && item.kontraktBall !== '' ? Number(item.kontraktBall) : null;
  const grantKvota = Number(item.grantKvota) || 0;
  const kontraktKvota = Number(item.kontraktKvota) || 0;

  // Kvotasi 0 (yoki umuman yo'q) bo'lsa, o'sha turdagi qabul (grant yoki
  // kontrakt) mavjud emas deb hisoblanadi — ball yetsa ham, o'rin yo'q
  // bo'lgani uchun bu yo'nalish "kira oladi" deb ko'rsatilmaydi.
  if (grantKvota > 0 && grantBall !== null && ball >= grantBall) {
    return { qualifies: true, status: '🟢 Balingiz grantga yetadi' };
  }
  if (kontraktKvota > 0 && kontraktBall !== null && ball >= kontraktBall) {
    return { qualifies: true, status: '🔵 Balingiz faqat kontraktga yetadi' };
  }
  return { qualifies: false, status: null };
}

function formatYonalishItemLine(r, num) {
  return (
    `<b>${num}.</b> 🏫 <b>${r.otm}</b>\n` +
    `📚 ${r.nomi} · ${r.talimShakli} · ${r.til}\n` +
    `🟢 Grant: <b>${r.grantBall || '—'}</b> ball, ${r.grantKvota || 0} kvota\n` +
    `🔵 Kontrakt: <b>${r.kontraktBall || '—'}</b> ball, ${r.kontraktKvota || 0} kvota\n` +
    r._status
  );
}

// Foydalanuvchining hozirgi sahifasini matn + klaviatura ko'rinishida qaytaradi
function renderYonalishResultsPage(userId) {
  const state = yonalishResultsState.get(userId);
  if (!state) return null;

  const { subject, ball, items } = state;
  const totalPages = Math.max(1, Math.ceil(items.length / YONALISH_ITEMS_PER_PAGE));
  const page = Math.min(Math.max(state.page, 0), totalPages - 1);
  state.page = page;

  const start = page * YONALISH_ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + YONALISH_ITEMS_PER_PAGE);

  const tanlov = getUserTanlov(userId);
  const tanlovKeys = new Set(tanlov.map((t) => t.key));

  const header =
    `🔎 Fanlar majmuasi: <b>${subject}</b>\n` +
    `🎯 Balingiz: <b>${ball}</b>\n\n` +
    `✅ Kira oladigan yo'nalishlar: <b>${items.length}</b> ta (${page + 1}/${totalPages}-sahifa)\n\n` +
    `<i>Yoqqan yo'nalish tagidagi tugma orqali uni "Mening 5 ta tanlovim" ro'yxatiga qo'shishingiz mumkin (${tanlov.length}/${TANLOV_MAX}).</i>\n\n`;

  const body = pageItems.map((r, i) => formatYonalishItemLine(r, start + i + 1)).join('\n\n');
  const text = `${header}${body}\n\n${YONALISH_YIL_ESLATMASI}`;

  const keyboard = [];
  pageItems.forEach((r, i) => {
    const globalIndex = start + i;
    const isAdded = tanlovKeys.has(tanlovItemKey(r));
    keyboard.push([
      btn({
        text: isAdded ? `❌ ${start + i + 1}-ni tanlovdan olib tashlash` : `➕ ${start + i + 1}-ni tanlovga qo'shish`,
        callback_data: `yon_add_${globalIndex}`,
        style: isAdded ? 'danger' : 'success',
      }),
    ]);
  });

  const navRow = [];
  if (page > 0) navRow.push(btn({ text: '⬅️ Oldingisi', callback_data: 'yon_page_prev', style: 'primary' }));
  if (page < totalPages - 1) navRow.push(btn({ text: 'Keyingisi ➡️', callback_data: 'yon_page_next', style: 'primary' }));
  if (navRow.length) keyboard.push(navRow);

  keyboard.push([btn({ text: '📋 Mening 5 ta tanlovim', callback_data: 'menu_tanlov', style: 'primary' })]);
  keyboard.push(backRow);

  return { text, keyboard };
}

// ---------------------------------------------------------------------------
// bot.getMe() natijasini keshlab qo'yamiz — har xabarda qayta so'ramaslik uchun
let BOT_USERNAME = '';
let CACHED_BANNER_FILE_ID = null; // banner rasmni bir marta yuklab, keyin file_id orqali qayta ishlatamiz
// Admin (ADMIN_CHAT_ID) fikr-mulohaza (yoki buyurtma) xabariga "Reply" qilsa,
// javobni asl yozgan foydalanuvchiga qaytarish uchun: adminga yuborilgan xabar ID -> foydalanuvchi chat ID
const feedbackReplyMap = new Map();


// ---------------------------------------------------------------------------
// AI: Gemini (asosiy) + Groq (zaxira) — ikkalasi ham bepul tarif
// ---------------------------------------------------------------------------
const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_INSTRUCTION =
  "Sen Ta'lim Talaba botining aqlli yordamchisisiz. O'zbek tilida qisqa, aniq va foydali javoblar ber. " +
  "Ta'lim, universitetlar, testlar va o'qish haqidagi savollarga ustuvorlik ber. " +
  "Agar sendan \"seni kim yaratgan\", \"yaratuvching kim\", \"egang kim\" kabi savol so'ralsa, " +
  "faqat shu ma'lumotni ayt: Seni Elmurod Allanazarov yaratgan, u 2007-yilda Qashqadaryo viloyati " +
  "Kasbi tumanida tug'ilgan, hozirda TATU talabasi va Elite Test platformasi asoschisi " +
  "(platforma Google Play va Microsoft Store'da mavjud). Bog'lanish: Telegram @elmurodallanazarov, tel: +998505060717.";

// Gemini API orqali javob olishga urinadi. Muvaffaqiyatsiz bo'lsa, null qaytaradi
// (shunda chaqiruvchi tomon Groq'ga o'tadi) — faqat kalit umuman bo'lmasa yoki
// javob formati noto'g'ri bo'lsa xato tashlaydi.
// replyContext — foydalanuvchi reply qilgan bot xabarining matni (bo'lsa), suhbat
// tarixi sifatida modelga beriladi, shunda "davom et", "nima demoqchisan" kabi
// savollarni ham tushunadi.
async function askGemini(userMessage, replyContext) {
  if (!GEMINI_API_KEY) return null;

  const contents = [];
  if (replyContext) {
    contents.push({ role: 'model', parts: [{ text: replyContext }] });
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  if (!text) throw new Error('Gemini bo\'sh javob qaytardi');
  return text;
}

// Groq (Llama 3.3 70B) — Gemini limitga yetganda yoki xato bersa ishlatiladi
async function askGroq(userMessage, replyContext) {
  if (!GROQ_API_KEY) return null;

  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  if (replyContext) {
    messages.push({ role: 'assistant', content: replyContext });
  }
  messages.push({ role: 'user', content: userMessage });

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq bo\'sh javob qaytardi');
  return text;
}

// Avval Gemini'ni sinaydi, u ishlamasa (limit, xato, kalit yo'q) Groq'ga o'tadi
async function askAI(userMessage, replyContext) {
  try {
    const reply = await askGemini(userMessage, replyContext);
    if (reply) return reply;
  } catch (err) {
    console.error('Gemini xatosi, Groq\'ga o\'tilmoqda:', err.message);
  }

  try {
    const reply = await askGroq(userMessage, replyContext);
    if (reply) return reply;
  } catch (err) {
    console.error('Groq xatosi:', err.message);
  }

  return "AI javob bera olmadi. Keyinroq urinib ko'ring.";
}

// Telegram'dan kelgan rasmni (file_id) yuklab, base64 formatga o'giradi
async function downloadTelegramPhotoAsBase64(fileId) {
  const fileUrl = await bot.getFileLink(fileId);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Rasmni yuklab olishda xatolik: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  // Telegram ko'pincha noto'g'ri/umumiy content-type ("application/octet-stream")
  // qaytaradi, shuning uchun fayl kengaytmasiga qarab aniqlaymiz
  const extMatch = fileUrl.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const extToMime = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
  };
  const mimeType = extToMime[ext] || 'image/jpeg'; // Telegram rasmlari odatda JPEG

  return { base64, mimeType };
}

// Rasm + (ixtiyoriy) matn asosida Gemini'dan javob oladi (Groq'da vision yo'q,
// shuning uchun rasm tahlili faqat Gemini orqali ishlaydi)
async function askGeminiVision(userMessage, base64Image, mimeType) {
  if (!GEMINI_API_KEY) return "Rasm tahlili hozircha mavjud emas.";
  try {
    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data: base64Image, mimeType } },
              { text: userMessage || "Bu rasmda nima ekanligini o'zbek tilida qisqa tushuntirib ber." },
            ],
          },
        ],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini vision API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    return text || "Javob ololmadim.";
  } catch (err) {
    console.error('Gemini vision xatosi:', err.message);
    return "Rasmni tahlil qila olmadim. Keyinroq urinib ko'ring.";
  }
}

// ---------------------------------------------------------------------------
// Xatolik himoyasi
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (err) => {
  console.error('Kutilmagan promise xatosi:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('Kutilmagan xatolik:', err && err.message ? err.message : err);
});

// ---------------------------------------------------------------------------
// Custom premium emoji identifikatorlari
// ---------------------------------------------------------------------------
const EMOJI = {
  channelMenuIcon: '5451880684945708278',
  channelBodyIcon: '5447183459602669338',
  channelButtonIcon: '5472411062412254753',
  testMenuIcon: '5206186681346039457',
  testBodyIcon: '5397879236499353888',
  testButtonIcon: '5373130604147654226',
  founderMenuIcon: '5431650332419563627',
  receptionIcon: '5208573502046610594',
  clockIcon: '5260463209562776385',
  telegramIcon: '5231489647946768652',
  instagramIcon: '5231051793210810793',
  phoneIcon: '5318765591014678496',
  giftIcon: '5449800250032143374',
  backIcon: '5411112567609243032',
  checkIcon: '5206607081334906820',
};

// ---------------------------------------------------------------------------
// Majburiy obuna kanallar
// ---------------------------------------------------------------------------
const REQUIRED_CHANNELS = [
  { name: "Talim Talaba", username: '@talimtalaba', icon: '5451880684945708278' },
];

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------
function emoji(id, placeholder) {
  return `<tg-emoji emoji-id="${id}">${placeholder}</tg-emoji>`;
}

function stripTgEmoji(html) {
  return html.replace(/<tg-emoji emoji-id="\d+">(.*?)<\/tg-emoji>/g, '$1');
}

// AI'ga kontekst sifatida yuborishdan oldin barcha HTML teglarini tozalaydi
// (bot xabarlari <b>, <i>, <tg-emoji> kabi teglar bilan yuborilgan bo'lishi mumkin)
function stripAllHtml(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

function btn({ text, callback_data, url, web_app, style, icon }) {
  const button = { text };
  if (callback_data) button.callback_data = callback_data;
  if (url) button.url = url;
  if (web_app) button.web_app = web_app;
  if (style) button.style = style;
  if (icon) button.icon_custom_emoji_id = icon;
  return button;
}

const backRow = [btn({ text: 'Orqaga', callback_data: 'menu_back', icon: EMOJI.backIcon })];

// ---------------------------------------------------------------------------
// "Seni kim yaratgan?" kabi savollarga 100% aniq, o'zgarmas javob
// (AI ga yuborilmaydi — to'g'ridan-to'g'ri shu matn qaytariladi)
// ---------------------------------------------------------------------------
const CREATOR_ANSWER_HTML =
  `👤 Meni <b>Elmurod Allanazarov</b> yaratgan.\n\n` +
  `U <i>2007-yilda</i> Qashqadaryo viloyati, Kasbi tumanida tug'ilgan va hozirda <b>TATU</b> talabasi. ` +
  `Hozirda u <b>Elite Test</b> platformasining asoschisi — platforma <b>Google Play</b> va <b>Microsoft Store</b>ga rasman joylangan.\n\n` +
  `📞 <b>Bog'lanish uchun:</b>\n` +
  `${emoji('5231489647946768652', '✈️')} Telegram: @elmurodallanazarov\n` +
  `${emoji('5318765591014678496', '📞')} Telefon: +998505060717\n\n` +
  `Bemalol bog'lanishingiz mumkin!`;

// Turli yozilishlarni ("kim yaratgan", "yaratuvchisi kim", "egasi kim" va h.k.) ushlab qolish uchun kalit so'zlar
const CREATOR_QUESTION_REGEX =
  /(kim\s*(seni|sizni)?\s*yarat|yaratuvchi|yaratgan|kim\s*qilgan|egasi\s*kim|founder|creator|kim\s*(seni|sizni)?\s*ishlab\s*chiq|elmurod\s*allanazarov|elmurod\s*aka|dasturchisi\s*kim|kimning\s*boti)/i;

function isCreatorQuestion(text) {
  return CREATOR_QUESTION_REGEX.test(text);
}

function stripPremium(keyboard) {
  return keyboard
    .map((row) =>
      row
        .filter((button) => !button.web_app)
        .map((button) => {
          const { style, icon_custom_emoji_id, ...rest } = button;
          return rest;
        })
    )
    .filter((row) => row.length > 0);
}

// ---------------------------------------------------------------------------
// Obuna tekshiruvi
// ---------------------------------------------------------------------------
async function isSubscribedToAll(userId) {
  // Barcha kanallarni PARALLEL tekshiramiz (ketma-ket emas) — tezroq javob uchun
  const results = await Promise.all(
    REQUIRED_CHANNELS.map(async (ch) => {
      try {
        const member = await bot.getChatMember(ch.username, userId);
        return !['left', 'kicked'].includes(member.status);
      } catch (err) {
        console.error(`getChatMember xatosi (${ch.username}):`, err.message);
        return false;
      }
    })
  );
  return results.every(Boolean);
}

function gateScreen() {
  const channelLines = REQUIRED_CHANNELS
    .map((ch) => `${emoji(ch.icon, '📡')} <b>${ch.name}</b>`)
    .join('\n');

  const text =
    `🔒 <b>Botdan foydalanish uchun</b> quyidagi kanal(lar)ga obuna bo'ling:\n\n` +
    `${channelLines}\n\n` +
    `<i>Obuna bo'lgach, pastdagi "Tekshirish" tugmasini bosing.</i>`;

  const keyboard = REQUIRED_CHANNELS.map((ch, i) => [
    btn({
      text: ch.name,
      url: `https://t.me/${ch.username.replace('@', '')}`,
      icon: ch.icon,
      style: i === 0 ? 'primary' : 'danger',
    }),
  ]);
  keyboard.push([btn({ text: "✅ Tekshirish", callback_data: 'check_subscription', style: 'success' })]);

  return { text, keyboard };
}

// ---------------------------------------------------------------------------
// Ekranlar
// ---------------------------------------------------------------------------
function mainMenuScreen() {
  const text =
    `🎓 <b>Ta'lim Talaba</b> botiga xush kelibsiz!\n\n` +
    `Bu yerda siz <b>ta'lim sohasidagi</b> eng so'nggi yangiliklar, foydali test platformalari va bot haqida ma'lumotlarni topasiz.\n\n` +
    `<i>Quyidagi bo'limlardan birini tanlang yoki savol yozing</i> 👇`;

  const keyboard = [
    [btn({ text: "Ta'lim kanalimiz", callback_data: 'menu_channel', icon: EMOJI.channelMenuIcon, style: 'primary' })],
    [btn({ text: 'Test Platformamiz', callback_data: 'menu_test', icon: EMOJI.testMenuIcon, style: 'success' })],
    [btn({ text: 'Elmurod Allanazarov', callback_data: 'menu_founder', icon: EMOJI.founderMenuIcon, style: 'danger' })],
    [btn({ text: '❓ Tez-tez so\'raladigan savollar', callback_data: 'menu_faq', style: 'primary' })],
    [btn({ text: '🎯 Mandat tanlash', callback_data: 'menu_yonalish', style: 'success' })],
    [btn({ text: '📋 Mening 5 ta tanlovim', callback_data: 'menu_tanlov', style: 'primary' })],
  ];

  if (MINI_APP_URL) {
    keyboard.push([
      btn({ text: 'Mini ilovani ochish', web_app: { url: MINI_APP_URL }, style: 'primary' }),
    ]);
  }

  return { text, keyboard };
}

function channelScreen() {
  const text =
    `${emoji(EMOJI.channelBodyIcon, '📡')} <b>Ta'lim Talaba</b> — siz qidirayotgan yangi kanallardan biri! ` +
    `U hozirda <b>barcha universitetlar</b> haqida eng so'nggi ma'lumotlarni berib kelmoqda.\n\n` +
    `<i>Siz ham talaba bo'lmoqchi bo'lsangiz, unda ushbu bottan tezroq foydalaning!</i>`;

  const keyboard = [
    [btn({ text: 'Talaba', url: 'https://t.me/talimtalaba', style: 'primary', icon: EMOJI.channelButtonIcon })],
    backRow,
  ];

  return { text, keyboard };
}

function testScreen() {
  const text =
    `${emoji(EMOJI.testBodyIcon, '📝')} <b>Barcha turdagi test dasturlari</b> shu yerda! Yangilik — <b>DTM test</b>. ` +
    `Siz ushbu bo'lim orqali bemalol <i>milliy sertifikatingizni</i> ishlatishingiz mumkin.`;

  const keyboard = [
    [
      btn({
        text: 'Yuklab olish',
        url: 'https://play.google.com/store/apps/details?id=app.netlify.eloquent_khapse_99d13b.twa&pcampaignid=web_share',
        style: 'success',
        icon: EMOJI.testButtonIcon,
      }),
    ],
    backRow,
  ];

  return { text, keyboard };
}

function founderScreen() {
  const text =
    `👤 <b>Elmurod Allanazarov</b>\n\n` +
    `Mana shu botimiz <b>asoschisi va dasturchisi</b> (developeri). U <i>2007-yil 17-noyabrda</i> Qashqadaryo viloyati, Kasbi tumanida tug'ilgan.\n\n` +
    `${emoji(EMOJI.receptionIcon, '📅')} <b>Qabul vaqti:</b>\n` +
    `Dushanba – Shanba\n` +
    `${emoji(EMOJI.clockIcon, '🕖')} 07:00 – 12:00\n` +
    `${emoji(EMOJI.clockIcon, '🕕')} 18:00 – 20:00\n\n` +
    `📞 <b>Telefon:</b> +998505060717`;

  const keyboard = [
    [btn({ text: 'Telegram', url: 'https://t.me/elmurodallanazarov', style: 'success', icon: EMOJI.telegramIcon })],
    [
      btn({
        text: 'Instagram',
        url: 'https://www.instagram.com/elmurodallanazarov?utm_source=qr&igsh=MWF0dWtpMDRmbTlpMA==',
        style: 'danger',
        icon: EMOJI.instagramIcon,
      }),
    ],
    [btn({ text: 'Telefon', callback_data: 'show_phone', style: 'primary', icon: EMOJI.phoneIcon })],
    backRow,
  ];

  return { text, keyboard };
}

function faqScreen() {
  const text =
    `❓ <b>Tez-tez so'raladigan savollar</b>\n\n` +
    `<b>1. Bot bepulmi?</b>\n` +
    `Ha, botning barcha imkoniyatlari to'liq bepul.\n\n` +
    `<b>2. AI qanday savollarga javob beradi?</b>\n` +
    `Ta'lim, universitetlar, testlar va o'qish bilan bog'liq har qanday savolga — shunchaki xabar yozing.\n\n` +
    `<b>3. Rasm yuborsam bo'ladimi?</b>\n` +
    `Ha, rasm yuboring — AI uni tahlil qilib, izoh beradi.\n\n` +
    `<b>4. Muammo yoki taklif bo'lsa?</b>\n` +
    `Mini ilovadagi "Fikr-mulohaza" bo'limi orqali yozing yoki bevosita <b>Elmurod Allanazarov</b>ga murojaat qiling.`;

  const keyboard = [backRow];
  return { text, keyboard };
}

// ---------------------------------------------------------------------------
// "Admin 24/7" — foydalanuvchi yo'nalish tanlash bo'yicha to'g'ridan-to'g'ri
// admindan shaxsiy maslahat olishi uchun kontakt kartasi
// ---------------------------------------------------------------------------
function adminAdviceScreen() {
  const text =
    `${emoji(EMOJI.giftIcon, '🟢')} <b>Admin 24/7</b>\n\n` +
    `Yo'nalish tanlash bo'yicha shaxsiy maslahat kerakmi? Pastdagi tugmalar orqali ` +
    `to'g'ridan-to'g'ri adminga murojaat qiling — sizga qaysi yo'nalish(lar) mos kelishi haqida yordam beramiz.`;

  const keyboard = [
    [btn({ text: 'Telegram', url: 'https://t.me/elmurodallanazarov', style: 'success', icon: EMOJI.telegramIcon })],
    [btn({ text: 'Telefon', callback_data: 'show_phone', style: 'primary', icon: EMOJI.phoneIcon })],
  ];

  return { text, keyboard };
}

// ---------------------------------------------------------------------------
// "Mening 5 ta tanlovim" — foydalanuvchi "Mandat tanlash" natijalaridan
// qo'shib borgan (5 tagacha) yo'nalishlar ro'yxati
// ---------------------------------------------------------------------------
function formatTanlovItemLine(item, num) {
  return (
    `<b>${num}.</b> 🏫 <b>${item.otm}</b>\n` +
    `📚 ${item.nomi} · ${item.talimShakli} · ${item.til}\n` +
    `🟢 Grant: <b>${item.grantBall || '—'}</b> ball, ${item.grantKvota || 0} kvota\n` +
    `🔵 Kontrakt: <b>${item.kontraktBall || '—'}</b> ball, ${item.kontraktKvota || 0} kvota`
  );
}

function tanlovScreen(userId) {
  const list = getUserTanlov(userId);

  if (!list.length) {
    const text =
      `📋 <b>Mening 5 ta tanlovim</b>\n\n` +
      `Hozircha ro'yxatingiz bo'sh.\n\n` +
      `Hujjat topshirishda O'zbekistonda 5 tagacha yo'nalish ko'rsatasiz — shu ro'yxatni oldindan tayyorlab qo'yish uchun ` +
      `<b>"🎯 Mandat tanlash"</b> bo'limida qidiruv qiling va yoqqan yo'nalishlar tagidagi <b>"➕ Tanlovga qo'shish"</b> ` +
      `tugmasini bosing.`;
    const keyboard = [
      [btn({ text: '🎯 Mandat tanlash', callback_data: 'menu_yonalish', style: 'success' })],
      backRow,
    ];
    return { text, keyboard };
  }

  const header =
    `📋 <b>Mening 5 ta tanlovim</b> (${list.length}/${TANLOV_MAX})\n\n` +
    `<i>O'zbekistonda hujjat topshirishda ko'rsatiladigan ustuvorlik tartibidagi kabi — birinchi yozilgani eng ustuvor.</i>\n\n`;
  const body = list.map((item, i) => formatTanlovItemLine(item, i + 1)).join('\n\n');
  const text = `${header}${body}\n\n${YONALISH_YIL_ESLATMASI}`;

  const keyboard = list.map((item, i) => [
    btn({ text: `❌ ${i + 1}-ni o'chirish`, callback_data: `tanlov_remove_${i}`, style: 'danger' }),
  ]);
  if (list.length < TANLOV_MAX) {
    keyboard.push([btn({ text: '➕ Yana yo\'nalish qo\'shish', callback_data: 'menu_yonalish', style: 'success' })]);
  }
  keyboard.push(backRow);

  return { text, keyboard };
}

// ---------------------------------------------------------------------------
// "Mandat tanlash" (avvalgi "Yo'nalish bo'yicha qidirish") — fanlar majmuasi
// bo'yicha admin bilan aniq maslahat oqimi
// ---------------------------------------------------------------------------
// Fanlar majmuasi tugmalari ro'yxati (kerak bo'lsa shu massivga qo'shib/o'zgartirib turing)
const MANDAT_SUBJECT_OPTIONS = [
  'Biologiya + Kimyo',
  'Biologiya + Ona tili va adabiyoti',
  'Chet tili + Ona tili va adabiyoti',
  'Fizika + Chet tili',
  'Fizika + Matematika',
  'Fransuz tili + Ona tili va adabiyoti',
  'Geografiya + Matematika',
  'Huquqshunoslik fanlari + Chet tili',
  'Ingliz tili + Ona tili va adabiyoti',
  'Kasbiy (ijodiy imtihon) + Chet tili',
  'Kasbiy (ijodiy imtihon) + Kasbiy (ijodiy imtihon)',
  'Kasbiy (ijodiy imtihon) + Ona tili va adabiyoti',
  'Kasbiy (ijodiy) imtihon + Kasbiy (ijodiy) imtihon',
  'Kimyo + Biologiya',
  'Kimyo + Matematika',
  'Matematika + Chet tili',
  'Matematika + Fizika',
  'Matematika + Geografiya',
  'Matematika + Ona tili va adabiyoti',
  'Nemis tili + Ona tili va adabiyoti',
  'Ona tili va adabiyoti + Chet tili',
  'Ona tili va adabiyoti + Matematika',
  "Oʻzbek tili va adabiyoti + Chet tili",
  "Qirg'iz tili va adabiyoti + Tarix",
  'Qoraqalpoq tili va adabiyoti + Chet tili',
  'Qoraqalpoq tili va adabiyoti + Tarix',
  'Qozoq tili va adabiyoti + Chet tili',
  'Qozoq tili va adabiyoti + Tarix',
  "Rus tili + O'zbek tili va adabiyoti",
  'Rus tili va adabiyoti + Chet tili',
  'Rus tili va adabiyoti + Tarix',
  'Tarix + Chet tili',
  'Tarix + Geografiya',
  'Tarix + Kasbiy (ijodiy) imtihon',
  'Tarix + Matematika',
  'Tarix + Ona tili va adabiyoti',
  'Tojik tili va adabiyoti + Chet tili',
  'Tojik tili va adabiyoti + Tarix',
  'Turkman tili va adabiyoti + Chet tili',
  'Turkman tili va adabiyoti + Tarix',
];

// Foydalanuvchi o'zining fanlar majmuasini qo'lda yozayotganini kutayotgan bo'lsak, shu Set ichida turadi
// Foydalanuvchi "Yo'nalish bo'yicha qidirish" bo'limida o'zining fanlar
// majmuasini qo'lda yozayotganini kutayotgan bo'lsak, shu Set ichida turadi
const awaitingYonalishCustomSubject = new Set();
// "Yo'nalish bo'yicha qidirish" bo'limida fanlar majmuasi tanlangandan keyin,
// ball kelgunga qadar shu Set ichida turadi
const awaitingYonalishBall = new Set();
// Fanlar majmuasi tanlangandan keyin, ball kelgunga qadar vaqtincha shu yerda
// saqlanadi (userId -> fanlar majmuasi matni)
const pendingYonalishSubject = new Map();
// Ta'lim tili (O'zbek/Rus) va ta'lim shakli (Kunduzgi/Masofaviy) tanlanganda,
// ball kelgunga qadar vaqtincha shu yerda saqlanadi (userId -> matn)
const pendingYonalishTil = new Map();
const pendingYonalishShakl = new Map();

function yonalishSubjectScreen() {
  const text =
    `🎯 <b>Mandat tanlash</b>\n\n` +
    `Fanlar majmuangizni tanlang 👇\n\n` +
    `<i>Ro'yxatda kerakli majmua yo'q bo'lsa, "✍️ O'zim yozaman" tugmasini bosib, o'zingiz yozishingiz mumkin.</i>`;

  const keyboard = MANDAT_SUBJECT_OPTIONS.map((subject, i) => [
    btn({ text: subject, callback_data: `yon_subj_${i}`, style: 'primary' }),
  ]);
  keyboard.push([btn({ text: "✍️ O'zim yozaman", callback_data: 'yon_subj_custom', style: 'success' })]);
  keyboard.push(backRow);

  return { text, keyboard };
}

// Fanlar majmuasi tanlangandan (yoki yozilgandan) keyin ta'lim tilini so'raydi
function yonalishTilScreen(subject) {
  const text =
    `✅ Fanlar majmuasi: <b>${subject}</b>\n\n` +
    `🌐 Ta'lim tilini tanlang 👇`;

  const keyboard = [
    [btn({ text: "O'zbek", callback_data: 'yon_til_uz', style: 'primary' })],
    [btn({ text: 'Rus', callback_data: 'yon_til_ru', style: 'success' })],
    backRow,
  ];

  return { text, keyboard };
}

async function askForYonalishTil(chatId, userId, subject) {
  pendingYonalishSubject.set(userId, subject);
  const { text, keyboard } = yonalishTilScreen(subject);
  await safeSend(chatId, text, keyboard);
}

// Ta'lim tili tanlangandan keyin ta'lim shaklini so'raydi
function yonalishShaklScreen() {
  const text = `🏫 Ta'lim shaklini tanlang 👇`;

  const keyboard = [
    [btn({ text: 'Kunduzgi', callback_data: 'yon_shakl_kunduzgi', style: 'primary' })],
    [btn({ text: 'Masofaviy', callback_data: 'yon_shakl_masofaviy', style: 'success' })],
    backRow,
  ];

  return { text, keyboard };
}

async function askForYonalishShakl(chatId, userId) {
  const { text, keyboard } = yonalishShaklScreen();
  await safeSend(chatId, text, keyboard);
}

// Fanlar majmuasi, til va shakl tanlangandan (yoki yozilgandan) keyin DTM balini so'raydi
async function askForYonalishBall(chatId, userId) {
  awaitingYonalishBall.add(userId);
  const subject = pendingYonalishSubject.get(userId) || 'Kiritilmagan';
  try {
    await bot.sendMessage(
      chatId,
      `✅ Fanlar majmuasi: <b>${subject}</b>\n\n` +
        `🔢 Endi DTM balingizni raqam bilan yozing (masalan: <b>154.5</b>):`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error("Yo'nalish ball so'rash xabari xatosi:", err.message);
  }
}

const SCREENS = {
  menu_back: mainMenuScreen,
  menu_channel: channelScreen,
  menu_test: testScreen,
  menu_founder: founderScreen,
  menu_faq: faqScreen,
  menu_yonalish: yonalishSubjectScreen,
  menu_admin_advice: adminAdviceScreen,
};

// ---------------------------------------------------------------------------
// Xavfsiz yuborish/tahrirlash
// ---------------------------------------------------------------------------
async function safeSend(chatId, html, keyboard) {
  try {
    await bot.sendMessage(chatId, html, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error("sendMessage xatosi (premium), oddiyga o'tilmoqda:", err.message);
    try {
      await bot.sendMessage(chatId, stripTgEmoji(html), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: stripPremium(keyboard) },
      });
    } catch (err2) {
      console.error('sendMessage xatosi (oddiy ham muvaffaqiyatsiz):', err2.message);
    }
  }
}

async function safeEdit(chatId, messageId, html, keyboard) {
  try {
    await bot.editMessageText(html, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    if (String(err.message).includes('message is not modified')) return;
    console.error("editMessageText xatosi (premium), oddiyga o'tilmoqda:", err.message);
    try {
      await bot.editMessageText(stripTgEmoji(html), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: stripPremium(keyboard) },
      });
    } catch (err2) {
      if (!String(err2.message).includes('message is not modified')) {
        console.error('editMessageText xatosi (oddiy ham muvaffaqiyatsiz):', err2.message);
      }
    }
  }
}

async function sendMainMenu(chatId, isGroup = false) {
  const { text, keyboard } = mainMenuScreen();
  const finalKeyboard = isGroup ? stripPremium(keyboard) : keyboard;
  const finalText = isGroup ? stripTgEmoji(text) : text;
  try {
    // Agar banner file_id keshda bo'lsa, uni ishlatamiz — bu qayta yuklashdan
    // ancha tezroq, chunki Telegram serveriga fayl qayta upload qilinmaydi.
    const photoSource = CACHED_BANNER_FILE_ID || MAIN_BANNER_PATH;
    const sent = await bot.sendPhoto(chatId, photoSource, {
      caption: finalText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: finalKeyboard },
    });
    // Birinchi (fayldan) yuborishdan keyin qaytgan file_id ni saqlab qo'yamiz
    if (!CACHED_BANNER_FILE_ID) {
      const photos = sent.photo;
      if (photos && photos.length) {
        CACHED_BANNER_FILE_ID = photos[photos.length - 1].file_id;
      }
    }
  } catch (err) {
    console.error('sendPhoto xatosi (banner), faqat matn yuborilmoqda:', err.message);
    await safeSend(chatId, finalText, finalKeyboard);
  }
}

async function deleteMessageSafe(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (err) {
    console.error('deleteMessage xatosi:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Handlerlar
// ---------------------------------------------------------------------------
// Shaxsiy chat ID'ni topish uchun — shu ID'ni .env fayldagi ADMIN_CHAT_ID ga
// qo'yib qo'ysangiz, mini ilovadagi "Fikr-mulohaza" xabarlari shu chatga keladi
bot.onText(/^\/id/, async (msg) => {
  try {
    await bot.sendMessage(
      msg.chat.id,
      `🆔 Ushbu chatning ID raqami:\n<code>${msg.chat.id}</code>\n\n` +
        `Buni nusxalab, <code>.env</code> fayldagi <code>ADMIN_CHAT_ID</code> qatoriga joylashtiring.`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('/id buyrug\'i xatosi:', err.message);
  }
});

bot.onText(/^\/start(?:\s+(\S+))?/, async (msg, match) => {
  const userId = msg.from.id;
  const chatType = msg.chat.type;

  // Guruhda — obuna tekshiruvisiz, premium-siz
  if (chatType === 'group' || chatType === 'supergroup') {
    await sendMainMenu(msg.chat.id, true);
    return;
  }

  // Shaxsiy chatda — obuna tekshiruvi bilan
  let subscribed = true;
  try {
    subscribed = await isSubscribedToAll(userId);
  } catch (err) {
    console.error('/start obuna tekshiruvi xatosi:', err.message);
  }

  if (!subscribed) {
    const { text, keyboard } = gateScreen();
    await safeSend(msg.chat.id, text, keyboard);
    return;
  }

  try {
    await bot.sendSticker(msg.chat.id, GREETING_STICKER_ID);
  } catch (err) {
    console.error('Salomlashish stikerini yuborishda xatolik:', err.message);
  }

  await sendMainMenu(msg.chat.id);

  // MUHIM: Telegram cheklovi — mini ilova ichidagi "Fikr-mulohaza" formasi
  // (sendData) faqat maxsus KLAVIATURA tugmasi orqali ochilganda ishlaydi.
  // Inline tugma yoki menyu tugmasi orqali ochilganda sendData jim ishlamaydi.
  // Shuning uchun shu maxsus tugmani alohida yuboramiz. "Admin 24/7" tugmasi
  // mini ilovadan qat'i nazar har doim ko'rsatiladi.
  const bottomKeyboardRows = [];
  if (MINI_APP_URL) {
    bottomKeyboardRows.push([
      {
        text: 'Mini ilova (fikr-mulohaza uchun)',
        web_app: { url: MINI_APP_URL },
        style: 'success',
        icon_custom_emoji_id: '5443038326535759644',
      },
    ]);
  }
  bottomKeyboardRows.push([
    {
      text: 'Admin 24/7',
      style: 'danger',
      icon_custom_emoji_id: EMOJI.giftIcon,
    },
  ]);

  try {
    await bot.sendMessage(
      msg.chat.id,
      MINI_APP_URL
        ? `${emoji('5443038326535759644', '🟢')} Fikr-mulohaza yuborish yoki "Admin 24/7" orqali yo'nalish tanlash bo'yicha maslahat olish uchun pastdagi tugmalardan foydalaning:`
        : `${emoji(EMOJI.giftIcon, '🟢')} Yo'nalish tanlash bo'yicha maslahat olish uchun pastdagi "Admin 24/7" tugmasidan foydalaning:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: bottomKeyboardRows,
          resize_keyboard: true,
          is_persistent: true,
        },
      }
    );
  } catch (err) {
    console.error("Klaviatura tugmalarini yuborishda xatolik:", err.message);
  }
});

// ---------------------------------------------------------------------------
// AI: Oddiy matnli xabarlarni Groq orqali javoblash
// (Shaxsiy chatda: barcha matnlar; Guruhda: faqat bot username bilan yoki reply)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Mini ilovadan (WebApp) kelgan ma'lumotlar — masalan "Fikr-mulohaza" formasi
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (!msg.web_app_data) return;

  let payload;
  try {
    payload = JSON.parse(msg.web_app_data.data);
  } catch (err) {
    payload = { type: 'unknown', text: msg.web_app_data.data };
  }

  if (payload.type === 'feedback' && payload.text) {
    const from = msg.from;
    const fromLabel = from.username ? `@${from.username}` : `${from.first_name || ''} (ID: ${from.id})`;

    // Adminga forward qilamiz (sozlangan bo'lsa)
    if (ADMIN_CHAT_ID) {
      try {
        const sentToAdmin = await bot.sendMessage(
          ADMIN_CHAT_ID,
          `📩 <b>Yangi fikr-mulohaza</b>\n\n👤 ${fromLabel}\n\n${payload.text}\n\n` +
            `<i>Javob berish uchun shu xabarga "Reply" qiling — javobingiz avtomatik shu foydalanuvchiga yetkaziladi.</i>\n` +
            `🆔 <code>${msg.chat.id}</code>`,
          { parse_mode: 'HTML' }
        );
        // Tezkor kirish uchun xotirada ham saqlaymiz (server qayta ishga tushsa,
        // yuqoridagi 🆔 qatoridan avtomatik qayta o'qib olinadi — ma'lumot yo'qolmaydi)
        feedbackReplyMap.set(sentToAdmin.message_id, msg.chat.id);
      } catch (err) {
        console.error('Fikr-mulohazani adminga yuborishda xatolik:', err.message);
      }
    } else {
      console.log(`[FIKR-MULOHAZA] ${fromLabel}: ${payload.text}`);
    }

    try {
      await bot.sendMessage(msg.chat.id, "✅ Fikringiz uchun rahmat! U jamoamizga yetkazildi.");
    } catch (err) {
      console.error("Fikr-mulohaza tasdiqlash xabarini yuborishda xatolik:", err.message);
    }
  }
});

// ---------------------------------------------------------------------------
// "Admin 24/7" tugmasi — yo'nalish tanlash bo'yicha admin kontaktini ko'rsatadi
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;
  if (msg.text.trim() !== 'Admin 24/7') return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const chatId = msg.chat.id;
  const { text, keyboard } = adminAdviceScreen();
  await safeSend(chatId, text, keyboard);
});

// ---------------------------------------------------------------------------
// "Mandat tanlash" — foydalanuvchi o'zining fanlar majmuasini qo'lda yozganda
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;

  const userId = msg.from.id;
  if (!awaitingYonalishCustomSubject.has(userId)) return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const subject = msg.text.trim();
  awaitingYonalishCustomSubject.delete(userId);

  if (!subject) {
    awaitingYonalishCustomSubject.add(userId);
    try {
      await bot.sendMessage(msg.chat.id, "❗️ Iltimos, fanlar majmuasini matn ko'rinishida yozing.");
    } catch (err) {
      console.error("Yo'nalish fanlar majmuasi validatsiya xabari xatosi:", err.message);
    }
    return;
  }

  await askForYonalishTil(msg.chat.id, userId, subject);
});

// ---------------------------------------------------------------------------
// "Yo'nalish bo'yicha qidirish" — foydalanuvchi DTM balini yozganda, mos
// yo'nalishlarni data/yonalishlar.json bazasidan qidirib topadi
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;

  const userId = msg.from.id;
  if (!awaitingYonalishBall.has(userId)) return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const raw = msg.text.trim().replace(',', '.');
  const ball = parseFloat(raw);

  if (isNaN(ball) || ball < 0 || ball > 189) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "❗️ Iltimos, to'g'ri raqam kiriting (0 dan 189 gacha), masalan: <b>154.5</b>",
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error("Yo'nalish ball validatsiya xabari xatosi:", err.message);
    }
    return; // holat saqlanadi — foydalanuvchi qayta urinishi mumkin
  }

  awaitingYonalishBall.delete(userId);
  const subject = pendingYonalishSubject.get(userId) || 'Kiritilmagan';
  pendingYonalishSubject.delete(userId);
  const til = pendingYonalishTil.get(userId) || '';
  const shakl = pendingYonalishShakl.get(userId) || '';
  pendingYonalishTil.delete(userId);
  pendingYonalishShakl.delete(userId);

  const tanlovLabel = [til, shakl].filter(Boolean).join(' · ');

  // Rasmiy minimal chegaradan past ball bilan hech qanday yo'nalishga
  // (na grant, na kontrakt) kirish imkoni yo'q — bu holda ro'yxat ko'rsatilmaydi
  if (ball < MIN_KIRISH_BALL) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        `🔴 <b>Balingiz: ${ball}</b>\n\n` +
          `Afsuski, <b>${MIN_KIRISH_BALL}</b> balldan past ball bilan hech qanday yo'nalishga ` +
          `(na grant, na kontrakt asosida) kira olmaysiz.\n\n` +
          `<i>Keyingi safar tayyorgarlikni kuchaytiring 💪.</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
      );
    } catch (err) {
      console.error("Yo'nalish past ball xabarini yuborishda xatolik:", err.message);
    }
    return;
  }

  const allResults = searchYonalishBySubject(subject).filter((r) => matchesTilShakl(r, til, shakl));
  const qualifying = allResults
    .map((r) => {
      const cls = classifyYonalishItem(r, ball);
      return { ...r, _status: cls.status, _qualifies: cls.qualifies };
    })
    .filter((r) => r._qualifies);

  if (!qualifying.length) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        `🔴 <b>${subject}</b>${tanlovLabel ? ` (${tanlovLabel})` : ''} fanlar majmuasi va <b>${ball}</b> ball bilan hozircha hech qanday ` +
          `yo'nalishga (na grant, na kontrakt) kira olmaysiz.\n\n` +
          `<i>Fanlar majmuasini boshqacharoq yozib ko'ring yoki keyingi safar tayyorgarlikni kuchaytiring 💪.</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
      );
    } catch (err) {
      console.error("Yo'nalish natija topilmadi xabarini yuborishda xatolik:", err.message);
    }
    return;
  }

  yonalishResultsState.set(userId, { subject, ball, items: qualifying, page: 0 });
  const { text, keyboard } = renderYonalishResultsPage(userId);

  try {
    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    console.error("Yo'nalish qidiruv natijasini yuborishda xatolik:", err.message);
  }
});

// ---------------------------------------------------------------------------
// Admin fikr-mulohaza xabariga "Reply" qilsa — javobni asl foydalanuvchiga qaytaramiz
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (!ADMIN_CHAT_ID) return;
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  if (!msg.reply_to_message) return;

  // Avval tezkor xotiradan qidiramiz; topilmasa — xabar matnidagi
  // "🆔 123456789" qatoridan o'qib olamiz (server qayta ishga tushgan bo'lsa ham ishlaydi)
  let targetChatId = feedbackReplyMap.get(msg.reply_to_message.message_id);
  if (!targetChatId) {
    const replyText = msg.reply_to_message.text || msg.reply_to_message.caption || '';
    const match = replyText.match(/🆔\s*(\d+)/);
    if (match) targetChatId = match[1];
  }
  if (!targetChatId) return;

  msg._relayedToUser = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  try {
    if (msg.text) {
      await bot.sendMessage(targetChatId, `💬 <b>Jamoamizdan javob:</b>\n\n${msg.text}`, { parse_mode: 'HTML' });
    } else if (msg.document) {
      const fileId = msg.document.file_id;
      await bot.sendDocument(targetChatId, fileId, {
        caption: msg.caption ? `📄 <b>Jamoamizdan fayl:</b>\n\n${msg.caption}` : '📄 Buyurtmangiz bo\'yicha fayl tayyor!',
        parse_mode: 'HTML',
      });
    } else if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(targetChatId, fileId, {
        caption: msg.caption ? `💬 <b>Jamoamizdan javob:</b>\n\n${msg.caption}` : '💬 <b>Jamoamizdan javob</b>',
        parse_mode: 'HTML',
      });
    } else {
      await bot.sendMessage(targetChatId, '💬 Jamoamizdan sizga javob keldi, lekin bu turdagi xabarni yuborib bo\'lmadi.');
    }
    await bot.sendMessage(msg.chat.id, '✅ Javobingiz foydalanuvchiga yetkazildi.');
  } catch (err) {
    console.error('Admin javobini foydalanuvchiga yetkazishda xatolik:', err.message);
    try {
      await bot.sendMessage(msg.chat.id, "❌ Javobni yetkazib bo'lmadi (foydalanuvchi botni bloklagan bo'lishi mumkin).");
    } catch (e) {}
  }
});

bot.on('message', async (msg) => {
  // Mini ilova ma'lumotlari yuqorida alohida handlerda qayta ishlanadi
  if (msg.web_app_data) return;
  // Admin fikr-mulohazaga javob berayotgan xabar yuqorida allaqachon qayta ishlandi
  if (msg._relayedToUser) return;
  // "Admin 24/7" / "Mandat tanlash" oqimidagi xabar yuqorida allaqachon qayta ishlandi
  if (msg._orderFlow) return;
  // Buyruqlarni o'tkazib yuboramiz; matn ham, rasm ham bo'lmasa — chiqib ketamiz
  if (msg.text && msg.text.startsWith('/')) return;
  if (!msg.text && !msg.photo) return;

  const chatType = msg.chat.type;
  const botUsername = BOT_USERNAME || (await bot.getMe()).username;
  const textOrCaption = msg.text || msg.caption || '';

  // Guruhda faqat @mention yoki reply bo'lsa javob beramiz
  if (chatType === 'group' || chatType === 'supergroup') {
    const isMentioned = textOrCaption.includes(`@${botUsername}`);
    const isReply = msg.reply_to_message?.from?.username === botUsername;
    if (!isMentioned && !isReply) return;
  }

  // Shaxsiy chatda obuna tekshiruvi
  if (chatType === 'private') {
    let subscribed = true;
    try {
      subscribed = await isSubscribedToAll(msg.from.id);
    } catch (err) { /* davom etamiz */ }
    if (!subscribed) return;
  }

  const userText = textOrCaption.replace(`@${botUsername}`, '').trim();

  // Agar foydalanuvchi botning oldingi xabariga reply qilgan bo'lsa, o'sha xabar
  // matnini kontekst sifatida olib qo'yamiz — shunda "davom et", "tushuntirib ber"
  // kabi savollarni ham AI to'g'ri tushunadi
  const repliedFromBot = msg.reply_to_message?.from?.username === botUsername;
  const rawReplyText = msg.reply_to_message?.text || msg.reply_to_message?.caption || '';
  const replyContext = repliedFromBot && rawReplyText ? stripAllHtml(rawReplyText) : undefined;

  // AI ga yuborish
  try {
    // Avval "O'ylamoqda..." xabarini yuboramiz
    const thinkingMsg = await bot.sendMessage(
      msg.chat.id,
      '<tg-emoji emoji-id="5456125285160226779">🤔</tg-emoji> <i>O\'ylamoqda...</i>',
      {
        parse_mode: 'HTML',
        reply_to_message_id: msg.message_id,
      }
    );

    let aiReply;
    if (msg.photo && msg.photo.length > 0) {
      // Rasmni tahlil qilamiz — eng yuqori sifatli versiyasini (oxirgisini) olamiz
      try {
        const bestPhoto = msg.photo[msg.photo.length - 1];
        const { base64, mimeType } = await downloadTelegramPhotoAsBase64(bestPhoto.file_id);
        aiReply = await askGeminiVision(userText, base64, mimeType);
      } catch (imgErr) {
        console.error('Rasmni yuklashda xatolik:', imgErr.message);
        aiReply = "Rasmni yuklab olishda xatolik yuz berdi. Keyinroq urinib ko'ring.";
      }
    } else if (isCreatorQuestion(userText)) {
      // "Kim yaratgan" kabi savollarga AI chaqirilmasdan, 100% aniq javob beriladi
      aiReply = CREATOR_ANSWER_HTML;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // tabiiy ko'rinishi uchun qisqa kutish
    } else {
      // AI javob va 4 soniya kutishni parallel ishlatamiz
      [aiReply] = await Promise.all([
        askAI(userText, replyContext),
        new Promise((resolve) => setTimeout(resolve, 4000)), // kamida 4s kutish
      ]);
    }

    // "O'ylamoqda..." xabarini AI javobi bilan almashtiramiz
    await bot.editMessageText(aiReply, {
      chat_id: msg.chat.id,
      message_id: thinkingMsg.message_id,
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('AI message handler xatosi:', err.message);
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const isGroup = ['group', 'supergroup'].includes(query.message.chat.type);

  // Telefon raqamini ko'rsatish
  if (query.data === 'show_phone') {
    try {
      await bot.answerCallbackQuery(query.id, {
        text: "+998505060717\n\nQo'ng'iroq qilish uchun xabardagi raqamga bosing.",
        show_alert: true,
      });
    } catch (err) {
      console.error('show_phone answerCallbackQuery xatosi:', err.message);
    }
    return;
  }

  // "Mandat tanlash" — foydalanuvchi ro'yxatdan fanlar majmuasini tanladi
  if (query.data && query.data.startsWith('yon_subj_') && query.data !== 'yon_subj_custom') {
    const index = parseInt(query.data.replace('yon_subj_', ''), 10);
    const subject = MANDAT_SUBJECT_OPTIONS[index];
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    if (!subject) return;
    await askForYonalishTil(chatId, userId, subject);
    return;
  }

  // "Yo'nalish bo'yicha qidirish" — foydalanuvchi o'zi fanlar majmuasini yozmoqchi
  if (query.data === 'yon_subj_custom') {
    awaitingYonalishCustomSubject.add(userId);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    try {
      await bot.sendMessage(
        chatId,
        "✍️ Fanlar majmuangizni yozing (masalan: <b>Matematika + Fizika</b>):",
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error("Yo'nalish fanlar majmuasi so'rash xabari xatosi:", err.message);
    }
    return;
  }

  // "Mandat tanlash" — ta'lim tili tanlandi
  if (query.data === 'yon_til_uz' || query.data === 'yon_til_ru') {
    pendingYonalishTil.set(userId, query.data === 'yon_til_uz' ? "O'zbek" : 'Rus');
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    await askForYonalishShakl(chatId, userId);
    return;
  }

  // "Mandat tanlash" — ta'lim shakli tanlandi
  if (query.data === 'yon_shakl_kunduzgi' || query.data === 'yon_shakl_masofaviy') {
    pendingYonalishShakl.set(userId, query.data === 'yon_shakl_kunduzgi' ? 'Kunduzgi' : 'Masofaviy');
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    await askForYonalishBall(chatId, userId);
    return;
  }

  // "Mandat tanlash" natijalari — sahifalash (Keyingisi/Oldingisi)
  if (query.data === 'yon_page_next' || query.data === 'yon_page_prev') {
    const state = yonalishResultsState.get(userId);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    if (!state) return;

    state.page += query.data === 'yon_page_next' ? 1 : -1;
    const rendered = renderYonalishResultsPage(userId);
    if (rendered) {
      await safeEdit(chatId, messageId, rendered.text, rendered.keyboard);
    }
    return;
  }

  // "Mandat tanlash" natijalari — bitta yo'nalishni "5 ta tanlov" ro'yxatiga
  // qo'shish yoki undan olib tashlash (tugma bosilganda holat almashadi)
  if (query.data && query.data.startsWith('yon_add_')) {
    const state = yonalishResultsState.get(userId);
    const index = parseInt(query.data.replace('yon_add_', ''), 10);
    const item = state && state.items[index];

    if (!item) {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
      return;
    }

    const alreadyIn = getUserTanlov(userId).some((t) => t.key === tanlovItemKey(item));
    let alertText;
    if (alreadyIn) {
      removeFromTanlov(userId, getUserTanlov(userId).findIndex((t) => t.key === tanlovItemKey(item)));
      alertText = '❌ Tanlovdan olib tashlandi.';
    } else {
      const res = addToTanlov(userId, item);
      if (res.ok) {
        alertText = `✅ Tanlovga qo'shildi! (${getUserTanlov(userId).length}/${TANLOV_MAX})`;
      } else if (res.reason === 'full') {
        alertText = `⚠️ Siz allaqachon ${TANLOV_MAX} ta yo'nalish tanladingiz. Avval birortasini olib tashlang.`;
      } else {
        alertText = 'ℹ️ Bu yo\'nalish allaqachon ro\'yxatingizda bor.';
      }
    }

    try {
      await bot.answerCallbackQuery(query.id, { text: alertText, show_alert: false });
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }

    const rendered = renderYonalishResultsPage(userId);
    if (rendered) {
      await safeEdit(chatId, messageId, rendered.text, rendered.keyboard);
    }
    return;
  }

  // "Mening 5 ta tanlovim" — ro'yxatdan bitta yo'nalishni o'chirish
  if (query.data && query.data.startsWith('tanlov_remove_')) {
    const index = parseInt(query.data.replace('tanlov_remove_', ''), 10);
    removeFromTanlov(userId, index);
    try {
      await bot.answerCallbackQuery(query.id, { text: "🗑 Ro'yxatdan o'chirildi." });
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    const { text, keyboard } = tanlovScreen(userId);
    await safeEdit(chatId, messageId, text, keyboard);
    return;
  }

  // "Mening 5 ta tanlovim" bo'limi (foydalanuvchiga bog'liq bo'lgani uchun
  // umumiy SCREENS ro'yxatidan alohida ishlanadi)
  if (query.data === 'menu_tanlov') {
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    const { text, keyboard } = tanlovScreen(userId);
    const outKeyboard = isGroup ? stripPremium(keyboard) : keyboard;
    const outText = isGroup ? stripTgEmoji(text) : text;
    await safeSend(chatId, outText, outKeyboard);
    return;
  }

  // Obunani qayta tekshirish
  if (query.data === 'check_subscription') {
    let subscribed = false;
    try {
      subscribed = await isSubscribedToAll(userId);
    } catch (err) {
      console.error('check_subscription xatosi:', err.message);
    }

    if (subscribed) {
      await deleteMessageSafe(chatId, messageId);
      await sendMainMenu(chatId, isGroup);
      try {
        await bot.answerCallbackQuery(query.id, { text: '✅ Obuna tasdiqlandi!' });
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
    } else {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: "❌ Siz hali barcha kanallarga obuna bo'lmagansiz. Iltimos, avval obuna bo'ling.",
          show_alert: true,
        });
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
    }
    return;
  }

  const screenFn = SCREENS[query.data];
  if (!screenFn) {
    try { await bot.answerCallbackQuery(query.id); } catch (err) { console.error('answerCallbackQuery xatosi:', err.message); }
    return;
  }

  // Shaxsiy chatda obuna tekshiruvi
  if (!isGroup) {
    let subscribed = true;
    try {
      subscribed = await isSubscribedToAll(userId);
    } catch (err) {
      console.error('menyu obuna tekshiruvi xatosi:', err.message);
    }

    if (!subscribed) {
      await deleteMessageSafe(chatId, messageId);
      const { text, keyboard } = gateScreen();
      await safeSend(chatId, text, keyboard);
      try {
        await bot.answerCallbackQuery(query.id, {
          text: "❌ Avval kanallarga obuna bo'ling.",
          show_alert: true,
        });
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
      return;
    }
  }

  // Tugma darhol "javob olindi" holatiga o'tsin — foydalanuvchi ekranida
  // tugma qotib qolmasligi (loading holatida turib qolmasligi) uchun bu yerda
  // answerCallbackQuery ni ogʻir amallardan (o'chirish/yuborish) OLDIN chaqiramiz.
  try {
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('answerCallbackQuery xatosi:', err.message);
  }

  // Foydalanuvchi boshqa bo'limga o'tsa, "yo'nalish qidirish" holati bekor qilinadi
  awaitingYonalishCustomSubject.delete(userId);
  awaitingYonalishBall.delete(userId);
  pendingYonalishSubject.delete(userId);
  pendingYonalishTil.delete(userId);
  pendingYonalishShakl.delete(userId);
  yonalishResultsState.delete(userId);

  const { text, keyboard } = screenFn();
  await deleteMessageSafe(chatId, messageId);

  if (query.data === 'menu_back') {
    await sendMainMenu(chatId, isGroup);
  } else {
    const outKeyboard = isGroup ? stripPremium(keyboard) : keyboard;
    const outText = isGroup ? stripTgEmoji(text) : text;
    await safeSend(chatId, outText, outKeyboard);
  }
});

// ---------------------------------------------------------------------------
// Bot buyruqlari
// ---------------------------------------------------------------------------
async function configureBot() {
  try {
    const me = await bot.getMe();
    BOT_USERNAME = me.username;
  } catch (err) {
    console.error('getMe xatosi:', err.message);
  }

  try {
    await bot.setMyCommands([
      { command: 'start', description: "Botni ishga tushirish" },
    ]);
  } catch (err) {
    console.error('setMyCommands xatosi:', err.message);
  }

  if (MINI_APP_URL) {
    try {
      await bot.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Mini ilova',
          web_app: { url: MINI_APP_URL },
        },
      });
    } catch (err) {
      console.error('setChatMenuButton xatosi:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Express server + webhook
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send("Ta'lim Talaba bot ishlamoqda ✅");
});

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);

  if (WEBHOOK_URL) {
    const fullWebhookUrl = `${WEBHOOK_URL.replace(/\/$/, '')}/bot${BOT_TOKEN}`;
    try {
      await bot.setWebHook(fullWebhookUrl);
      console.log("Webhook o'rnatildi:", fullWebhookUrl);
    } catch (err) {
      console.error("Webhook o'rnatishda xatolik:", err.message);
    }
  } else {
    console.warn("WEBHOOK_URL berilmagan — webhook o'rnatilmadi.");
  }

  await configureBot();
});
