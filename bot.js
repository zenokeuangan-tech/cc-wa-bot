const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const express = require('express');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Bot WhatsApp CC Tracker sedang berjalan dan aktif 24 jam di Cloud!');
});

app.listen(port, () => {
    console.log(`🌐 Server Web Mini berjalan di port ${port}`);
});

const serviceAccount = require('./firebase-adminsdk.json');
initializeApp({
    credential: cert(serviceAccount)
});
const db = getFirestore();

// Fungsi untuk mencari jalur eksekusi Chrome lokal secara dinamis
function findChromeExecutable() {
    const puppeteerCacheDir = path.join(__dirname, '.cache', 'puppeteer', 'chrome');
    if (!fs.existsSync(puppeteerCacheDir)) return null;

    const platforms = fs.readdirSync(puppeteerCacheDir);
    if (platforms.length === 0) return null;

    const platformDir = path.join(puppeteerCacheDir, platforms[0]);
    const chromeDir = path.join(platformDir, fs.readdirSync(platformDir)[0]);

    return path.join(chromeDir, 'chrome');
}

const executablePath = findChromeExecutable();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: executablePath || undefined, // Gunakan path lokal jika ditemukan
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('\n=========================================');
    console.log('SCAN QR CODE INI MENGGUNAKAN WHATSAPP ANDA:');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 Bot WhatsApp CC Tracker Sudah Siap & Terhubung!');
    startCronJob();
});

client.initialize();

function startCronJob() {
    cron.schedule('0 8 * * *', async () => {
        console.log('Mulai menjalankan pengecekan tagihan harian...');
        try {
            const usersSnapshot = await db.collection('artifacts').doc('cctracker-app').collection('users').get();
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            usersSnapshot.forEach(userDoc => {
                const userId = userDoc.id;
                db.collection('artifacts').doc('cctracker-app').collection('users').doc(userId).collection('data').doc('state').get()
                    .then(stateDoc => {
                        if (!stateDoc.exists) return;
                        const userData = stateDoc.data();
                        if (!userData.waNumber) return;

                        const waNumber = userData.waNumber + '@c.us';
                        const activeBills = userData.bills ? userData.bills.filter(b => !b.isPaid) : [];

                        activeBills.forEach(bill => {
                            const dueDate = new Date(bill.dueDate);
                            const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                            const card = userData.cards ? userData.cards.find(c => c.id === bill.cardId) : null;
                            const bankName = card ? card.bank : 'Kartu Kredit';
                            const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(bill.amount);

                            if (diffDays === 5) {
                                client.sendMessage(waNumber, `🚨 *PENGINGAT TAGIHAN H-5* 🚨\n\nHalo! Tagihan *${bankName}* sebesar *${rp}* akan jatuh tempo dalam 5 hari (${bill.dueDate}).\n\n_Pesan otomatis dari CC Tracker_`);
                            }
                            if (diffDays === 0) {
                                client.sendMessage(waNumber, `⚠️ *HARI TERAKHIR PEMBAYARAN* ⚠️\n\nHari ini adalah batas akhir pembayaran *${bankName}* sebesar *${rp}*.\n\n_Pesan otomatis dari CC Tracker_`);
                            }
                        });
                    });
            });
        } catch (error) {
            console.error('Error saat mengecek tagihan:', error);
        }
    });
}
