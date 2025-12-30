import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { createRoom, getRoom, removePlayerFromRoom } from "./roomStore.js";
import { validateAction } from "./engine/validate.js";
import { applyAction } from "./engine/reducer.js";
import { toPublicState } from "./engine/publicState.js";

const PORT = process.env.PORT || 3001;

// --- Basic HTTP server (Socket.io attaches here) ---
const handler = (req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Kargo server running");
};
const httpServer = http.createServer(handler);

// CORS for dev + prod
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

function emitRoomState(roomId) {
  const room = getRoom(roomId);
  if (!room) return;

  // Send per-socket public state (so each player only sees what they should)
  for (const [socketId, playerId] of Object.entries(room.socketIdToPlayerId)) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    socket.emit("ROOM_STATE", {
      roomId,
      you: playerId,
      state: toPublicState(room.state, playerId),
      activity: room.activity.slice(-50)
    });
  }
}

function pushActivity(room, entry) {
  room.activity.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    ...entry
  });
  if (room.activity.length > 200) room.activity.shift();
}

io.on("connection", (socket) => {
  socket.on("PING", (cb) => cb?.({ ok: true, ts: Date.now() }));

  socket.on("CREATE_ROOM", ({ name }, cb) => {
    try {
      const { roomId, playerId } = createRoom({ name: name || "Player 1", socketId: socket.id });
      socket.join(roomId);

      const room = getRoom(roomId);
      pushActivity(room, { player: name || "Player 1", action: "created the room" });

      emitRoomState(roomId);
      cb?.({ ok: true, roomId, playerId });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || "Failed to create room" });
    }
  });

  socket.on("JOIN_ROOM", ({ roomId, name }, cb) => {
    try {
      const room = getRoom(roomId);
      if (!room) return cb?.({ ok: false, error: "Room not found" });

      const playerId = room.addPlayer({ name: name || "Player", socketId: socket.id });
      socket.join(roomId);

      pushActivity(room, { player: name || "Player", action: "joined" });

      emitRoomState(roomId);
      cb?.({ ok: true, roomId, playerId });
    } catch (e) {
      cb?.({ ok: false, error: e?.message || "Failed to join room" });
    }
  });

  socket.on("ACTION", ({ roomId, playerId, action }, cb) => {
    const room = getRoom(roomId);
    if (!room) return cb?.({ ok: false, error: "Room not found" });

    // Hard bind socket -> player to prevent spoofing
    const boundPlayer = room.socketIdToPlayerId[socket.id];
    if (!boundPlayer || boundPlayer !== playerId) {
      return cb?.({ ok: false, error: "Not authorized for this player" });
    }

    const v = validateAction(room.state, playerId, action);
    if (!v.ok) return cb?.({ ok: false, error: v.error });

    const next = applyAction(room.state, playerId, action);
    room.state = next;

    // Activity entry (simple / MVP)
    if (action?.type) {
      const pName = room.state.players.find((p) => p.id === playerId)?.name || "Player";
      pushActivity(room, { player: pName, action: describeAction(action) });
    }

    emitRoomState(roomId);
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const { roomId } = removePlayerFromRoom(socket.id) || {};
    if (roomId) emitRoomState(roomId);
  });
});

function describeAction(action) {
  switch (action.type) {
    case "READY": return "is ready";
    case "DRAW": return "drew a card";
    case "SWAP_WITH_DISCARD": return "swapped with discard";
    case "SWAP_DRAWN_WITH_HAND": return "swapped drawn card with hand";
    case "DISCARD_DRAWN": return "discarded the drawn card";
    default: return action.type;
  }
}

httpServer.listen(PORT, () => {
  console.log(`Kargo server listening on :${PORT}`);
});
