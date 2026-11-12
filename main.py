import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rooms = {}

@app.get("/")
async def root():
    return {"status": "Servidor Python Netplay Super Bomberman 4 Online!"}

@app.get("/list")
async def list_rooms(game_id: str = None, domain: str = None):
    result = {}
    for session_id, room in rooms.items():
        match_game = not game_id or str(room.get("game_id")) == str(game_id)
        match_domain = not domain or str(room.get("domain")) == str(domain)
        if match_game and match_domain:
            result[session_id] = {
                "room_name": room.get("room_name", "Sala Bomberman"),
                "player_name": room.get("player_name", "Jogador 1"),
                "hasPassword": bool(room.get("password")),
                "current": len(room.get("players", [])),
                "max": room.get("maxPlayers", 4)
            }
    return result

# Função auxiliar que descobre em qual sala o jogador está e repassa a mensagem
async def repassar_para_sala(sid, evento, data):
    for session_id, room in rooms.items():
        if sid in room["players"]:
            await sio.emit(evento, data, room=session_id, skip_sid=sid)
            break

@sio.event
async def connect(sid, environ):
    print(f"Conectado: {sid}")

@sio.on("open-room")
async def open_room(sid, data):
    extra = data.get("extra", {})
    session_id = extra.get("sessionid", sid)

    if session_id in rooms:
        return "Sala já existe!"

    rooms[session_id] = {
        "sessionid": session_id,
        "owner": sid,
        "domain": extra.get("domain", ""),
        "room_name": extra.get("room_name", "Sala Bomberman"),
        "player_name": extra.get("player_name", "Jogador 1"),
        "game_id": extra.get("game_id", "404"),
        "password": data.get("password"),
        "maxPlayers": data.get("maxPlayers", 4),
        "players": [sid]
    }

    await sio.enter_room(sid, session_id)
    return None

@sio.on("join-room")
async def join_room(sid, data):
    extra = data.get("extra", {})
    session_id = extra.get("sessionid")
    room = rooms.get(session_id)

    if not room:
        return "Sala não encontrada!"
    if room.get("password") and room.get("password") != data.get("password"):
        return "Senha incorreta!"
    if len(room["players"]) >= room["maxPlayers"]:
        return "Sala cheia!"

    room["players"].append(sid)
    await sio.enter_room(sid, session_id)

    # Notifica o dono da sala com todos os formatos esperados pelo EmulatorJS
    payload = {
        "userid": extra.get("userid", sid),
        "player_name": extra.get("player_name", "Jogador"),
        "extra": extra
    }
    await sio.emit("user-connected", payload, room=session_id, skip_sid=sid)
    await sio.emit("join-room", data, room=session_id, skip_sid=sid)

    return None

# Repassa todos os possíveis canais de negociação WebRTC entre Jogador 1 e Jogador 2
@sio.on("webrtc-signal")
async def on_webrtc_signal(sid, data):
    await repassar_para_sala(sid, "webrtc-signal", data)

@sio.on("data-message")
async def on_data_message(sid, data):
    await repassar_para_sala(sid, "data-message", data)

@sio.on("message")
async def on_message(sid, data):
    await repassar_para_sala(sid, "message", data)

@sio.on("rtcmulticonnection")
async def on_rtc(sid, data):
    await repassar_para_sala(sid, "rtcmulticonnection", data)

@sio.on("changed-uuid")
async def on_uuid(sid, data):
    await repassar_para_sala(sid, "changed-uuid", data)

@sio.event
async def disconnect(sid):
    to_delete = []
    for session_id, room in rooms.items():
        if sid in room["players"]:
            room["players"].remove(sid)
            if room["owner"] == sid or len(room["players"]) == 0:
                to_delete.append(session_id)
                await sio.emit("room-closed", room=session_id)
            else:
                await sio.emit("user-disconnected", sid, room=session_id)
    for session_id in to_delete:
        del rooms[session_id]

socket_app = socketio.ASGIApp(sio, other_asgi_app=app)
