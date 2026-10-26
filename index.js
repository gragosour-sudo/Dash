const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

let waSocket = null;
let allGroups = {};
let qrCodeData = '';
let connectionStatus = 'disconnected';

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    waSocket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            connectionStatus = 'qr_ready';
            io.emit('qr', qr);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            io.emit('status', { status: 'disconnected' });
            if (shouldReconnect) {
                startWhatsApp();
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeData = '';
            io.emit('status', { status: 'connected' });
            await fetchAllGroups();
        }
    });

    waSocket.ev.on('creds.update', saveCreds);
}

async function fetchAllGroups() {
    try {
        const groups = await waSocket.groupFetchAllParticipating();
        allGroups = groups;
        io.emit('groups_updated', Object.values(groups));
    } catch (error) {
        console.error('❌ خطأ أثناء جلب الجروبات:', error);
    }
}

app.get('/api/groups', (req, res) => {
    const groupsList = Object.values(allGroups).map(group => ({
        id: group.id,
        subject: group.subject || 'بدون اسم',
        participantsCount: group.participants ? group.participants.length : 0,
        creation: group.creation
    }));
    res.json({ success: true, count: groupsList.length, groups: groupsList });
});

io.on('connection', (socket) => {
    socket.emit('status', { status: connectionStatus });
    if (qrCodeData && connectionStatus === 'qr_ready') {
        socket.emit('qr', qrCodeData);
    }
});

server.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على البورت ${PORT}`);
    startWhatsApp();
});
