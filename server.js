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

const rooms = {};

app.get('/', (req, res) => {
    res.send('Servidor Netplay Super Bomberman 4 Online e Operante!');
});

io.on('connection', (socket) => {
    socket.on('join-room', (data) => {
        const roomName = data.room;
        socket.join(roomName);
        if (!rooms[roomName]) rooms[roomName] = [];
        rooms[roomName].push(socket.id);
        socket.to(roomName).emit('user-connected', socket.id);
    });

    socket.on('signal', (data) => {
        io.to(data.to).emit('signal', {
            from: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        for (const room in rooms) {
            rooms[room] = rooms[room].filter(id => id !== socket.id);
            if (rooms[room].length === 0) delete rooms[room];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
