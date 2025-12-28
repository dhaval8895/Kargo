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
    cards.push({ id: `${d}-JOKER-0-${Math.random()}`, rank: "JOKER", suit: "J" });
    cards.push({ id: `${d}-JOKER-1-${Math.random()}`, rank: "JOKER", suit: "J" });
  }
  return shuffle(cards);
}

function ensureDeck(room) {
  if (room.deck.length > 0) return;
  if (room.usedPile.length === 0) return;
  room.deck = shuffle(room.usedPile);
  room.usedPile = [];
}

function nowMs() {
  return Date.now();
}

/** -------------------- Rooms -------------------- */
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** -------------------- Used Window (race-claim) -------------------- */
function tickUsedWindow(room) {
  if (!room.usedWindow) return;

  const w = room.usedWindow;
  const t = nowMs();

  if (w.state === "open") {
    if (t - w.openedAt > 2000) {
      room.usedPile.push(w.card);
      room.usedWindow = null;
    }
    return;
  }

  if (w.state === "postWin") {
    if (t > w.postWinUntil) room.usedWindow = null;
  }
}

/** -------------------- Scoring -------------------- */
function isRedSuit(s) {
  return s === "H" || s === "D";
}
function cardValue(card) {
  if (!card) return 0;
  if (card.rank === "JOKER") return 0;
  if (card.rank === "A") return 1;
  if (/^\d+$/.test(card.rank)) return Number(card.rank);
  if (card.rank === "J") return 11;
  if (card.rank === "Q") return 12;
  if (card.rank === "K") return isRedSuit(card.suit) ? -1 : 13;
  return 0;
}
function handTotal(hand) {
  return (hand || []).filter(Boolean).reduce((sum, slot) => sum + cardValue(slot.card), 0);
}
function countCards(hand) {
  return (hand || []).filter(Boolean).length;
}

/** -------------------- Round end helpers -------------------- */
function resetToLobby(room) {
  room.phase = "lobby";
  room.deck = [];
  room.usedPile = [];
  room.usedWindow = null;
  room.hands = new Map();
  room.turnIndex = 0;
  room.drawnBy = new Map();
  room.ready = new Map();
  room.readyGateOpen = false;
  room.kargo = null;
  room.powerState = new Map();
  room.swapState = new Map();
}

function recordRoundBoard(room, deltas) {
  room.roundBoard = {
    endedAt: nowMs(),
    deltas,
  };
}

function endRoundAndScoreStandard(room, winnerPid, reason = "out") {
  const winnerName = room.players.get(winnerPid)?.name ?? "Unknown";

  const deltas = [];

  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const prev = room.scoreboard.get(name) ?? 0;

    let delta = 0;
    if (pid === winnerPid) delta = -20;
    else delta = handTotal(room.hands.get(pid) || []);

    room.scoreboard.set(name, prev + delta);
    deltas.push({ name, delta, totalAfter: prev + delta });
  }

  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const st = room.stats.get(name) ?? { roundsPlayed: 0, roundsWon: 0 };
    st.roundsPlayed += 1;
    if (pid === winnerPid) st.roundsWon += 1;
    room.stats.set(name, st);
  }

  room.lastRound = { winnerPid, winnerName, reason, endedAt: nowMs() };
  recordRoundBoard(room, deltas);
  resetToLobby(room);
}

function endRoundAndScoreKargoCompare(room) {
  const k = room.kargo;
  if (!k) return;

  const callerId = k.callerId;
  const callerName = room.players.get(callerId)?.name ?? k.callerName ?? "Caller";
  const callerTotal = handTotal(room.hands.get(callerId) || []);

  const totals = room.order.map((pid) => ({
    pid,
    name: room.players.get(pid)?.name ?? "Unknown",
    total: handTotal(room.hands.get(pid) || []),
  }));

  const breakers = totals.filter((x) => x.pid !== callerId && x.total <= callerTotal);

  const deltas = [];

  if (breakers.length > 0) {
    for (const t of totals) {
      const prev = room.scoreboard.get(t.name) ?? 0;
      let delta = 0;

      if (t.pid === callerId) delta = +40;
      else if (t.total <= callerTotal) delta = -10;
      else delta = 0;

      room.scoreboard.set(t.name, prev + delta);
      deltas.push({ name: t.name, delta, totalAfter: prev + delta });
    }

    for (const pid of room.order) {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const st = room.stats.get(name) ?? { roundsPlayed: 0, roundsWon: 0 };
      st.roundsPlayed += 1;
      room.stats.set(name, st);
    }

    room.lastRound = { winnerPid: callerId, winnerName: callerName, reason: "kargo_broken_by_total", endedAt: nowMs() };
    recordRoundBoard(room, deltas);
    resetToLobby(room);
    return;
  }

  // success
  for (const t of totals) {
    const prev = room.scoreboard.get(t.name) ?? 0;
    let delta = 0;

    if (t.pid === callerId) delta = -20;
    else delta = t.total;

    room.scoreboard.set(t.name, prev + delta);
    deltas.push({ name: t.name, delta, totalAfter: prev + delta });
  }

  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const st = room.stats.get(name) ?? { roundsPlayed: 0, roundsWon: 0 };
    st.roundsPlayed += 1;
    if (pid === callerId) st.roundsWon += 1;
    room.stats.set(name, st);
  }

  room.lastRound = { winnerPid: callerId, winnerName: callerName, reason: "kargo_success", endedAt: nowMs() };
  recordRoundBoard(room, deltas);
  resetToLobby(room);
}

function maybeEndIfOut(room, pid) {
  const hand = room.hands.get(pid) || [];
  if (countCards(hand) !== 0) return false;

  if (room.kargo && room.phase === "playing") {
    // break caller's kargo by going out
    const callerId = room.kargo.callerId;
    const callerName = room.players.get(callerId)?.name ?? room.kargo.callerName ?? "Caller";
    room.scoreboard.set(callerName, (room.scoreboard.get(callerName) ?? 0) + 40);
    endRoundAndScoreStandard(room, pid, "kargo_broken_by_out");
    return true;
  }

  endRoundAndScoreStandard(room, pid, "out");
  return true;
}

/** -------------------- Turn & KARGO flow -------------------- */
function startTurn(room, pid) {
  room.powerState.set(pid, { mode: "none" });
  room.swapState.set(pid, { mode: "none" });
}

function buildFinalTurns(room, callerId) {
  const order = room.order;
  const start = room.turnIndex;
  const afterCallerIndex = (start + 1) % order.length;
  const finalTurns = [];
  for (let i = 0; i < order.length; i++) {
    const pid = order[(afterCallerIndex + i) % order.length];
    if (pid !== callerId) finalTurns.push(pid);
  }
  return finalTurns;
}

function nextTurn(room) {
  if (room.kargo) {
    room.kargo.index += 1;
    if (room.kargo.index >= room.kargo.finalTurns.length) {
      endRoundAndScoreKargoCompare(room);
      return;
    }
    const nextPid = room.kargo.finalTurns[room.kargo.index];
    room.turnIndex = room.order.indexOf(nextPid);
    startTurn(room, nextPid);
    return;
  }

  room.turnIndex = (room.turnIndex + 1) % room.order.length;
  startTurn(room, room.order[room.turnIndex]);
}

function givePenaltyCard(room, pid) {
  ensureDeck(room);
  const c = room.deck.pop();
  if (!c) return;
  const hand = room.hands.get(pid) || [];
  hand.push({ card: c });
  room.hands.set(pid, hand);
}

/** -------------------- Ready gate -------------------- */
function dealHands(room) {
  const n = room.order.length;
  room.deckCount = n <= 5 ? 2 : 3;
  room.deck = makeDecks(room.deckCount);
  room.usedPile = [];
  room.usedWindow = null;

  room.hands = new Map();
  room.drawnBy = new Map();
  room.ready = new Map();
  room.powerState = new Map();
  room.swapState = new Map();

  for (const pid of room.order) {
    const c0 = room.deck.pop();
    const c1 = room.deck.pop();
    const c2 = room.deck.pop();
    const c3 = room.deck.pop();
    // NOTE: Slot 0 & 1 are bottom two. Slot 2 & 3 are top two.
    room.hands.set(pid, [{ card: c0 }, { card: c1 }, { card: c2 }, { card: c3 }]);
    room.ready.set(pid, false);
    room.powerState.set(pid, { mode: "none" });
    room.swapState.set(pid, { mode: "none" });
  }

  room.turnIndex = 0;
  room.readyGateOpen = true;
  room.phase = "ready";
}

function allReady(room) {
  for (const pid of room.order) if (!room.ready.get(pid)) return false;
  return true;
}

function closeReadyGate(room) {
  room.readyGateOpen = false;
  room.phase = "playing";
  startTurn(room, room.order[room.turnIndex]);
}

/** -------------------- Public room view -------------------- */
function publicRoomView(room, viewerId) {
  tickUsedWindow(room);

  const activeUsedCard = room.usedWindow?.card ?? null;
  const usedPileTop = room.usedPile.length ? room.usedPile[room.usedPile.length - 1] : null;

  const k = room.kargo
    ? {
        callerId: room.kargo.callerId,
        callerName: room.kargo.callerName,
        activeFinalPlayerId: room.kargo.finalTurns[room.kargo.index] ?? null,
      }
    : null;

  const readyState =
    room.phase === "ready"
      ? {
          readyGateOpen: true,
          mine: !!room.ready.get(viewerId),
          all: room.order.map((pid) => ({
            id: pid,
            name: room.players.get(pid)?.name ?? "Unknown",
            ready: !!room.ready.get(pid),
          })),
        }
      : null;

  const ps = room.powerState.get(viewerId) || { mode: "none" };
  const roundBoard = room.roundBoard ?? null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    turnPlayerId: room.order[room.turnIndex] ?? null,

    thrownCard: activeUsedCard,
    usedPileTop,
    usedPileCount: room.usedPile.length,

    lastRound: room.lastRound ?? null,
    roundBoard,
    kargo: k,
    readyState,
    powerState: ps,

    players: room.order.map((pid) => {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const hand = room.hands.get(pid) || [];

      // ALWAYS hidden during play. In READY: only show slot 0 & 1 to viewer if viewer isn't ready yet.
      const slots = hand.map((slot, idx) => {
        if (!slot) return null;

        if (room.phase === "ready" && pid === viewerId && !room.ready.get(viewerId)) {
          if (idx === 0 || idx === 1) return { faceUp: true, card: slot.card }; // bottom two revealed once
          return { faceUp: false, card: null };
        }

        return { faceUp: false, card: null };
      });

      return { id: pid, name, cardCount: countCards(hand), slots };
    }),

    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score })),
    stats: Array.from(room.stats.entries()).map(([name, st]) => ({ name, ...st })),
  };
}

function broadcastRoom(room) {
  tickUsedWindow(room);
  for (const pid of room.order) io.to(pid).emit("room:update", publicRoomView(room, pid));
}

/** -------------------- Power handling (single-use consumes drawn card) -------------------- */
function consumeDrawnAndEndTurn(room, pid) {
  const drawn = room.drawnBy.get(pid);
  if (!drawn) return;

  room.usedPile.push(drawn);
  room.drawnBy.delete(pid);
  room.powerState.set(pid, { mode: "none" });
  room.swapState.set(pid, { mode: "none" });

  nextTurn(room);
}

function actingGuard(room, socket) {
  if (room.phase !== "playing") return "Not in playing phase";

  if (room.kargo) {
    const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
    if (activeFinal !== socket.id) return "Not your final turn";
  } else {
    if (room.order[room.turnIndex] !== socket.id) return "Not your turn";
  }
  return null;
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
      stats: new Map(),
      phase: "lobby",

      deckCount: 2,
      deck: [],
      usedPile: [],
      usedWindow: null,

      hands: new Map(),
      turnIndex: 0,
      drawnBy: new Map(),

      ready: new Map(),
      readyGateOpen: false,

      kargo: null,
      powerState: new Map(),
      swapState: new Map(),

      lastRound: null,
      roundBoard: null,
    };

    rooms.set(code, room);

    room.players.set(socket.id, { id: socket.id, name });
    room.order.push(socket.id);
    room.scoreboard.set(name, 0);
    room.stats.set(name, { roundsPlayed: 0, roundsWon: 0 });

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
    if (!room.stats.has(name)) room.stats.set(name, { roundsPlayed: 0, roundsWon: 0 });

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
    room.ready.delete(socket.id);
    room.powerState.delete(socket.id);
    room.swapState.delete(socket.id);

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

    dealHands(room);
    broadcastRoom(room);
  });

  socket.on("game:ready", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "ready") return;
    if (!room.ready.has(socket.id)) return;

    room.ready.set(socket.id, true);

    if (allReady(room)) closeReadyGate(room);
    broadcastRoom(room);
  });

  // CALL KARGO: allowed even if you have a drawn card pending (we auto-discard it to used)
  socket.on("kargo:call", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.kargo) return socket.emit("error:msg", "KARGO already called");

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    // If caller has drawn but hasn't resolved, discard it into used pile first
    const drawn = room.drawnBy.get(socket.id);
    if (drawn) {
      room.usedPile.push(drawn);
      room.drawnBy.delete(socket.id);
    }

    const callerName = room.players.get(socket.id)?.name ?? "Caller";
    room.kargo = {
      callerId: socket.id,
      callerName,
      calledAt: nowMs(),
      finalTurns: buildFinalTurns(room, socket.id),
      index: -1,
    };

    nextTurn(room);
    broadcastRoom(room);
  });

  socket.on("turn:draw", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    if (room.drawnBy.has(socket.id)) return socket.emit("error:msg", "You already drew");

    ensureDeck(room);
    const drawn = room.deck.pop();
    if (!drawn) return socket.emit("error:msg", "Deck empty");

    room.drawnBy.set(socket.id, drawn);

    // clear any power state
    room.powerState.set(socket.id, { mode: "none" });
    room.swapState.set(socket.id, { mode: "none" });

    socket.emit("turn:drawn", drawn);
    broadcastRoom(room);
  });

  // NEW: discard drawn card to used pile (ends turn)
  socket.on("turn:discardDrawn", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "No drawn card to discard");

    room.usedPile.push(drawn);
    room.drawnBy.delete(socket.id);

    nextTurn(room);
    broadcastRoom(room);
  });

  // Tap-to-resolve draw:
  // - match rank: discard both
  // - else: swap
  socket.on("turn:resolveDrawTap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "No drawn card to resolve");

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[slotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    if (slot.card.rank === drawn.rank) {
      room.usedPile.push(drawn);
      room.usedPile.push(slot.card);
      hand[slotIndex] = null;
      room.drawnBy.delete(socket.id);

      if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

      nextTurn(room);
      broadcastRoom(room);
      return;
    }

    const replacedCard = slot.card;
    hand[slotIndex] = { card: drawn };
    room.drawnBy.delete(socket.id);

    if (room.usedWindow) room.usedPile.push(replacedCard);
    else room.usedWindow = { state: "open", openedAt: nowMs(), card: replacedCard };

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

    nextTurn(room);
    broadcastRoom(room);
  });

  /** -------------------- Power single-use entry -------------------- */
  socket.on("power:useOnce", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "You must have a drawn card");

    const r = drawn.rank;
    if (!["7", "8", "9", "10", "J", "Q"].includes(r)) return socket.emit("error:msg", "This drawn card has no power");

    // 7/8 = peek one of your cards only
    if (r === "7" || r === "8") {
      room.powerState.set(socket.id, { mode: "selfPeekPick", consumeAfter: true });
      broadcastRoom(room);
      return;
    }

    // 9/10 = peek one of opponent's cards only
    if (r === "9" || r === "10") {
      room.powerState.set(socket.id, { mode: "otherPeekPick", consumeAfter: true });
      broadcastRoom(room);
      return;
    }

    // J = unseen swap: pick YOUR card, then pick ANY opponent card → swap immediately → consume J → end turn
    if (r === "J") {
      room.powerState.set(socket.id, { mode: "jPickMyCard", consumeAfter: true, mySlotIndex: null });
      broadcastRoom(room);
      return;
    }

    // Q = seen swap: pick YOUR card, then pick opponent card to PEEK, then decide swap or not → consume Q → end
    if (r === "Q") {
      room.powerState.set(socket.id, { mode: "qPickMyCard", consumeAfter: true, mySlotIndex: null, target: null });
      broadcastRoom(room);
      return;
    }
  });

  socket.on("power:tapSelfCard", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "selfPeekPick") return socket.emit("error:msg", "Not in self peek mode");

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[slotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    socket.emit("power:result", { type: "peekSelf", card: slot.card });

    if (ps.consumeAfter) consumeDrawnAndEndTurn(room, socket.id);
    broadcastRoom(room);
  });

  socket.on("power:tapMyCardForSwap", ({ code, mySlotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "jPickMyCard") return socket.emit("error:msg", "Not in J select-my-card mode");

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[mySlotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    room.powerState.set(socket.id, { ...ps, mode: "jPickOpponentCard", mySlotIndex });
    broadcastRoom(room);
  });

  socket.on("power:tapMyCardForQ", ({ code, mySlotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "qPickMyCard") return socket.emit("error:msg", "Not in Q select-my-card mode");

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[mySlotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    room.powerState.set(socket.id, { ...ps, mode: "qPickOpponentCard", mySlotIndex });
    broadcastRoom(room);
  });

  socket.on("power:tapOtherCard", ({ code, otherPlayerId, otherSlotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const ps = room.powerState.get(socket.id) || { mode: "none" };

    // 9/10 peek other
    if (ps.mode === "otherPeekPick") {
      const otherHand = room.hands.get(otherPlayerId) || [];
      const otherSlot = otherHand[otherSlotIndex];
      if (!otherSlot) return socket.emit("error:msg", "Other slot empty");

      socket.emit("power:result", { type: "peekOther", card: otherSlot.card });

      if (ps.consumeAfter) consumeDrawnAndEndTurn(room, socket.id);
      broadcastRoom(room);
      return;
    }

    // J unseen swap
    if (ps.mode === "jPickOpponentCard") {
      const mySlotIndex = ps.mySlotIndex;
      if (mySlotIndex === null || mySlotIndex === undefined) return socket.emit("error:msg", "Select your card first");

      const myHand = room.hands.get(socket.id) || [];
      const otherHand = room.hands.get(otherPlayerId) || [];

      const mySlot = myHand[mySlotIndex];
      const otherSlot = otherHand[otherSlotIndex];

      if (!mySlot) return socket.emit("error:msg", "Your slot empty");
      if (!otherSlot) return socket.emit("error:msg", "Other slot empty");

      // swap immediately
      const tmp = mySlot.card;
      mySlot.card = otherSlot.card;
      otherSlot.card = tmp;

      // consume J and end turn
      consumeDrawnAndEndTurn(room, socket.id);
      broadcastRoom(room);
      return;
    }

    // Q seen swap: peek first, then decide swap or not
    if (ps.mode === "qPickOpponentCard") {
      const mySlotIndex = ps.mySlotIndex;
      if (mySlotIndex === null || mySlotIndex === undefined) return socket.emit("error:msg", "Select your card first");

      const otherHand = room.hands.get(otherPlayerId) || [];
      const otherSlot = otherHand[otherSlotIndex];
      if (!otherSlot) return socket.emit("error:msg", "Other slot empty");

      // send peek result and store target
      socket.emit("power:result", { type: "qPeekThenDecide", card: otherSlot.card });
      room.powerState.set(socket.id, {
        ...ps,
        mode: "qAwaitDecision",
        target: { otherPlayerId, otherSlotIndex },
      });
      broadcastRoom(room);
      return;
    }

    socket.emit("error:msg", "Not in a power mode that targets another card");
  });

  socket.on("power:qDecision", ({ code, accept }) => {
    const room = rooms.get(code);
    if (!room) return;

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "qAwaitDecision" || !ps.target) return socket.emit("error:msg", "No Q decision pending");

    if (accept) {
      const mySlotIndex = ps.mySlotIndex;
      const { otherPlayerId, otherSlotIndex } = ps.target;

      const myHand = room.hands.get(socket.id) || [];
      const otherHand = room.hands.get(otherPlayerId) || [];

      const mySlot = myHand[mySlotIndex];
      const otherSlot = otherHand[otherSlotIndex];

      if (!mySlot) return socket.emit("error:msg", "Your slot empty");
      if (!otherSlot) return socket.emit("error:msg", "Other slot empty");

      const tmp = mySlot.card;
      mySlot.card = otherSlot.card;
      otherSlot.card = tmp;
    }

    // consume Q and end turn either way
    consumeDrawnAndEndTurn(room, socket.id);
    broadcastRoom(room);
  });

  socket.on("used:claim", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    if (room.phase !== "playing") return;

    const w = room.usedWindow;
    if (!w) return socket.emit("error:msg", "No active used card");

    if (w.state === "postWin") {
      if (nowMs() <= w.postWinUntil) givePenaltyCard(room, socket.id);
      broadcastRoom(room);
      return;
    }

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[slotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    if (slot.card.rank !== w.card.rank) {
      givePenaltyCard(room, socket.id);
      broadcastRoom(room);
      return;
    }

    room.usedPile.push(slot.card);
    hand[slotIndex] = null;
    room.usedPile.push(w.card);

    room.usedWindow = { state: "postWin", postWinUntil: nowMs() + 200 };

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue;

      room.players.delete(socket.id);
      room.order = room.order.filter((id) => id !== socket.id);
      room.hands.delete(socket.id);
      room.drawnBy.delete(socket.id);
      room.ready.delete(socket.id);
      room.powerState.delete(socket.id);
      room.swapState.delete(socket.id);

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
