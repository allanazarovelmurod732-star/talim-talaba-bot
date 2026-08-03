// ============================================================================
// Mandat reyestri — Telegram Mini App
// Backend: Netlify Functions (/api/*), manba: mandat.uzbmb.uz
// ============================================================================

// ---------------------------------------------------------------------------
// Telegram WebApp bilan integratsiya (Telegramdan tashqarida ham xato bermaydi)
// ---------------------------------------------------------------------------
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (err) {}
}

// ---------------------------------------------------------------------------
// Fanlar majmuasi ro'yxati (botdagi MANDAT_SUBJECT_OPTIONS bilan bir xil)
// ---------------------------------------------------------------------------
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
const CUSTOM_VALUE = '__custom__';

const LANG_OPTIONS = [
  { value: 1, label: "O'zbekcha" },
  { value: 2, label: 'Русский' },
  { value: 3, label: 'Qoraqalpoq' },
  { value: 4, label: 'Tadjik' },
  { value: 5, label: 'Qozoq' },
];

// ---------------------------------------------------------------------------
// Kichik yordamchilar
// ---------------------------------------------------------------------------
function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function apiGet(path, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/${path}?${qs}`);
  let data;
  try { data = await res.json(); } catch (err) { data = null; }
  if (!res.ok) {
    const message = (data && data.error) || `Xatolik (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function loadingNode(text) {
  const wrap = el('div', 'loading');
  wrap.appendChild(el('span', 'spinner'));
  wrap.appendChild(el('span', '', escapeHtml(text || 'Yuklanmoqda...')));
  return wrap;
}

function errorNode(message) {
  return el('div', 'card card--error', escapeHtml(message));
}

function mutedNode(message) {
  return el('div', 'card card--muted', escapeHtml(message));
}

function setResult(slotEl, node) {
  slotEl.innerHTML = '';
  slotEl.appendChild(node);
}

function hapticSuccess() {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'); } catch (err) {}
}
function hapticError() {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error'); } catch (err) {}
}

// ---------------------------------------------------------------------------
// Fanlar majmuasi + til tanlash bloki (ID/kengaytirilgan/ball bo'limlari
// uchun bir xil komponent, alohida holat bilan)
// ---------------------------------------------------------------------------
function createSubjectFilter(container) {
  container.innerHTML = '';

  const subjectField = el('div', 'field');
  subjectField.appendChild(el('label', 'field__label', "Fanlar majmuasi"));
  const subjectSelect = el('select', 'input select');
  MANDAT_SUBJECT_OPTIONS.forEach((s) => {
    const opt = el('option');
    opt.value = s; opt.textContent = s;
    subjectSelect.appendChild(opt);
  });
  const customOpt = el('option');
  customOpt.value = CUSTOM_VALUE; customOpt.textContent = "✍️ O'zim yozaman...";
  subjectSelect.appendChild(customOpt);
  subjectField.appendChild(subjectSelect);
  container.appendChild(subjectField);

  const customRow = el('div', 'field-row');
  customRow.hidden = true;
  const fan1 = el('input', 'input');
  fan1.placeholder = '1-fan (masalan: Matematika)';
  const fan2 = el('input', 'input');
  fan2.placeholder = '2-fan (masalan: Fizika)';
  customRow.appendChild(fan1);
  customRow.appendChild(fan2);
  container.appendChild(customRow);

  subjectSelect.addEventListener('change', () => {
    customRow.hidden = subjectSelect.value !== CUSTOM_VALUE;
  });

  const langField = el('div', 'field');
  langField.appendChild(el('label', 'field__label', "Ta'lim tili"));
  const langSelect = el('select', 'input select');
  LANG_OPTIONS.forEach((l) => {
    const opt = el('option');
    opt.value = l.value; opt.textContent = l.label;
    langSelect.appendChild(opt);
  });
  langField.appendChild(langSelect);
  container.appendChild(langField);

  return {
    getSubject() {
      if (subjectSelect.value === CUSTOM_VALUE) {
        const a = fan1.value.trim();
        const b = fan2.value.trim();
        if (!a || !b) return null;
        return `${a} + ${b}`;
      }
      return subjectSelect.value;
    },
    getLang() {
      return parseInt(langSelect.value, 10);
    },
    getLangLabel() {
      const found = LANG_OPTIONS.find((l) => l.value === parseInt(langSelect.value, 10));
      return found ? found.label : '';
    },
  };
}

// ---------------------------------------------------------------------------
// TAB 1 — "ID bo'yicha" natijani tekshirish
// ---------------------------------------------------------------------------
const formId = document.getElementById('form-id');
const inputId = document.getElementById('input-id');
const resultIdSlot = document.getElementById('result-id');

formId.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = inputId.value.trim();
  if (!/^\d{7}$/.test(id)) {
    setResult(resultIdSlot, errorNode("Iltimos, 7 xonali ID raqamini to'g'ri kiriting."));
    return;
  }
  setResult(resultIdSlot, loadingNode('mandat.uzbmb.uz saytidan qidirilmoqda...'));
  try {
    const data = await apiGet('mandat-id', { id });
    renderIdResult(data, id);
  } catch (err) {
    hapticError();
    setResult(resultIdSlot, errorNode(err.message));
  }
});

function renderIdResult(data, id) {
  if (!data.found) {
    hapticError();
    setResult(resultIdSlot, mutedNode(`❌ ${id} ID raqami bo'yicha natija topilmadi.`));
    return;
  }
  hapticSuccess();
  const { result, rank } = data;

  const card = el('div', 'card');

  const head = el('div', 'result-head');
  const seal = el('div', 'result-seal');
  seal.appendChild(el('span', 'result-seal__rank', rank ? `#${rank.rank}` : '✓'));
  head.appendChild(seal);

  const nameWrap = el('div');
  nameWrap.appendChild(el('p', 'result-name', escapeHtml(result.name)));
  nameWrap.appendChild(el('p', 'result-id', `ID: ${escapeHtml(id)}`));
  head.appendChild(nameWrap);
  card.appendChild(head);

  const kv = el('div', 'kv-list');
  if (result.scoreText) kv.appendChild(kvRow('Ball', result.scoreText, true));
  if (result.thresholdText) kv.appendChild(kvRow('Holat', result.thresholdText));
  if (result.subjects) {
    const combo = [result.subjects.fan1, result.subjects.fan2].filter(Boolean).join(' + ') || result.subjects.majburiy;
    if (combo) kv.appendChild(kvRow('Fanlar majmuasi', combo));
    if (result.subjects.til) kv.appendChild(kvRow("Ta'lim tili", result.subjects.til));
  }
  card.appendChild(kv);

  if (rank) {
    const totalStr = `${rank.approxTotal ? '~' : ''}${rank.total}`;
    const pill = el('span', 'rank-pill', `🏆 ${rank.rank}-o'rin / jami ${totalStr} ta`);
    card.appendChild(pill);
  }

  setResult(resultIdSlot, card);
}

function kvRow(k, v, mono) {
  const row = el('div', 'kv-row');
  row.appendChild(el('span', 'kv-row__k', escapeHtml(k)));
  row.appendChild(el('span', `kv-row__v${mono ? ' kv-row__v--mono' : ''}`, escapeHtml(v)));
  return row;
}

// ---------------------------------------------------------------------------
// TAB 2 — "Kengaytirilgan qidiruv"
// ---------------------------------------------------------------------------
const kqFilters = createSubjectFilter(document.getElementById('kq-filters'));
const kqBtnList = document.getElementById('kq-btn-list');
const kqBtnId = document.getElementById('kq-btn-id');
const kqIdRow = document.getElementById('kq-id-row');
const kqInputId = document.getElementById('kq-input-id');
const resultKqSlot = document.getElementById('result-kq');

let kqListState = null; // { subject, lang, langLabel, page }

kqBtnId.addEventListener('click', () => {
  kqIdRow.hidden = !kqIdRow.hidden;
  if (!kqIdRow.hidden) kqInputId.focus();
});

kqBtnList.addEventListener('click', () => {
  const subject = kqFilters.getSubject();
  if (!subject) {
    setResult(resultKqSlot, errorNode("Iltimos, fanlar majmuasini to'liq kiriting."));
    return;
  }
  kqListState = { subject, lang: kqFilters.getLang(), langLabel: kqFilters.getLangLabel(), page: 1 };
  loadKqPage();
});

document.getElementById('kq-id-row').addEventListener('submit', async (e) => {
  e.preventDefault();
  const subject = kqFilters.getSubject();
  const id = kqInputId.value.trim();
  if (!subject) {
    setResult(resultKqSlot, errorNode("Iltimos, fanlar majmuasini to'liq kiriting."));
    return;
  }
  if (!/^\d{7}$/.test(id)) {
    setResult(resultKqSlot, errorNode("Iltimos, 7 xonali ID raqamini to'g'ri kiriting."));
    return;
  }
  kqListState = null;
  setResult(resultKqSlot, loadingNode(`"${subject}" ro'yxatidan #${id} qidirilmoqda... (bu biroz vaqt olishi mumkin)`));
  try {
    const data = await apiGet('kq-rank', { subject, lang: kqFilters.getLang(), id });
    renderKqRank(data, id, subject);
  } catch (err) {
    hapticError();
    setResult(resultKqSlot, errorNode(err.message));
  }
});

function renderKqRank(data, id, subject) {
  if (!data.found) {
    hapticError();
    const totalStr = data.total != null ? ` (jami ${data.approxTotal ? '~' : ''}${data.total} ta ichida)` : '';
    setResult(resultKqSlot, mutedNode(`❌ #${id} ushbu ro'yxatdan topilmadi${totalStr}.`));
    return;
  }
  hapticSuccess();
  const card = el('div', 'card');
  const head = el('div', 'result-head');
  const seal = el('div', 'result-seal');
  seal.appendChild(el('span', 'result-seal__rank', `#${data.rank}`));
  head.appendChild(seal);
  const nameWrap = el('div');
  nameWrap.appendChild(el('p', 'result-name', escapeHtml(data.card.name)));
  nameWrap.appendChild(el('p', 'result-id', `ID: ${escapeHtml(id)}`));
  head.appendChild(nameWrap);
  card.appendChild(head);

  const kv = el('div', 'kv-list');
  kv.appendChild(kvRow('Fanlar majmuasi', subject));
  if (data.card.scoreText) kv.appendChild(kvRow('Ball', data.card.scoreText, true));
  if (data.card.thresholdText) kv.appendChild(kvRow('Holat', data.card.thresholdText));
  card.appendChild(kv);

  const totalStr = `${data.approxTotal ? '~' : ''}${data.total}`;
  card.appendChild(el('span', 'rank-pill', `🏆 ${data.rank}-o'rin / jami ${totalStr} ta`));

  setResult(resultKqSlot, card);
}

async function loadKqPage() {
  setResult(resultKqSlot, loadingNode(`${kqListState.page}-sahifa yuklanmoqda...`));
  try {
    const data = await apiGet('kq-list', {
      subject: kqListState.subject,
      lang: kqListState.lang,
      page: kqListState.page,
    });
    renderKqList(data);
  } catch (err) {
    hapticError();
    setResult(resultKqSlot, errorNode(err.message));
  }
}

function renderKqList(data) {
  const wrap = el('div');

  if (!data.cards.length) {
    wrap.appendChild(mutedNode("😕 Bu fanlar majmuasi va til bo'yicha natija topilmadi."));
    setResult(resultKqSlot, wrap);
    return;
  }

  const card = el('div', 'card');
  card.appendChild(el('p', 'result-id', `👥 ${kqListState.page}-sahifa · ${kqListState.subject} · ${kqListState.langLabel}`));

  const ledger = el('div', 'ledger');
  data.cards.forEach((c, i) => {
    const row = el('div', 'ledger-row');
    row.appendChild(el('span', 'ledger-row__rank', String(data.startRank + i)));
    const nameWrap = el('div');
    nameWrap.appendChild(el('div', 'ledger-row__name', escapeHtml(c.name)));
    nameWrap.appendChild(el('div', 'ledger-row__id', `#${escapeHtml(c.id)}`));
    row.appendChild(nameWrap);
    row.appendChild(el('span', 'ledger-row__score', escapeHtml(c.scoreText || '—')));
    ledger.appendChild(row);
  });
  card.appendChild(ledger);
  wrap.appendChild(card);

  const pager = el('div', 'pager');
  const prevBtn = el('button', 'btn btn--ghost', '⬅️ Oldingisi');
  prevBtn.type = 'button';
  prevBtn.disabled = kqListState.page <= 1;
  prevBtn.addEventListener('click', () => { kqListState.page -= 1; loadKqPage(); });

  const nextBtn = el('button', 'btn btn--ghost', 'Keyingisi ➡️');
  nextBtn.type = 'button';
  nextBtn.disabled = !data.hasNext;
  nextBtn.addEventListener('click', () => { kqListState.page += 1; loadKqPage(); });

  pager.appendChild(prevBtn);
  pager.appendChild(nextBtn);
  wrap.appendChild(pager);

  setResult(resultKqSlot, wrap);
}

// ---------------------------------------------------------------------------
// TAB 3 — Ball tahlili (masalan, 189 ball)
// ---------------------------------------------------------------------------
const ballFilters = createSubjectFilter(document.getElementById('ball-filters'));
const ballScoreInput = document.getElementById('ball-score');
const ballBtn = document.getElementById('ball-btn');
const resultBallSlot = document.getElementById('result-ball');

ballBtn.addEventListener('click', async () => {
  const subject = ballFilters.getSubject();
  const score = parseFloat(String(ballScoreInput.value).replace(',', '.'));

  if (!subject) {
    setResult(resultBallSlot, errorNode("Iltimos, fanlar majmuasini to'liq kiriting."));
    return;
  }
  if (!Number.isFinite(score)) {
    setResult(resultBallSlot, errorNode("Iltimos, ballni raqam bilan kiriting."));
    return;
  }

  setResult(resultBallSlot, loadingNode('mandat.uzbmb.uz saytidan hisoblanmoqda...'));
  try {
    const data = await apiGet('ball-stats', { subject, lang: ballFilters.getLang(), score });
    renderBallStats(data, subject, ballFilters.getLangLabel());
  } catch (err) {
    hapticError();
    setResult(resultBallSlot, errorNode(err.message));
  }
});

function renderBallStats(data, subject, langLabel) {
  hapticSuccess();
  const card = el('div', 'card');
  card.appendChild(el('p', 'result-id', `${subject} · ${langLabel}`));

  const grid = el('div', 'stat-grid');

  const tile1 = el('div', 'stat-tile');
  tile1.appendChild(el('div', 'stat-tile__num', String(data.exactCount)));
  tile1.appendChild(el('div', 'stat-tile__label', `Aynan ${formatScore(data.score)} ball to'plaganlar`));
  grid.appendChild(tile1);

  const tile2 = el('div', 'stat-tile');
  tile2.appendChild(el('div', 'stat-tile__num', String(data.aboveCount)));
  tile2.appendChild(el('div', 'stat-tile__label', `${formatScore(data.score)} balldan yuqori to'plaganlar`));
  grid.appendChild(tile2);

  card.appendChild(grid);

  if (data.approx) {
    card.appendChild(el('p', 'note', "⚠️ Ro'yxat juda katta bo'lgani uchun natija taxminiy (yaqin son)."));
  }

  setResult(resultBallSlot, card);
}

function formatScore(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

// ---------------------------------------------------------------------------
// Pastki tab-bar — bo'limlar orasida almashish
// ---------------------------------------------------------------------------
const tabButtons = document.querySelectorAll('.tabbar__btn');
const panels = document.querySelectorAll('.panel');

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    panels.forEach((p) => { p.hidden = p.dataset.panel !== target; });
    try { tg && tg.HapticFeedback && tg.HapticFeedback.selectionChanged(); } catch (err) {}
    document.getElementById('content').scrollTo({ top: 0, behavior: 'smooth' });
  });
});
