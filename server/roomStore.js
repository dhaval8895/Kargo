const rooms = new Map();

function makePlayerId() {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

function makeRoomCode6() {
  // 100000–999999 (always 6 digits)
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createUniqueRoomCode() {
  // retry a few times to avoid collision
  for (let i = 0; i < 20; i++) {
    const code = makeRoomCode6();
    if (!rooms.has(code)) return code;
  }
  // ultra-rare fallback
  return `${makeRoomCode6()}${Math.floor(Math.random() * 10)}`; // 7 digits fallback
}

export function createRoom({ name, socketId }) {
  const roomId = createUniqueRoomCode();   // ✅ 6 digit
  const playerId = makePlayerId();

  const room = {
    roomId,
    socketIdToPlayerId: { [socketId]: playerId },
    activity: [],
    state: createInitialState(),
    addPlayer({ name, socketId }) {
      const id = makePlayerId();
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
  return rooms.get(String(roomId));
}
