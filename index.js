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
// Matn ichiga custom emoji joylash uchun yordamchi.
// segments: string yoki { id, placeholder } obyektlari massivi.
// Telegram offset/length UTF-16 birliklarida hisoblanadi — bu yerda
// js String.length aynan shu birlikni qaytaradi, shu sababli to'g'ridan-to'g'ri ishlatamiz.
// ---------------------------------------------------------------------------
function buildText(segments) {
  let text = '';
  const entities = [];
  for (const seg of segments) {
    if (typeof seg === 'string') {
      text += seg;
    } else {
      const offset = text.length;
      text += seg.placeholder;
      entities.push({
        type: 'custom_emoji',
        offset,
        length: seg.placeholder.length,
        custom_emoji_id: seg.id,
      });
    }
  }
  return { text, entities };
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

// ---------------------------------------------------------------------------
// Ekranlar (matn + tugmalar)
// ---------------------------------------------------------------------------
function mainMenuScreen() {
  const { text, entities } = buildText([
    '🎓 ',
    "Ta'lim Talaba",
    " botiga xush kelibsiz!\n\n",
    "Bu yerda siz ta'lim sohasidagi eng so'nggi yangiliklar, foydali test platformalari va bot haqida ma'lumotlarni topasiz.\n\n",
    'Quyidagi bo\'limlardan birini tanlang 👇',
  ]);

  const keyboard = [
    [btn({ text: "Ta'lim kanalimiz", callback_data: 'menu_channel', icon: EMOJI.channelMenuIcon })],
    [btn({ text: 'Test Platformamiz', callback_data: 'menu_test', icon: EMOJI.testMenuIcon })],
    [btn({ text: 'Elmurod Allanazarov', callback_data: 'menu_founder', icon: EMOJI.founderMenuIcon })],
  ];

  if (MINI_APP_URL) {
    keyboard.push([
      btn({
        text: 'Mini ilovani ochish',
        web_app: { url: MINI_APP_URL },
        style: 'primary',
      }),
    ]);
  }

  return { text, entities, keyboard };
}

function channelScreen() {
  const { text, entities } = buildText([
    { id: EMOJI.channelBodyIcon, placeholder: '📡' },
    " Ta'lim Talaba — siz qidirayotgan yangi kanallardan biri! U hozirda barcha universitetlar haqida eng so'nggi ma'lumotlarni berib kelmoqda.\n\n",
    "Siz ham talaba bo'lmoqchi bo'lsangiz, unda ushbu bottan tezroq foydalaning!",
  ]);

  const keyboard = [
    [btn({ text: 'Talaba', url: 'https://t.me/talimtalaba', style: 'primary', icon: EMOJI.channelButtonIcon })],
    backRow,
  ];

  return { text, entities, keyboard };
}

function testScreen() {
  const { text, entities } = buildText([
    { id: EMOJI.testBodyIcon, placeholder: '📝' },
    ' Barcha turdagi test dasturlari shu yerda! Yangilik — DTM test. Siz ushbu bo\'lim orqali bemalol milliy sertifikatingizni ishlatishingiz mumkin.',
  ]);

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

  return { text, entities, keyboard };
}

function founderScreen() {
  const { text, entities } = buildText([
    '👤 Elmurod Allanazarov\n\n',
    "Mana shu botimiz asoschisi va dasturchisi (developeri). U 2007-yil 17-noyabrda Qashqadaryo viloyati, Kasbi tumanida tug'ilgan.\n\n",
    { id: EMOJI.receptionIcon, placeholder: '📅' },
    ' Qabul vaqti:\n',
    'Dushanba – Shanba\n',
    { id: EMOJI.clockIcon, placeholder: '🕖' },
    ' 07:00 – 12:00\n',
    { id: EMOJI.clockIcon, placeholder: '🕕' },
    ' 18:00 – 20:00',
  ]);

  const keyboard = [
    [
      btn({ text: 'Telegram', url: 'https://t.me/elmurodallanazarov', style: 'success', icon: EMOJI.telegramIcon }),
    ],
    [
      btn({
        text: 'Instagram',
        url: 'https://www.instagram.com/elmurodallanazarov?utm_source=qr&igsh=MWF0dWtpMDRmbTlpMA==',
        style: 'danger',
        icon: EMOJI.instagramIcon,
      }),
    ],
    [
      btn({ text: 'Telefon', url: 'tel:+998505060717', style: 'primary', icon: EMOJI.phoneIcon }),
    ],
    backRow,
  ];

  return { text, entities, keyboard };
}

const SCREENS = {
  menu_back: mainMenuScreen,
  menu_channel: channelScreen,
  menu_test: testScreen,
  menu_founder: founderScreen,
};

// ---------------------------------------------------------------------------
// Handlerlar
// ---------------------------------------------------------------------------
bot.onText(/^\/start/, async (msg) => {
  try {
    const { text, entities, keyboard } = mainMenuScreen();
    await bot.sendMessage(msg.chat.id, text, {
      entities,
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    console.error('/start xatosi:', err.message);
  }
});

bot.on('callback_query', async (query) => {
  const screenFn = SCREENS[query.data];
  if (!screenFn) {
    try { await bot.answerCallbackQuery(query.id); } catch (err) { console.error('answerCallbackQuery xatosi:', err.message); }
    return;
  }

  const { text, entities, keyboard } = screenFn();

  try {
    await bot.editMessageText(text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      entities,
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    // Matn o'zgarmagan bo'lsa Telegram xato qaytaradi — bunda jim o'tkazib yuboramiz
    if (!String(err.message).includes('message is not modified')) {
      console.error('editMessageText xatosi:', err.message);
    }
  }

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
