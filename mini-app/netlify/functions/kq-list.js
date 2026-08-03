const { fetchKengaytirilganPage, splitSubject, KQ_PAGE_SIZE } = require('./_lib/mandat');

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
  const page = Math.max(1, parseInt(q.page, 10) || 1);

  const parts = splitSubject(subject);
  if (!parts) {
    return json(400, { error: 'Fanlar majmuasi "Fan1 + Fan2" ko\'rinishida bo\'lishi kerak.' });
  }
  if (![1, 2, 3, 4, 5].includes(edLangId)) {
    return json(400, { error: "Ta'lim tili noto'g'ri." });
  }

  try {
    const cards = await fetchKengaytirilganPage(parts.s4subject, parts.s5subject, edLangId, page);
    return json(200, {
      page,
      cards,
      hasNext: cards.length === KQ_PAGE_SIZE,
      startRank: (page - 1) * KQ_PAGE_SIZE + 1,
    });
  } catch (err) {
    return json(502, { error: "mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi." });
  }
};
