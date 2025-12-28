// server/index.js
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
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

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
    // 2 jokers per deck
    cards.push({ id: `${d}-JOKER-0-${Math.random()}`, rank: "JOKER", suit: "J" });
    cards.push({ id: `${d}-JOKER-1-${Math.random()}`, rank: "JOKER", suit: "J" });
  }
  return shuffle(cards);
}

function ensureDeck(room) {
  if (room.deck.length > 0) return;
  if (room.usedPile.length === 0) return; // reshuffle used pile into deck
  room.deck = shuffle(room.usedPile);
  room.usedPile = [];
}

function nowMs() {
  return Date.now();
}

function countCards(hand) {
  return (hand || []).filter(Boolean).length;
}

/** -------------------- Rooms -------------------- */
const rooms = new Map(); // code -> room

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function startTurn(room, pid) {
  room.turnFlags.set(pid, { keptDrawnThisTurn: false });
}

function canSeenPairDiscard(room, pid) {
  const hand = room.hands.get(pid) || [];
  const a = hand[0]?.card;
  const b = hand[1]?.card;
  if (!a || !b) return false;
  return a.rank === b.rank;
}

function publicRoomView(room, viewerId) {
  const activeUsedCard = room.usedWindow && !room.usedWindow.resolved ? room.usedWindow.card : null;

  const viewerFlags = room.turnFlags.get(viewerId) || { keptDrawnThisTurn: false };
  const isMyTurn = room.order[room.turnIndex] === viewerId;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    deckRemaining: room.deck.length,
    turnPlayerId: room.order[room.turnIndex] ?? null,

    // keeping old key name so frontend doesn't break (you can rename later)
    thrownCard: activeUsedCard,

    viewer: {
      keptDrawnThisTurn: !!viewerFlags.keptDrawnThisTurn,
      canDiscardSeenPair: isMyTurn && !!viewerFlags.keptDrawnThisTurn && canSeenPairDiscard(room, viewerId),
    },

    players: room.order.map((pid) => {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const hand = room.hands.get(pid) || [];
      const slots = hand.map((slot) => {
        if (!slot) return null;
        if (pid === viewerId) {
          return { faceUp: !!slot.faceUp, card: slot.faceUp ? slot.card : null };
        }
        return { faceUp: false, card: null };
      });
      return { id: pid, name, cardCount: countCards(hand), slots };
    }),

    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score })),
  };
}

function broadcastRoom(room) {
  // Used-card claim window expires after 2 seconds -> card becomes used pile
  if (room.usedWindow && !room.usedWindow.resolved) {
    const age = nowMs() - room.usedWindow.openedAt;
    if (age > 2000) {
      room.usedPile.push(room.usedWindow.card);
      room.usedWindow.resolved = true;
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
  room.usedPile = []; // "used cards" pile (was discard)

  room.hands = new Map();
  room.turnIndex = 0;
  room.drawnBy = new Map();
  room.phase = "playing";

  // usedWindow is the active face-up card that players can race-claim
  room.usedWindow = null;

  room.turnFlags = new Map();
  for (const pid of room.order) room.turnFlags.set(pid, { keptDrawnThisTurn: false });

  for (const pid of room.order) {
    const c0 = room.deck.pop();
    const c1 = room.deck.pop();
    const c2 = room.deck.pop();
    const c3 = room.deck.pop();

    room.hands.set(pid, [
      { card: c0, faceUp: true },
      { card: c1, faceUp: true },
      { card: c2, faceUp: false },
      { card: c3, faceUp: false },
    ]);
  }

  startTurn(room, room.order[room.turnIndex]);
}

function nextTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.order.length;
  startTurn(room, room.order[room.turnIndex]);
}

function givePenaltyCard(room, pid) {
  ensureDeck(room);
  const c = room.deck.pop();
  if (!c) return;
  const hand = room.hands.get(pid) || [];
  hand.push({ card: c, faceUp: false });
  room.hands.set(pid, hand);
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
      usedPile: [],

      hands: new Map(),
      turnIndex: 0,
      drawnBy: new Map(),
      usedWindow: null,

      turnFlags: new Map(),
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
    room.order = room.order.filter((id) => id !== socket.id);
    room.hands.delete(socket.id);
    room.drawnBy.delete(socket.id);
    room.turnFlags.delete(socket.id);

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

  /**
   * KEEP -> SLOT:
   * - drawn card goes into the chosen slot
   * - the replaced slotted card becomes the ACTIVE used card (race-claim window)
   * - if a used card window is already active, replaced card goes to used pile
   */
  socket.on("turn:keepSwap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    if (!hand) return;

    const replaced = hand[slotIndex]; // card currently in that slot (may be null)

    // Put drawn in the slot (kept card becomes faceUp because you saw it)
    hand[slotIndex] = { card: drawn, faceUp: true };
    room.drawnBy.delete(socket.id);

    // Mark you kept a card this turn (enables "discard seen pair" rule, etc.)
    room.turnFlags.set(socket.id, { keptDrawnThisTurn: true });

    // The replaced card becomes the "used card" window (claim race)
    if (replaced) {
      if (room.usedWindow && !room.usedWindow.resolved) {
        // Can't overwrite an active window -> send replaced to used pile
        room.usedPile.push(replaced.card);
      } else {
        room.usedWindow = {
          card: replaced.card,
          openedAt: nowMs(),
          byId: socket.id,
          winner: null, // { id, at }
          resolved: false,
        };
      }
    }

    // IMPORTANT: keeping does NOT end your turn automatically in this build.
    // You can discard seen pair (if eligible) or click "End turn".
    broadcastRoom(room);
  });

  // Discard drawn + matching rank in any slot (any suit/color) — ends turn
  socket.on("turn:discardDrawnMatch", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    const slot = hand?.[slotIndex];
    if (!slot) return socket.emit("error:msg", "Invalid slot");

    if (slot.card.rank !== drawn.rank) {
      return socket.emit("error:msg", "That slot does not match the drawn rank");
    }

    // Both become used cards (go to usedPile)
    room.usedPile.push(drawn);
    room.usedPile.push(slot.card);

    hand[slotIndex] = null;
    room.drawnBy.delete(socket.id);

    nextTurn(room);
    broadcastRoom(room);
  });

  // Discard seen pair (slots 0 & 1) AFTER keeping this turn — ends turn
  socket.on("turn:discardSeenPair", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const flags = room.turnFlags.get(socket.id) || { keptDrawnThisTurn: false };
    if (!flags.keptDrawnThisTurn) {
      return socket.emit("error:msg", "You must keep the drawn card to discard a seen pair");
    }

    const hand = room.hands.get(socket.id) || [];
    const a = hand[0];
    const b = hand[1];
    if (!a || !b) return socket.emit("error:msg", "Seen slots are empty");
    if (a.card.rank !== b.card.rank) return socket.emit("error:msg", "Seen pair ranks do not match");

    room.usedPile.push(a.card);
    room.usedPile.push(b.card);
    hand[0] = null;
    hand[1] = null;

    nextTurn(room);
    broadcastRoom(room);
  });

  // End turn (only allowed if you don't still have an unresolved drawn card)
  socket.on("turn:end", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    if (room.drawnBy.has(socket.id)) return socket.emit("error:msg", "Resolve your drawn card first");

    nextTurn(room);
    broadcastRoom(room);
  });

  /**
   * THROW DRAWN (do NOT keep):
   * - drawn card becomes the active used card window (race-claim window)
   * - ends turn immediately
   */
  socket.on("turn:throwDrawn", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    room.drawnBy.delete(socket.id);

    if (room.usedWindow && !room.usedWindow.resolved) {
      // active window exists -> can't overwrite, so just put it into used pile
      room.usedPile.push(drawn);
    } else {
      room.usedWindow = {
        card: drawn,
        openedAt: nowMs(),
        byId: socket.id,
        winner: null, // { id, at }
        resolved: false,
      };
    }

    nextTurn(room);
    broadcastRoom(room);
  });

  /**
   * CLAIM USED CARD WINDOW:
   * - if wrong rank: +1 penalty card from unused deck, used card stays active
   * - if first correct: claimant discards their matching card (to usedPile),
   *   used card goes to usedPile, window stays open briefly for +0.2s penalty
   * - if another correct within +200ms (0.2s): +1 penalty card
   */
  socket.on("thrown:claim", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    const used = room.usedWindow;
    if (!used || used.resolved) return socket.emit("error:msg", "No active used card");

    const hand = room.hands.get(socket.id);
    const slot = hand?.[slotIndex];
    if (!slot) return socket.emit("error:msg", "Invalid slot");

    const tNow = nowMs();
    const matches = slot.card.rank === used.card.rank;

    if (!matches) {
      // Wrong claim: penalty card from unused deck; used card remains active
      givePenaltyCard(room, socket.id);
      broadcastRoom(room);
      return;
    }

    if (!used.winner) {
      used.winner = { id: socket.id, at: tNow };

      // claimant discards their selected card
      room.usedPile.push(slot.card);
      hand[slotIndex] = null;

      // used card goes to used pile
      room.usedPile.push(used.card);

      // keep window active briefly to catch +0.2s penalties (we do NOT immediately resolve)
      broadcastRoom(room);
      return;
    }

    const diff = tNow - used.winner.at;
    if (socket.id !== used.winner.id && diff <= 200) {
      // second touch penalty (within +0.2s of winner)
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
      room.order = room.order.filter((id) => id !== socket.id);
      room.hands.delete(socket.id);
      room.drawnBy.delete(socket.id);
      room.turnFlags.delete(socket.id);

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
