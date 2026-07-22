const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const admin = require('firebase-admin');
const express = require('express'); // Mengimpor Express untuk web server

const app = express();
const port = process.env.PORT || 3000;

// Membuat halaman web sederhana agar Render tahu bot ini hidup
app.get('/', (req, res) => {
    res.send('Bot WhatsApp CC Tracker sedang berjalan dan aktif 24 jam!');
});

app.listen(port, () => {
    console.log(`🌐 Server Web Mini berjalan di port ${port}`);
});

const serviceAccount = require('./firebase-adminsdk.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // Argumen ini SANGAT PENTING agar Puppeteer (browser WA) tidak crash di server Render (Linux)
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
    // Jadwal berjalan otomatis setiap hari pukul 08:00 pagi
    cron.schedule('0 8 * * *', async () => {
        console.log('Mulai menjalankan pengecekan tagihan harian...');
        
        try {
            // Mengambil semua user dari database Firebase
            const usersSnapshot = await db.collection('artifacts').doc('cctracker-app').collection('users').get();
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            usersSnapshot.forEach(userDoc => {
                const userId = userDoc.id;
                
                db.collection('artifacts').doc('cctracker-app').collection('users').doc(userId).collection('data').doc('state').get()
                    .then(stateDoc => {
                        if (!stateDoc.exists) return;
                        
                        const userData = stateDoc.data();
                        if (!userData.waNumber) return; // Lewati jika user belum mengatur nomor WA
                        
                        // Format nomor WA untuk library whatsapp-web.js
                        const waNumber = userData.waNumber + '@c.us';
                        const activeBills = userData.bills ? userData.bills.filter(b => !b.isPaid) : [];
                        
                        activeBills.forEach(bill => {
                            const dueDate = new Date(bill.dueDate);
                            const diffTime = dueDate - today;
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            
                            const card = userData.cards ? userData.cards.find(c => c.id === bill.cardId) : null;
                            const bankName = card ? card.bank : 'Kartu Kredit';

                            const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(bill.amount);

                            // Pengingat H-5
                            if (diffDays === 5) {
                                const msg = `🚨 *PENGINGAT TAGIHAN H-5* 🚨\n\nHalo! Tagihan kartu *${bankName}* sebesar *${rp}* akan jatuh tempo dalam 5 hari (${bill.dueDate}).\n\nSegera siapkan dana untuk menghindari denda keterlambatan! 💳💸\n\n_Pesan otomatis dari CC Tracker Cloud_`;
                                client.sendMessage(waNumber, msg);
                                console.log(`Notifikasi H-5 terkirim ke ${userData.waNumber}`);
                            }
                            
                            // Pengingat Hari H
                            if (diffDays === 0) {
                                const msg = `⚠️ *HARI TERAKHIR PEMBAYARAN* ⚠️\n\nHari ini adalah batas akhir pembayaran tagihan *${bankName}* sebesar *${rp}*.\nMohon lunasi hari ini agar status kolektibilitas Anda tetap aman.\n\n_Pesan otomatis dari CC Tracker Cloud_`;
                                client.sendMessage(waNumber, msg);
                                console.log(`Notifikasi Hari H terkirim ke ${userData.waNumber}`);
                            }
                        });
                    });
            });

        } catch (error) {
            console.error('Error saat mengecek tagihan dari Firebase:', error);
        }
    });
}
