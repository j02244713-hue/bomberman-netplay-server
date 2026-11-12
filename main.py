import socketio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Configura o servidor Socket.IO liberando qualquer origem (PC, Celular, GitHub)
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dicionário que guarda as salas abertas
rooms = {}

@app.get("/")
async def root():
    return {"status": "Servidor Python Netplay Super Bomberman 4 Online!", "salas_ativas": len(rooms)}

# Rota que o EmulatorJS consulta para listar as salas
@app.get("/list")
async def list_rooms(request: Request):
    game_id = request.query_params.get("game_id")
    result = {}
    
    for session_id, room in rooms.items():
        if not game_id or str(room.get("game_id")) == str(game_id):
            result[session_id] = {
                "room_name": room["room_name"],
                "player_name": room["player_name"],
                "hasPassword": bool(room["password"]),
                "current": len(room["players"]),
                "max": room["max_players"]
            }
    return result

@sio.event
async def connect(sid, environ):
    print(f"Jogador conectado: {sid}")

@sio.on("open-room")
async def open_room(sid, data):
    extra = data.get("extra", {})
    session_id = extra.get("sessionid", sid)
    
    rooms[session_id] = {
        "sessionid": session_id,
        "owner": sid,
        "room_name": extra.get("room_name", "Sala Bomberman"),
        "player_name": extra.get("player_name", "Jogador 1"),
        "game_id": extra.get("game_id", "404"),
        "password": data.get("password"),
        "max_players": data.get("maxPlayers", 4),
        "players": [sid]
    }
    
    await sio.enter_room(sid, session_id)
    print(f"Sala criada: {rooms[session_id]['room_name']} (ID: {session_id})")
    return None # Retorna None para confirmar sucesso ao EmulatorJS

@sio.on("join-room")
async def join_room(sid, data):
    extra = data.get("extra", {})
    session_id = extra.get("sessionid")
    room = rooms.get(session_id)
    
    if not room:
        return "Sala não encontrada!"
    if room["password"] and room["password"] != data.get("password"):
        return "Senha incorreta!"
    if len(room["players"]) >= room["max_players"]:
        return "A sala está cheia!"
        
    room["players"].append(sid)
    await sio.enter_room(sid, session_id)
    
    await sio.emit("user-connected", {
        "userid": extra.get("userid", sid),
        "player_name": extra.get("player_name", "Jogador")
    }, room=session_id, skip_sid=sid)
    
    return None

@sio.on("webrtc-signal")
async def webrtc_signal(sid, data):
    for session_id, room in rooms.items():
        if sid in room["players"]:
            await sio.emit("webrtc-signal", data, room=session_id, skip_sid=sid)
            break

@sio.on("data-message")
async def data_message(sid, data):
    for session_id, room in rooms.items():
        if sid in room["players"]:
            await sio.emit("data-message", data, room=session_id, skip_sid=sid)
            break

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
        print(f"Sala encerrada: {session_id}")

# Une o FastAPI com o Socket.IO
socket_app = socketio.ASGIApp(sio, app)

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(socket_app, host="0.0.0.0", port=port)
