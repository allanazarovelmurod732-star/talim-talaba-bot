const {
  fetchMandatById,
  findKQEntrantByScore,
  getKQTotalCount,
  parseKQScoreNumber,
  splitSubject,
  KQ_PAGE_SIZE,
} = require('./_lib/mandat');

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const subject = (q.subject || '').trim();
  const edLangId = parseInt(q.lang, 10);
  const id = (q.id || '').trim();

  const parts = splitSubject(subject);
  if (!parts) {
    return json(400, { error: 'Fanlar majmuasi "Fan1 + Fan2" ko\'rinishida bo\'lishi kerak.' });
  }
  if (![1, 2, 3, 4, 5].includes(edLangId)) {
    return json(400, { error: "Ta'lim tili noto'g'ri." });
  }
  if (!/^\d{7}$/.test(id)) {
    return json(400, { error: "ID 7 xonali raqam bo'lishi kerak." });
  }

  try {
    // Avval umumiy natija so'rovi orqali ballni bilib olamiz — shu asosda
    // binary search bilan to'g'ridan-to'g'ri kerakli sahifaga sakraymiz
    let targetScore = null;
    try {
      const general = await fetchMandatById(id);
      if (general && general.scoreText) targetScore = parseKQScoreNumber(general.scoreText);
    } catch (err) {}

    const [found, totalInfo] = await Promise.all([
      findKQEntrantByScore(parts.s4subject, parts.s5subject, edLangId, id, targetScore),
      getKQTotalCount(parts.s4subject, parts.s5subject, edLangId),
    ]);

    if (!found) {
      return json(200, { found: false, total: totalInfo.count, approxTotal: totalInfo.approx });
    }

    const rank = (found.page - 1) * KQ_PAGE_SIZE + found.index + 1;
    return json(200, {
      found: true,
      rank,
      card: found.card,
      total: totalInfo.count,
      approxTotal: totalInfo.approx,
    });
  } catch (err) {
    return json(502, { error: "mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi." });
  }
};
