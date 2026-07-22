const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('./firebase-adminsdk.json');

initializeApp({
    credential: cert(serviceAccount)
});
const db = getFirestore();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true }
});

client.on('qr', (qr) => {
    console.log('SCAN QR CODE INI MENGGUNAKAN WHATSAPP ANDA:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 Bot WhatsApp CC Tracker Sudah Siap & Terhubung!');
    startCronJob();
});

client.initialize();

function startCronJob() {
    cron.schedule('0 8 * * *', async () => {
        console.log('Menjalankan pengecekan tagihan...');

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
                            const diffTime = dueDate - today;
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                            const card = userData.cards ? userData.cards.find(c => c.id === bill.cardId) : null;
                            const bankName = card ? card.bank : 'Kartu Kredit';

                            const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(bill.amount);

                            if (diffDays === 5) {
                                const msg = `🚨 *PENGINGAT TAGIHAN H-5* 🚨\n\nHalo! Tagihan untuk kartu *${bankName}* sebesar *${rp}* akan jatuh tempo dalam 5 hari (${bill.dueDate}).\n\nSegera siapkan dana untuk menghindari denda keterlambatan! 💳💸\n\n_Pesan otomatis dari CC Tracker_`;
                                client.sendMessage(waNumber, msg);
                                console.log(`Notifikasi H-5 terkirim ke ${userData.waNumber}`);
                            }

                            if (diffDays === 0) {
                                const msg = `⚠️ *HARI TERAKHIR PEMBAYARAN* ⚠️\n\nHari ini adalah batas akhir pembayaran tagihan *${bankName}* sebesar *${rp}*.\nMohon lunasi hari ini agar status kolektibilitas Anda tetap aman.\n\n_Pesan otomatis dari CC Tracker_`;
                                client.sendMessage(waNumber, msg);
                                console.log(`Notifikasi Hari H terkirim ke ${userData.waNumber}`);
                            }
                        });
                    });
            });

        } catch (error) {
            console.error('Error saat mengecek tagihan:', error);
        }
    });
}