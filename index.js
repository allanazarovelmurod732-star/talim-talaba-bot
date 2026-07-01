require('dotenv').config();
const path = require('path');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');

// Asosiy menyu tepasidagi banner rasm (assets papkasida bo'lishi shart)
const MAIN_BANNER_PATH = path.join(__dirname, 'assets', 'banner.jpg');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const MINI_APP_URL = process.env.MINI_APP_URL || '';
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

if (!BOT_TOKEN) {
  console.error("XATOLIK: BOT_TOKEN environment o'zgaruvchisi topilmadi (.env faylga qarang).");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { webHook: { port: false } });

// bot.getMe() natijasini keshlab qo'yamiz — har xabarda qayta so'ramaslik uchun
let BOT_USERNAME = '';
let CACHED_BANNER_FILE_ID = null; // banner rasmni bir marta yuklab, keyin file_id orqali qayta ishlatamiz

// ---------------------------------------------------------------------------
// Groq AI client
// ---------------------------------------------------------------------------
const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

async function askGroq(userMessage) {
  if (!groq) return "AI hozircha ulanmagan.";
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
            "Sen Ta'lim Talaba botining aqlli yordamchisisiz. O'zbek tilida qisqa, aniq va foydali javoblar ber. " +
            "Ta'lim, universitetlar, testlar va o'qish haqidagi savollarga ustuvorlik ber. " +
            "Agar sendan \"seni kim yaratgan\", \"yaratuvching kim\", \"egang kim\" kabi savol so'ralsa, " +
            "faqat shu ma'lumotni ayt: Seni Elmurod Allanazarov yaratgan, u 2007-yilda Qashqadaryo viloyati " +
            "Kasbi tumanida tug'ilgan, hozirda TATU talabasi va Elite Test platformasi asoschisi " +
            "(platforma Google Play va Microsoft Store'da mavjud). Bog'lanish: Telegram @elmurodallanazarov, tel: +998505060717.",
        },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content || "Javob ololmadim.";
  } catch (err) {
    console.error('Groq xatosi:', err.message);
    return "AI javob bera olmadi. Keyinroq urinib ko'ring.";
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
};

// ---------------------------------------------------------------------------
// Majburiy obuna kanallar
// ---------------------------------------------------------------------------
const REQUIRED_CHANNELS = [
  { name: "Talim Talaba", username: '@talimtalaba', icon: '5451880684945708278' },
  { name: 'IT kurslar', username: '@it_kurslarr', icon: '5807952667992920776' },
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

function btn({ text, callback_data, url, web_app, style, icon }) {
  const button = { text };
  if (callback_data) button.callback_data = callback_data;
  if (url) button.url = url;
  if (web_app) button.web_app = web_app;
  if (style) button.style = style;
  if (icon) button.icon_custom_emoji_id = icon;
  return button;
}

const backRow = [btn({ text: '⬅️ Orqaga', callback_data: 'menu_back' })];

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
bot.onText(/^\/start/, async (msg) => {
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

  await sendMainMenu(msg.chat.id);
});

// ---------------------------------------------------------------------------
// AI: Oddiy matnli xabarlarni Groq orqali javoblash
// (Shaxsiy chatda: barcha matnlar; Guruhda: faqat bot username bilan yoki reply)
// ---------------------------------------------------------------------------
bot.on('message', async (msg) => {
  // Buyruqlarni o'tkazib yuboramiz
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatType = msg.chat.type;
  const botUsername = BOT_USERNAME || (await bot.getMe()).username;

  // Guruhda faqat @mention yoki reply bo'lsa javob beramiz
  if (chatType === 'group' || chatType === 'supergroup') {
    const isMentioned = msg.text.includes(`@${botUsername}`);
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

  const userText = msg.text.replace(`@${botUsername}`, '').trim();

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
    if (isCreatorQuestion(userText)) {
      // "Kim yaratgan" kabi savollarga AI chaqirilmasdan, 100% aniq javob beriladi
      aiReply = CREATOR_ANSWER_HTML;
      await new Promise((resolve) => setTimeout(resolve, 1000)); // tabiiy ko'rinishi uchun qisqa kutish
    } else {
      // AI javob va 4 soniya kutishni parallel ishlatamiz
      [aiReply] = await Promise.all([
        askGroq(userText),
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
