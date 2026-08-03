// ---------------------------------------------------------------------------
// mandat.uzbmb.uz bilan ishlash uchun umumiy mantiq.
// Bu fayl Ta'lim Talaba Telegram botidagi (index.js) aynan shu vazifani
// bajaruvchi qismning soddalashtirilgan, serverless (Netlify Functions)
// muhitiga moslashtirilgan nusxasidir.
// ---------------------------------------------------------------------------

const MANDAT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const KQ_PAGE_SIZE = 10; // Server tomonidan qattiq belgilangan (o'zgartirib bo'lmaydi)

// Netlify Functions (sinxron/oddiy) odatda ~10 soniya vaqt chegarasiga ega,
// shuning uchun binary search chegarasini botdagiga (20000) nisbatan
// ehtiyotkorlik bilan pastroq qildik. Bu ~30 000 kishigacha bo'lgan
// ro'yxatlarni to'liq qamrab oladi (matematika-fizika kabi eng ommaviy
// majmualar ham odatda shu chegaradan past).
const MAX_SEARCH_PAGES = 3000;

function decodeUzApostrophe(s) {
  return String(s).replace(/&#x2018;|&#8216;|&rsquo;/g, "'").trim();
}

// Ball matnini ("142,700" yoki "142.700" kabi) taqqoslash uchun songa aylantiradi
function parseKQScoreNumber(scoreText) {
  if (!scoreText) return null;
  const normalized = String(scoreText).replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

// "Ta'lim tili" matnini (masalan "O'zbek tili", "Rus tili" ...) Kengaytirilgan
// qidiruvda ishlatiladigan edLangId'ga mos keltiradi
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

const EDLANG_LABELS = {
  1: "O'zbekcha",
  2: 'Русский',
  3: 'Qoraqalpoq',
  4: 'Tadjik',
  5: 'Qozoq',
};

// ---------------------------------------------------------------------------
// "Natijamni tekshirish (ID)"
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// "Kengaytirilgan qidiruv" — ro'yxat, ID orqali reyting, ball statistikasi
// ---------------------------------------------------------------------------

function parseKQCards(html) {
  const cards = [];
  const chunks = String(html).split('m3-rescard m3-rescard--');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const nameMatch = chunk.match(/m3-rescard__name">(?:<i[^>]*><\/i>\s*)?([^<]+)</);
    const idMatch = chunk.match(/m3-rescard__id">#\s*([0-9]+)/);
    const scoreMatch = chunk.match(/m3-score-val[^"]*">([^<]+)</);
    const thresholdMatch = chunk.match(/m3-pbar__thmark"\s+title="([^"]*)"/);

    if (!nameMatch || !idMatch) continue;

    cards.push({
      name: decodeUzApostrophe(nameMatch[1]),
      id: idMatch[1],
      scoreText: scoreMatch ? decodeUzApostrophe(scoreMatch[1]) : null,
      thresholdText: thresholdMatch ? decodeUzApostrophe(thresholdMatch[1]) : null,
    });
  }
  return cards;
}

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

// Ball asosida binary search bilan abituriyentni topadi (ro'yxat ball
// bo'yicha kamayish tartibida saqlanadi)
async function findKQEntrantByScore(s4subject, s5subject, edLangId, entrantId, targetScore) {
  const firstInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, 1);
  if (firstInfo.empty) return null;
  let idx = firstInfo.cards.findIndex((c) => c.id === entrantId);
  if (idx !== -1) return { page: 1, index: idx, card: firstInfo.cards[idx] };

  if (targetScore == null) return null;

  let lo = 1;
  let hi = 1;
  let hiInfo = firstInfo;

  while (hiInfo.full && hiInfo.bottomScore !== null && hiInfo.bottomScore > targetScore) {
    lo = hi;
    hi = hi * 2;
    if (hi > MAX_SEARCH_PAGES) {
      hi = MAX_SEARCH_PAGES;
      hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
      idx = hiInfo.cards.findIndex((c) => c.id === entrantId);
      if (idx !== -1) return { page: hi, index: idx, card: hiInfo.cards[idx] };
      return null;
    }
    hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
    idx = hiInfo.cards.findIndex((c) => c.id === entrantId);
    if (idx !== -1) return { page: hi, index: idx, card: hiInfo.cards[idx] };
  }

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const midInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, mid);
    idx = midInfo.cards.findIndex((c) => c.id === entrantId);
    if (idx !== -1) return { page: mid, index: idx, card: midInfo.cards[idx] };

    if (midInfo.empty || !midInfo.full || (midInfo.bottomScore !== null && midInfo.bottomScore <= targetScore)) {
      hi = mid;
      hiInfo = midInfo;
    } else {
      lo = mid;
    }
  }

  // Aniq bir necha sahifa atrofida qattiq mos kelmasa (formatlanish farqi
  // bo'lishi mumkin) — chegara atrofidagi bir necha sahifani tekshiramiz
  const NEARBY = 20;
  const nearbyPages = [];
  for (let p = Math.max(1, lo - NEARBY); p <= Math.min(MAX_SEARCH_PAGES, hi + NEARBY); p++) nearbyPages.push(p);
  for (const p of nearbyPages) {
    const info = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, p);
    const i2 = info.cards.findIndex((c) => c.id === entrantId);
    if (i2 !== -1) return { page: p, index: i2, card: info.cards[i2] };
  }

  return null;
}

// Ro'yxatdagi umumiy abituriyentlar sonini aniqlaydi
async function getKQTotalCount(s4subject, s5subject, edLangId) {
  const firstInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, 1);
  if (firstInfo.empty) return { count: 0, approx: false };
  if (!firstInfo.full) return { count: firstInfo.cards.length, approx: false };

  let lo = 1;
  let hi = 2;
  let hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
  let capped = false;
  while (hiInfo.full) {
    lo = hi;
    hi *= 2;
    if (hi > MAX_SEARCH_PAGES) {
      hi = MAX_SEARCH_PAGES;
      hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
      capped = hiInfo.full;
      break;
    }
    hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
  }

  if (!capped) {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const midInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, mid);
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
async function countEntriesWithScoreAtLeast(s4subject, s5subject, edLangId, threshold) {
  const countInPage = (cards) =>
    cards.filter((c) => {
      const s = parseKQScoreNumber(c.scoreText);
      return s !== null && s >= threshold;
    }).length;

  const firstInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, 1);
  if (firstInfo.empty) return { count: 0, approx: false };

  if (!firstInfo.full || firstInfo.bottomScore === null || firstInfo.bottomScore < threshold) {
    return { count: countInPage(firstInfo.cards), approx: false };
  }

  let lo = 1;
  let hi = 2;
  let hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
  let capped = false;
  while (hiInfo.full && hiInfo.bottomScore !== null && hiInfo.bottomScore >= threshold) {
    lo = hi;
    hi *= 2;
    if (hi > MAX_SEARCH_PAGES) {
      hi = MAX_SEARCH_PAGES;
      hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
      capped = hiInfo.full && hiInfo.bottomScore !== null && hiInfo.bottomScore >= threshold;
      break;
    }
    hiInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, hi);
  }

  if (capped) {
    return { count: hi * KQ_PAGE_SIZE, approx: true };
  }

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const midInfo = await fetchKengaytirilganPageInfo(s4subject, s5subject, edLangId, mid);
    if (midInfo.full && midInfo.bottomScore !== null && midInfo.bottomScore >= threshold) {
      lo = mid;
    } else {
      hi = mid;
      hiInfo = midInfo;
    }
  }

  return { count: lo * KQ_PAGE_SIZE + countInPage(hiInfo.cards), approx: false };
}

async function getKQScoreStats(s4subject, s5subject, edLangId, targetScore) {
  const [atLeastResult, aboveResult] = await Promise.all([
    countEntriesWithScoreAtLeast(s4subject, s5subject, edLangId, targetScore),
    countEntriesWithScoreAtLeast(s4subject, s5subject, edLangId, targetScore + 0.001),
  ]);
  return {
    exactCount: Math.max(0, atLeastResult.count - aboveResult.count),
    aboveCount: aboveResult.count,
    approx: atLeastResult.approx || aboveResult.approx,
  };
}

async function computeMandatIdRanking(result, entrantId) {
  if (!result || !result.subjects) return null;
  const { fan1, fan2, til } = result.subjects;
  if (!fan1 || !fan2 || !til) return null;

  const edLangId = tilToEdLangId(til);
  if (!edLangId) return null;

  const targetScore = parseKQScoreNumber(result.scoreText);

  try {
    const [found, totalInfo] = await Promise.all([
      findKQEntrantByScore(fan1, fan2, edLangId, entrantId, targetScore),
      getKQTotalCount(fan1, fan2, edLangId),
    ]);

    if (!found || !totalInfo) return null;

    const rank = (found.page - 1) * KQ_PAGE_SIZE + found.index + 1;
    return {
      rank,
      total: totalInfo.count,
      approxTotal: totalInfo.approx,
      subjectCombo: `${fan1} + ${fan2}`,
    };
  } catch (err) {
    return null;
  }
}

// Fanlar majmuasi matnini ("Fan1 + Fan2") ikkiga ajratadi
function splitSubject(subjectText) {
  const parts = String(subjectText || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  return { s4subject: parts[0], s5subject: parts[1] };
}

module.exports = {
  KQ_PAGE_SIZE,
  MAX_SEARCH_PAGES,
  EDLANG_LABELS,
  decodeUzApostrophe,
  parseKQScoreNumber,
  tilToEdLangId,
  fetchMandatById,
  fetchKengaytirilganPage,
  findKQEntrantByScore,
  getKQTotalCount,
  getKQScoreStats,
  computeMandatIdRanking,
  splitSubject,
};
