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

// API Endpoint untuk cek status QR via AJAX (tanpa reload halaman)
app.get('/qr-status', (req, res) => {
    res.json({
        isConnected: isConnected,
        qr: latestQR
    });
});

// Endpoint baru untuk melakukan tes kirim pengingat tagihan secara manual
app.get('/test-check', async (req, res) => {
    try {
        await checkAndSendReminders();
        res.json({ status: 'success', message: 'Pengecekan dan pengiriman pengingat tagihan berhasil dijalankan!' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Scan QR WhatsApp - CC Tracker</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6; color: #1f2937; margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
                .card { background: #ffffff; padding: 35px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); max-width: 420px; width: 90%; }
                h1 { font-size: 22px; margin-bottom: 8px; color: #111827; }
                p { font-size: 14px; color: #6b7280; line-height: 1.5; margin-bottom: 20px; }
                /* Area Quiet Zone Putih Bersih untuk Kamera */
                .qr-container { background: #ffffff; padding: 20px; border-radius: 16px; border: 2px solid #e5e7eb; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                .qr-container img { width: 280px; height: 280px; display: block; border: none; }
                .status-badge { display: inline-flex; align-items: center; gap: 8px; background: #dcfce7; color: #15803d; font-weight: 600; padding: 8px 16px; border-radius: 9999px; font-size: 14px; margin-top: 15px; }
                .loading-spinner { border: 3px solid #f3f3f3; border-top: 3px solid #3b82f6; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 20px auto; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        </head>
        <body>
            <div class="card">
                <div id="content">
                    <h2>⏳ Menyiapkan WhatsApp Web...</h2>
                    <div class="loading-spinner"></div>
                    <p>Mohon tunggu beberapa detik, browser cloud sedang memuat WhatsApp.</p>
                </div>
            </div>

            <script>
                let currentQR = '';
                async function checkStatus() {
                    try {
                        const response = await fetch('/qr-status');
                        const data = await response.json();
                        const contentDiv = document.getElementById('content');

                        if (data.isConnected) {
                            contentDiv.innerHTML = \`
                                <h1 style="color: #16a34a;">✅ WhatsApp Terhubung!</h1>
                                <p>Bot CC Tracker sudah aktif 24 jam di Cloud dan siap mengirim pengingat tagihan.</p>
                                <div class="status-badge">● Bot Berjalan Normal</div>
                            \`;
                        } else if (data.qr) {
                            if (currentQR !== data.qr) {
                                currentQR = data.qr;
                                const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=2&data=' + encodeURIComponent(data.qr);
                                contentDiv.innerHTML = \`
                                    <h1>📱 Scan QR Code WhatsApp</h1>
                                    <p>Buka WhatsApp di HP &gt; <b>Perangkat Tertaut</b> &gt; <b>Tautkan Perangkat</b>:</p>
                                    <div class="qr-container">
                                        <img src="\${qrUrl}" alt="WhatsApp QR Code" />
                                    </div>
                                    <p style="font-size: 12px; color: #9ca3af; margin-top: 15px;">QR Code ini diperbarui secara otomatis secara realtime.</p>
                                \`;
                            }
                        }
                    } catch (e) {
                        console.error('Error fetching QR status:', e);
                    }
                }
                setInterval(checkStatus, 2000);
                checkStatus();
            </script>
        </body>
        </html>
    `);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Server Web Mini berjalan di port ${port}`);
});

const serviceAccount = require('./firebase-adminsdk.json');
initializeApp({
    credential: cert(serviceAccount)
});
const db = getFirestore();

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
            '--disable-gpu',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-features=Translate',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--single-process' // Sangat penting: Menjalankan Chrome dalam 1 proses untuk menghemat RAM < 512MB
        ] 
    }
});

client.on('qr', (qr) => {
    latestQR = qr;
    isConnected = false;
    console.log('\n=========================================');
    console.log('QR CODE BARU SIAP! Buka URL Web Service Render Anda di browser.');
    console.log('=========================================\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    isConnected = true;
    latestQR = '';
    console.log('🤖 Bot WhatsApp CC Tracker Sudah Siap & Terhubung!');
    startCronJob();
    
    // Jalankan pengecekan 1x secara otomatis saat bot baru saja terhubung
    checkAndSendReminders();
});

client.initialize();

async function checkAndSendReminders() {
    console.log('Mulai menjalankan pengecekan tagihan...');
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
                    
                    // Clean & Format Nomor WhatsApp (memastikan format 62xxx)
                    let cleanNumber = userData.waNumber.toString().replace(/\D/g, '');
                    if (cleanNumber.startsWith('0')) {
                        cleanNumber = '62' + cleanNumber.slice(1);
                    }
                    const waNumber = cleanNumber + '@c.us';

                    const activeBills = userData.bills ? userData.bills.filter(b => !b.isPaid) : [];
                    
                    activeBills.forEach(bill => {
                        const dueDate = new Date(bill.dueDate);
                        dueDate.setHours(0, 0, 0, 0);
                        const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                        const card = userData.cards ? userData.cards.find(c => c.id === bill.cardId) : null;
                        const bankName = card ? card.bank : 'Kartu Kredit';
                        const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(bill.amount);

                        // Kirim pengingat jika H-5, H-4, H-3, H-2, H-1, atau Hari H (0)
                        if (diffDays === 5) {
                            client.sendMessage(waNumber, `🚨 *PENGINGAT TAGIHAN H-5* 🚨\n\nHalo! Tagihan *${bankName}* sebesar *${rp}* akan jatuh tempo dalam 5 hari (${bill.dueDate}).\n\n_Pesan otomatis dari CC Tracker_`);
                        } else if (diffDays > 0 && diffDays < 5) {
                            client.sendMessage(waNumber, `⚠️ *PENGINGAT TAGIHAN H-${diffDays}* ⚠️\n\nHalo! Tagihan *${bankName}* sebesar *${rp}* akan jatuh tempo dalam ${diffDays} hari lagi (${bill.dueDate}).\n\n_Pesan otomatis dari CC Tracker_`);
                        } else if (diffDays === 0) {
                            client.sendMessage(waNumber, `⚠️ *HARI TERAKHIR PEMBAYARAN* ⚠️\n\nHari ini adalah batas akhir pembayaran *${bankName}* sebesar *${rp}*.\n\n_Pesan otomatis dari CC Tracker_`);
                        }
                    });
                });
        });
    } catch (error) {
        console.error('Error saat mengecek tagihan:', error);
    }
}

function startCronJob() {
    // Jalankan setiap jam 08:00 Pagi Waktu Indonesia Barat (Asia/Jakarta)
    cron.schedule('0 8 * * *', checkAndSendReminders, {
        timezone: "Asia/Jakarta"
    });
}
