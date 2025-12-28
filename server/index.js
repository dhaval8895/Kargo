import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.get("/", (_, res) => res.send("KARGO server running"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = new Map(); // code -> room

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SUITS = ["S", "H", "D", "C"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function isRedSuit(s) { return s === "H" || s === "D"; }
function cardValue(c) {
  if (c.rank === "A") return 1;
  if (/^\d+$/.test(c.rank)) return Number(c.rank);
  if (c.rank === "J") return 11;
  if (c.rank === "Q") return 12;
  if (c.rank === "K") return isRedSuit(c.suit) ? -1 : 13;
  return 0;
}

function makeDecks(deckCount) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: `${d}-${rank}-${suit}-${Math.random()}`, rank, suit });
      }
    }
    // 2 jokers per deck (0 points)
    cards.push({ id: `${d}-JOKER-0-${Math.random()}`, rank: "JOKER", suit: "J" });
    cards.push({ id: `${d}-JOKER-1-${Math.random()}`, rank: "JOKER", suit: "J" });
  }
  return shuffle(cards);
}

function ensureDeck(room) {
  if (room.deck.length > 0) return;
  if (room.discard.length === 0) return;
  room.deck = shuffle(room.discard);
  room.discard = [];
}

function handTotal(slots) {
  return slots.filter(Boolean).reduce((sum, s) => sum + (s.card.rank === "JOKER" ? 0 : cardValue(s.card)), 0);
}
function cardCount(slots) { return slots.filter(Boolean).length; }

function publicView(room, viewerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.order.map(pid => {
      const p = room.players.get(pid);
      const hand = room.hands.get(pid) || [];
      return {
        id: pid,
        name: p.name,
        cardCount: cardCount(hand),
        // viewer sees faceUp cards only for self
        slots: hand.map(slot => {
          if (!slot) return null;
          if (pid === viewerId && slot.faceUp) return { card: slot.card, faceUp: true };
          return { card: null, faceUp: false };
        })
      };
    }),
    turnPlayerId: room.order[room.turnIndex] ?? null,
    deckRemaining: room.deck.length,
    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score }))
  };
}

function broadcast(room) {
  for (const pid of room.order) {
    io.to(pid).emit("room:update", publicView(room, pid));
  }
}

function startRound(room) {
  const n = room.order.length;
  room.deckCount = n <= 5 ? 2 : 3;
  room.deck = makeDecks(room.deckCount);
  room.discard = [];
  room.hands = new Map();
  room.turnIndex = 0;
  room.phase = "playing"; // keep simple for MVP; UI can still do "peek once" client-side

  for (const pid of room.order) {
    // 4 slots: bottom 2 seen once (we mark faceUp true initially; UI can auto-hide them after 1 peek)
    const c0 = room.deck.pop();
    const c1 = room.deck.pop();
    const c2 = room.deck.pop();
    const c3 = room.deck.pop();
    room.hands.set(pid, [
      { card: c0, faceUp: true },
      { card: c1, faceUp: true },
      { card: c2, faceUp: false },
      { card: c3, faceUp: false }
    ]);
  }
}

function nextTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.order.length;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }) => {
    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      order: [],
      scoreboard: new Map(),
      phase: "lobby",
      deckCount: 2,
      deck: [],
      discard: [],
      hands: new Map(),
      turnIndex: 0,
      drawnBy: new Map()
    };
    rooms.set(code, room);

    room.players.set(socket.id, { id: socket.id, name });
    room.order.push(socket.id);
    room.scoreboard.set(name, 0);

    socket.join(code);
    broadcast(room);
  });

  socket.on("room:join", ({ code, name }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit("error:msg", "Room not found");
    if (room.phase !== "lobby") return socket.emit("error:msg", "Game already started");
    if (room.order.length >= 8) return socket.emit("error:msg", "Room full (max 8)");

    room.players.set(socket.id, { id: socket.id, name });
    room.order.push(socket.id);
    if (!room.scoreboard.has(name)) room.scoreboard.set(name, 0);

    socket.join(code);
    broadcast(room);
  });

  socket.on("game:start", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit("error:msg", "Only host can start");
    if (room.order.length < 2) return socket.emit("error:msg", "Need at least 2 players");
    startRound(room);
    broadcast(room);
  });

  socket.on("turn:draw", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    ensureDeck(room);
    const card = room.deck.pop();
    if (!card) return socket.emit("error:msg", "Deck empty");

    room.drawnBy.set(socket.id, card);
    socket.emit("turn:drawn", card);
    broadcast(room);
  });

  socket.on("turn:keepSwap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    const replaced = hand?.[slotIndex];
    if (replaced) room.discard.push(replaced.card);

    hand[slotIndex] = { card: drawn, faceUp: true };
    room.drawnBy.delete(socket.id);

    // if you’re out, round ends: -20, others add totals
    if (cardCount(hand) === 0) {
      const totals = room.order.map(pid => ({
        pid,
        name: room.players.get(pid).name,
        total: handTotal(room.hands.get(pid))
      }));

      for (const t of totals) {
        const prev = room.scoreboard.get(t.name) ?? 0;
        const delta = (t.pid === socket.id) ? -20 : t.total;
        room.scoreboard.set(t.name, prev + delta);
      }
      room.phase = "lobby"; // MVP: bounce back to lobby for next round
    } else {
      nextTurn(room);
    }

    broadcast(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue;

      room.players.delete(socket.id);
      room.order = room.order.filter(id => id !== socket.id);
      room.hands.delete(socket.id);
      room.drawnBy.delete(socket.id);

      if (room.order.length === 0) rooms.delete(code);
      else {
        if (room.hostId === socket.id) room.hostId = room.order[0];
        room.turnIndex = Math.min(room.turnIndex, room.order.length - 1);
        broadcast(room);
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`KARGO server listening on :${PORT}`));
