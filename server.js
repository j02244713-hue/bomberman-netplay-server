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

// Armazena as salas ativas separadas por ID do jogo
const rooms = {};

app.get('/', (req, res) => {
    res.send('Servidor Oficial Netplay Super Bomberman 4 Online!');
});

io.on('connection', (socket) => {
    let currentRoom = null;
    let currentGameId = null;

    // 1. Quando o emulador pede a lista de salas disponíveis
    socket.on('get-rooms', (data, callback) => {
        const gameId = data.game_id || 'default';
        const gameRooms = rooms[gameId] || {};
        const roomList = [];

        for (const roomName in gameRooms) {
            const room = gameRooms[roomName];
            roomList.push({
                room_name: roomName,
                player_name: room.ownerName,
                has_password: !!room.password,
                current_players: room.players.length,
                max_players: room.maxPlayers || 4
            });
        }

        if (typeof callback === 'function') {
            callback(roomList);
        }
    });

    // 2. Quando o jogador cria uma nova sala
    socket.on('create-room', (data, callback) => {
        const gameId = data.game_id || 'default';
        const roomName = data.room_name;

        if (!rooms[gameId]) rooms[gameId] = {};

        if (rooms[gameId][roomName]) {
            if (typeof callback === 'function') {
                callback({ error: 'Já existe uma sala com esse nome!' });
            }
            return;
        }

        rooms[gameId][roomName] = {
            owner: socket.id,
            ownerName: data.player_name || 'Jogador 1',
            password: data.password || null,
            maxPlayers: data.max_players || 4,
            players: [{ id: socket.id, name: data.player_name || 'Jogador 1' }]
        };

        currentRoom = roomName;
        currentGameId = gameId;
        socket.join(`${gameId}_${roomName}`);

        if (typeof callback === 'function') {
            callback({ success: true });
        }
    });

    // 3. Quando outro jogador tenta entrar na sala
    socket.on('join-room', (data, callback) => {
        const gameId = data.game_id || 'default';
        const roomName = data.room_name;
        const room = rooms[gameId]?.[roomName];

        if (!room) {
            if (typeof callback === 'function') callback({ error: 'Sala não encontrada!' });
            return;
        }

        if (room.password && room.password !== data.password) {
            if (typeof callback === 'function') callback({ error: 'Senha incorreta!' });
            return;
        }

        if (room.players.length >= room.maxPlayers) {
            if (typeof callback === 'function') callback({ error: 'A sala está cheia!' });
            return;
        }

        room.players.push({ id: socket.id, name: data.player_name || 'Jogador' });
        currentRoom = roomName;
        currentGameId = gameId;
        socket.join(`${gameId}_${roomName}`);

        // Avisa o dono da sala que alguém entrou para iniciar a conexão WebRTC
        io.to(room.owner).emit('user-connected', {
            id: socket.id,
            name: data.player_name || 'Jogador'
        });

        if (typeof callback === 'function') {
            callback({ success: true, owner: room.owner });
        }
    });

    // 4. Troca de dados de conexão direta (WebRTC) entre os jogadores
    socket.on('signal', (data) => {
        io.to(data.to).emit('signal', {
            from: socket.id,
            signal: data.signal
        });
    });

    // 5. Limpeza automática quando o jogador fecha a aba ou sai
    socket.on('disconnect', () => {
        if (currentGameId && currentRoom && rooms[currentGameId]?.[currentRoom]) {
            const room = rooms[currentGameId][currentRoom];
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.owner === socket.id || room.players.length === 0) {
                delete rooms[currentGameId][currentRoom];
                io.to(`${currentGameId}_${currentRoom}`).emit('room-closed');
            } else {
                io.to(`${currentGameId}_${currentRoom}`).emit('user-disconnected', socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor Netplay rodando na porta ${PORT}`);
});
