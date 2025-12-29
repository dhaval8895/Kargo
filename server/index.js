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

/* -------------------- Helpers -------------------- */
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
function nowMs() {
  return Date.now();
}

function ensureDeck(room) {
  if (room.deck.length > 0) return;
  if (room.usedPile.length === 0) return;
  room.deck = shuffle(room.usedPile);
  room.usedPile = [];
}

function occIndices(hand) {
  const out = [];
  for (let i = 0; i < (hand || []).length; i++) if (hand[i]?.card) out.push(i);
  return out;
}
function findNextOccupied(hand, startIdx = 0) {
  for (let i = startIdx; i < hand.length; i++) if (hand[i]?.card) return i;
  return null;
}

/* -------------------- Activity Log -------------------- */
function pushLog(room, msg) {
  room.activityLog.unshift({ t: nowMs(), msg });
  if (room.activityLog.length > 12) room.activityLog = room.activityLog.slice(0, 12);
}

/* -------------------- Rooms -------------------- */
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* -------------------- Claim -------------------- */
function openClaim(room, rank) {
  room.claim = { rank, state: "open", winnerId: null, winAt: null };
}

/* -------------------- Round end/scoring -------------------- */
function snapshotHands(room) {
  const snap = {};
  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const hand = room.hands.get(pid) || [];
    snap[name] = hand.map((s) => (s?.card ? { rank: s.card.rank, suit: s.card.suit } : null));
  }
  return snap;
}

function recordRoundBoard(room, deltas) {
  room.roundBoard = { endedAt: nowMs(), deltas };
}

function resetToLobby(room) {
  room.phase = "lobby";
  room.deck = [];
  room.usedPile = [];
  room.claim = null;

  room.hands = new Map();
  room.turnIndex = 0;
  room.drawnBy = new Map();
  room.turnStageBy = new Map();
  room.ready = new Map();

  room.kargo = null;
  room.powerState = new Map();

  room.lastRound = room.lastRound || null;
  room.roundBoard = room.roundBoard || null;

  room.activityLog = [];
}

function endRoundAndScoreStandard(room, winnerPid, reason = "out") {
  const winnerName = room.players.get(winnerPid)?.name ?? "Unknown";
  const reveal = snapshotHands(room);

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

  room.lastRound = { winnerPid, winnerName, reason, endedAt: nowMs(), reveal };
  recordRoundBoard(room, deltas);
  resetToLobby(room);
}

function endRoundAndScoreKargoCompare(room) {
  const k = room.kargo;
  if (!k) return;

  const reveal = snapshotHands(room);
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

    room.lastRound = {
      winnerPid: callerId,
      winnerName: callerName,
      reason: "kargo_broken_by_total",
      endedAt: nowMs(),
      reveal,
      kargoCallerTotal: callerTotal,
    };
    recordRoundBoard(room, deltas);
    resetToLobby(room);
    return;
  }

  for (const t of totals) {
    const prev = room.scoreboard.get(t.name) ?? 0;
    const delta = t.pid === callerId ? -20 : t.total;
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

  room.lastRound = {
    winnerPid: callerId,
    winnerName: callerName,
    reason: "kargo_success",
    endedAt: nowMs(),
    reveal,
    kargoCallerTotal: callerTotal,
  };
  recordRoundBoard(room, deltas);
  resetToLobby(room);
}

function maybeEndIfOut(room, pid) {
  const hand = room.hands.get(pid) || [];
  if (countCards(hand) !== 0) return false;

  if (room.kargo && room.phase === "playing") {
    const callerId = room.kargo.callerId;
    const callerName = room.players.get(callerId)?.name ?? room.kargo.callerName ?? "Caller";
    room.scoreboard.set(callerName, (room.scoreboard.get(callerName) ?? 0) + 40);
    endRoundAndScoreStandard(room, pid, "kargo_broken_by_out");
    return true;
  }

  endRoundAndScoreStandard(room, pid, "out");
  return true;
}

/* -------------------- Turn / Kargo flow -------------------- */
function startTurn(room, pid) {
  room.turnStageBy.set(pid, "needDraw");
  room.powerState.set(pid, { mode: "none" });
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
  const prevPid = room.order[room.turnIndex];
  if (prevPid) room.turnStageBy.set(prevPid, "needDraw");

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

function givePenaltyCard(room, pid) {
  ensureDeck(room);
  const c = room.deck.pop();
  if (!c) return;
  const hand = room.hands.get(pid) || [];
  hand.push({ card: c });
  room.hands.set(pid, hand);

  const name = room.players.get(pid)?.name ?? "Unknown";
  pushLog(room, `${name} got +1 penalty card`);
}

function consumeDrawnToUsed(room, pid, { openClaimWithRank = true } = {}) {
  const drawn = room.drawnBy.get(pid);
  if (!drawn) return null;
  room.usedPile.push(drawn);
  room.drawnBy.delete(pid);
  if (openClaimWithRank) openClaim(room, drawn.rank);
  return drawn;
}

/* -------------------- Ready / Deal -------------------- */
function dealHands(room) {
  const n = room.order.length;
  room.deckCount = n <= 5 ? 2 : 3;
  room.deck = makeDecks(room.deckCount);
  room.usedPile = [];
  room.claim = null;

  room.hands = new Map();
  room.drawnBy = new Map();
  room.turnStageBy = new Map();
  room.ready = new Map();
  room.powerState = new Map();
  room.activityLog = [];

  for (const pid of room.order) {
    const c0 = room.deck.pop();
    const c1 = room.deck.pop();
    const c2 = room.deck.pop();
    const c3 = room.deck.pop();
    room.hands.set(pid, [{ card: c0 }, { card: c1 }, { card: c2 }, { card: c3 }]);

    room.ready.set(pid, false);
    room.turnStageBy.set(pid, "needDraw");
    room.powerState.set(pid, { mode: "none" });
  }

  room.turnIndex = 0;
  room.phase = "ready";
  pushLog(room, `Game started — everyone press Ready`);
}

function allReady(room) {
  for (const pid of room.order) if (!room.ready.get(pid)) return false;
  return true;
}
function closeReadyGate(room) {
  room.phase = "playing";
  startTurn(room, room.order[room.turnIndex]);
  pushLog(room, `All players ready — game begins`);
}

/* -------------------- Public View -------------------- */
function publicRoomView(room, viewerId) {
  const usedTop2 = room.usedPile.slice(-2);

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
          mine: !!room.ready.get(viewerId),
          all: room.order.map((pid) => ({
            id: pid,
            name: room.players.get(pid)?.name ?? "Unknown",
            ready: !!room.ready.get(pid),
          })),
        }
      : null;

  const curPid = room.order[room.turnIndex] ?? null;
  const stage = curPid ? room.turnStageBy.get(curPid) || "needDraw" : "needDraw";

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,

    players: room.order.map((pid) => {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const hand = room.hands.get(pid) || [];
      const viewerReady = !!room.ready.get(viewerId);

      const slots = hand.map((slot, idx) => {
        if (!slot) return null;

        // ready phase: show only viewer's bottom two (0,1) one time until they press Ready
        if (room.phase === "ready" && pid === viewerId && !viewerReady) {
          if (idx === 0 || idx === 1) return { faceUp: true, card: slot.card };
          return { faceUp: false, card: null };
        }

        return { faceUp: false, card: null };
      });

      return {
        id: pid,
        name,
        cardCount: countCards(hand),
        slots,
        occupied: occIndices(hand), // ✅ used for swap/peek targeting (no empty slots)
      };
    }),

    turnPlayerId: curPid,
    turnStage: stage,

    usedTop2,
    usedCount: room.usedPile.length,

    claim: room.claim
      ? { rank: room.claim.rank, state: room.claim.state, winnerId: room.claim.winnerId, winAt: room.claim.winAt }
      : null,

    kargo: k,
    readyState,

    powerState: room.powerState.get(viewerId) || { mode: "none" },

    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score })),
    stats: Array.from(room.stats.entries()).map(([name, st]) => ({ name, ...st })),

    activityLog: room.activityLog,
    lastRound: room.lastRound ?? null,
    roundBoard: room.roundBoard ?? null,
  };
}

function broadcastRoom(room) {
  for (const pid of room.order) io.to(pid).emit("room:update", publicRoomView(room, pid));
}

/* -------------------- Socket -------------------- */
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
      claim: null,

      hands: new Map(),
      turnIndex: 0,
      drawnBy: new Map(),
      turnStageBy: new Map(),

      ready: new Map(),
      kargo: null,
      powerState: new Map(),

      lastRound: null,
      roundBoard: null,

      activityLog: [],
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
    room.turnStageBy.delete(socket.id);
    room.ready.delete(socket.id);
    room.powerState.delete(socket.id);

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
    const name = room.players.get(socket.id)?.name ?? "Unknown";
    pushLog(room, `${name} is ready`);

    if (allReady(room)) closeReadyGate(room);
    broadcastRoom(room);
  });

  socket.on("turn:draw", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "needDraw") return socket.emit("error:msg", "You cannot draw right now");

    // ✅ Claim closes only when the next player draws
    room.claim = null;

    ensureDeck(room);
    const drawn = room.deck.pop();
    if (!drawn) return socket.emit("error:msg", "Deck empty");

    room.drawnBy.set(socket.id, drawn);
    room.turnStageBy.set(socket.id, "hasDrawn");
    room.powerState.set(socket.id, { mode: "none" });

    const name = room.players.get(socket.id)?.name ?? "Unknown";
    pushLog(room, `${name} drew a card`);

    socket.emit("turn:drawn", drawn);
    broadcastRoom(room);
  });

  socket.on("turn:resolveDrawTap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "hasDrawn") return socket.emit("error:msg", "You must draw first");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "No drawn card");

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[slotIndex];
    if (!slot?.card) return socket.emit("error:msg", "Empty card slot");

    const name = room.players.get(socket.id)?.name ?? "Unknown";

    // if match -> discard both (used pile) and open claim on rank
    if (slot.card.rank === drawn.rank) {
      room.usedPile.push(drawn);
      room.usedPile.push(slot.card);
      openClaim(room, drawn.rank);

      hand[slotIndex] = null;
      room.drawnBy.delete(socket.id);

      pushLog(room, `${name} discarded a matching pair (${drawn.rank})`);

      if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

      room.turnStageBy.set(socket.id, "awaitEnd");
      broadcastRoom(room);
      return;
    }

    // else swap: keep drawn in tapped slot, discard old card to used + open claim on discarded rank
    const replaced = slot.card;
    hand[slotIndex] = { card: drawn };
    room.drawnBy.delete(socket.id);

    room.usedPile.push(replaced);
    openClaim(room, replaced.rank);

    pushLog(room, `${name} discarded a card`);

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

    room.turnStageBy.set(socket.id, "awaitEnd");
    broadcastRoom(room);
  });

  socket.on("turn:discardPair", ({ code, a, b }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "hasDrawn") return socket.emit("error:msg", "You must draw first to throw a pair");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "No drawn card");

    const hand = room.hands.get(socket.id) || [];
    const sa = hand[a];
    const sb = hand[b];
    if (!sa?.card || !sb?.card) return socket.emit("error:msg", "Both selected slots must have cards");
    if (a === b) return socket.emit("error:msg", "Pick two different slots");

    const name = room.players.get(socket.id)?.name ?? "Unknown";

    if (sa.card.rank !== sb.card.rank) {
      givePenaltyCard(room, socket.id);
      pushLog(room, `${name} attempted a wrong pair — penalty`);
      broadcastRoom(room);
      return;
    }

    // discard exactly the two pair cards
    room.usedPile.push(sa.card);
    room.usedPile.push(sb.card);
    openClaim(room, sa.card.rank);

    // keep drawn: replace slot a with drawn, clear slot b
    hand[a] = { card: drawn };
    hand[b] = null;
    room.drawnBy.delete(socket.id);

    pushLog(room, `${name} discarded a pair (${sa.card.rank})`);

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

    room.turnStageBy.set(socket.id, "awaitEnd");
    broadcastRoom(room);
  });

  socket.on("turn:discardDrawn", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "hasDrawn") return socket.emit("error:msg", "No drawn card to discard");

    const drawn = consumeDrawnToUsed(room, socket.id, { openClaimWithRank: true });
    const name = room.players.get(socket.id)?.name ?? "Unknown";
    pushLog(room, `${name} discarded the drawn card (${drawn?.rank ?? "?"})`);

    room.turnStageBy.set(socket.id, "awaitEnd");
    broadcastRoom(room);
  });

  socket.on("turn:end", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "awaitEnd") return socket.emit("error:msg", "Finish your action first");

    nextTurn(room);
    broadcastRoom(room);
  });

  // CLAIM: anyone including thrower; wrong => penalty; 2nd within 0.2s after win => penalty
  socket.on("used:claim", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (room.phase !== "playing") return;

    const c = room.claim;
    if (!c) return socket.emit("error:msg", "No claimable card right now");

    if (c.state === "won") {
      if (c.winAt && nowMs() - c.winAt <= 200) {
        givePenaltyCard(room, socket.id);
        broadcastRoom(room);
      }
      return;
    }

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[slotIndex];
    if (!slot?.card) return socket.emit("error:msg", "Empty card slot");

    const name = room.players.get(socket.id)?.name ?? "Unknown";

    if (slot.card.rank !== c.rank) {
      givePenaltyCard(room, socket.id);
      pushLog(room, `${name} claimed wrong — penalty`);
      broadcastRoom(room);
      return;
    }

    // discard claimed card
    room.usedPile.push(slot.card);
    hand[slotIndex] = null;

    c.state = "won";
    c.winnerId = socket.id;
    c.winAt = nowMs();

    pushLog(room, `${name} claimed (${c.rank})`);

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

    broadcastRoom(room);
  });

  /* -------------------- KARGO -------------------- */
  socket.on("kargo:call", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.kargo) return socket.emit("error:msg", "KARGO already called");

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    // If they still have a drawn card, toss it to used (opens claim)
    const drawn = room.drawnBy.get(socket.id);
    if (drawn) {
      room.usedPile.push(drawn);
      openClaim(room, drawn.rank);
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

    pushLog(room, `KARGO called by ${callerName}`);

    nextTurn(room);
    broadcastRoom(room);
  });

  /* -------------------- Power: single-use (7/8 self peek, 9/10 other peek, J/Q swap) -------------------- */
  socket.on("power:useOnce", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "hasDrawn") return socket.emit("error:msg", "You must have a drawn card to use power");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "No drawn card");

    const r = drawn.rank;
    if (!["7", "8", "9", "10", "J", "Q"].includes(r)) return socket.emit("error:msg", "This drawn card has no power");

    const name = room.players.get(socket.id)?.name ?? "Unknown";

    if (r === "7" || r === "8") {
      room.powerState.set(socket.id, { mode: "selfPeekPick", drawnRank: r });
      pushLog(room, `${name} activated ${r} power`);
      broadcastRoom(room);
      return;
    }

    if (r === "9" || r === "10") {
      room.powerState.set(socket.id, { mode: "otherPeekPick", drawnRank: r });
      pushLog(room, `${name} activated ${r} power`);
      broadcastRoom(room);
      return;
    }

    if (r === "J") {
      room.powerState.set(socket.id, { mode: "jPickOpponentCard", drawnRank: r, target: null });
      pushLog(room, `${name} activated J swap`);
      broadcastRoom(room);
      return;
    }

    if (r === "Q") {
      room.powerState.set(socket.id, { mode: "qPickOpponentCard", drawnRank: r, target: null });
      pushLog(room, `${name} activated Q swap`);
      broadcastRoom(room);
      return;
    }
  });

  socket.on("power:cancel", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    room.powerState.set(socket.id, { mode: "none" });
    broadcastRoom(room);
  });

  // 7/8: pick one of your cards to peek, then drawn power card goes to used and opens claim
  socket.on("power:tapSelfCard", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "selfPeekPick") return socket.emit("error:msg", "Not in 7/8 mode");

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[slotIndex];
    if (!slot?.card) return socket.emit("error:msg", "Empty card slot");

    socket.emit("power:result", { type: "peekSelf", card: slot.card });

    // consume drawn to used + open claim on power rank
    const consumed = consumeDrawnToUsed(room, socket.id, { openClaimWithRank: true });
    const name = room.players.get(socket.id)?.name ?? "Unknown";
    pushLog(room, `${name} used ${consumed?.rank ?? "?"} (peek self)`);

    room.turnStageBy.set(socket.id, "awaitEnd");
    room.powerState.set(socket.id, { mode: "none" });
    broadcastRoom(room);
  });

  // 9/10 peek other OR J/Q choose opponent card
  socket.on("power:tapOtherCard", ({ code, otherPlayerId, otherSlotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const ps = room.powerState.get(socket.id) || { mode: "none" };

    // KARGO protection: cannot target caller with 9/10/J/Q
    if (room.kargo && otherPlayerId === room.kargo.callerId) {
      return socket.emit("error:msg", "You cannot target the KARGO caller");
    }

    const otherHand = room.hands.get(otherPlayerId) || [];
    const otherSlot = otherHand[otherSlotIndex];
    if (!otherSlot?.card) return socket.emit("error:msg", "Other slot empty");

    const actorName = room.players.get(socket.id)?.name ?? "Unknown";
    const otherName = room.players.get(otherPlayerId)?.name ?? "Unknown";

    if (ps.mode === "otherPeekPick") {
      socket.emit("power:result", { type: "peekOther", card: otherSlot.card });

      const consumed = consumeDrawnToUsed(room, socket.id, { openClaimWithRank: true });
      pushLog(room, `${actorName} used ${consumed?.rank ?? "?"} (peeked ${otherName})`);

      room.turnStageBy.set(socket.id, "awaitEnd");
      room.powerState.set(socket.id, { mode: "none" });
      broadcastRoom(room);
      return;
    }

    if (ps.mode === "jPickOpponentCard") {
      room.powerState.set(socket.id, {
        ...ps,
        mode: "jPickMyCard",
        target: { otherPlayerId, otherSlotIndex },
      });
      broadcastRoom(room);
      return;
    }

    if (ps.mode === "qPickOpponentCard") {
      // Q lets the actor see the opponent card (only actor sees it)
      socket.emit("power:result", { type: "qPeekThenDecide", card: otherSlot.card });
      room.powerState.set(socket.id, {
        ...ps,
        mode: "qAwaitDecision",
        target: { otherPlayerId, otherSlotIndex },
      });
      broadcastRoom(room);
      return;
    }

    socket.emit("error:msg", "Not targeting another player right now");
  });

  function logSwap(room, actorId, otherId, aSlot, bSlot, kind) {
    const aName = room.players.get(actorId)?.name ?? "Unknown";
    const bName = room.players.get(otherId)?.name ?? "Unknown";
    // ✅ confirmed requirement: J + Q both show player + slot numbers, no cards
    pushLog(room, `${aName} swapped with ${bName} — ${aName} slot ${aSlot} ↔ ${bName} slot ${bSlot} (${kind})`);
  }

  // J: pick your card to swap after picking opponent card
  socket.on("power:tapMyCardForJSwap", ({ code, mySlotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "jPickMyCard" || !ps.target) return socket.emit("error:msg", "Pick opponent card first");

    const myHand = room.hands.get(socket.id) || [];
    const mySlot = myHand[mySlotIndex];
    if (!mySlot?.card) return socket.emit("error:msg", "Empty card slot");

    const { otherPlayerId, otherSlotIndex } = ps.target;

    // KARGO protection
    if (room.kargo && otherPlayerId === room.kargo.callerId) {
      return socket.emit("error:msg", "You cannot target the KARGO caller");
    }

    const otherHand = room.hands.get(otherPlayerId) || [];
    const otherSlot = otherHand[otherSlotIndex];
    if (!otherSlot?.card) return socket.emit("error:msg", "Other slot empty");

    // swap cards
    const aOld = mySlot.card;
    const bOld = otherSlot.card;
    mySlot.card = bOld;
    otherSlot.card = aOld;

    logSwap(room, socket.id, otherPlayerId, mySlotIndex, otherSlotIndex, "J");

    // consume power card (J) into used and open claim
    consumeDrawnToUsed(room, socket.id, { openClaimWithRank: true });

    room.turnStageBy.set(socket.id, "awaitEnd");
    room.powerState.set(socket.id, { mode: "none" });
    broadcastRoom(room);
  });

  // Q decision: accept swap or not
  socket.on("power:qDecision", ({ code, accept }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "qAwaitDecision" || !ps.target) return socket.emit("error:msg", "No Q decision pending");

    if (!accept) {
      const actorName = room.players.get(socket.id)?.name ?? "Unknown";
      pushLog(room, `${actorName} declined Q swap`);

      consumeDrawnToUsed(room, socket.id, { openClaimWithRank: true });
      room.turnStageBy.set(socket.id, "awaitEnd");
      room.powerState.set(socket.id, { mode: "none" });
      broadcastRoom(room);
      return;
    }

    room.powerState.set(socket.id, { ...ps, mode: "qPickMyCard" });
    broadcastRoom(room);
  });

  socket.on("power:tapMyCardForQSwap", ({ code, mySlotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const ps = room.powerState.get(socket.id) || { mode: "none" };
    if (ps.mode !== "qPickMyCard" || !ps.target) return socket.emit("error:msg", "Pick opponent first, then accept");

    const myHand = room.hands.get(socket.id) || [];
    const mySlot = myHand[mySlotIndex];
    if (!mySlot?.card) return socket.emit("error:msg", "Empty card slot");

    const { otherPlayerId, otherSlotIndex } = ps.target;

    // KARGO protection
    if (room.kargo && otherPlayerId === room.kargo.callerId) {
      return socket.emit("error:msg", "You cannot target the KARGO caller");
    }

    const otherHand = room.hands.get(otherPlayerId) || [];
    const otherSlot = otherHand[otherSlotIndex];
    if (!otherSlot?.card) return socket.emit("error:msg", "Other slot empty");

    const aOld = mySlot.card;
    const bOld = otherSlot.card;
    mySlot.card = bOld;
    otherSlot.card = aOld;

    logSwap(room, socket.id, otherPlayerId, mySlotIndex, otherSlotIndex, "Q");

    consumeDrawnToUsed(room, socket.id, { openClaimWithRank: true });

    room.turnStageBy.set(socket.id, "awaitEnd");
    room.powerState.set(socket.id, { mode: "none" });
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      if (!room.players.has(socket.id)) continue;

      room.players.delete(socket.id);
      room.order = room.order.filter((id) => id !== socket.id);
      room.hands.delete(socket.id);
      room.drawnBy.delete(socket.id);
      room.turnStageBy.delete(socket.id);
      room.ready.delete(socket.id);
      room.powerState.delete(socket.id);

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
