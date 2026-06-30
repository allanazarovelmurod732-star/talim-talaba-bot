require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://talim-talaba-bot.onrender.com
const MINI_APP_URL = process.env.MINI_APP_URL || ''; // mini app (index.html) joylashgan https manzil
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('XATOLIK: BOT_TOKEN environment o\'zgaruvchisi topilmadi (.env faylga qarang).');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { webHook: { port: false } });

// Bitta kutilmagan xatolik butun serverni yiqitib qo'ymasligi uchun himoya
process.on('unhandledRejection', (err) => {
  console.error('Kutilmagan promise xatosi:', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('Kutilmagan xatolik:', err && err.message ? err.message : err);
});

// ---------------------------------------------------------------------------
// Custom premium emoji identifikatorlari (Bot API 9.4: style + icon_custom_emoji_id)
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
};

// ---------------------------------------------------------------------------
// Majburiy obuna bo'lish kerak bo'lgan kanallar
// ---------------------------------------------------------------------------
const REQUIRED_CHANNELS = [
  { name: "Talim Talaba", username: '@talimtalaba', icon: '5451880684945708278' },
  { name: 'IT kurslar', username: '@it_kurslarr', icon: '5807952667992920776' },
];

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

// Matn ichiga premium custom emoji joylash uchun (HTML parse_mode, tg-emoji tegi)
function emoji(id, placeholder) {
  return `<tg-emoji emoji-id="${id}">${placeholder}</tg-emoji>`;
}

// Agar tg-emoji ID noto'g'ri/ishlamasa, shu funksiya uni oddiy emojiga aylantiradi
function stripTgEmoji(html) {
  return html.replace(/<tg-emoji emoji-id="\d+">(.*?)<\/tg-emoji>/g, '$1');
}

// Tugma qurish yordamchisi (style va icon_custom_emoji_id bilan)
function btn({ text, callback_data, url, web_app, style, icon }) {
  const button = { text };
  if (callback_data) button.callback_data = callback_data;
  if (url) button.url = url;
  if (web_app) button.web_app = web_app;
  if (style) button.style = style; // 'danger' | 'success' | 'primary'
  if (icon) button.icon_custom_emoji_id = icon;
  return button;
}

const backRow = [btn({ text: '⬅️ Orqaga', callback_data: 'menu_back' })];

// Agar premium custom emoji/style ushbu bot hisobida ishlamasa, shu funksiya
// tugmalardan style va icon_custom_emoji_id maydonlarini olib tashlaydi —
// shunda bot hech bo'lmaganda oddiy ko'rinishda ishlayveradi.
function stripPremium(keyboard) {
  return keyboard.map((row) =>
    row.map((button) => {
      const { style, icon_custom_emoji_id, ...rest } = button;
      return rest;
    })
  );
}

// ---------------------------------------------------------------------------
// Obuna tekshiruvi
// ---------------------------------------------------------------------------
async function isSubscribedToAll(userId) {
  for (const ch of REQUIRED_CHANNELS) {
    try {
      const member = await bot.getChatMember(ch.username, userId);
      if (['left', 'kicked'].includes(member.status)) return false;
    } catch (err) {
      console.error(`getChatMember xatosi (${ch.username}):`, err.message);
      // Bot kanalda admin bo'lmasa yoki boshqa xato bo'lsa, xavfsizlik uchun "obuna yo'q" deb hisoblaymiz
      return false;
    }
  }
  return true;
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
// Ekranlar (matn + tugmalar) — HTML formatlash (qalin/qiya) bilan
// ---------------------------------------------------------------------------
function mainMenuScreen() {
  const text =
    `🎓 <b>Ta'lim Talaba</b> botiga xush kelibsiz!\n\n` +
    `Bu yerda siz <b>ta'lim sohasidagi</b> eng so'nggi yangiliklar, foydali test platformalari va bot haqida ma'lumotlarni topasiz.\n\n` +
    `<i>Quyidagi bo'limlardan birini tanlang</i> 👇`;

  const keyboard = [
    [btn({ text: "Ta'lim kanalimiz", callback_data: 'menu_channel', icon: EMOJI.channelMenuIcon, style: 'primary' })],
    [btn({ text: 'Test Platformamiz', callback_data: 'menu_test', icon: EMOJI.testMenuIcon, style: 'success' })],
    [btn({ text: 'Elmurod Allanazarov', callback_data: 'menu_founder', icon: EMOJI.founderMenuIcon, style: 'danger' })],
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

const SCREENS = {
  menu_back: mainMenuScreen,
  menu_channel: channelScreen,
  menu_test: testScreen,
  menu_founder: founderScreen,
};

// ---------------------------------------------------------------------------
// Xavfsiz yuborish/tahrirlash — premium ishlamasa, oddiyga zaxira (fallback)
// ---------------------------------------------------------------------------
async function safeSend(chatId, html, keyboard) {
  try {
    await bot.sendMessage(chatId, html, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    console.error('sendMessage xatosi (premium), oddiyga o\'tilmoqda:', err.message);
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
    console.error('editMessageText xatosi (premium), oddiyga o\'tilmoqda:', err.message);
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

// ---------------------------------------------------------------------------
// Handlerlar
// ---------------------------------------------------------------------------
bot.onText(/^\/start/, async (msg) => {
  const userId = msg.from.id;
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

  const { text, keyboard } = mainMenuScreen();
  await safeSend(msg.chat.id, text, keyboard);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;

  // Telefon raqamini ko'rsatish
  if (query.data === 'show_phone') {
    try {
      await bot.answerCallbackQuery(query.id, {
        text: '📞 +998505060717\n\nQo\'ng\'iroq qilish uchun xabardagi raqamga bosing.',
        show_alert: true,
      });
    } catch (err) {
      console.error('show_phone answerCallbackQuery xatosi:', err.message);
    }
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
      const { text, keyboard } = mainMenuScreen();
      await safeEdit(chatId, messageId, text, keyboard);
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

  // Menyu bo'limlariga kirishdan oldin ham obunani tekshiramiz
  let subscribed = true;
  try {
    subscribed = await isSubscribedToAll(userId);
  } catch (err) {
    console.error('menyu obuna tekshiruvi xatosi:', err.message);
  }

  if (!subscribed) {
    const { text, keyboard } = gateScreen();
    await safeEdit(chatId, messageId, text, keyboard);
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

  const { text, keyboard } = screenFn();
  await safeEdit(chatId, messageId, text, keyboard);

  try {
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('answerCallbackQuery xatosi:', err.message);
  }
});

// ---------------------------------------------------------------------------
// Bot buyruqlari va menyu tugmasi (mini ilova)
// ---------------------------------------------------------------------------
async function configureBot() {
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
// Express server + webhook (Render uchun)
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
      console.log('Webhook o\'rnatildi:', fullWebhookUrl);
    } catch (err) {
      console.error('Webhook o\'rnatishda xatolik:', err.message);
    }
  } else {
    console.warn('WEBHOOK_URL berilmagan — webhook o\'rnatilmadi. .env faylni tekshiring.');
  }

  await configureBot();
});
