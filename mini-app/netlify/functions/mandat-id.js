const { fetchMandatById, computeMandatIdRanking } = require('./_lib/mandat');

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
  const id = ((event.queryStringParameters && event.queryStringParameters.id) || '').trim();

  if (!/^\d{7}$/.test(id)) {
    return json(400, { error: "ID 7 xonali raqam bo'lishi kerak." });
  }

  try {
    const result = await fetchMandatById(id);
    if (!result || !result.name) {
      return json(200, { found: false });
    }

    let rank = null;
    if (result.subjects) {
      rank = await computeMandatIdRanking(result, id);
    }

    return json(200, { found: true, result, rank });
  } catch (err) {
    return json(502, { error: "mandat.uzbmb.uz saytidan ma'lumot olishda xatolik yuz berdi." });
  }
};
