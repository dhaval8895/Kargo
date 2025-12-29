import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const PORT = process.env.PORT || 3001;
const ORIGIN = process.env.CORS_ORIGIN || "*";

const app = express();
app.use(cors({ origin: ORIGIN }));

app.get("/", (_req, res) => res.json({ ok: true, name: "kargo-server" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ORIGIN, methods: ["GET", "POST"] },
});

const rooms = new Map();

function randCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const cards = [];
  for (let d = 0; d < 2; d++) {
    for (const s of suits) for (const r of ranks) cards.push({ rank: r, suit: s });
    // joker support (optional)
    cards.push({ rank: "JOKER", suit: "X" });
    cards.push({ rank: "JOKER", suit: "X" });
  }
  // shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      slots: p.slots,
    })),
    turnPlayerId: room.turnPlayerId,
    turnStage: room.turnStage, // needDraw | hasDrawn | awaitEnd
    powerState: room.powerState, // { mode: "none", ... }
    usedTop2: room.usedTop2,
    usedCount: room.usedCount,
    claim: room.claim, // { rank, state }
    scoreboard: room.scoreboard,
    roundBoard: room.roundBoard,
    lastRound: room.lastRound,
    kargo: room.kargo, // null or { calledById, calledByName, activeFinalPlayerId }
    readyState: room.readyState,
    activityLog: room.activityLog || [],
  };
}

function emitRoomUpdate(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("room:update", publicRoom(room));
}

function ensureRoom(code) {
  const r = rooms.get(code);
  if (!r) throw new Error("Room not found");
  return r;
}

function playersName(room, id) {
  const p = room.players.find((x) => x.id === id);
  return p?.name || "Player";
}

function dealInitial(room) {
  room.deck = makeDeck();
  for (const p of room.players) {
    p.slots = Array.from({ length: 4 }, () => ({ faceUp: false, card: null }));
    for (let i = 0; i < 4; i++) {
      const card = room.deck.pop();
      p.slots[i] = { faceUp: false, card };
    }
    // In "ready" phase, reveal slot 0 & 1 once
    p.slots[0].faceUp = true;
    p.slots[1].faceUp = true;
  }
  room.used = [];
  room.usedTop2 = [];
  room.usedCount = 0;

  room.powerState = { mode: "none" };
  room.turnStage = "needDraw";
  room.drawn = null;

  room.claim = { rank: null, state: null };

  room.roundBoard = { deltas: [] };
  room.lastRound = null;
  room.kargo = null;

  room.readyState = { mine: false };
  room.activityLog = [];
}

function advanceTurn(room) {
  if (!room.players.length) return;
  const idx = room.players.findIndex((p) => p.id === room.turnPlayerId);
  const nextIdx = idx >= 0 ? (idx + 1) % room.players.length : 0;
  room.turnPlayerId = room.players[nextIdx].id;
  room.turnStage = "needDraw";
  room.powerState = { mode: "none" };
}

function pushUsed(room, card) {
  if (!card) return;
  room.used.push(card);
  room.usedCount = room.used.length;
  const top = room.used.slice(-2).reverse();
  room.usedTop2 = top;
}

function pushLog(room, msg) {
  room.activityLog = room.activityLog || [];
  room.activityLog.unshift({ ts: Date.now(), msg });
  if (room.activityLog.length > 12) room.activityLog = room.activityLog.slice(0, 12);
}

function endClaim(room) {
  room.claim = { rank: null, state: null };
}

/* ---------------- Socket handlers ---------------- */
io.on("connection", (socket) => {
  socket.on("room:create", ({ name }) => {
    try {
      const code = randCode();
      const room = {
        code,
        phase: "lobby",
        hostId: socket.id,
        players: [{ id: socket.id, name: String(name || "Player").slice(0, 18), slots: [] }],
        deck: [],
        used: [],
        usedTop2: [],
        usedCount: 0,
        drawn: null,
        powerState: { mode: "none" },
        turnPlayerId: null,
        turnStage: "needDraw",
        claim: { rank: null, state: null },
        scoreboard: [],
        roundBoard: { deltas: [] },
        lastRound: null,
        kargo: null,
        readyState: { mine: false },
        activityLog: [],
      };

      rooms.set(code, room);
      socket.join(code);
      emitRoomUpdate(code);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to create room");
    }
  });

  socket.on("room:join", ({ code, name }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "lobby") throw new Error("Game already started");

      if (room.players.some((p) => p.id === socket.id)) return;

      room.players.push({ id: socket.id, name: String(name || "Player").slice(0, 18), slots: [] });
      socket.join(c);

      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to join room");
    }
  });

  socket.on("room:leave", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = rooms.get(c);
      if (!room) return;

      room.players = room.players.filter((p) => p.id !== socket.id);
      socket.leave(c);

      if (!room.players.length) {
        rooms.delete(c);
        return;
      }
      if (room.hostId === socket.id) room.hostId = room.players[0]?.id ?? null;

      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to leave room");
    }
  });

  socket.on("game:start", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.hostId !== socket.id) return;
      if (room.phase !== "lobby") return;
      if (room.players.length < 2) throw new Error("Need at least 2 players");

      dealInitial(room);
      room.phase = "ready";
      pushLog(room, "Game started. Waiting for Ready.");
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to start");
    }
  });

  socket.on("game:ready", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "ready") return;

      room._ready = room._ready || new Set();
      room._ready.add(socket.id);

      // hide slot 0/1 for that player
      const me = room.players.find((p) => p.id === socket.id);
      if (me) {
        if (me.slots[0]) me.slots[0].faceUp = false;
        if (me.slots[1]) me.slots[1].faceUp = false;
      }

      if (room._ready.size >= room.players.length) {
        room.phase = "playing";
        room.turnPlayerId = room.players[0]?.id ?? null;
        room.turnStage = "needDraw";
        room.powerState = { mode: "none" };
        pushLog(room, `Playing started. ${playersName(room, room.turnPlayerId)} to draw.`);
      }

      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to ready");
    }
  });

  socket.on("turn:draw", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "needDraw") return;

      // New draw ends the previous claim window.
      endClaim(room);

      const card = room.deck.pop();
      if (!card) throw new Error("Deck empty");

      room.drawn = card;
      room.turnStage = "hasDrawn";
      socket.emit("turn:drawn", card);
      pushLog(room, `${playersName(room, socket.id)} drew a card.`);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to draw");
    }
  });

  socket.on("turn:discard", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;

      pushUsed(room, room.drawn);
      pushLog(room, `${playersName(room, socket.id)} discarded ${room.drawn.rank}${room.drawn.suit}.`);
      room.drawn = null;
      room.turnStage = "awaitEnd";
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to discard");
    }
  });

  // NOTE: This server file is your baseline plumbing. Game resolution happens in your existing client logic.
  socket.on("turn:resolveDrawTap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));

  // Power hooks (client-driven in your baseline)
  socket.on("power:useOnce", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:cancel", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:qDecision", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapSelfCard", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapOtherCard", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapMyCardForJSwap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapMyCardForQSwap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapOtherForJSwap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapOtherForQSwap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));

  // Claim window (baseline)
  socket.on("used:claim", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      room.claim = room.claim || { rank: null, state: null };
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Claim failed");
    }
  });

  socket.on("kargo:call", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn" && room.turnStage !== "awaitEnd") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      // Can't call Kargo with penalty cards (any filled slots beyond the initial 4)
      const hasPenaltyCards = me.slots.slice(4).some((s) => !!s?.card);
      if (hasPenaltyCards) {
        socket.emit("error:msg", "You can’t call Kargo with penalty cards.");
        return;
      }

      room.kargo = {
        calledById: socket.id,
        calledByName: me.name,
        activeFinalPlayerId: room.turnPlayerId,
      };
      pushLog(room, `${me.name} called Kargo! Finish last round.`);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "KARGO failed");
    }
  });

  socket.on("disconnect", () => {
    // no-op; players can leave explicitly
  });
});

server.listen(PORT, () => {
  console.log(`kargo-server listening on :${PORT}`);
});
