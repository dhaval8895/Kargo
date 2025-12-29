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

/* ---------------- Game state (simple baseline) ---------------- */
const rooms = new Map(); // code -> room

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  deck.push({ rank: "JOKER", suit: "J" });
  deck.push({ rank: "JOKER", suit: "J" });
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function makePlayer(id, name) {
  return {
    id,
    name,
    slots: [], // array of { faceUp: boolean, card: {rank,suit} } or null
    cardCount: 4,
  };
}

function publicRoom(room) {
  // send only what client expects; keep it plain
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase, // lobby | ready | playing
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      slots: p.slots,
      cardCount: p.cardCount,
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
    kargo: room.kargo, // null or { activeFinalPlayerId }
    readyState: room.readyState,
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

function dealInitial(room) {
  room.deck = makeDeck();
  for (const p of room.players) {
    p.slots = Array.from({ length: 4 }, () => ({ faceUp: false, card: null }));
    for (let i = 0; i < 4; i++) {
      const card = room.deck.pop();
      p.slots[i] = { faceUp: false, card };
    }
    // In "ready" phase, reveal slot 0 & 1 once (baseline behavior)
    p.slots[0].faceUp = true;
    p.slots[1].faceUp = true;
  }
  room.used = [];
  room.usedTop2 = [];
  room.usedCount = 0;

  room.powerState = { mode: "none" };
  room.turnPlayerId = room.players[0]?.id ?? null;
  room.turnStage = "needDraw";

  room.claim = { rank: null, state: null };

  room.scoreboard = room.players.map((p) => ({ name: p.name, score: 0 }));
  room.roundBoard = { deltas: [] };
  room.lastRound = null;
  room.kargo = null;

  room.readyState = { mine: false };
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
        hostId: socket.id,
        phase: "lobby",
        players: [makePlayer(socket.id, String(name || "Player").slice(0, 24))],
        deck: [],
        used: [],
        usedTop2: [],
        usedCount: 0,
        powerState: { mode: "none" },
        turnPlayerId: null,
        turnStage: "needDraw",
        claim: { rank: null, state: null },
        scoreboard: [],
        roundBoard: { deltas: [] },
        lastRound: null,
        kargo: null,
        readyState: { mine: false },
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

      if (room.players.some((p) => p.id === socket.id)) {
        socket.join(c);
        emitRoomUpdate(c);
        return;
      }

      // baseline: allow join only while lobby/ready (keep it simple)
      if (room.phase === "playing") throw new Error("Game already started");

      room.players.push(makePlayer(socket.id, String(name || "Player").slice(0, 24)));
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

      socket.leave(c);
      room.players = room.players.filter((p) => p.id !== socket.id);

      if (room.hostId === socket.id) {
        room.hostId = room.players[0]?.id ?? null;
      }
      if (room.turnPlayerId === socket.id) {
        room.turnPlayerId = room.players[0]?.id ?? null;
        room.turnStage = "needDraw";
      }

      if (!room.players.length) {
        rooms.delete(c);
        return;
      }

      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to leave room");
    }
  });

  socket.on("game:start", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.hostId !== socket.id) throw new Error("Only host can start");
      if (room.players.length < 2) throw new Error("Need at least 2 players");

      room.phase = "ready";
      dealInitial(room);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to start game");
    }
  });

  socket.on("game:ready", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "ready") return;

      // When someone clicks Ready, hide their slot 0/1 and move to playing if all clicked.
      // Baseline: treat "ready" as per-socket and advance when everyone has clicked at least once.
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

      const card = room.deck.pop();
      if (!card) throw new Error("Deck empty");

      room.drawn = card;
      room.turnStage = "hasDrawn";
      socket.emit("turn:drawn", card);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to draw");
    }
  });

  socket.on("turn:discardDrawn", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;

      pushUsed(room, room.drawn);
      room.drawn = null;
      room.turnStage = "awaitEnd";
      endClaim(room);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to discard");
    }
  });

  socket.on("turn:resolveDrawTap", ({ code, slotIndex }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      const idx = Number(slotIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= me.slots.length) return;

      // swap drawn into slot, discard old to used
      const old = me.slots[idx]?.card;
      const newCard = room.drawn;
      if (!newCard) return;

      me.slots[idx] = { faceUp: false, card: newCard };
      pushUsed(room, old);
      room.drawn = null;

      room.turnStage = "awaitEnd";
      endClaim(room);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to place card");
    }
  });

  socket.on("turn:end", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "awaitEnd") return;

      advanceTurn(room);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to end turn");
    }
  });

  // Powers / claims / kargo: baseline stubs so UI never crashes
  socket.on("power:useOnce", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;

      // baseline: no-op power, just return a safe payload
      room.powerState = { mode: "none" };
      socket.emit("power:result", { type: "peekSelf", card: { rank: "A", suit: "S" } });
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Power failed");
    }
  });

  socket.on("power:cancel", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      room.powerState = { mode: "none" };
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Cancel failed");
    }
  });

  socket.on("power:qDecision", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      room.powerState = { mode: "none" };
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Decision failed");
    }
  });

  socket.on("power:tapSelfCard", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapOtherCard", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapMyCardForJSwap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));
  socket.on("power:tapMyCardForQSwap", ({ code }) => emitRoomUpdate(String(code || "").toUpperCase().trim()));

  socket.on("used:claim", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      room.claim = { rank: null, state: null };
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Claim failed");
    }
  });

  socket.on("kargo:call", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      room.kargo = { activeFinalPlayerId: room.turnPlayerId };
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "KARGO failed");
    }
  });

  socket.on("disconnect", () => {
    // remove player from any rooms they were in
    for (const [code, room] of rooms.entries()) {
      const had = room.players.some((p) => p.id === socket.id);
      if (!had) continue;

      room.players = room.players.filter((p) => p.id !== socket.id);
      if (room.hostId === socket.id) room.hostId = room.players[0]?.id ?? null;
      if (room.turnPlayerId === socket.id) room.turnPlayerId = room.players[0]?.id ?? null;

      if (!room.players.length) rooms.delete(code);
      else emitRoomUpdate(code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`kargo-server listening on :${PORT}`);
});
