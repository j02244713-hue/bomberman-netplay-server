const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

app.get('/', (req, res) => {
    res.send('Servidor Netplay Super Bomberman 4 Online!');
});

// Rota exata que o console mostrou que o emulador está buscando
app.get('/list', (req, res) => {
    const gameId = req.query.game_id;
    const domain = req.query.domain;
    const result = {};

    for (const sessionId in rooms) {
        const room = rooms[sessionId];
        const matchGame = !gameId || String(room.game_id) === String(gameId);
        const matchDomain = !domain || String(room.domain) === String(domain);
        
        if (matchGame && matchDomain) {
            result[sessionId] = {
                room_name: room.room_name,
                player_name: room.player_name,
                hasPassword: !!room.password,
                current: room.players.length,
                max: room.maxPlayers
            };
        }
    }

    res.json(result);
});

io.on('connection', (socket) => {
    let currentSessionId = null;

    socket.on('open-room', (data, callback) => {
        const extra = data.extra || {};
        const sessionId = extra.sessionid || socket.id;

        if (rooms[sessionId]) {
            if (typeof callback === 'function') callback('Sala já existe!');
            return;
        }

        rooms[sessionId] = {
            sessionid: sessionId,
            owner: socket.id,
            domain: extra.domain || '',
            room_name: extra.room_name || 'Sala Bomberman',
            player_name: extra.player_name || 'Jogador 1',
            game_id: extra.game_id || '404',
            password: data.password || null,
            maxPlayers: data.maxPlayers || 4,
            players: [socket.id]
        };

        currentSessionId = sessionId;
        socket.join(sessionId);

        if (typeof callback === 'function') callback(null);
    });

    socket.on('join-room', (data, callback) => {
        const extra = data.extra || {};
        const sessionId = extra.sessionid;
        const room = rooms[sessionId];

        if (!room) {
            if (typeof callback === 'function') callback('Sala não encontrada!');
            return;
        }
        if (room.password && room.password !== data.password) {
            if (typeof callback === 'function') callback('Senha incorreta!');
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            if (typeof callback === 'function') callback('Sala cheia!');
            return;
        }

        room.players.push(socket.id);
        currentSessionId = sessionId;
        socket.join(sessionId);

        socket.to(sessionId).emit('user-connected', {
            userid: extra.userid || socket.id,
            player_name: extra.player_name || 'Jogador'
        });

        if (typeof callback === 'function') callback(null);
    });

    socket.on('webrtc-signal', (data) => {
        if (currentSessionId) {
            socket.to(currentSessionId).emit('webrtc-signal', data);
        }
    });

    socket.on('data-message', (data) => {
        if (currentSessionId) {
            socket.to(currentSessionId).emit('data-message', data);
        }
    });

    const sair = () => {
        if (currentSessionId && rooms[currentSessionId]) {
            const room = rooms[currentSessionId];
            room.players = room.players.filter(id => id !== socket.id);

            if (room.owner === socket.id || room.players.length === 0) {
                delete rooms[currentSessionId];
                io.to(currentSessionId).emit('room-closed');
            } else {
                socket.to(currentSessionId).emit('user-disconnected', socket.id);
            }
            currentSessionId = null;
        }
    };

    socket.on('leave-room', sair);
    socket.on('disconnect', sair);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
