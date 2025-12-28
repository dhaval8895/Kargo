import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.get("/", (_, res) => res.send("KARGO server running"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/** -------------------- Card helpers -------------------- */
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function isRedSuit(s) { return s === "H" || s === "D"; }
function cardValue(card) {
  if (card.rank === "JOKER") return 0;
  if (card.rank === "A") return 1;
  if (/^\d+$/.test(card.rank)) return Number(card.rank);
  if (card.rank === "J") return 11;
  if (card.rank === "Q") return 12;
  if (card.rank === "K") return isRedSuit(card.suit) ? -1 : 13;
  return 0;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeDecks(deckCount) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const s of SUITS) for (const r of RANKS) {
      cards.push({ id: `${d}-${r}-${s}-${Math.random()}`, rank: r, suit: s });
    }
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
function countCards(hand) {
  return hand.filter(Boolean).length;
}
function handTotal(hand) {
  return hand.filter(Boolean).reduce((sum, slot) => sum + cardValue(slot.card), 0);
}
function nowMs() {
  // monotonic-ish on Node is fine; we use Date.now for simplicity
  return Date.now();
}

/** -------------------- Rooms -------------------- */
const rooms = new Map(); // code -> room

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function publicRoomView(room, viewerId) {
  // Thrown card visible to everyone
  const thrownCard = room.thrown && !room.thrown.resolved ? room.thrown.card : null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    deckRemaining: room.deck.length,
    turnPlayerId: room.order[room.turnIndex] ?? null,
    thrownCard,
    players: room.order.map(pid => {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const hand = room.hands.get(pid) || [];
      const slots = hand.map(slot => {
        if (!slot) return null;
        if (pid === viewerId) {
          return {
            faceUp: !!slot.faceUp,
            card: slot.faceUp ? slot.card : null
          };
        }
        return { faceUp: false, card: null };
      });
      return { id: pid, name, cardCount: countCards(hand), slots };
    }),
    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score }))
  };
}

function broadcastRoom(room) {
  // expire thrown window after 2 seconds
  if (room.thrown && !room.thrown.resolved) {
    const age = nowMs() - room.thrown.openedAt;
    if (age > 2000) {
      room.discard.push(room.thrown.card);
      room.thrown.resolved = true;
    }
  }

  for (const pid of room.order) {
    io.to(pid).emit("room:update", publicRoomView(room, pid));
  }
}

function startRound(room) {
  const n = room.order.length;
  room.deckCount = n <= 5 ? 2 : 3;
  room.deck = makeDecks(room.deckCount);
  room.discard = [];
  room.hands = new Map();
  room.turnIndex = 0;
  room.drawnBy = new Map();
  room.phase = "playing";
  room.thrown = null;

  for (const pid of room.order) {
    const c0 = room.deck.pop();
    const c1 = room.deck.pop();
    const c2 = room.deck.pop();
    const c3 = room.deck.pop();

    // bottom 2 = faceUp "peek once" (client will auto-hide); top 2 faceDown
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

function givePenaltyCard(room, pid) {
  ensureDeck(room);
  const c = room.deck.pop();
  if (!c) return;
  const hand = room.hands.get(pid) || [];
  hand.push({ card: c, faceUp: false });
  room.hands.set(pid, hand);
}

function endRoundSomeoneOut(room, outPid) {
  // -20 for outPid, others add totals
  const totals = room.order.map(pid => ({
    pid,
    name: room.players.get(pid)?.name ?? "Unknown",
    total: handTotal(room.hands.get(pid) || [])
  }));

  for (const t of totals) {
    const prev = room.scoreboard.get(t.name) ?? 0;
    const delta = (t.pid === outPid) ? -20 : t.total;
    room.scoreboard.set(t.name, prev + delta);
  }

  room.phase = "lobby";
  room.deck = [];
  room.discard = [];
  room.drawnBy = new Map();
  room.thrown = null;
}

/** -------------------- Socket handlers -------------------- */
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
      drawnBy: new Map(),
      thrown: null
    };
    rooms.set(code, room);

    room.players.set(socket.id, { id: socket.id, name });
    room.order.push(socket.id);
    room.scoreboard.set(name, 0);

    socket.join(code);
    broadcastRoom(room);
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
    broadcastRoom(room);
  });

  socket.on("room:leave", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    room.players.delete(socket.id);
    room.order = room.order.filter(id => id !== socket.id);
    room.hands.delete(socket.id);
    room.drawnBy.delete(socket.id);

    if (room.order.length === 0) {
      rooms.delete(code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.order[0];
    room.turnIndex = Math.min(room.turnIndex, room.order.length - 1);

    broadcastRoom(room);
  });

  socket.on("game:start", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId !== socket.id) return socket.emit("error:msg", "Only host can start");
    if (room.order.length < 2) return socket.emit("error:msg", "Need at least 2 players");
    startRound(room);
    broadcastRoom(room);
  });

  socket.on("turn:draw", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    if (room.drawnBy.has(socket.id)) return socket.emit("error:msg", "You already drew");

    ensureDeck(room);
    const drawn = room.deck.pop();
    if (!drawn) return socket.emit("error:msg", "Deck empty");

    room.drawnBy.set(socket.id, drawn);
    socket.emit("turn:drawn", drawn);
    broadcastRoom(room);
  });

  socket.on("turn:keepSwap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    if (!hand) return;

    // swap in; discard replaced
    const replaced = hand[slotIndex];
    if (replaced) room.discard.push(replaced.card);

    // kept card becomes faceUp (you saw it)
    hand[slotIndex] = { card: drawn, faceUp: true };
    room.drawnBy.delete(socket.id);

    // win condition
    if (countCards(hand) === 0) {
      endRoundSomeoneOut(room, socket.id);
      return broadcastRoom(room);
    }

    nextTurn(room);
    broadcastRoom(room);
  });

  socket.on("turn:throwDrawn", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    // open thrown window
    room.thrown = {
      card: drawn,
      openedAt: nowMs(),
      byId: socket.id,
      winner: null,          // { id, at } for first correct claim
      resolved: false
    };

    room.drawnBy.delete(socket.id);

    // throwing ends your turn immediately
    nextTurn(room);
    broadcastRoom(room);
  });

  socket.on("thrown:claim", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    const thrown = room.thrown;
    if (!thrown || thrown.resolved) return socket.emit("error:msg", "No active thrown card");

    const hand = room.hands.get(socket.id);
    const slot = hand?.[slotIndex];
    if (!slot) return socket.emit("error:msg", "Invalid slot");

    const tNow = nowMs();
    const matches = slot.card.rank === thrown.card.rank; // rank only

    if (!matches) {
      // wrong claim => penalty
      givePenaltyCard(room, socket.id);
      broadcastRoom(room);
      return;
    }

    // First correct winner
    if (!thrown.winner) {
      thrown.winner = { id: socket.id, at: tNow };

      // discard the player's selected card
      room.discard.push(slot.card);
      hand[slotIndex] = null;

      // thrown card goes to discard
      room.discard.push(thrown.card);

      // keep window open briefly to catch “second touch” penalties (0.2s)
      broadcastRoom(room);
      return;
    }

    // If not winner and within +200ms => penalty
    const diff = tNow - thrown.winner.at;
    if (socket.id !== thrown.winner.id && diff <= 200) {
      givePenaltyCard(room, socket.id);
      broadcastRoom(room);
      return;
    }

    // late correct claim => nothing
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue;

      room.players.delete(socket.id);
      room.order = room.order.filter(id => id !== socket.id);
      room.hands.delete(socket.id);
      room.drawnBy.delete(socket.id);

      if (room.order.length === 0) {
        rooms.delete(code);
        continue;
      }
      if (room.hostId === socket.id) room.hostId = room.order[0];
      room.turnIndex = Math.min(room.turnIndex, room.order.length - 1);

      broadcastRoom(room);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`KARGO server listening on :${PORT}`));
