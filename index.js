const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const P = require('pino');
const qrcode = require('qrcode-terminal');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    auth: state,
    version,
    printQRInTerminal: false
  });

  // QR + connection updates
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n📱 Scan this QR code to connect WhatsApp:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('✅ Connected to WhatsApp successfully!');
    else if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode || 'unknown';
      console.log(`❌ Connection closed (Reason: ${reason}). Reconnecting in 5s...`);
      setTimeout(startBot, 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Anti-delete feature
  sock.ev.on('messages.update', (updates) => {
    updates.forEach(({ key, update }) => {
      if (!update.message && !key.fromMe) {
        const log = `[${new Date().toLocaleString()}] Deleted message in ${key.remoteJid}\n`;
        fs.appendFileSync('deleted_msgs.txt', log);
        console.log(log);
      }
    });
  });

  // Auto-view status + auto-replies
  sock.ev.on('messages.upsert', async (msgUpdate) => {
    const msg = msgUpdate.messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const fromMe = msg.key.fromMe;
    const name = msg.pushName || 'User';

    // Auto-view statuses
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key]);
        const log = `[${new Date().toLocaleString()}] Viewed status from ${name}\n`;
        fs.appendFileSync('viewed_status.txt', log);
        console.log(`👀 Viewed status from ${name}`);
      } catch (err) {
        console.error('Error viewing status:', err.message);
      }
      return;
    }

    // Extract text
    let text = '';
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage?.text)
      text = msg.message.extendedTextMessage.text;
    else if (msg.message.imageMessage?.caption)
      text = msg.message.imageMessage.caption;
    else if (msg.message.videoMessage?.caption)
      text = msg.message.videoMessage.caption;

    // Auto-reply greetings
    const greetings = ['hello', 'hi', 'hey', 'mambo', 'sasa'];
    if (!fromMe && text && greetings.includes(text.toLowerCase().trim())) {
      await sock.sendMessage(from, {
        text: `Hello ${name}! 👋 Hope you're doing great!`
      });
      console.log(`💬 Replied to greeting from ${name}`);
    }
  });

  // Welcome + Goodbye messages for groups
  sock.ev.on('group-participants.update', async (update) => {
    try {
      const groupId = update.id;
      for (const participant of update.participants) {
        const shortName = participant.split('@')[0];
        if (update.action === 'add') {
          await sock.sendMessage(groupId, {
            text: `🎉 Welcome @${shortName} to the group!`,
            mentions: [participant]
          });
          console.log(`👋 Welcomed ${shortName}`);
        } else if (update.action === 'remove') {
          await sock.sendMessage(groupId, {
            text: `👋 Goodbye @${shortName}! We'll miss you!`,
            mentions: [participant]
          });
          console.log(`💔 Said goodbye to ${shortName}`);
        }
      }
    } catch (err) {
      console.error('Group update error:', err.message);
    }
  });

  console.log('🤖 WhatsApp Bot is now running with all features enabled!');
}

startBot();
