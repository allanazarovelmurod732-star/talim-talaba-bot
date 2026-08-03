require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Asosiy menyu tepasidagi banner rasm (assets papkasida bo'lishi shart)
const MAIN_BANNER_PATH = path.join(__dirname, 'assets', 'banner.jpg');
// "Botni baholang" ekrani tepasidagi rasm (assets papkasida bo'lishi shart)
const RATING_BANNER_PATH = path.join(__dirname, 'assets', 'baho_banner.jpg');
// "Mandat tanlash" (fanlar majmuasi) ekrani tepasidagi rasm (assets papkasida bo'lishi shart)
const MANDAT_BANNER_PATH = path.join(__dirname, 'assets', 'mandat_banner.jpg');

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
// "Natijamni tekshirish (ID)" — foydalanuvchi yuborgan BITTA abituriyent ID'i
// uchun, jonli ravishda (hech qanday oldindan yig'ilgan baza ISHLATMASDAN)
// mandat.uzbmb.uz saytiga so'rov yuborib, shu bitta odamning natijasini
// olib beradi. Hech qanday boshqa foydalanuvchi ma'lumoti saqlanmaydi yoki
// ommaviy yig'ilmaydi — bu xuddi saytning o'zida "ID bo'yicha qidiruv"
// qilishning aynan o'zi, faqat Telegram orqali.
// ---------------------------------------------------------------------------
const MANDAT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function decodeUzApostrophe(s) {
  return String(s).replace(/&#x2018;|&#8216;|&rsquo;/g, "'").trim();
}

// hashId bo'yicha "Details" sahifasidan fanlar majmuasi/til/umumiy ball
// tafsilotlarini oladi. fetchMandatById va Kengaytirilgan qidiruv ID
// natijasida ham baravar ishlatiladi.
async function fetchEntrantSubjectDetails(hashId) {
  if (!hashId) return null;
  try {
    const detRes = await fetch(`https://mandat.uzbmb.uz/Bakalavr/Details?hashId=${hashId}`, {
      headers: { 'User-Agent': MANDAT_UA },
    });
    if (!detRes.ok) return null;
    const detHtml = await detRes.text();
    const til = (detHtml.match(/Ta'lim tili:\s*<b>([^<]+)</) || [])[1];
    const majburiy = (detHtml.match(/Majburiy fanlar<\/div>\s*<div class="m3-det-subj__val">([^<]+)</) || [])[1];
    const fan1 = (detHtml.match(/1-mutaxassislik fani<\/div>\s*<div class="m3-det-subj__val">([^<]+)</) || [])[1];
    const fan2 = (detHtml.match(/2-mutaxassislik fani<\/div>\s*<div class="m3-det-subj__val">([^<]+)</) || [])[1];
    const umumiy = (detHtml.match(/Umumiy ball:\s*<br\s*\/?>\s*<b>([^<]+)</) || [])[1];
    return {
      til: til ? decodeUzApostrophe(til) : null,
      majburiy: majburiy ? decodeUzApostrophe(majburiy) : null,
      fan1: fan1 ? decodeUzApostrophe(fan1) : null,
      fan2: fan2 ? decodeUzApostrophe(fan2) : null,
      umumiy: umumiy ? decodeUzApostrophe(umumiy) : null,
    };
  } catch (err) {
    console.error('Mandat Details olishda xatolik:', err.message);
    return null; // Tafsilot olinmasa ham, asosiy natija baribir ko'rsatiladi
  }
}

async function fetchMandatById(entrantId) {
  const searchUrl = `https://mandat.uzbmb.uz/Bakalavr/MainSearch?entrantid=${encodeURIComponent(entrantId)}&lang=uz`;
  const res = await fetch(searchUrl, { headers: { 'User-Agent': MANDAT_UA } });
  if (!res.ok) throw new Error(`mandat.uzbmb.uz MainSearch ${res.status}`);
  const html = await res.text();

  const idMarker = `# ${entrantId}`;
  const idIdx = html.indexOf(idMarker);
  if (idIdx === -1) return null; // shu ID bo'yicha natija topilmadi

  // Kartaning boshlanish nuqtasini orqaga qarab qidiramiz
  const cardStart = html.lastIndexOf('m3-rescard m3-rescard--', idIdx);
  const win = html.slice(cardStart === -1 ? 0 : cardStart, idIdx + 3000);

  const nameMatch = win.match(/m3-rescard__name">(?:<i[^>]*><\/i>\s*)?([^<]+)</);
  const scoreMatch = win.match(/m3-score-val[^"]*">([^<]+)</);
  const thresholdMatch = win.match(/m3-pbar__thmark"\s+title="([^"]*)"/);
  const hashMatch = win.match(/Details\?hashId=([a-f0-9]+)/);

  const result = {
    name: nameMatch ? decodeUzApostrophe(nameMatch[1]) : null,
    scoreText: scoreMatch ? decodeUzApostrophe(scoreMatch[1]) : null,
    thresholdText: thresholdMatch ? decodeUzApostrophe(thresholdMatch[1]) : null,
    subjects: null,
  };

  const hashId = hashMatch ? hashMatch[1] : null;
  result.subjects = await fetchEntrantSubjectDetails(hashId);

  return result;
}

// Foydalanuvchi hozir o'z abituriyent ID'ini kiritishini kutayotgan bo'lsak, shu Set ichida turadi
const awaitingMandatId = new Set();

function formatMandatIdResult(result, entrantId, rankInfo) {
  if (!result || !result.name) {
    return (
      `❌ <b>${entrantId}</b> ID raqami bo'yicha natija topilmadi.\n\n` +
      `<i>ID raqamini tekshirib qayta yuboring, yoki hali natija e'lon qilinmagan bo'lishi mumkin.</i>`
    );
  }

  const { name, scoreText, thresholdText, subjects } = result;

  let text =
    `✅ <b>${name}</b>\n` +
    `🆔 ID: <b>${entrantId}</b>\n` +
    (scoreText ? `🎯 Ball: <b>${scoreText}</b>\n` : '') +
    (thresholdText ? `🚩 ${thresholdText}\n` : '');

  if (rankInfo) {
    const totalStr = `${rankInfo.approxTotal ? '~' : ''}${rankInfo.total}`;
    text += `🏆 Reytingda: <b>${rankInfo.rank}-o'rin</b> (jami ${totalStr} ta abituriyent ichida)\n`;
  }

  if (subjects) {
    const combo = [subjects.fan1, subjects.fan2].filter(Boolean).join(' + ');
    const comboLine = combo || subjects.majburiy;
    if (comboLine) {
      text += `📚 Topilgan yo'nalish: <b>${comboLine}${subjects.til ? ` + ${subjects.til}` : ''}</b>\n`;
    }
  }

  text += `\n@talimtalababot — orqali o'z o'rningizni aniqlang`;

  return text;
}

// ---------------------------------------------------------------------------
// "Kengaytirilgan qidiruv" — mandat.uzbmb.uz saytining o'z sahifasi bilan bir xil:
// foydalanuvchi fanlar majmuasi (1- va 2-mutaxassislik fani) va ta'lim tilini
// tanlaydi, bot esa o'sha bo'yicha YAKUNIY MANDATGA kirgan barcha abituriyentlar
// ro'yxatini (reytingini) sahifalab ko'rsatadi. Hech qanday ma'lumot oldindan
// yig'ib olinmaydi — har bir so'rov saytdan jonli olinadi.
// Endpoint 1 (birinchi sahifa): GET /Bakalavr/MainSearch?s4subject=...&s5subject=...&edLangId=...&lang=uz
// Endpoint 2 (keyingi sahifalar): GET /Bakalavr/Paginate?pageNumber=...&pageSize=10&s4subject=...&s5subject=...&edLangId=...&lang=uz
// ---------------------------------------------------------------------------
const KQ_PAGE_SIZE = 10; // Server tomonidan qattiq belgilangan (o'zgartirib bo'lmaydi)

// MainSearch/Paginate javobidagi HTML'dan har bir "m3-rescard" blokini (bitta
// abituriyent kartasi) ajratib, kerakli maydonlarni o'qib oladi
function parseKQCards(html) {
  const cards = [];
  const chunks = String(html).split('m3-rescard m3-rescard--');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const statusMatch = chunk.match(/^(\w+)/);
    const nameMatch = chunk.match(/m3-rescard__name">(?:<i[^>]*><\/i>\s*)?([^<]+)</);
    const idMatch = chunk.match(/m3-rescard__id">#\s*([0-9]+)/);
    const scoreMatch = chunk.match(/m3-score-val[^"]*">([^<]+)</);
    const thresholdMatch = chunk.match(/m3-pbar__thmark"\s+title="([^"]*)"/);
    const hashMatch = chunk.match(/Details\?hashId=([a-f0-9]+)/);

    if (!nameMatch || !idMatch) continue; // bu chunk karta emas (masalan, sahifaning qolgan qismi)

    cards.push({
      status: statusMatch ? statusMatch[1] : '',
      name: decodeUzApostrophe(nameMatch[1]),
      id: idMatch[1],
      scoreText: scoreMatch ? decodeUzApostrophe(scoreMatch[1]) : null,
      thresholdText: thresholdMatch ? decodeUzApostrophe(thresholdMatch[1]) : null,
      hashId: hashMatch ? hashMatch[1] : null,
    });
  }
  return cards;
}

// Berilgan fanlar majmuasi + ta'lim tili bo'yicha, so'ralgan sahifadagi
// abituriyentlar ro'yxatini mandat.uzbmb.uz saytidan jonli olib keladi
async function fetchKengaytirilganPage(s4subject, s5subject, edLangId, pageNumber) {
  const qs =
    `s4subject=${encodeURIComponent(s4subject)}` +
    `&s5subject=${encodeURIComponent(s5subject)}` +
    `&edLangId=${encodeURIComponent(edLangId)}` +
    `&lang=uz`;

  const url =
    pageNumber <= 1
      ? `https://mandat.uzbmb.uz/Bakalavr/MainSearch?${qs}`
      : `https://mandat.uzbmb.uz/Bakalavr/Paginate?pageNumber=${pageNumber}&pageSize=${KQ_PAGE_SIZE}&${qs}`;

  const res = await fetch(url, { headers: { 'User-Agent': MANDAT_UA } });
  if (!res.ok) throw new Error(`mandat.uzbmb.uz ${pageNumber <= 1 ? 'MainSearch' : 'Paginate'} ${res.status}`);
  const html = await res.text();
  return parseKQCards(html);
}

// Ball matnini ("142,700" yoki "142.700" kabi) taqqoslash uchun songa aylantiradi
function parseKQScoreNumber(scoreText) {
  if (!scoreText) return null;
  const normalized = String(scoreText).replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

// Bitta sahifani olib, shu bilan birga sahifadagi eng yuqori/eng past ball va
// ro'yxat shu sahifada tugagan-tugamaganini ham qaytaradi (binary search uchun)
async function fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, pageNumber) {
  const cards = await fetchKengaytirilganPage(s4subject, s5subject, edLangId, pageNumber);
  if (!cards.length) return { page: pageNumber, cards, empty: true, full: false, topScore: null, bottomScore: null };
  return {
    page: pageNumber,
    cards,
    empty: false,
    full: cards.length === KQ_PAGE_SIZE,
    topScore: parseKQScoreNumber(cards[0].scoreText),
    bottomScore: parseKQScoreNumber(cards[cards.length - 1].scoreText),
  };
}

// Ro'yxat (mandat.uzbmb.uz'da) ball bo'yicha KAMAYISH tartibida saqlanadi.
// Shundan foydalanib, minglab sahifani bittalab tekshirish o'rniga, avval
// abituriyentning ballini bilib olib (fetchMandatById orqali), keyin binary
// search bilan to'g'ridan-to'g'ri o'sha ball joylashgan sahifaga "sakraymiz".
// Bu, masalan, 115 000 kishilik ro'yxatda ham bir necha o'nlab so'rov bilan
// (minglab so'rov o'rniga) natija topishga imkon beradi.
async function findKQEntrantByScore(s4subject, s5subject, edLangId, entrantId, targetScore, onProgress) {
  let requests = 0;
  const fetchInfo = async (page) => {
    requests++;
    const info = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, page);
    if (onProgress) onProgress({ page, requests });
    return info;
  };

  // 1-sahifani darhol tekshiramiz (kam sonli ro'yxatlar uchun bevosita topilishi mumkin)
  const firstInfo = await fetchInfo(1);
  if (firstInfo.empty) return { found: null, requests };
  let idx = firstInfo.cards.findIndex((c) => c.id === entrantId);
  if (idx !== -1) return { found: { page: 1, index: idx, card: firstInfo.cards[idx], cards: firstInfo.cards, hasNext: firstInfo.full }, requests };

  if (targetScore == null) return { found: null, requests, noScore: true };

  // 2) Eksponensial qidiruv: bottomScore <= targetScore bo'lgan (yoki ro'yxat
  // tugagan) sahifani topguncha 2, 4, 8, 16... sahifalarni tekshiramiz
  let lo = 1;
  let loInfo = firstInfo;
  let hi = 1;
  let hiInfo = firstInfo;

  while (hiInfo.full && hiInfo.bottomScore !== null && hiInfo.bottomScore > targetScore) {
    lo = hi;
    loInfo = hiInfo;
    hi = hi * 2;
    if (hi > MAX_KQ_ID_SEARCH_PAGES) {
      hi = MAX_KQ_ID_SEARCH_PAGES;
      hiInfo = await fetchInfo(hi);
      idx = hiInfo.cards.findIndex((c) => c.id === entrantId);
      if (idx !== -1) return { found: { page: hi, index: idx, card: hiInfo.cards[idx], cards: hiInfo.cards, hasNext: hiInfo.full }, requests };
      break;
    }
    hiInfo = await fetchInfo(hi);
    idx = hiInfo.cards.findIndex((c) => c.id === entrantId);
    if (idx !== -1) return { found: { page: hi, index: idx, card: hiInfo.cards[idx], cards: hiInfo.cards, hasNext: hiInfo.full }, requests };
  }

  // 3) Binary search: lo (bottomScore > target) va hi (bottomScore <= target
  // yoki ro'yxat tugagan) orasida, target ball joylashgan sahifani topamiz
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const midInfo = await fetchInfo(mid);
    idx = midInfo.cards.findIndex((c) => c.id === entrantId);
    if (idx !== -1) return { found: { page: mid, index: idx, card: midInfo.cards[idx], cards: midInfo.cards, hasNext: midInfo.full }, requests };

    if (midInfo.empty || !midInfo.full || (midInfo.bottomScore !== null && midInfo.bottomScore <= targetScore)) {
      hi = mid;
      hiInfo = midInfo;
    } else {
      lo = mid;
      loInfo = midInfo;
    }
  }

  // 4) Binary search bergan taxminiy nuqta atrofida, ballar aniq mos
  // kelmasligi mumkinligini hisobga olib (masalan, umumiy tekshiruvdagi ball
  // bilan shu ro'yxatdagi ball formatida ozgina farq bo'lishi mumkin), FAQAT
  // ID bo'yicha (ball farqiga qaramay) kengroq oynada — ikkala tomonga
  // parallel paketlarda — qidiramiz.
  const WINDOW_PAGES = 400; // har tomonga eng ko'pi bilan shuncha sahifa (jami ~8000 kishi)
  const BATCH = 8;

  // Orqaga (past raqamli sahifalarga, ya'ni balli balandroq tomonga) qidirish
  for (let start = lo; start > Math.max(1, lo - WINDOW_PAGES); start -= BATCH) {
    const pages = [];
    for (let p = start; p > start - BATCH && p >= Math.max(1, lo - WINDOW_PAGES); p--) pages.push(p);
    if (!pages.length) break;
    const results = await Promise.all(pages.map((p) => fetchInfo(p)));
    for (let i = 0; i < results.length; i++) {
      const idx2 = results[i].cards.findIndex((c) => c.id === entrantId);
      if (idx2 !== -1) {
        return { found: { page: pages[i], index: idx2, card: results[i].cards[idx2], cards: results[i].cards, hasNext: results[i].full }, requests };
      }
    }
  }

  // Oldinga (katta raqamli sahifalarga, ya'ni balli pastroq tomonga) qidirish
  let page = hi;
  outerForward:
  for (let start = hi; start < hi + WINDOW_PAGES; start += BATCH) {
    const pages = [];
    for (let p = start; p < start + BATCH && p < hi + WINDOW_PAGES; p++) pages.push(p);
    if (!pages.length) break;
    const results = await Promise.all(pages.map((p) => fetchInfo(p)));
    for (let i = 0; i < results.length; i++) {
      const info = results[i];
      const idx2 = info.cards.findIndex((c) => c.id === entrantId);
      if (idx2 !== -1) {
        return { found: { page: pages[i], index: idx2, card: info.cards[idx2], cards: info.cards, hasNext: info.full }, requests };
      }
      if (info.empty || !info.full) break outerForward; // ro'yxat tugadi
    }
  }

  return { found: null, requests };
}



// Details sahifasidan olingan "Ta'lim tili" matnini (masalan "O'zbek tili",
// "Rus tili" ...) Kengaytirilgan qidiruvda ishlatiladigan edLangId'ga mos keltiradi
function tilToEdLangId(til) {
  if (!til) return null;
  const t = til.toLowerCase();
  if (t.includes('рус') || t.includes('rus')) return 2;
  if (t.includes('qoraqalpoq')) return 3;
  if (t.includes('tojik') || t.includes('тож')) return 4;
  if (t.includes('qozoq') || t.includes('қаз')) return 5;
  if (t.includes('zbek')) return 1;
  return null;
}

// Berilgan fanlar majmuasi + til bo'yicha YAKUNIY MANDATGA kirganlarning
// umumiy sonini aniqlaydi (findKQEntrantByScore'dagi kabi eksponensial +
// binary search — sahifalarni birma-bir sanamasdan)
async function getKQTotalCount(s4subject, s5subject, edLangId, onProgress) {
  let requests = 0;
  const fetchInfo = async (page) => {
    requests++;
    const info = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, page);
    if (onProgress) onProgress({ page, requests });
    return info;
  };

  const firstInfo = await fetchInfo(1);
  if (firstInfo.empty) return { count: 0, approx: false };
  if (!firstInfo.full) return { count: firstInfo.cards.length, approx: false };

  let lo = 1;
  let hi = 2;
  let hiInfo = await fetchInfo(hi);
  let capped = false;
  while (hiInfo.full) {
    lo = hi;
    hi *= 2;
    if (hi > MAX_KQ_ID_SEARCH_PAGES) {
      hi = MAX_KQ_ID_SEARCH_PAGES;
      hiInfo = await fetchInfo(hi);
      capped = hiInfo.full;
      break;
    }
    hiInfo = await fetchInfo(hi);
  }

  if (!capped) {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const midInfo = await fetchInfo(mid);
      if (midInfo.full) {
        lo = mid;
      } else {
        hi = mid;
        hiInfo = midInfo;
      }
    }
  }

  return { count: (hi - 1) * KQ_PAGE_SIZE + hiInfo.cards.length, approx: capped };
}

// Berilgan "threshold" balldan KATTA YOKI TENG ball to'plaganlar sonini aniqlaydi
// (ro'yxat ball bo'yicha KAMAYISH tartibida ekanidan foydalanib, binary search bilan —
// getKQTotalCount'dagi kabi, sahifalarni birma-bir sanamasdan)
async function countEntriesWithScoreAtLeast(s4subject, s5subject, edLangId, threshold, onProgress) {
  let requests = 0;
  const fetchInfo = async (page) => {
    requests++;
    const info = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, page);
    if (onProgress) onProgress({ page, requests });
    return info;
  };
  const countInPage = (cards) =>
    cards.filter((c) => {
      const s = parseKQScoreNumber(c.scoreText);
      return s !== null && s >= threshold;
    }).length;

  const firstInfo = await fetchInfo(1);
  if (firstInfo.empty) return { count: 0, approx: false };

  // Chegara birinchi sahifaning o'zida bo'lsa (ro'yxat tugagan yoki bu
  // sahifadayoq threshold'dan pastga tushgan bo'lsa) — darhol sanab qaytaramiz
  if (!firstInfo.full || firstInfo.bottomScore === null || firstInfo.bottomScore < threshold) {
    return { count: countInPage(firstInfo.cards), approx: false };
  }

  // Eksponensial qidiruv: bottomScore threshold'dan pastga tushguncha (yoki
  // ro'yxat tugaguncha) 2, 4, 8, 16... sahifalarni tekshiramiz
  let lo = 1;
  let hi = 2;
  let hiInfo = await fetchInfo(hi);
  let capped = false;
  while (hiInfo.full && hiInfo.bottomScore !== null && hiInfo.bottomScore >= threshold) {
    lo = hi;
    hi *= 2;
    if (hi > MAX_KQ_ID_SEARCH_PAGES) {
      hi = MAX_KQ_ID_SEARCH_PAGES;
      hiInfo = await fetchInfo(hi);
      capped = hiInfo.full && hiInfo.bottomScore !== null && hiInfo.bottomScore >= threshold;
      break;
    }
    hiInfo = await fetchInfo(hi);
  }

  if (capped) {
    // Ro'yxat juda katta — aniq chegarani MAX_KQ_ID_SEARCH_PAGES ichida topib bo'lmadi
    return { count: hi * KQ_PAGE_SIZE, approx: true };
  }

  // Binary search: lo (hali threshold'ga mos) va hi (endi mos emas) orasida
  // chegara sahifasini topamiz
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const midInfo = await fetchInfo(mid);
    if (midInfo.full && midInfo.bottomScore !== null && midInfo.bottomScore >= threshold) {
      lo = mid;
    } else {
      hi = mid;
      hiInfo = midInfo;
    }
  }

  return { count: lo * KQ_PAGE_SIZE + countInPage(hiInfo.cards), approx: false };
}

// Aynan 189 (yoki istalgan) ball to'plaganlar soni va shu balldan YUQORI
// ball to'plaganlar sonini birgalikda hisoblaydi
async function getKQScoreStats(s4subject, s5subject, edLangId, targetScore, onProgress) {
  const [atLeastResult, aboveResult] = await Promise.all([
    countEntriesWithScoreAtLeast(s4subject, s5subject, edLangId, targetScore, onProgress),
    countEntriesWithScoreAtLeast(s4subject, s5subject, edLangId, targetScore + 0.001, onProgress),
  ]);
  return {
    exactCount: Math.max(0, atLeastResult.count - aboveResult.count),
    aboveCount: aboveResult.count,
    approx: atLeastResult.approx || aboveResult.approx,
  };
}

// ID orqali topilgan abituriyentning shu fanlar majmuasi + til bo'yicha
// nechanchi o'rinda ekanini va ro'yxat jamisini aniqlashga urinadi
// (majburiy ma'lumot yetarli bo'lmasa yoki xatolik bo'lsa, jimgina null qaytaradi)
async function computeMandatIdRanking(result, entrantId) {
  if (!result || !result.subjects) return null;
  const { fan1, fan2, til } = result.subjects;
  if (!fan1 || !fan2 || !til) return null;

  const edLangId = tilToEdLangId(til);
  if (!edLangId) return null;

  const targetScore = parseKQScoreNumber(result.scoreText);

  try {
    const [searchResult, totalInfo] = await Promise.all([
      findKQEntrantByScore(fan1, fan2, edLangId, entrantId, targetScore),
      getKQTotalCount(fan1, fan2, edLangId),
    ]);

    if (!searchResult || !searchResult.found || !totalInfo) return null;

    const rank = (searchResult.found.page - 1) * KQ_PAGE_SIZE + searchResult.found.index + 1;
    return {
      rank,
      total: totalInfo.count,
      approxTotal: totalInfo.approx,
      subjectCombo: `${fan1} + ${fan2}`,
    };
  } catch (err) {
    console.error('Mandat ID reyting hisoblashda xatolik:', err.message);
    return null;
  }
}

async function askForMandatId(chatId, userId) {
  awaitingMandatId.add(userId);
  try {
    await bot.sendMessage(
      chatId,
      `🆔 <b>Natijamni tekshirish</b>\n\n` +
        `Abituriyent ID raqamingizni (7 xonali) yozing, masalan: <b>5506347</b>.\n\n` +
        `Bot <b>mandat.uzbmb.uz</b> saytidan sizning shaxsiy natijangizni jonli tarzda olib ko'rsatadi ` +
        `— boshqa hech kimning ma'lumoti ko'rsatilmaydi yoki saqlanmaydi.`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
    );
  } catch (err) {
    console.error("Mandat ID so'rash xabari xatosi:", err.message);
  }
}

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

// ---------------------------------------------------------------------------
// "Botni baholang" — foydalanuvchi 1 dan 5 tagacha yulduz bilan botni
// baholaydi. Kuniga 2 martagacha baholash mumkin — shu limitni va
// baholar tarixini diskka (BAHO_DB_PATH) saqlaymiz.
// ---------------------------------------------------------------------------
const BAHO_DB_PATH = path.join(DATA_DIR, 'baholar.json');
const BAHO_KUNLIK_LIMIT = 2;

// userId (string) -> { lastDate: 'YYYY-MM-DD', countToday: number, history: [{date, rating}] }
let BAHO_DB = new Map();

function loadBahoDb() {
  try {
    const raw = fs.readFileSync(BAHO_DB_PATH, 'utf8');
    const obj = JSON.parse(raw);
    BAHO_DB = new Map(Object.entries(obj));
    console.log(`[BAHO] ${BAHO_DB.size} ta foydalanuvchi bahosi yuklandi.`);
  } catch (err) {
    BAHO_DB = new Map();
  }
}
loadBahoDb();

function saveBahoDb() {
  try {
    const obj = Object.fromEntries(BAHO_DB);
    fs.writeFileSync(BAHO_DB_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('[BAHO] Saqlashda xatolik:', err.message);
  }
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Foydalanuvchi bugun yana nechta marta baholay olishini qaytaradi (0, 1 yoki BAHO_KUNLIK_LIMIT)
function bahoQolganSoni(userId) {
  const rec = BAHO_DB.get(String(userId));
  const today = todayDateStr();
  if (!rec || rec.lastDate !== today) return BAHO_KUNLIK_LIMIT;
  return Math.max(0, BAHO_KUNLIK_LIMIT - rec.countToday);
}

// Bahoni saqlaydi. Natija: { ok: true, remaining } yoki { ok: false, remaining: 0 } (limit tugagan)
function recordBaho(userId, rating) {
  const today = todayDateStr();
  const key = String(userId);
  let rec = BAHO_DB.get(key);

  if (!rec || rec.lastDate !== today) {
    rec = { lastDate: today, countToday: 0, history: rec ? rec.history || [] : [] };
  }

  if (rec.countToday >= BAHO_KUNLIK_LIMIT) {
    return { ok: false, remaining: 0 };
  }

  rec.countToday += 1;
  rec.history.push({ date: today, rating });
  BAHO_DB.set(key, rec);
  saveBahoDb();

  return { ok: true, remaining: BAHO_KUNLIK_LIMIT - rec.countToday };
}

// ---------------------------------------------------------------------------
// Barcha foydalanuvchilar ro'yxati — "hammaga xabar yuborish" (broadcast)
// uchun. Foydalanuvchi shaxsiy chatda /start bosganda shu ro'yxatga qo'shiladi.
// ---------------------------------------------------------------------------
const USERS_DB_PATH = path.join(DATA_DIR, 'users.json');

// Set<string> — userId (= shaxsiy chat id) lar
let USERS_DB = new Set();

function loadUsersDb() {
  try {
    const raw = fs.readFileSync(USERS_DB_PATH, 'utf8');
    const arr = JSON.parse(raw);
    USERS_DB = new Set(arr.map(String));
    console.log(`[USERS] ${USERS_DB.size} ta foydalanuvchi yuklandi.`);
  } catch (err) {
    USERS_DB = new Set();
  }
}
loadUsersDb();

function saveUsersDb() {
  try {
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify([...USERS_DB], null, 2), 'utf8');
  } catch (err) {
    console.error('[USERS] Saqlashda xatolik:', err.message);
  }
}

function registerUser(userId) {
  const key = String(userId);
  if (!USERS_DB.has(key)) {
    USERS_DB.add(key);
    saveUsersDb();
  }
}

// Admin /xabar (reply qilib) yuborgandan keyin, tasdiqlash kutilayotgan
// broadcast ma'lumoti shu yerda vaqtincha turadi (bir vaqtda bittasi)
let pendingBroadcast = null; // { fromChatId, messageId }

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
// solishtiradi. Fanlar soni va TARTIBI aniq mos kelishi shart (masalan
// "Biologiya + Kimyo" so'ralsa, faylda "Kimyo, Biologiya" tartibida
// yozilgan yo'nalishlar endi mos deb hisoblanmaydi).
function subjectMatches(itemFanlar, subjectQuery) {
  const itemArr = Array.isArray(itemFanlar)
    ? itemFanlar
    : String(itemFanlar || '').split(',');
  const itemNorm = itemArr.map(normalizeText).filter(Boolean);
  if (!itemNorm.length) return false;

  const parts = String(subjectQuery)
    .split('+')
    .map((p) => normalizeText(p))
    .filter(Boolean);
  if (!parts.length) return false;

  // Fanlar soni bir xil bo'lishi va har bir pozitsiyada mos kelishi shart
  if (parts.length !== itemNorm.length) return false;
  return parts.every((p, i) => itemNorm[i].includes(p));
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
// mumkinmi-yo'qmi va qaysi holat ekanini aniqlaydi.
// qabulTuri: 'grant' — faqat grant bo'yicha tekshiradi
//            'kontrakt' — faqat kontrakt bo'yicha tekshiradi
//            'both' (yoki berilmasa) — avval grant, bo'lmasa kontrakt bo'yicha tekshiradi
function classifyYonalishItem(item, ball, qabulTuri) {
  const grantBall = item.grantBall !== undefined && item.grantBall !== null && item.grantBall !== '' ? Number(item.grantBall) : null;
  const kontraktBall = item.kontraktBall !== undefined && item.kontraktBall !== null && item.kontraktBall !== '' ? Number(item.kontraktBall) : null;
  const grantKvota = Number(item.grantKvota) || 0;
  const kontraktKvota = Number(item.kontraktKvota) || 0;

  const grantOk = grantKvota > 0 && grantBall !== null && ball >= grantBall;
  const kontraktOk = kontraktKvota > 0 && kontraktBall !== null && ball >= kontraktBall;

  // Kvotasi 0 (yoki umuman yo'q) bo'lsa, o'sha turdagi qabul (grant yoki
  // kontrakt) mavjud emas deb hisoblanadi — ball yetsa ham, o'rin yo'q
  // bo'lgani uchun bu yo'nalish "kira oladi" deb ko'rsatilmaydi.
  if (qabulTuri === 'grant') {
    return grantOk
      ? { qualifies: true, status: '🟢 Balingiz grantga yetadi' }
      : { qualifies: false, status: null };
  }
  if (qabulTuri === 'kontrakt') {
    return kontraktOk
      ? { qualifies: true, status: '🔵 Balingiz kontraktga yetadi' }
      : { qualifies: false, status: null };
  }

  // 'both' — avval grant, bo'lmasa kontrakt
  if (grantOk) {
    return { qualifies: true, status: '🟢 Balingiz grantga yetadi' };
  }
  if (kontraktOk) {
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

  const { subject, ball, qabulTuriLabel, items } = state;
  const totalPages = Math.max(1, Math.ceil(items.length / YONALISH_ITEMS_PER_PAGE));
  const page = Math.min(Math.max(state.page, 0), totalPages - 1);
  state.page = page;

  const start = page * YONALISH_ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + YONALISH_ITEMS_PER_PAGE);

  const tanlov = getUserTanlov(userId);
  const tanlovKeys = new Set(tanlov.map((t) => t.key));

  const header =
    `🔎 Fanlar majmuasi: <b>${subject}</b>\n` +
    (qabulTuriLabel ? `💰 Qabul turi: <b>${qabulTuriLabel}</b>\n` : '') +
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
let CACHED_RATING_BANNER_FILE_ID = null; // "Botni baholang" banner rasmi uchun file_id keshi
let CACHED_MANDAT_BANNER_FILE_ID = null; // "Mandat tanlash" banner rasmi uchun file_id keshi
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
  starIcon: '6005661956931850799',
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

const backRow = [btn({ text: 'Orqaga', callback_data: 'menu_back', icon: EMOJI.backIcon, style: 'danger' })];

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
    [btn({ text: '🔎 Kengaytirilgan qidiruv', callback_data: 'menu_kengaytirilgan', style: 'danger' })],
    [btn({ text: '📊 189 ball', callback_data: 'menu_189', style: 'primary' })],
    [btn({ text: '📋 Mening 5 ta tanlovim', callback_data: 'menu_tanlov', style: 'primary' })],
    [btn({ text: "🆔 Natijamni tekshirish (ID)", callback_data: 'menu_mandat_id', style: 'danger' })],
    [btn({ text: 'Botni baholang', callback_data: 'menu_baho', icon: EMOJI.starIcon, style: 'success' })],
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
// "Botni baholang" — foydalanuvchi yulduzlar sonini tanlaydi, so'ng
// "✅ Yuborish" tugmasini bosib tasdiqlaydi (kuniga 2 martagacha)
// ---------------------------------------------------------------------------
// userId -> tanlangan (lekin hali yuborilmagan) yulduzlar soni (1-5)
const pendingBahoSelection = new Map();

function ratingScreen(userId) {
  const selected = pendingBahoSelection.get(userId) || null;
  const remaining = bahoQolganSoni(userId);

  if (remaining <= 0) {
    const text =
      `⭐ <b>Botni baholang</b>\n\n` +
      `Siz bugun allaqachon <b>${BAHO_KUNLIK_LIMIT}</b> marta baholadingiz. ` +
      `Rahmat! Ertaga yana baholashingiz mumkin bo'ladi 🙏`;
    return { text, keyboard: [backRow] };
  }

  const text =
    `⭐ <b>Botni baholang</b>\n\n` +
    `Bot sizga qanchalik foydali bo'ldi? Yulduzlar sonini tanlang, so'ng ` +
    `<b>"✅ Yuborish"</b> tugmasini bosing.\n\n` +
    `<i>Bugun yana ${remaining} marta baholashingiz mumkin.</i>`;

  const keyboard = [];
  for (let n = 1; n <= 5; n++) {
    keyboard.push([
      btn({
        text: '⭐'.repeat(n),
        callback_data: `baho_select_${n}`,
        icon: EMOJI.starIcon,
        style: selected === n ? 'success' : 'primary',
      }),
    ]);
  }

  if (selected) {
    keyboard.push([btn({ text: '✅ Yuborish', callback_data: 'baho_submit', style: 'success' })]);
  }
  keyboard.push(backRow);

  return { text, keyboard };
}


// Fanlar majmuasi tugmalari ro'yxati (kerak bo'lsa shu massivga qo'shib/o'zgartirib turing)
const MANDAT_SUBJECT_OPTIONS = [
  'Biologiya + Kimyo',
  'Biologiya + Ona tili va adabiyot',
  'Chet tili + Ona tili va adabiyot',
  'Fizika + Chet tili',
  'Fizika + Matematika',
  'Fransuz tili + Ona tili va adabiyot',
  'Geografiya + Matematika',
  'Huquqshunoslik fanlari + Chet tili',
  'Ingliz tili + Ona tili va adabiyot',
  'Kasbiy (ijodiy imtihon) + Chet tili',
  'Kasbiy (ijodiy imtihon) + Kasbiy (ijodiy imtihon)',
  'Kasbiy (ijodiy imtihon) + Ona tili va adabiyot',
  'Kasbiy (ijodiy) imtihon + Kasbiy (ijodiy) imtihon',
  'Kimyo + Biologiya',
  'Kimyo + Matematika',
  'Matematika + Chet tili',
  'Matematika + Fizika',
  'Matematika + Geografiya',
  'Matematika + Ona tili va adabiyot',
  'Nemis tili + Ona tili va adabiyot',
  'Ona tili va adabiyot + Chet tili',
  'Ona tili va adabiyot + Matematika',
  "Oʻzbek tili va adabiyot + Chet tili",
  "Qirg'iz tili va adabiyot + Tarix",
  'Qoraqalpoq tili va adabiyot + Chet tili',
  'Qoraqalpoq tili va adabiyot + Tarix',
  'Qozoq tili va adabiyot + Chet tili',
  'Qozoq tili va adabiyot + Tarix',
  "Rus tili + O'zbek tili va adabiyot",
  'Rus tili va adabiyot + Chet tili',
  'Rus tili va adabiyot + Tarix',
  'Tarix + Chet tili',
  'Tarix + Geografiya',
  'Tarix + Kasbiy (ijodiy) imtihon',
  'Tarix + Matematika',
  'Tarix + Ona tili va adabiyot',
  'Tojik tili va adabiyot + Chet tili',
  'Tojik tili va adabiyot + Tarix',
  'Turkman tili va adabiyot + Chet tili',
  'Turkman tili va adabiyot + Tarix',
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
// Ta'lim tili tanlash tugmalari callback_data -> ko'rsatiladigan til nomi
const YONALISH_TIL_LABELS = {
  yon_til_uz: "O'zbek",
  yon_til_ru: 'Rus',
  yon_til_qq: 'Qoraqalpoq',
  yon_til_qz: 'Qozoq',
  yon_til_kg: "Qirg'iz",
  yon_til_tj: 'Tojik',
  yon_til_tk: 'Turkman',
};
const pendingYonalishShakl = new Map();
// Qabul turi (Grant / Kontrakt / Grant + Kontrakt) tanlanganda, ball
// kelgunga qadar vaqtincha shu yerda saqlanadi (userId -> 'grant'|'kontrakt'|'both')
const pendingYonalishQabulTuri = new Map();
const QABUL_TURI_LABELS = {
  grant: '🟢 Faqat Grant',
  kontrakt: '🔵 Faqat Kontrakt',
  both: '🟢🔵 Grant + Kontrakt',
};

// ---------------------------------------------------------------------------
// "Kengaytirilgan qidiruv" ekranlari va holatlari
// ---------------------------------------------------------------------------
// Foydalanuvchi o'zining fanlar majmuasini qo'lda yozayotganini kutayotgan bo'lsak, shu Set ichida turadi
const awaitingKQCustomSubject = new Set();
// Fanlar majmuasi tanlangandan (yoki yozilgandan) keyin, til tanlangunga
// qadar vaqtincha shu yerda saqlanadi (userId -> "Fan1 + Fan2")
const pendingKQSubject = new Map();
// Ta'lim tili tanlash tugmalari callback_data -> { edLangId, label }
// (mandat.uzbmb.uz saytining GetEducLangs ro'yxatiga mos)
const KQ_LANG_LABELS = {
  kq_lang_1: { edLangId: 1, label: "O'zbekcha" },
  kq_lang_2: { edLangId: 2, label: 'Русский' },
  kq_lang_3: { edLangId: 3, label: 'Qoraqalpoq' },
  kq_lang_4: { edLangId: 4, label: 'Tadjik' },
  kq_lang_5: { edLangId: 5, label: 'Qozoq' },
};
// userId -> { subject, s4subject, s5subject, edLangId, langLabel, page, cards, hasNext }
const kqResultsState = new Map();
// Fanlar majmuasi + til tanlangandan keyin, "to'liq ro'yxat" yoki "ID orqali
// o'rnini topish" tanlangunga qadar vaqtincha shu yerda saqlanadi
// (userId -> { subject, s4subject, s5subject, edLangId, langLabel })
const pendingKQFilters = new Map();
// Foydalanuvchi "ID orqali o'rnini topish"ni tanlab, ID kiritishini kutayotgan bo'lsak, shu Set ichida turadi
const awaitingKQId = new Set();
// Binary search bilan sahifalarni tekshirish LOG shaklda o'sadi (2, 4, 8, 16...),
// shuning uchun bu chegarani ancha katta qilib qo'yish deyarli hech qanday
// qo'shimcha so'rov sarflamaydi, lekin 100 000+ kishilik ro'yxatlarni ham
// (masalan, matematika-fizika kabi ommaviy yo'nalishlarni) to'liq qamrab oladi
// (20000 sahifa = ~200 000 kishigacha)
const MAX_KQ_ID_SEARCH_PAGES = 20000;
// "189 ball statistikasi" tugmasi qaysi ball bo'yicha hisoblashini belgilaydi
const KQ_TARGET_SCORE = 189;

// ---------------------------------------------------------------------------
// Bosh menyudagi "📊 189 ball" — mustaqil, qisqa oqim: fanlar majmuasi -> til
// -> to'g'ridan-to'g'ri natija (oraliq "rejim tanlash" ekranisiz)
// ---------------------------------------------------------------------------
// Foydalanuvchi o'zining fanlar majmuasini qo'lda yozayotganini kutayotgan bo'lsak, shu Set ichida turadi
const awaiting189CustomSubject = new Set();
// Fanlar majmuasi tanlangandan (yoki yozilgandan) keyin, til tanlangunga
// qadar vaqtincha shu yerda saqlanadi (userId -> "Fan1 + Fan2")
const pending189Subject = new Map();
// Ta'lim tili tanlash tugmalari callback_data -> { edLangId, label }
const B189_LANG_LABELS = {
  b189_lang_1: { edLangId: 1, label: "O'zbekcha" },
  b189_lang_2: { edLangId: 2, label: 'Русский' },
  b189_lang_3: { edLangId: 3, label: 'Qoraqalpoq' },
  b189_lang_4: { edLangId: 4, label: 'Tadjik' },
  b189_lang_5: { edLangId: 5, label: 'Qozoq' },
};

function ball189SubjectScreen() {
  const text =
    `📊 <b>189 ball statistikasi</b>\n\n` +
    `Bu bo'lim orqali tanlagan fanlar majmuasi va ta'lim tili bo'yicha ` +
    `<b>aynan 189 ball</b> va <b>189 balldan yuqori</b> ball to'plagan abituriyentlar sonini bilib olasiz ` +
    `— bevosita <b>mandat.uzbmb.uz</b> saytidan, jonli hisoblab.\n\n` +
    `Fanlar majmuangizni tanlang 👇\n\n` +
    `<i>Ro'yxatda kerakli majmua yo'q bo'lsa, "✍️ O'zim yozaman" tugmasini bosing.</i>`;

  const keyboard = MANDAT_SUBJECT_OPTIONS.map((subject, i) => [
    btn({ text: subject, callback_data: `b189_subj_${i}`, style: 'primary' }),
  ]);
  keyboard.push([btn({ text: "✍️ O'zim yozaman", callback_data: 'b189_subj_custom', style: 'success' })]);
  keyboard.push(backRow);

  return { text, keyboard };
}

function ball189LangScreen(subject) {
  const text = `✅ Fanlar majmuasi: <b>${subject}</b>\n\n🌐 Ta'lim tilini tanlang 👇`;

  const keyboard = [
    [btn({ text: "O'zbekcha", callback_data: 'b189_lang_1', style: 'primary' })],
    [btn({ text: 'Русский', callback_data: 'b189_lang_2', style: 'primary' })],
    [btn({ text: 'Qoraqalpoq', callback_data: 'b189_lang_3', style: 'primary' })],
    [btn({ text: 'Tadjik', callback_data: 'b189_lang_4', style: 'primary' })],
    [btn({ text: 'Qozoq', callback_data: 'b189_lang_5', style: 'primary' })],
    backRow,
  ];

  return { text, keyboard };
}

async function askFor189Lang(chatId, userId, subject) {
  pending189Subject.set(userId, subject);
  const { text, keyboard } = ball189LangScreen(subject);
  await safeSend(chatId, text, keyboard);
}

function kengaytirilganSubjectScreen() {
  const text =
    `🔎 <b>Kengaytirilgan qidiruv</b>\n\n` +
    `Bu bo'lim orqali tanlagan fanlar majmuasi va ta'lim tili bo'yicha ` +
    `<b>yakuniy mandatga kirgan barcha abituriyentlar ro'yxatini</b> ko'rishingiz mumkin ` +
    `— bevosita <b>mandat.uzbmb.uz</b> saytidan, xuddi saytning o'zidagidek.\n\n` +
    `Fanlar majmuangizni tanlang 👇\n\n` +
    `<i>Ro'yxatda kerakli majmua yo'q bo'lsa, "✍️ O'zim yozaman" tugmasini bosing.</i>`;

  const keyboard = MANDAT_SUBJECT_OPTIONS.map((subject, i) => [
    btn({ text: subject, callback_data: `kq_subj_${i}`, style: 'primary' }),
  ]);
  keyboard.push([btn({ text: "✍️ O'zim yozaman", callback_data: 'kq_subj_custom', style: 'success' })]);
  keyboard.push(backRow);

  return { text, keyboard };
}

function kengaytirilganLangScreen(subject) {
  const text = `✅ Fanlar majmuasi: <b>${subject}</b>\n\n🌐 Ta'lim tilini tanlang 👇`;

  const keyboard = [
    [btn({ text: "O'zbekcha", callback_data: 'kq_lang_1', style: 'primary' })],
    [btn({ text: 'Русский', callback_data: 'kq_lang_2', style: 'primary' })],
    [btn({ text: 'Qoraqalpoq', callback_data: 'kq_lang_3', style: 'primary' })],
    [btn({ text: 'Tadjik', callback_data: 'kq_lang_4', style: 'primary' })],
    [btn({ text: 'Qozoq', callback_data: 'kq_lang_5', style: 'primary' })],
    backRow,
  ];

  return { text, keyboard };
}

async function askForKQLang(chatId, userId, subject) {
  pendingKQSubject.set(userId, subject);
  const { text, keyboard } = kengaytirilganLangScreen(subject);
  await safeSend(chatId, text, keyboard);
}

// Fanlar majmuasi va til tanlangandan keyin — to'liq ro'yxatni ko'rishni yoki
// ID orqali o'z o'rnini topishni tanlash ekrani
function kengaytirilganModeScreen(subject, langLabel) {
  const text =
    `✅ Fanlar majmuasi: <b>${subject}</b>\n` +
    `✅ Ta'lim tili: <b>${langLabel}</b>\n\n` +
    `Qanday ko'rmoqchisiz? 👇`;

  const keyboard = [
    [btn({ text: "📋 To'liq ro'yxatni ko'rish", callback_data: 'kq_mode_list', style: 'primary' })],
    [btn({ text: "🆔 ID orqali o'rnimni topish", callback_data: 'kq_mode_id', style: 'success' })],
    [btn({ text: '📊 189 ball statistikasi', callback_data: 'kq_mode_189', style: 'danger' })],
    backRow,
  ];

  return { text, keyboard };
}

// "189 ball statistikasi" natijasini matn ko'rinishida tayyorlaydi
function formatKQ189Result(filters, stats, targetScore) {
  const approxNote = stats.approx
    ? `\n\n<i>⚠️ Ro'yxat juda katta bo'lgani uchun natija taxminiy (yaqin son).</i>`
    : '';

  return (
    `📊 <b>${targetScore} ball statistikasi</b>\n\n` +
    `📚 Fanlar majmuasi: <b>${filters.subject}</b>\n` +
    `🌐 Ta'lim tili: <b>${filters.langLabel}</b>\n\n` +
    `🎯 Aynan <b>${targetScore}</b> ball to'plaganlar: <b>${stats.exactCount}</b> ta\n` +
    `📈 <b>${targetScore}</b> balldan yuqori to'plaganlar: <b>${stats.aboveCount}</b> ta` +
    approxNote
  );
}

// Zaxira usul: agar abituriyentning ballini oldindan bilib bo'lmasa (masalan,
// umumiy ma'lumot olinmadi), binary search ishlamaydi — shunda sahifalarni
// PARALLEL paketlarda (bir nechtasini bir vaqtda) ketma-ket tekshiramiz.
// Bu sekinroq, shuning uchun xavfsizlik uchun maxPages bilan chegaralangan.
async function fetchKQEntrantLinearScan(s4subject, s5subject, edLangId, entrantId, maxPages, onProgress) {
  const BATCH_SIZE = 15;
  for (let batchStart = 1; batchStart <= maxPages; batchStart += BATCH_SIZE) {
    const batchPages = [];
    for (let p = batchStart; p < batchStart + BATCH_SIZE && p <= maxPages; p++) batchPages.push(p);

    const batchResults = await Promise.all(
      batchPages.map((p) => fetchKengaytirilganPage(s4subject, s5subject, edLangId, p))
    );

    for (let i = 0; i < batchResults.length; i++) {
      const page = batchPages[i];
      const cards = batchResults[i];
      const idx = cards.findIndex((c) => c.id === entrantId);
      if (idx !== -1) return { found: { page, index: idx, card: cards[idx], cards, hasNext: cards.length === KQ_PAGE_SIZE } };
      if (cards.length < KQ_PAGE_SIZE) return { found: null, listEnded: true };
    }

    if (onProgress) onProgress({ page: batchPages[batchPages.length - 1] });
  }
  return { found: null, listEnded: false };
}


function formatKQCardLine(card, rank) {
  let line = `🏅 <b>${rank}-o'rin</b>\n👤 <b>${card.name}</b>\n🆔 ID: <b>${card.id}</b>\n`;
  if (card.scoreText) line += `🎯 Ball: <b>${card.scoreText}</b>\n`;
  if (card.thresholdText) line += `🚩 ${card.thresholdText}\n`;
  return line.trim();
}

// "ID orqali o'rnimni topish" natijasi — FAQAT shu foydalanuvchining o'z
// kartasi ko'rsatiladi, ro'yxatdagi boshqa hech kim ko'rinmaydi
function formatKQIdFoundResult(card, rank, filters, subjects, totalInfo) {
  const totalLine = totalInfo
    ? ` (jami ${totalInfo.approx ? '~' : ''}${totalInfo.count} ta abituriyent ichida)`
    : '';

  let text =
    `✅ <b>#${card.id} topildi — ${rank}-o'rinda!</b>\n\n` +
    `👤 <b>${card.name}</b>\n` +
    `🔢 ID: <b>${card.id}</b>\n` +
    `🏅 O'rni: <b>${rank}</b>${totalLine}\n` +
    (card.scoreText ? `🎯 To'plangan ball: <b>${card.scoreText}</b>\n` : '') +
    (card.thresholdText ? `🚩 ${card.thresholdText}\n` : '') +
    `📚 Fanlar majmuasi: <b>${filters.subject}</b>\n` +
    `🌐 Ta'lim tili: <b>${filters.langLabel}</b>\n`;

  if (subjects) {
    text += `\n📖 <b>Tafsilot:</b>\n`;
    if (subjects.majburiy) text += `• Majburiy fanlar: ${subjects.majburiy}\n`;
    if (subjects.fan1) text += `• 1-mutaxassislik fani: ${subjects.fan1}\n`;
    if (subjects.fan2) text += `• 2-mutaxassislik fani: ${subjects.fan2}\n`;
    if (subjects.umumiy) text += `• Umumiy ball: ${subjects.umumiy}\n`;
  }

  return text.trim();
}


// Foydalanuvchining hozirgi "Kengaytirilgan qidiruv" sahifasini matn +
// klaviatura ko'rinishida qaytaradi
function renderKQPage(userId) {
  const state = kqResultsState.get(userId);
  if (!state) return null;

  const { subject, langLabel, page, cards } = state;
  const start = (page - 1) * KQ_PAGE_SIZE;

  const header =
    `🔎 <b>Kengaytirilgan qidiruv</b>\n\n` +
    `📚 Fanlar majmuasi: <b>${subject}</b>\n` +
    `🌐 Ta'lim tili: <b>${langLabel}</b>\n\n` +
    (cards.length
      ? `👥 <b>${page}</b>-sahifa (har sahifada ${KQ_PAGE_SIZE} tagacha):\n\n`
      : `😕 Bu fanlar majmuasi va til bo'yicha natija topilmadi.\n\n`);

  const body = cards.map((c, i) => formatKQCardLine(c, start + i + 1)).join('\n\n');
  const text = `${header}${body}`;

  const keyboard = [];
  const navRow = [];
  if (page > 1) navRow.push(btn({ text: '⬅️ Oldingisi', callback_data: 'kq_page_prev', style: 'primary' }));
  if (state.hasNext) navRow.push(btn({ text: 'Keyingisi ➡️', callback_data: 'kq_page_next', style: 'primary' }));
  if (navRow.length) keyboard.push(navRow);
  keyboard.push(backRow);

  return { text, keyboard };
}

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
    [btn({ text: "O'zbek", callback_data: 'yon_til_uz', style: 'primary', icon: '5271648932194195260' })],
    [btn({ text: 'Rus', callback_data: 'yon_til_ru', style: 'primary', icon: '5305587746587300980' })],
    [btn({ text: 'Qoraqalpoq', callback_data: 'yon_til_qq', style: 'primary', icon: '5364282834078939253' })],
    [btn({ text: 'Qozoq', callback_data: 'yon_til_qz', style: 'primary', icon: '5244446228543983332' })],
    [btn({ text: "Qirg'iz", callback_data: 'yon_til_kg', style: 'primary', icon: '6323615997852910673' })],
    [btn({ text: 'Tojik', callback_data: 'yon_til_tj', style: 'primary', icon: '5244570589322039598' })],
    [btn({ text: 'Turkman', callback_data: 'yon_til_tk', style: 'primary', icon: '5431468139906901536' })],
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

// Ta'lim shakli tanlangandan keyin qabul turini (Grant / Kontrakt /
// Grant + Kontrakt) so'raydi
function yonalishQabulTuriScreen() {
  const text =
    `💰 Qabul turini tanlang 👇\n\n` +
    `<i>Faqat grant, faqat kontrakt yoki ikkalasini birga ko'rishingiz mumkin.</i>`;

  const keyboard = [
    [btn({ text: '🟢 Faqat Grant', callback_data: 'yon_qabul_grant', style: 'success' })],
    [btn({ text: '🔵 Faqat Kontrakt', callback_data: 'yon_qabul_kontrakt', style: 'primary' })],
    [btn({ text: '🟢🔵 Grant + Kontrakt', callback_data: 'yon_qabul_both', style: 'danger' })],
    backRow,
  ];

  return { text, keyboard };
}

async function askForYonalishQabulTuri(chatId, userId) {
  const { text, keyboard } = yonalishQabulTuriScreen();
  await safeSend(chatId, text, keyboard);
}

// Fanlar majmuasi, til va shakl tanlangandan (yoki yozilgandan) keyin DTM balini so'raydi
async function askForYonalishBall(chatId, userId) {
  awaitingYonalishBall.add(userId);
  const subject = pendingYonalishSubject.get(userId) || 'Kiritilmagan';
  const qabulTuriLabel = QABUL_TURI_LABELS[pendingYonalishQabulTuri.get(userId)] || '';
  try {
    await bot.sendMessage(
      chatId,
      `✅ Fanlar majmuasi: <b>${subject}</b>\n` +
        (qabulTuriLabel ? `✅ Qabul turi: <b>${qabulTuriLabel}</b>\n` : '') +
        `\n🔢 Endi DTM balingizni raqam bilan yozing (masalan: <b>154.5</b>):`,
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
  menu_kengaytirilgan: kengaytirilganSubjectScreen,
  menu_189: ball189SubjectScreen,
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

// "Botni baholang" ekranini tepasida rasm bilan yuboradi (yangi xabar sifatida)
async function sendRatingScreen(chatId, html, keyboard) {
  try {
    const photoSource = CACHED_RATING_BANNER_FILE_ID || RATING_BANNER_PATH;
    const sent = await bot.sendPhoto(chatId, photoSource, {
      caption: html,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
    if (!CACHED_RATING_BANNER_FILE_ID) {
      const photos = sent.photo;
      if (photos && photos.length) {
        CACHED_RATING_BANNER_FILE_ID = photos[photos.length - 1].file_id;
      }
    }
    return sent;
  } catch (err) {
    console.error('sendPhoto xatosi (baho banner), faqat matn yuborilmoqda:', err.message);
    await safeSend(chatId, html, keyboard);
  }
}

// "Botni baholang" ekranidagi mavjud rasmli xabarning caption va tugmalarini yangilaydi
async function editRatingScreen(chatId, messageId, html, keyboard) {
  try {
    await bot.editMessageCaption(html, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    if (String(err.message).includes('message is not modified')) return;
    console.error('editMessageCaption xatosi (baho):', err.message);
  }
}

// "Mandat tanlash" (fanlar majmuasi) ekranini tepasida rasm bilan yuboradi
async function sendMandatScreen(chatId, html, keyboard) {
  try {
    const photoSource = CACHED_MANDAT_BANNER_FILE_ID || MANDAT_BANNER_PATH;
    const sent = await bot.sendPhoto(chatId, photoSource, {
      caption: html,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
    if (!CACHED_MANDAT_BANNER_FILE_ID) {
      const photos = sent.photo;
      if (photos && photos.length) {
        CACHED_MANDAT_BANNER_FILE_ID = photos[photos.length - 1].file_id;
      }
    }
    return sent;
  } catch (err) {
    console.error('sendPhoto xatosi (mandat banner), faqat matn yuborilmoqda:', err.message);
    await safeSend(chatId, html, keyboard);
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

// ---------------------------------------------------------------------------
// Admin uchun: "/xabar" — biror xabarga "Reply" qilib shu buyruqni yozsa,
// o'sha xabar botdan foydalangan BARCHA foydalanuvchilarga yuboriladi
// (matn, rasm, video, fayl — qanday bo'lsa, xuddi shunday nusxalanadi).
// Xavfsizlik uchun avval tasdiqlash so'raladi.
// ---------------------------------------------------------------------------
bot.onText(/^\/xabar/, async (msg) => {
  if (!ADMIN_CHAT_ID || String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;

  if (!msg.reply_to_message) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "⚠️ Yubormoqchi bo'lgan xabaringizga (matn, rasm, video, fayl — nima bo'lsa ham) \"Reply\" qilib, shu ostiga <code>/xabar</code> deb yozing.",
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('/xabar xatosi:', err.message);
    }
    return;
  }

  pendingBroadcast = {
    fromChatId: msg.reply_to_message.chat.id,
    messageId: msg.reply_to_message.message_id,
  };

  try {
    await bot.sendMessage(
      msg.chat.id,
      `📢 Ushbu xabar <b>${USERS_DB.size}</b> ta foydalanuvchiga yuborilsinmi?`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Ha, yubor', callback_data: 'broadcast_confirm' },
              { text: '❌ Bekor qilish', callback_data: 'broadcast_cancel' },
            ],
          ],
        },
      }
    );
  } catch (err) {
    console.error('/xabar tasdiqlash xabari xatosi:', err.message);
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
  registerUser(msg.chat.id);
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
// "Kengaytirilgan qidiruv" — foydalanuvchi o'zining fanlar majmuasini qo'lda yozganda
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;

  const userId = msg.from.id;
  if (!awaitingKQCustomSubject.has(userId)) return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const subject = msg.text.trim();
  awaitingKQCustomSubject.delete(userId);

  if (!subject) {
    awaitingKQCustomSubject.add(userId);
    try {
      await bot.sendMessage(msg.chat.id, "❗️ Iltimos, fanlar majmuasini matn ko'rinishida yozing.");
    } catch (err) {
      console.error("Kengaytirilgan qidiruv fanlar majmuasi validatsiya xabari xatosi:", err.message);
    }
    return;
  }

  await askForKQLang(msg.chat.id, userId, subject);
});

// ---------------------------------------------------------------------------
// "189 ball" — foydalanuvchi o'zining fanlar majmuasini qo'lda yozganda
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;

  const userId = msg.from.id;
  if (!awaiting189CustomSubject.has(userId)) return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const subject = msg.text.trim();
  awaiting189CustomSubject.delete(userId);

  if (!subject) {
    awaiting189CustomSubject.add(userId);
    try {
      await bot.sendMessage(msg.chat.id, "❗️ Iltimos, fanlar majmuasini matn ko'rinishida yozing.");
    } catch (err) {
      console.error('189 ball fanlar majmuasi validatsiya xabari xatosi:', err.message);
    }
    return;
  }

  await askFor189Lang(msg.chat.id, userId, subject);
});

// ---------------------------------------------------------------------------
// "Kengaytirilgan qidiruv" — foydalanuvchi ID orqali o'z o'rnini kiritganda,
// tanlangan fanlar majmuasi + til bo'yicha ro'yxatni sahifama-sahifa (saytdan
// jonli) ko'rib, shu ID'ni topib, aynan nechanchi o'rinda ekanini aniqlaydi
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;

  const userId = msg.from.id;
  if (!awaitingKQId.has(userId)) return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const entrantId = msg.text.trim();
  if (!/^\d{7}$/.test(entrantId)) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "❗️ Iltimos, 7 xonali abituriyent ID raqamini to'g'ri kiriting (masalan: 5506347)."
      );
    } catch (err) {
      console.error('Kengaytirilgan qidiruv ID validatsiya xabari xatosi:', err.message);
    }
    return; // holat saqlanadi — qayta urinish mumkin
  }

  awaitingKQId.delete(userId);

  const filters = pendingKQFilters.get(userId);
  if (!filters) {
    try {
      await bot.sendMessage(msg.chat.id, "❗️ Avval fanlar majmuasi va ta'lim tilini tanlang.", {
        reply_markup: { inline_keyboard: [backRow] },
      });
    } catch (err) {
      console.error('Kengaytirilgan qidiruv filtr topilmadi xabari xatosi:', err.message);
    }
    return;
  }

  let progressMsgId = null;
  try {
    const progressMsg = await bot.sendMessage(
      msg.chat.id,
      `🔎 "${filters.subject}" ro'yxatidan #${entrantId} qidirilmoqda...`
    );
    progressMsgId = progressMsg.message_id;
  } catch (err) {
    console.error("Kengaytirilgan qidiruv ID 'qidirilmoqda' xabari xatosi:", err.message);
  }

  const updateProgress = async (extra) => {
    if (!progressMsgId) return;
    try {
      await bot.editMessageText(
        `🔎 "${filters.subject}" ro'yxatidan #${entrantId} qidirilmoqda...${extra ? `\n${extra}` : ''}`,
        { chat_id: msg.chat.id, message_id: progressMsgId }
      );
    } catch (err) {}
  };

  // Avval umumiy natija so'rovi orqali abituriyentning ballini bilib olamiz —
  // shu ball asosida to'g'ridan-to'g'ri kerakli sahifaga "sakrab" (binary
  // search) topamiz, minglab sahifani birma-bir tekshirib chiqmaymiz
  let targetScore = null;
  try {
    const generalResult = await fetchMandatById(entrantId);
    if (generalResult && generalResult.scoreText) {
      targetScore = parseKQScoreNumber(generalResult.scoreText);
    }
  } catch (err) {
    console.error('Kengaytirilgan qidiruv uchun umumiy ball olishda xatolik:', err.message);
  }

  let searchErr = null;
  let searchResult = null;
  let lastProgressUpdate = 0;

  try {
    searchResult = await findKQEntrantByScore(
      filters.s4subject,
      filters.s5subject,
      filters.edLangId,
      entrantId,
      targetScore,
      ({ requests }) => {
        // Har 5 so'rovda bir marta progress xabarini yangilaymiz (Telegram limitiga tushmaslik uchun)
        if (requests - lastProgressUpdate >= 5) {
          lastProgressUpdate = requests;
          updateProgress(`(${requests} ta so'rov tekshirildi)`);
        }
      }
    );
  } catch (err) {
    searchErr = err;
    console.error('Kengaytirilgan qidiruv ID qidiruv xatosi:', err.message);
  }

  pendingKQFilters.delete(userId);

  if (searchErr) {
    const errText = "❌ mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.";
    if (progressMsgId) {
      try {
        await bot.editMessageText(errText, {
          chat_id: msg.chat.id,
          message_id: progressMsgId,
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {}
    } else {
      await safeSend(msg.chat.id, errText, [backRow]);
    }
    return;
  }

  // Agar tezkor (ball asosidagi) qidiruv topa olmasa — ballar farq qilishi
  // yoki ball umuman aniqlanmagan bo'lishi mumkin — oxirgi chora sifatida
  // chegaralangan to'liq (sekinroq) parallel-paketli qidiruvga o'tamiz
  if (searchResult && !searchResult.found) {
    const FALLBACK_MAX_PAGES = 15000; // ~150 000 kishigacha (mat-fizika kabi ommaviy majmualar uchun ham yetarli)
    try {
      const fallbackResult = await fetchKQEntrantLinearScan(
        filters.s4subject,
        filters.s5subject,
        filters.edLangId,
        entrantId,
        FALLBACK_MAX_PAGES,
        ({ page }) => {
          if (page - lastProgressUpdate >= 80) {
            lastProgressUpdate = page;
            updateProgress(`(~${page * KQ_PAGE_SIZE} kishi tekshirildi)`);
          }
        }
      );
      searchResult = fallbackResult;
    } catch (err) {
      searchErr = err;
      console.error('Kengaytirilgan qidiruv zaxira qidiruv xatosi:', err.message);
    }
  }

  if (searchErr) {
    const errText = "❌ mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.";
    if (progressMsgId) {
      try {
        await bot.editMessageText(errText, {
          chat_id: msg.chat.id,
          message_id: progressMsgId,
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {}
    } else {
      await safeSend(msg.chat.id, errText, [backRow]);
    }
    return;
  }

  if (!searchResult || !searchResult.found) {
    const notFoundText =
      `❌ <b>#${entrantId}</b> ID "<b>${filters.subject}</b>" (${filters.langLabel}) ro'yxatidan topilmadi.\n\n` +
      `<i>Bu ID boshqa fanlar majmuasi yoki ta'lim tili bo'yicha yakuniy mandatga kirgan bo'lishi mumkin — ` +
      `shu majmua/tilni tekshirib qayta urinib ko'ring, yoki ID raqamini qayta tekshiring.</i>`;
    if (progressMsgId) {
      try {
        await bot.editMessageText(notFoundText, {
          chat_id: msg.chat.id,
          message_id: progressMsgId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {}
    } else {
      await safeSend(msg.chat.id, notFoundText, [backRow]);
    }
    return;
  }

  const { page: foundPage, index: foundIndex, card: foundCard } = searchResult.found;
  const rank = (foundPage - 1) * KQ_PAGE_SIZE + foundIndex + 1;

  // Fanlar majmuasi bo'yicha qo'shimcha tafsilot (agar hashId mavjud bo'lsa)
  let subjectsDetail = null;
  try {
    subjectsDetail = await fetchEntrantSubjectDetails(foundCard.hashId);
  } catch (err) {
    console.error('Kengaytirilgan qidiruv tafsilot olishda xatolik:', err.message);
  }

  // Shu fanlar majmuasi + til bo'yicha jami nechta abituriyent yakuniy
  // mandatga kirganini ham aniqlaymiz (topilmasa ham natija ko'rsatiladi)
  let totalInfo = null;
  try {
    totalInfo = await getKQTotalCount(filters.s4subject, filters.s5subject, filters.edLangId);
  } catch (err) {
    console.error("Kengaytirilgan qidiruv jami son hisoblashda xatolik:", err.message);
  }

  // Diqqat: bu yerda FAQAT topilgan foydalanuvchining o'z kartasi ko'rsatiladi,
  // sahifadagi boshqa abituriyentlar (ro'yxat) ko'rsatilmaydi
  const resultText = formatKQIdFoundResult(foundCard, rank, filters, subjectsDetail, totalInfo);

  if (progressMsgId) {
    try {
      await bot.editMessageText(resultText, {
        chat_id: msg.chat.id,
        message_id: progressMsgId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [backRow] },
      });
    } catch (err) {
      console.error('Kengaytirilgan qidiruv ID natijasini tahrirlashda xatolik:', err.message);
    }
  } else {
    await safeSend(msg.chat.id, resultText, [backRow]);
  }
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
  const qabulTuri = pendingYonalishQabulTuri.get(userId) || 'both';
  pendingYonalishQabulTuri.delete(userId);
  const qabulTuriLabel = QABUL_TURI_LABELS[qabulTuri] || QABUL_TURI_LABELS.both;

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
      const cls = classifyYonalishItem(r, ball, qabulTuri);
      return { ...r, _status: cls.status, _qualifies: cls.qualifies };
    })
    .filter((r) => r._qualifies);

  if (!qualifying.length) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        `🔴 <b>${subject}</b>${tanlovLabel ? ` (${tanlovLabel})` : ''} fanlar majmuasi, <b>${qabulTuriLabel}</b> qabul turi va ` +
          `<b>${ball}</b> ball bilan hozircha hech qanday yo'nalishga kira olmaysiz.\n\n` +
          `<i>Fanlar majmuasini yoki qabul turini boshqacharoq tanlab ko'ring yoki keyingi safar tayyorgarlikni kuchaytiring 💪.</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
      );
    } catch (err) {
      console.error("Yo'nalish natija topilmadi xabarini yuborishda xatolik:", err.message);
    }
    return;
  }

  yonalishResultsState.set(userId, { subject, ball, qabulTuri, qabulTuriLabel, items: qualifying, page: 0 });
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

  // Admin — broadcast xabarni yuborishni bekor qilish
  if (query.data === 'broadcast_cancel') {
    pendingBroadcast = null;
    try {
      await bot.answerCallbackQuery(query.id, { text: 'Bekor qilindi.' });
    } catch (err) {
      console.error('broadcast_cancel answerCallbackQuery xatosi:', err.message);
    }
    try {
      await bot.editMessageText("❌ Xabar yuborish bekor qilindi.", { chat_id: chatId, message_id: messageId });
    } catch (err) {}
    return;
  }

  // Admin — broadcast xabarni haqiqatan ham barcha foydalanuvchilarga yuborish
  if (query.data === 'broadcast_confirm') {
    if (!pendingBroadcast) {
      try {
        await bot.answerCallbackQuery(query.id, { text: "⚠️ Yuboriladigan xabar topilmadi.", show_alert: true });
      } catch (err) {}
      return;
    }

    const { fromChatId, messageId: srcMessageId } = pendingBroadcast;
    pendingBroadcast = null;

    try {
      await bot.answerCallbackQuery(query.id, { text: '🚀 Yuborish boshlandi...' });
    } catch (err) {
      console.error('broadcast_confirm answerCallbackQuery xatosi:', err.message);
    }
    try {
      await bot.editMessageText('🚀 Xabar yuborilmoqda, biroz kuting...', { chat_id: chatId, message_id: messageId });
    } catch (err) {}

    const targets = [...USERS_DB];
    let sent = 0;
    let failed = 0;

    for (const targetId of targets) {
      try {
        await bot.copyMessage(targetId, fromChatId, srcMessageId);
        sent += 1;
      } catch (err) {
        failed += 1;
      }
      // Telegram rate-limitiga tushib qolmaslik uchun har xabar orasida kichik pauza
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    try {
      await bot.sendMessage(
        chatId,
        `✅ Xabar yuborish yakunlandi.\n\n📨 Yuborildi: <b>${sent}</b>\n🚫 Yetkazilmadi: <b>${failed}</b>`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('broadcast yakuniy hisobot xatosi:', err.message);
    }
    return;
  }

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
  if (YONALISH_TIL_LABELS[query.data]) {
    pendingYonalishTil.set(userId, YONALISH_TIL_LABELS[query.data]);
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
    await askForYonalishQabulTuri(chatId, userId);
    return;
  }

  // "Mandat tanlash" — qabul turi (Grant / Kontrakt / Grant + Kontrakt) tanlandi
  if (
    query.data === 'yon_qabul_grant' ||
    query.data === 'yon_qabul_kontrakt' ||
    query.data === 'yon_qabul_both'
  ) {
    const qabulTuri = query.data.replace('yon_qabul_', '');
    pendingYonalishQabulTuri.set(userId, qabulTuri);
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

  // "Kengaytirilgan qidiruv" — foydalanuvchi ro'yxatdan fanlar majmuasini tanladi
  if (query.data && query.data.startsWith('kq_subj_') && query.data !== 'kq_subj_custom') {
    const index = parseInt(query.data.replace('kq_subj_', ''), 10);
    const subject = MANDAT_SUBJECT_OPTIONS[index];
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    if (!subject) return;
    await askForKQLang(chatId, userId, subject);
    return;
  }

  // "Kengaytirilgan qidiruv" — foydalanuvchi o'zi fanlar majmuasini yozmoqchi
  if (query.data === 'kq_subj_custom') {
    awaitingKQCustomSubject.add(userId);
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
      console.error("Kengaytirilgan qidiruv fanlar majmuasi so'rash xabari xatosi:", err.message);
    }
    return;
  }

  // "189 ball" — foydalanuvchi ro'yxatdan fanlar majmuasini tanladi
  if (query.data && query.data.startsWith('b189_subj_') && query.data !== 'b189_subj_custom') {
    const index = parseInt(query.data.replace('b189_subj_', ''), 10);
    const subject = MANDAT_SUBJECT_OPTIONS[index];
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    if (!subject) return;
    await askFor189Lang(chatId, userId, subject);
    return;
  }

  // "189 ball" — foydalanuvchi o'zi fanlar majmuasini yozmoqchi
  if (query.data === 'b189_subj_custom') {
    awaiting189CustomSubject.add(userId);
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
      console.error("189 ball fanlar majmuasi so'rash xabari xatosi:", err.message);
    }
    return;
  }

  // "189 ball" — ta'lim tili tanlandi -> to'g'ridan-to'g'ri hisoblab natijani ko'rsatamiz
  if (B189_LANG_LABELS[query.data]) {
    const { edLangId, label } = B189_LANG_LABELS[query.data];
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);

    const subject = pending189Subject.get(userId) || '';
    pending189Subject.delete(userId);

    const parts = subject.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length !== 2) {
      try {
        await bot.sendMessage(
          chatId,
          `❗️ Fanlar majmuasi noto'g'ri formatda. Iltimos, "<b>Fan1 + Fan2</b>" ko'rinishida yozing (masalan: Matematika + Fizika).`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
        );
      } catch (err) {
        console.error('189 ball format xabari xatosi:', err.message);
      }
      return;
    }
    const [s4subject, s5subject] = parts;
    const filters = { subject, s4subject, s5subject, edLangId, langLabel: label };

    let thinkingMsgId = null;
    try {
      const thinkingMsg = await bot.sendMessage(chatId, '🔎 mandat.uzbmb.uz saytidan hisoblanmoqda...');
      thinkingMsgId = thinkingMsg.message_id;
    } catch (err) {
      console.error("189 ball 'hisoblanmoqda' xabari xatosi:", err.message);
    }

    let stats = null;
    let fetchErr = null;
    try {
      stats = await getKQScoreStats(s4subject, s5subject, edLangId, KQ_TARGET_SCORE);
    } catch (err) {
      fetchErr = err;
      console.error('189 ball statistikasi hisoblashda xatolik:', err.message);
    }

    if (fetchErr || !stats) {
      const errText = "❌ mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.";
      if (thinkingMsgId) {
        try {
          await bot.editMessageText(errText, {
            chat_id: chatId,
            message_id: thinkingMsgId,
            reply_markup: { inline_keyboard: [backRow] },
          });
        } catch (err) {}
      } else {
        await safeSend(chatId, errText, [backRow]);
      }
      return;
    }

    const resultText = formatKQ189Result(filters, stats, KQ_TARGET_SCORE);
    if (thinkingMsgId) {
      try {
        await bot.editMessageText(resultText, {
          chat_id: chatId,
          message_id: thinkingMsgId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {
        console.error('189 ball natijasini tahrirlashda xatolik:', err.message);
      }
    } else {
      await safeSend(chatId, resultText, [backRow]);
    }
    return;
  }

  // "Kengaytirilgan qidiruv" — ta'lim tili tanlandi -> to'liq ro'yxat yoki ID
  // orqali qidirishni tanlashni so'raymiz
  if (KQ_LANG_LABELS[query.data]) {
    const { edLangId, label } = KQ_LANG_LABELS[query.data];
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);

    const subject = pendingKQSubject.get(userId) || '';
    pendingKQSubject.delete(userId);

    const parts = subject.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length !== 2) {
      try {
        await bot.sendMessage(
          chatId,
          `❗️ Fanlar majmuasi noto'g'ri formatda. Iltimos, "<b>Fan1 + Fan2</b>" ko'rinishida yozing (masalan: Matematika + Fizika).`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
        );
      } catch (err) {
        console.error('Kengaytirilgan qidiruv format xabari xatosi:', err.message);
      }
      return;
    }
    const [s4subject, s5subject] = parts;

    pendingKQFilters.set(userId, { subject, s4subject, s5subject, edLangId, langLabel: label });

    const { text, keyboard } = kengaytirilganModeScreen(subject, label);
    await safeSend(chatId, text, keyboard);
    return;
  }

  // "Kengaytirilgan qidiruv" — "To'liq ro'yxatni ko'rish" tanlandi -> saytdan 1-sahifani olib kelamiz
  if (query.data === 'kq_mode_list') {
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);

    const filters = pendingKQFilters.get(userId);
    if (!filters) {
      try {
        await bot.sendMessage(chatId, "❗️ Avval fanlar majmuasi va ta'lim tilini tanlang.", {
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {}
      return;
    }

    let thinkingMsgId = null;
    try {
      const thinkingMsg = await bot.sendMessage(chatId, '🔎 mandat.uzbmb.uz saytidan qidirilmoqda...');
      thinkingMsgId = thinkingMsg.message_id;
    } catch (err) {
      console.error("Kengaytirilgan qidiruv 'qidirilmoqda' xabari xatosi:", err.message);
    }

    let cards = [];
    let fetchErr = null;
    try {
      cards = await fetchKengaytirilganPage(filters.s4subject, filters.s5subject, filters.edLangId, 1);
    } catch (err) {
      fetchErr = err;
      console.error('Kengaytirilgan qidiruv xatosi:', err.message);
    }

    if (fetchErr) {
      const errText = "❌ mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.";
      if (thinkingMsgId) {
        try {
          await bot.editMessageText(errText, {
            chat_id: chatId,
            message_id: thinkingMsgId,
            reply_markup: { inline_keyboard: [backRow] },
          });
        } catch (err) {}
      } else {
        await safeSend(chatId, errText, [backRow]);
      }
      return;
    }

    kqResultsState.set(userId, {
      subject: filters.subject,
      s4subject: filters.s4subject,
      s5subject: filters.s5subject,
      edLangId: filters.edLangId,
      langLabel: filters.langLabel,
      page: 1,
      cards,
      hasNext: cards.length === KQ_PAGE_SIZE,
    });

    const rendered = renderKQPage(userId);
    if (thinkingMsgId) {
      try {
        await bot.editMessageText(rendered.text, {
          chat_id: chatId,
          message_id: thinkingMsgId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rendered.keyboard },
        });
      } catch (err) {
        console.error('Kengaytirilgan qidiruv natijasini tahrirlashda xatolik:', err.message);
      }
    } else {
      await safeSend(chatId, rendered.text, rendered.keyboard);
    }
    return;
  }

  // "Kengaytirilgan qidiruv" — "189 ball statistikasi" tanlandi -> saytdan
  // hisoblab, aynan 189 va 189 balldan yuqori to'plaganlar sonini ko'rsatamiz
  if (query.data === 'kq_mode_189') {
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);

    const filters = pendingKQFilters.get(userId);
    if (!filters) {
      try {
        await bot.sendMessage(chatId, "❗️ Avval fanlar majmuasi va ta'lim tilini tanlang.", {
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {}
      return;
    }

    let thinkingMsgId = null;
    try {
      const thinkingMsg = await bot.sendMessage(chatId, '🔎 mandat.uzbmb.uz saytidan hisoblanmoqda...');
      thinkingMsgId = thinkingMsg.message_id;
    } catch (err) {
      console.error("189 ball statistikasi 'hisoblanmoqda' xabari xatosi:", err.message);
    }

    let stats = null;
    let fetchErr = null;
    try {
      stats = await getKQScoreStats(filters.s4subject, filters.s5subject, filters.edLangId, KQ_TARGET_SCORE);
    } catch (err) {
      fetchErr = err;
      console.error('189 ball statistikasi hisoblashda xatolik:', err.message);
    }

    if (fetchErr || !stats) {
      const errText = "❌ mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi. Birozdan so'ng qayta urinib ko'ring.";
      if (thinkingMsgId) {
        try {
          await bot.editMessageText(errText, {
            chat_id: chatId,
            message_id: thinkingMsgId,
            reply_markup: { inline_keyboard: [backRow] },
          });
        } catch (err) {}
      } else {
        await safeSend(chatId, errText, [backRow]);
      }
      return;
    }

    const resultText = formatKQ189Result(filters, stats, KQ_TARGET_SCORE);
    if (thinkingMsgId) {
      try {
        await bot.editMessageText(resultText, {
          chat_id: chatId,
          message_id: thinkingMsgId,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [backRow] },
        });
      } catch (err) {
        console.error('189 ball statistikasi natijasini tahrirlashda xatolik:', err.message);
      }
    } else {
      await safeSend(chatId, resultText, [backRow]);
    }
    return;
  }

  // "Kengaytirilgan qidiruv" — "ID orqali o'rnimni topish" tanlandi -> ID so'raymiz
  if (query.data === 'kq_mode_id') {
    if (!pendingKQFilters.has(userId)) {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: "❗️ Avval fanlar majmuasi va ta'lim tilini tanlang.",
          show_alert: true,
        });
      } catch (err) {}
      return;
    }
    awaitingKQId.add(userId);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    try {
      await bot.sendMessage(
        chatId,
        `🆔 Abituriyent ID raqamingizni (7 xonali) yozing, masalan: <b>5506347</b>.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } }
      );
    } catch (err) {
      console.error("Kengaytirilgan qidiruv ID so'rash xabari xatosi:", err.message);
    }
    return;
  }

  // "Kengaytirilgan qidiruv" — sahifalash (Keyingisi/Oldingisi), har safar
  // saytdan (Bakalavr/Paginate) jonli olib kelinadi
  if (query.data === 'kq_page_next' || query.data === 'kq_page_prev') {
    const state = kqResultsState.get(userId);
    if (!state) {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
      return;
    }

    const newPage = state.page + (query.data === 'kq_page_next' ? 1 : -1);
    if (newPage < 1) {
      try {
        await bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
      return;
    }

    let cards = [];
    let fetchErr = null;
    try {
      cards = await fetchKengaytirilganPage(state.s4subject, state.s5subject, state.edLangId, newPage);
    } catch (err) {
      fetchErr = err;
      console.error('Kengaytirilgan qidiruv sahifalash xatosi:', err.message);
    }

    if (fetchErr) {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: "❌ Xatolik yuz berdi, qayta urinib ko'ring.",
          show_alert: true,
        });
      } catch (err) {}
      return;
    }

    if (!cards.length && query.data === 'kq_page_next') {
      // Keyingi sahifada natija yo'q ekan — demak shu yergacha ekan
      state.hasNext = false;
      try {
        await bot.answerCallbackQuery(query.id, { text: "Boshqa natija yo'q." });
      } catch (err) {}
      const rendered = renderKQPage(userId);
      if (rendered) await safeEdit(chatId, messageId, rendered.text, rendered.keyboard);
      return;
    }

    state.page = newPage;
    state.cards = cards;
    state.hasNext = cards.length === KQ_PAGE_SIZE;

    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }

    const rendered = renderKQPage(userId);
    if (rendered) await safeEdit(chatId, messageId, rendered.text, rendered.keyboard);
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

  // "Natijamni tekshirish (ID)" bo'limi — foydalanuvchining ID'ini kutish holatini
  // yoqib qo'yishi kerak bo'lgani uchun umumiy SCREENS ro'yxatidan alohida ishlanadi
  if (query.data === 'menu_mandat_id') {
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    await askForMandatId(chatId, userId);
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

  // "Botni baholang" bo'limi (foydalanuvchiga bog'liq bo'lgani uchun
  // umumiy SCREENS ro'yxatidan alohida ishlanadi)
  if (query.data === 'menu_baho') {
    pendingBahoSelection.delete(userId);
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    await deleteMessageSafe(chatId, messageId);
    const { text, keyboard } = ratingScreen(userId);
    const outKeyboard = isGroup ? stripPremium(keyboard) : keyboard;
    const outText = isGroup ? stripTgEmoji(text) : text;
    await sendRatingScreen(chatId, outText, outKeyboard);
    return;
  }

  // "Botni baholang" — yulduzlar sonini tanlash (hali yubormaydi, faqat belgilaydi)
  if (query.data && query.data.startsWith('baho_select_')) {
    const n = parseInt(query.data.replace('baho_select_', ''), 10);
    if (n >= 1 && n <= 5) {
      pendingBahoSelection.set(userId, n);
    }
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }
    const { text, keyboard } = ratingScreen(userId);
    await editRatingScreen(chatId, messageId, text, keyboard);
    return;
  }

  // "Botni baholang" — tanlangan bahoni yuborish (kuniga 2 martagacha)
  if (query.data === 'baho_submit') {
    const selected = pendingBahoSelection.get(userId);

    if (!selected) {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: '⚠️ Avval yulduzlar sonini tanlang.',
          show_alert: true,
        });
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
      return;
    }

    const res = recordBaho(userId, selected);
    pendingBahoSelection.delete(userId);

    if (!res.ok) {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: `⚠️ Siz bugun allaqachon ${BAHO_KUNLIK_LIMIT} marta baholadingiz. Ertaga qayta urinib ko'ring!`,
          show_alert: true,
        });
      } catch (err) {
        console.error('answerCallbackQuery xatosi:', err.message);
      }
      const { text, keyboard } = ratingScreen(userId);
      await editRatingScreen(chatId, messageId, text, keyboard);
      return;
    }

    try {
      await bot.answerCallbackQuery(query.id, { text: '✅ Bahoyingiz yuborildi!' });
    } catch (err) {
      console.error('answerCallbackQuery xatosi:', err.message);
    }

    const thankYouText =
      `${'⭐'.repeat(selected)}\n\n` +
      `Bahoyingiz uchun rahmat! Siz bizning yaxshilanishimizga yordam bermoqdasiz! 🙏`;
    await editRatingScreen(chatId, messageId, thankYouText, [backRow]);
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
  pendingYonalishQabulTuri.delete(userId);
  yonalishResultsState.delete(userId);
  pendingBahoSelection.delete(userId);
  awaitingMandatId.delete(userId);
  awaitingKQCustomSubject.delete(userId);
  pendingKQSubject.delete(userId);
  pendingKQFilters.delete(userId);
  awaitingKQId.delete(userId);
  kqResultsState.delete(userId);
  awaiting189CustomSubject.delete(userId);
  pending189Subject.delete(userId);

  const { text, keyboard } = screenFn();
  await deleteMessageSafe(chatId, messageId);

  if (query.data === 'menu_back') {
    await sendMainMenu(chatId, isGroup);
  } else if (query.data === 'menu_yonalish') {
    const outKeyboard = isGroup ? stripPremium(keyboard) : keyboard;
    const outText = isGroup ? stripTgEmoji(text) : text;
    await sendMandatScreen(chatId, outText, outKeyboard);
  } else {
    const outKeyboard = isGroup ? stripPremium(keyboard) : keyboard;
    const outText = isGroup ? stripTgEmoji(text) : text;
    await safeSend(chatId, outText, outKeyboard);
  }
});

// ---------------------------------------------------------------------------
// "Natijamni tekshirish (ID)" — foydalanuvchi o'z ID raqamini yozganda
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  if (msg.web_app_data) return;
  if (msg._relayedToUser) return;
  if (!msg.text) return;

  const userId = msg.from.id;
  if (!awaitingMandatId.has(userId)) return;

  msg._orderFlow = true; // AI handleri bu xabarga javob bermasligi uchun belgi

  const entrantId = msg.text.trim();
  if (!/^\d{7}$/.test(entrantId)) {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "❗️ Iltimos, 7 xonali abituriyent ID raqamini to'g'ri kiriting (masalan: 5506347)."
      );
    } catch (err) {
      console.error('Mandat ID validatsiya xabari xatosi:', err.message);
    }
    return; // holat saqlanadi — qayta urinish mumkin
  }

  awaitingMandatId.delete(userId);

  try {
    await bot.sendChatAction(msg.chat.id, 'typing');
  } catch (err) {
    console.error('sendChatAction xatosi:', err.message);
  }

  let thinkingMsgId = null;
  try {
    const thinkingMsg = await bot.sendMessage(msg.chat.id, '🔎 mandat.uzbmb.uz saytidan qidirilmoqda...');
    thinkingMsgId = thinkingMsg.message_id;
  } catch (err) {
    console.error("Mandat ID 'qidirilmoqda' xabari xatosi:", err.message);
  }

  let result = null;
  try {
    result = await fetchMandatById(entrantId);
  } catch (err) {
    console.error('Mandat ID qidiruv xatosi:', err.message);
  }

  let rankInfo = null;
  if (result && result.name) {
    if (thinkingMsgId) {
      try {
        await bot.editMessageText('📊 Reytingdagi o\'rningiz hisoblanmoqda...', {
          chat_id: msg.chat.id,
          message_id: thinkingMsgId,
        });
      } catch (err) {}
    }
    rankInfo = await computeMandatIdRanking(result, entrantId);
  }

  const resultText = formatMandatIdResult(result, entrantId, rankInfo);
  const sendOptions = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [backRow] } };

  if (thinkingMsgId) {
    try {
      await bot.editMessageText(resultText, {
        chat_id: msg.chat.id,
        message_id: thinkingMsgId,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [backRow] },
      });
    } catch (err) {
      console.error('Mandat ID natijasini tahrirlashda xatolik:', err.message);
    }
  } else {
    try {
      await bot.sendMessage(msg.chat.id, resultText, sendOptions);
    } catch (err) {
      console.error('Mandat ID natijasini yuborishda xatolik:', err.message);
    }
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
