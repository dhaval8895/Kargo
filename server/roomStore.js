import { createInitialState } from "./engine/reducer.js";

const rooms = new Map();

/* -------------------- ID HELPERS -------------------- */

function makePlayerId() {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

function makeRoomCode6() {
  // Always 6 digits: 100000–999999
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createUniqueRoomCode() {
  // Try a few times to avoid collisions
  for (let i = 0; i < 20; i++) {
    const code = makeRoomCode6();
    if (!rooms.has(code)) return code;
  }
  // Ultra-rare fallback (still readable)
  return `${makeRoomCode6()}${Math.floor(Math.random() * 10)}`;
}

/* -------------------- ROOM CREATION -------------------- */

export function createRoom({ name, socketId }) {
  const roomId = createUniqueRoomCode(); // ✅ 6-digit code
  const playerId = makePlayerId();

  const room = {
    roomId,
    socketIdToPlayerId: {
      [socketId]: playerId,
    },
    activity: [],
    state: createInitialState(),

    addPlayer({ name, socketId }) {
      if (this.state.phase !== "lobby") {
        throw new Error("Game already started");
      }

      const id = makePlayerId();
      this.socketIdToPlayerId[socketId] = id;

      this.state.players.push({
        id,
        name,
        ready: false,
        hand: [],
        revealedOnce: { bottom: false },
        kargoCalled: false,
      });

      return id;
    },
  };

  // Host player
  room.state.players.push({
    id: playerId,
    name,
    ready: false,
    hand: [],
    revealedOnce: { bottom: false },
    kargoCalled: false,
  });

  rooms.set(roomId, room);
  return { roomId, playerId };
}

/* -------------------- LOOKUPS -------------------- */

export function getRoom(roomId) {
  if (!roomId) return null;
  return rooms.get(String(roomId));
}

/* -------------------- DISCONNECT HANDLING -------------------- */

export function removePlayerFromRoom(socketId) {
  for (const room of rooms.values()) {
    const playerId = room.socketIdToPlayerId[socketId];
    if (!playerId) continue;

    delete room.socketIdToPlayerId[socketId];

    // If still in lobby, remove player entirely
    if (room.state.phase === "lobby") {
      room.state.players = room.state.players.filter(
        (p) => p.id !== playerId
      );

      // Delete empty room
      if (room.state.players.length === 0) {
        rooms.delete(room.roomId);
      }
    }

    return { roomId: room.roomId, playerId };
  }

  return null;
}
