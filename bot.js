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

let latestQR = '';
let isConnected = false;

// Halaman Web untuk melihat QR Code langsung dari Browser
app.get('/', (req, res) => {
    if (isConnected) {
        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #16a34a;">✅ Bot WhatsApp Terhubung & Aktif!</h1>
                <p>Bot CC Tracker sedang berjalan 24 jam di Cloud.</p>
            </div>
        `);
    } else if (latestQR) {
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h1>📱 Scan QR Code WhatsApp</h1>
                <p>Buka WhatsApp di HP > Perangkat Tertaut > Scan QR di bawah ini:</p>
                <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 4px solid #3b82f6; border-radius: 12px; padding: 10px; margin-top: 10px;" />
                <p style="color: #666; font-size: 14px; margin-top: 15px;">Halaman ini akan otomatis diperbarui setiap 15 detik.</p>
                <script>setTimeout(() => location.reload(), 15000);</script>
            </div>
        `);
    } else {
        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h2>⏳ Menyiapkan Bot WhatsApp...</h2>
                <p>Server sedang membuka WhatsApp Web di latar belakang (butuh waktu sekitar 30-60 detik).</p>
                <p>Halaman ini akan otomatis memuat ulang...</p>
                <script>setTimeout(() => location.reload(), 10000);</script>
            </div>
        `);
    }
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
        executablePath: executablePath || undefined,
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
    latestQR = qr;
    isConnected = false;
    console.log('\n=========================================');
    console.log('QR CODE BARU SIAP! Buka URL Web Service Anda di browser untuk men-scan.');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    isConnected = true;
    latestQR = '';
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
