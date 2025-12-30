import { createInitialState } from "./engine/reducer.js";

const rooms = new Map();

function makeId(prefix = "r") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createRoom({ name, socketId }) {
  const roomId = makeId("room");
  const playerId = makeId("p");

  const room = {
    roomId,
    socketIdToPlayerId: { [socketId]: playerId },
    activity: [],
    state: createInitialState(),
    addPlayer({ name, socketId }) {
      const id = makeId("p");
      if (this.state.phase !== "lobby") throw new Error("Game already started");
      this.socketIdToPlayerId[socketId] = id;
      this.state.players.push({
        id,
        name,
        ready: false,
        hand: [],
        revealedOnce: { bottom: false },
        kargoCalled: false
      });
      return id;
    }
  };

  // Host player
  room.state.players.push({
    id: playerId,
    name,
    ready: false,
    hand: [],
    revealedOnce: { bottom: false },
    kargoCalled: false
  });

  rooms.set(roomId, room);
  return { roomId, playerId };
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function removePlayerFromRoom(socketId) {
  for (const room of rooms.values()) {
    const playerId = room.socketIdToPlayerId[socketId];
    if (!playerId) continue;

    delete room.socketIdToPlayerId[socketId];

    // keep player in state for MVP (don’t auto-kick mid game)
    // if in lobby, you can remove:
    if (room.state.phase === "lobby") {
      room.state.players = room.state.players.filter((p) => p.id !== playerId);
      // delete empty room
      if (room.state.players.length === 0) rooms.delete(room.roomId);
    }

    return { roomId: room.roomId, playerId };
  }
  return null;
}
