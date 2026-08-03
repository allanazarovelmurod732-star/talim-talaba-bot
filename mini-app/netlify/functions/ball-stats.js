const { getKQScoreStats, splitSubject } = require('./_lib/mandat');

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
  const score = parseFloat(q.score);

  const parts = splitSubject(subject);
  if (!parts) {
    return json(400, { error: 'Fanlar majmuasi "Fan1 + Fan2" ko\'rinishida bo\'lishi kerak.' });
  }
  if (![1, 2, 3, 4, 5].includes(edLangId)) {
    return json(400, { error: "Ta'lim tili noto'g'ri." });
  }
  if (!Number.isFinite(score)) {
    return json(400, { error: "Ball raqam bo'lishi kerak." });
  }

  try {
    const stats = await getKQScoreStats(parts.s4subject, parts.s5subject, edLangId, score);
    return json(200, { score, ...stats });
  } catch (err) {
    return json(502, { error: "mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi." });
  }
};
