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

/* ---------------- In-memory room state ---------------- */
const rooms = new Map(); // code -> room

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  deck.push({ rank: "JOKER", suit: "J" });
  deck.push({ rank: "JOKER", suit: "J" });
  return shuffle(deck);
}

function makePlayer(id, name) {
  return {
    id,
    name,
    slots: [], // [{faceUp:boolean, card:{rank,suit} | null}]
    cardCount: 4,
  };
}

function ensureRoom(code) {
  const r = rooms.get(code);
  if (!r) throw new Error("Room not found");
  return r;
}

function top2(room) {
  return room.used.slice(-2).reverse();
}

function endClaim(room) {
  room.claim = { rank: null, state: null, claimedBy: null, claimedAt: null };
}

function log(room, msg) {
  room.activityLog = room.activityLog || [];
  room.activityLog.unshift({ t: Date.now(), msg });
  if (room.activityLog.length > 12) room.activityLog = room.activityLog.slice(0, 12);
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase, // lobby | ready | playing
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      slots: p.slots, // presence known; faces hidden unless faceUp (self only)
      cardCount: p.cardCount,
    })),
    turnPlayerId: room.turnPlayerId,
    turnStage: room.turnStage, // needDraw | hasDrawn | awaitEnd
    powerState: room.powerState, // { mode, ... }
    usedTop2: room.usedTop2,
    usedCount: room.usedCount,
    claim: room.claim, // { rank, state, claimedBy, claimedAt }
    scoreboard: room.scoreboard,
    roundBoard: room.roundBoard,
    lastRound: room.lastRound,
    kargo: room.kargo, // null or { callerId, callerName, activeFinalPlayerId }
    readyState: room.readyState,
    activityLog: room.activityLog || [],
  };
}

function emitRoomUpdate(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("room:update", publicRoom(room));
}

function reshuffleIfNeeded(room) {
  if (room.deck.length > 0) return;
  if (!room.used.length) throw new Error("Deck empty");
  // reshuffle used pile back into deck, clear used
  room.deck = shuffle([...room.used]);
  room.used = [];
  room.usedCount = 0;
  room.usedTop2 = [];
  endClaim(room);
}

function drawOne(room) {
  reshuffleIfNeeded(room);
  const c = room.deck.pop();
  if (!c) throw new Error("Deck empty");
  return c;
}

function setUsed(room, card) {
  if (!card) return;
  room.used.push(card);
  room.usedCount = room.used.length;
  room.usedTop2 = top2(room);

  // open claim window for this rank (ends ONLY when next player draws)
  room.claim = {
    rank: card.rank,
    state: "open", // open | won
    claimedBy: null,
    claimedAt: null,
  };
}

function dealInitial(room) {
  room.deck = makeDeck();
  room.used = [];
  room.usedTop2 = [];
  room.usedCount = 0;

  for (const p of room.players) {
    p.slots = Array.from({ length: 4 }, () => ({ faceUp: false, card: null }));
    for (let i = 0; i < 4; i++) {
      p.slots[i] = { faceUp: false, card: drawOne(room) };
    }
    // show bottom two once in ready phase (slot 0/1)
    p.slots[0].faceUp = true;
    p.slots[1].faceUp = true;
    p.cardCount = p.slots.length;
  }

  room.powerState = { mode: "none" };
  room.turnPlayerId = room.players[0]?.id ?? null;
  room.turnStage = "needDraw";
  room.drawn = null;

  endClaim(room);

  room.scoreboard = room.players.map((p) => ({ name: p.name, score: 0 }));
  room.roundBoard = { deltas: [] };
  room.lastRound = null;

  room.kargo = null;
  room.readyState = { mine: false };

  room.activityLog = [];
  log(room, "Game started. Peek your bottom two once, then press Ready.");
}

function advanceTurn(room) {
  if (!room.players.length) return;
  const idx = room.players.findIndex((p) => p.id === room.turnPlayerId);
  const nextIdx = idx >= 0 ? (idx + 1) % room.players.length : 0;
  room.turnPlayerId = room.players[nextIdx].id;
  room.turnStage = "needDraw";
  room.powerState = { mode: "none" };
  room.drawn = null;
  // claim persists until next draw (rule) -> do not clear here
}

function firstEmptySlotIndex(player) {
  return player.slots.findIndex((s) => !s?.card);
}

function givePenalty(room, player, reasonMsg) {
  const card = drawOne(room);
  const emptyIdx = firstEmptySlotIndex(player);
  if (emptyIdx >= 0) {
    player.slots[emptyIdx] = { faceUp: false, card };
  } else {
    player.slots.push({ faceUp: false, card });
  }
  player.cardCount = player.slots.length;
  if (reasonMsg) log(room, reasonMsg);
}

function isPowerCard(card) {
  return !!card && ["7", "8", "9", "10", "J", "Q"].includes(card.rank);
}

function blockIfKargoProtected(room, targetPlayerId) {
  const callerId = room.kargo?.callerId;
  return !!callerId && targetPlayerId === callerId;
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
        drawn: null,
        claim: { rank: null, state: null, claimedBy: null, claimedAt: null },
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

      if (room.players.some((p) => p.id === socket.id)) {
        socket.join(c);
        emitRoomUpdate(c);
        return;
      }

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

      if (room.hostId === socket.id) room.hostId = room.players[0]?.id ?? null;
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
      room._ready = new Set();
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

      room._ready = room._ready || new Set();
      room._ready.add(socket.id);

      // hide slot 0/1 for that player (one-time peek)
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
        log(room, "All players ready. Game on.");
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

      // claim ends ONLY when next player draws
      endClaim(room);

      const card = drawOne(room);
      room.drawn = card;
      room.turnStage = "hasDrawn";
      room.powerState = { mode: "none" };

      const turnP = room.players.find((p) => p.id === room.turnPlayerId);
      log(room, `${turnP?.name || "Player"} drew a card.`);
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

      const card = room.drawn;
      if (!card) return;

      setUsed(room, card);
      room.drawn = null;
      room.turnStage = "awaitEnd";
      room.powerState = { mode: "none" };

      const turnP = room.players.find((p) => p.id === socket.id);
      log(room, `${turnP?.name || "Player"} discarded ${card.rank}.`);
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
      if (room.powerState?.mode !== "none") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      const idx = Number(slotIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= me.slots.length) return;

      const newCard = room.drawn;
      if (!newCard) return;

      const old = me.slots[idx]?.card || null;

      me.slots[idx] = { faceUp: false, card: newCard };
      me.cardCount = me.slots.length;

      if (old) setUsed(room, old);

      room.drawn = null;
      room.turnStage = "awaitEnd";

      log(room, `${me.name} placed a card into slot ${idx}.`);
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

      const me = room.players.find((p) => p.id === socket.id);
      log(room, `${me?.name || "Player"} ended their turn.`);
      advanceTurn(room);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Failed to end turn");
    }
  });

  /* ---------------- Claims ---------------- */
  socket.on("used:claim", ({ code, slotIndex }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;

      const claimer = room.players.find((p) => p.id === socket.id);
      if (!claimer) return;

      const idx = Number(slotIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= claimer.slots.length) return;

      const claim = room.claim;
      if (!claim?.rank || claim.state === null) return;

      const myCard = claimer.slots[idx]?.card;
      if (!myCard) {
        socket.emit("error:msg", "Empty slot.");
        return;
      }

      // already won: enforce 0.2s penalty window
      if (claim.state === "won") {
        const now = Date.now();
        if (claim.claimedAt && now - claim.claimedAt <= 200 && claim.claimedBy !== socket.id) {
          givePenalty(room, claimer, `${claimer.name} was too slow (+1 card).`);
          emitRoomUpdate(c);
        }
        return;
      }

      // open claim: must match rank
      if (myCard.rank !== claim.rank) {
        givePenalty(room, claimer, `${claimer.name} claimed wrong card (+1 card).`);
        emitRoomUpdate(c);
        return;
      }

      // successful claim: remove from hand
      claimer.slots[idx] = { faceUp: false, card: null };
      claimer.cardCount = claimer.slots.length;

      // add their card into used (so top shows two cards sometimes)
      room.used.push(myCard);
      room.usedCount = room.used.length;
      room.usedTop2 = top2(room);

      // lock claim as won
      room.claim = {
        rank: claim.rank,
        state: "won",
        claimedBy: socket.id,
        claimedAt: Date.now(),
      };

      log(room, `${claimer.name} claimed ${claim.rank}.`);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Claim failed");
    }
  });

  /* ---------------- Kargo ---------------- */
  socket.on("kargo:call", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.kargo) return;

      const caller = room.players.find((p) => p.id === socket.id);
      if (!caller) return;

      // Rule: cannot call Kargo if you have penalty cards (interpreted as extra slots >4 holding cards)
      const hasPenaltySlots = caller.slots.length > 4 && caller.slots.slice(4).some((s) => s?.card);
      if (hasPenaltySlots) {
        socket.emit("error:msg", "You can't call Kargo with penalty cards.");
        return;
      }

      room.kargo = { callerId: socket.id, callerName: caller.name, activeFinalPlayerId: room.turnPlayerId };
      log(room, `${caller.name} called KARGO! Finish the last round.`);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "KARGO failed");
    }
  });

  /* ---------------- Powers ---------------- */
  socket.on("power:useOnce", ({ code }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;
      if (!room.drawn) return;
      if (!isPowerCard(room.drawn)) return;

      const card = room.drawn;
      if (card.rank === "7" || card.rank === "8") {
        room.powerState = { mode: "selfPeekPick" };
        return emitRoomUpdate(c);
      }
      if (card.rank === "9" || card.rank === "10") {
        room.powerState = { mode: "otherPeekPick" };
        return emitRoomUpdate(c);
      }
      if (card.rank === "J") {
        room.powerState = { mode: "jPickOpponentCard", j: { otherPlayerId: null, otherSlotIndex: null } };
        return emitRoomUpdate(c);
      }
      if (card.rank === "Q") {
        room.powerState = { mode: "qPickOpponentCard", q: { otherPlayerId: null, otherSlotIndex: null } };
        return emitRoomUpdate(c);
      }
    } catch (e) {
      socket.emit("error:msg", e?.message || "Power failed");
    }
  });

  socket.on("power:tapSelfCard", ({ code, slotIndex }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;
      if (!room.drawn) return;
      if (room.powerState?.mode !== "selfPeekPick") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      const idx = Number(slotIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= me.slots.length) return;

      const myCard = me.slots[idx]?.card;
      if (!myCard) {
        socket.emit("error:msg", "Empty slot.");
        return;
      }

      socket.emit("power:result", { type: "peekSelf", card: myCard });

      const usedPower = room.drawn;
      room.drawn = null;
      room.turnStage = "awaitEnd";
      room.powerState = { mode: "none" };

      setUsed(room, usedPower);
      log(room, `${me.name} used a ${usedPower.rank} power.`);
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Power failed");
    }
  });

  socket.on("power:tapOtherCard", ({ code, otherPlayerId, otherSlotIndex }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;
      if (!room.drawn) return;

      const mode = room.powerState?.mode;
      if (!["otherPeekPick", "jPickOpponentCard", "qPickOpponentCard"].includes(mode)) return;

      // Kargo protection: cannot peek/swap caller
      if (blockIfKargoProtected(room, otherPlayerId)) {
        socket.emit("error:msg", "That player's cards are protected after Kargo.");
        return;
      }

      const other = room.players.find((p) => p.id === otherPlayerId);
      if (!other) return;

      const idx = Number(otherSlotIndex);
      if (!Number.isFinite(idx) || idx < 0 || idx >= other.slots.length) return;

      const otherCard = other.slots[idx]?.card;
      if (!otherCard) {
        socket.emit("error:msg", "Empty slot.");
        return;
      }

      const me = room.players.find((p) => p.id === socket.id);

      if (mode === "otherPeekPick") {
        socket.emit("power:result", { type: "peekOther", card: otherCard });

        const usedPower = room.drawn;
        room.drawn = null;
        room.turnStage = "awaitEnd";
        room.powerState = { mode: "none" };
        setUsed(room, usedPower);
        log(room, `${me?.name || "Player"} used a ${usedPower.rank} power.`);
        emitRoomUpdate(c);
        return;
      }

      if (mode === "jPickOpponentCard") {
        room.powerState = { mode: "jPickMyCard", j: { otherPlayerId, otherSlotIndex: idx } };
        emitRoomUpdate(c);
        return;
      }

      if (mode === "qPickOpponentCard") {
        room.powerState = { mode: "qAwaitDecision", q: { otherPlayerId, otherSlotIndex: idx } };
        socket.emit("power:result", { type: "qPeekThenDecide", card: otherCard });
        emitRoomUpdate(c);
        return;
      }
    } catch (e) {
      socket.emit("error:msg", e?.message || "Power failed");
    }
  });

  socket.on("power:qDecision", ({ code, accept }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;
      if (room.powerState?.mode !== "qAwaitDecision") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      if (!accept) {
        const usedPower = room.drawn;
        room.drawn = null;
        room.turnStage = "awaitEnd";
        room.powerState = { mode: "none" };
        setUsed(room, usedPower);
        log(room, `${me.name} declined Q swap.`);
        emitRoomUpdate(c);
        return;
      }

      room.powerState = { mode: "qPickMyCard", q: room.powerState.q };
      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Decision failed");
    }
  });

  socket.on("power:tapMyCardForJSwap", ({ code, mySlotIndex }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;
      if (room.powerState?.mode !== "jPickMyCard") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      const j = room.powerState.j;
      const other = room.players.find((p) => p.id === j.otherPlayerId);
      if (!other) return;

      const myIdx = Number(mySlotIndex);
      if (!Number.isFinite(myIdx) || myIdx < 0 || myIdx >= me.slots.length) return;

      const otherIdx = Number(j.otherSlotIndex);
      if (!Number.isFinite(otherIdx) || otherIdx < 0 || otherIdx >= other.slots.length) return;

      const myCard = me.slots[myIdx]?.card;
      const otherCard = other.slots[otherIdx]?.card;
      if (!myCard || !otherCard) {
        socket.emit("error:msg", "Empty card slot.");
        return;
      }

      me.slots[myIdx] = { faceUp: false, card: otherCard };
      other.slots[otherIdx] = { faceUp: false, card: myCard };

      const usedPower = room.drawn;
      room.drawn = null;
      room.turnStage = "awaitEnd";
      room.powerState = { mode: "none" };
      setUsed(room, usedPower);

      // J: activity log only “A swapped with B” (no slots, no cards)
      socket.emit("swap:notice", { kind: "J", withPlayer: other.name, message: `Swapped with ${other.name}` });
      log(room, `${me.name} swapped with ${other.name} (J).`);

      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "J swap failed");
    }
  });

  socket.on("power:tapMyCardForQSwap", ({ code, mySlotIndex }) => {
    try {
      const c = String(code || "").toUpperCase().trim();
      const room = ensureRoom(c);
      if (room.phase !== "playing") return;
      if (room.turnPlayerId !== socket.id) return;
      if (room.turnStage !== "hasDrawn") return;
      if (room.powerState?.mode !== "qPickMyCard") return;

      const me = room.players.find((p) => p.id === socket.id);
      if (!me) return;

      const q = room.powerState.q;
      const other = room.players.find((p) => p.id === q.otherPlayerId);
      if (!other) return;

      const myIdx = Number(mySlotIndex);
      if (!Number.isFinite(myIdx) || myIdx < 0 || myIdx >= me.slots.length) return;

      const otherIdx = Number(q.otherSlotIndex);
      if (!Number.isFinite(otherIdx) || otherIdx < 0 || otherIdx >= other.slots.length) return;

      const myCard = me.slots[myIdx]?.card;
      const otherCard = other.slots[otherIdx]?.card;
      if (!myCard || !otherCard) {
        socket.emit("error:msg", "Empty card slot.");
        return;
      }

      me.slots[myIdx] = { faceUp: false, card: otherCard };
      other.slots[otherIdx] = { faceUp: false, card: myCard };

      const usedPower = room.drawn;
      room.drawn = null;
      room.turnStage = "awaitEnd";
      room.powerState = { mode: "none" };
      setUsed(room, usedPower);

      // Q: can show slot numbers swapped but NEVER card faces
      socket.emit("swap:notice", {
        kind: "Q",
        withPlayer: other.name,
        message: `Swapped with ${other.name} (Q)`,
        mySlot: myIdx,
        otherSlot: otherIdx,
      });
      log(room, `${me.name} swapped with ${other.name} (Q).`);

      emitRoomUpdate(c);
    } catch (e) {
      socket.emit("error:msg", e?.message || "Q swap failed");
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

  socket.on("disconnect", () => {
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
