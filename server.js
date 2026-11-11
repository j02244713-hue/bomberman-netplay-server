const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Armazena as salas ativas por sessionid
const rooms = {};

app.get('/', (req, res) => {
    res.send('Servidor Netplay Super Bomberman 4 Online!');
});

// 1. Rota HTTP que o EmulatorJS consulta para listar as salas abertas
app.get('/list', (req, res) => {
    const gameId = req.query.game_id;
    const result = {};

    for (const sessionId in rooms) {
        const room = rooms[sessionId];
        if (!gameId || String(room.game_id) === String(gameId)) {
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

    // 2. Evento oficial que o EmulatorJS dispara ao criar uma sala
    socket.on('open-room', (data, callback) => {
        const extra = data.extra || {};
        const sessionId = extra.sessionid || socket.id;

        if (rooms[sessionId]) {
            if (typeof callback === 'function') callback('Já existe uma sala com esse ID!');
            return;
        }

        rooms[sessionId] = {
            sessionid: sessionId,
            owner: socket.id,
            room_name: extra.room_name || 'Sala Bomberman',
            player_name: extra.player_name || 'Jogador 1',
            game_id: extra.game_id || '404',
            password: data.password || null,
            maxPlayers: data.maxPlayers || 4,
            players: [socket.id]
        };

        currentSessionId = sessionId;
        socket.join(sessionId);

        if (typeof callback === 'function') {
            callback(null); // null significa sucesso no protocolo do EmulatorJS
        }
    });

    // 3. Evento oficial quando outro jogador entra na sala
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
            if (typeof callback === 'function') callback('A sala está cheia!');
            return;
        }

        room.players.push(socket.id);
        currentSessionId = sessionId;
        socket.join(sessionId);

        // Avisa os participantes da sala sobre o novo jogador
        socket.to(sessionId).emit('user-connected', {
            userid: extra.userid || socket.id,
            player_name: extra.player_name || 'Jogador'
        });

        if (typeof callback === 'function') {
            callback(null);
        }
    });

    // 4. Repasse de sinais WebRTC e dados da partida entre os jogadores
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

    // 5. Fecha ou limpa a sala quando alguém sai
    const sairDaSala = () => {
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

    socket.on('leave-room', sairDaSala);
    socket.on('disconnect', sairDaSala);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Netplay rodando na porta ${PORT}`);
});
