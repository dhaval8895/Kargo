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
  return (hand || []).reduce((sum, slot) => sum + cardValue(slot?.card), 0);
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

function countNonEmpty(hand) {
  let c = 0;
  for (const s of hand) if (s?.card) c++;
  return c;
}

function ensureMinSlots(hand, n) {
  while (hand.length < n) hand.push(null);
}

/**
 * Penalty card placement rules:
 * - Always keep empty slots visible.
 * - If player has <4 slots, ensure 4 exist.
 * - Fill earliest empty slot first.
 * - If no empty slots, append (slot 5,6,...)
 */
function placePenaltyCard(room, pid, card) {
  const hand = room.hands.get(pid) || [];
  ensureMinSlots(hand, 4);

  for (let i = 0; i < hand.length; i++) {
    if (!hand[i] || !hand[i]?.card) {
      hand[i] = { card };
      room.hands.set(pid, hand);
      return;
    }
  }
  hand.push({ card });
  room.hands.set(pid, hand);
}

function givePenaltyDraw(room, pid) {
  ensureDeck(room);
  const c = room.deck.pop();
  if (!c) return;
  placePenaltyCard(room, pid, c);
}

/* -------------------- Activity Log -------------------- */
function pushLog(room, msg) {
  room.activityLog.unshift({ t: nowMs(), msg });
  if (room.activityLog.length > 12) room.activityLog = room.activityLog.slice(0, 12);
}

/* -------------------- Turn-scoped rank cap (KEY RULE) -------------------- */
/**
 * Rule:
 * - During a single turn, at most 2 cards of the same rank may enter the used pile (across ALL players).
 * - If someone attempts the 3rd same-rank addition in the same turn:
 *   - the attempted card is returned to their hand (they keep it),
 *   - AND they receive +1 extra penalty card drawn from deck.
 */
function pushUsedWithTurnGuard(room, pid, card) {
  if (!card) return { ok: true, blocked: false };

  const rank = card.rank;
  if (!room.turnRankAdds) room.turnRankAdds = {};
  const usedThisTurn = room.turnRankAdds[rank] || 0;

  if (usedThisTurn >= 2) {
    // Block: return card + extra penalty draw
    placePenaltyCard(room, pid, card);
    givePenaltyDraw(room, pid);

    const name = room.players.get(pid)?.name ?? "Unknown";
    pushLog(room, `${name} tried a 3rd ${rank} this turn — card returned + penalty`);

    return { ok: false, blocked: true };
  }

  room.usedPile.push(card);
  room.turnRankAdds[rank] = usedThisTurn + 1;
  return { ok: true, blocked: false };
}

/* -------------------- Claim window -------------------- */
/**
 * Claim window lasts until NEXT PLAYER DRAWS.
 * room.claim = { rank, state: "open"|"won", winnerId, winAt }
 */
function openClaim(room, rank) {
  room.claim = { rank, state: "open", winnerId: null, winAt: null };
}

/* -------------------- Round end -------------------- */
function snapshotHands(room) {
  const snap = {};
  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const hand = room.hands.get(pid) || [];
    snap[name] = hand.map((s) => (s?.card ? { rank: s.card.rank, suit: s.card.suit } : null));
  }
  return snap;
}

function endRound(room, winnerPid, reason = "out") {
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

  // round stats
  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const st = room.stats.get(name) ?? { roundsPlayed: 0, roundsWon: 0 };
    st.roundsPlayed += 1;
    if (pid === winnerPid) st.roundsWon += 1;
    room.stats.set(name, st);
  }

  room.lastRound = {
    endedAt: nowMs(),
    winnerPid,
    winnerName: room.players.get(winnerPid)?.name ?? "Unknown",
    reason,
    reveal,
    deltas,
  };

  // reset to lobby, keep scoreboard/stats
  room.phase = "lobby";
  room.deck = [];
  room.usedPile = [];
  room.claim = null;
  room.hands = new Map();
  room.drawnBy = new Map();
  room.turnStageBy = new Map();
  room.ready = new Map();
  room.turnIndex = 0;
  room.activityLog = [];
  room.turnRankAdds = {};
  room.turnSeq = 0;
}

function maybeEndIfOut(room, pid) {
  const hand = room.hands.get(pid) || [];
  if (countNonEmpty(hand) !== 0) return false;
  endRound(room, pid, "out");
  return true;
}

/* -------------------- Game flow -------------------- */
function startTurn(room, pid) {
  room.turnStageBy.set(pid, "needDraw");
}

function nextTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.order.length;
  startTurn(room, room.order[room.turnIndex]);
}

function actingGuard(room, socket) {
  if (room.phase !== "playing") return "Not in playing phase";
  if (room.order[room.turnIndex] !== socket.id) return "Not your turn";
  return null;
}

function dealHands(room) {
  const n = room.order.length;
  const deckCount = n <= 5 ? 2 : 3;
  room.deck = makeDecks(deckCount);
  room.usedPile = [];
  room.claim = null;

  room.hands = new Map();
  room.drawnBy = new Map();
  room.turnStageBy = new Map();
  room.ready = new Map();
  room.activityLog = [];
  room.turnRankAdds = {};
  room.turnSeq = 0;

  for (const pid of room.order) {
    const c0 = room.deck.pop();
    const c1 = room.deck.pop();
    const c2 = room.deck.pop();
    const c3 = room.deck.pop();
    room.hands.set(pid, [{ card: c0 }, { card: c1 }, { card: c2 }, { card: c3 }]);
    room.ready.set(pid, false);
    room.turnStageBy.set(pid, "needDraw");
  }

  room.turnIndex = 0;
  room.phase = "ready";
  pushLog(room, "Game started — press Ready");
}

function allReady(room) {
  for (const pid of room.order) if (!room.ready.get(pid)) return false;
  return true;
}

function closeReadyGate(room) {
  room.phase = "playing";
  startTurn(room, room.order[room.turnIndex]);
  pushLog(room, "All players ready — game begins");
}

/* -------------------- Public state for each viewer -------------------- */
function publicRoomView(room, viewerId) {
  const curPid = room.order[room.turnIndex] ?? null;
  const stage = curPid ? room.turnStageBy.get(curPid) || "needDraw" : "needDraw";
  const viewerReady = room.phase === "ready" ? !!room.ready.get(viewerId) : true;

  const usedTop2 = room.usedPile.slice(-2);

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,

    players: room.order.map((pid) => {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const hand = room.hands.get(pid) || [];

      const slots = hand.map((slot, idx) => {
        if (!slot || !slot.card) return { state: "empty", faceUp: false, card: null };

        // READY phase: only viewer sees their bottom two (slot 0,1) ONCE until they press Ready
        if (room.phase === "ready" && pid === viewerId && !viewerReady) {
          if (idx === 0 || idx === 1) return { state: "card", faceUp: true, card: slot.card };
          return { state: "card", faceUp: false, card: null };
        }

        // otherwise hidden
        return { state: "card", faceUp: false, card: null };
      });

      return {
        id: pid,
        name,
        totalSlots: hand.length,
        nonEmptyCount: countNonEmpty(hand),
        slots,
      };
    }),

    turnPlayerId: curPid,
    turnStage: stage,

    usedTop2,
    usedCount: room.usedPile.length,

    claim: room.claim
      ? { rank: room.claim.rank, state: room.claim.state, winnerId: room.claim.winnerId, winAt: room.claim.winAt }
      : null,

    readyState:
      room.phase === "ready"
        ? {
            mine: !!room.ready.get(viewerId),
            all: room.order.map((pid) => ({
              id: pid,
              name: room.players.get(pid)?.name ?? "Unknown",
              ready: !!room.ready.get(pid),
            })),
          }
        : null,

    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score })),
    stats: Array.from(room.stats.entries()).map(([name, st]) => ({ name, ...st })),

    activityLog: room.activityLog,
    lastRound: room.lastRound ?? null,
  };
}

function broadcastRoom(room) {
  for (const pid of room.order) io.to(pid).emit("room:update", publicRoomView(room, pid));
}

/* -------------------- Rooms -------------------- */
const rooms = new Map();

function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

/* -------------------- Socket -------------------- */
io.on("connection", (socket) => {
  socket.on("room:create", ({ name }) => {
    const code = newCode();
    const room = {
      code,
      hostId: socket.id,
      players: new Map(),
      order: [],
      scoreboard: new Map(),
      stats: new Map(),

      phase: "lobby",
      deck: [],
      usedPile: [],
      claim: null,

      hands: new Map(),
      drawnBy: new Map(),
      turnStageBy: new Map(),
      ready: new Map(),
      turnIndex: 0,

      activityLog: [],
      turnSeq: 0,
      turnRankAdds: {},
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

  /**
   * DRAW:
   * - ends previous claim window (claim ends only when next player draws)
   * - starts a new "turn rank counter" window
   */
  socket.on("turn:draw", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "needDraw") return socket.emit("error:msg", "You cannot draw right now");

    // END claim window when next player draws:
    room.claim = null;

    // New turn sequence begins when active player draws:
    room.turnSeq = (room.turnSeq || 0) + 1;
    room.turnRankAdds = {};

    ensureDeck(room);
    const drawn = room.deck.pop();
    if (!drawn) return socket.emit("error:msg", "Deck empty");

    room.drawnBy.set(socket.id, drawn);
    room.turnStageBy.set(socket.id, "hasDrawn");

    const name = room.players.get(socket.id)?.name ?? "Unknown";
    pushLog(room, `${name} drew a card`);

    socket.emit("turn:drawn", drawn);
    broadcastRoom(room);
  });

  /**
   * Active player taps a card slot to resolve drawn card:
   * - If same rank => discard both to used (counts toward per-turn cap)
   * - If not same => swap (keep drawn in slot), discard tapped to used
   */
  socket.on("turn:resolveTap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "hasDrawn") return socket.emit("error:msg", "You must draw first");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "No drawn card");

    const hand = room.hands.get(socket.id) || [];
    if (!hand[slotIndex]?.card) return socket.emit("error:msg", "Empty card slot");

    const name = room.players.get(socket.id)?.name ?? "Unknown";
    const tapped = hand[slotIndex].card;

    if (tapped.rank === drawn.rank) {
      // attempt to add 2 of the same rank (tapped + drawn) this turn
      // NOTE: per-turn cap is 2, so this is allowed only if current count for that rank is 0
      const usedThisTurn = room.turnRankAdds[drawn.rank] || 0;
      if (usedThisTurn !== 0) {
        // would exceed cap -> drawn returned + penalty draw; tapped stays
        placePenaltyCard(room, socket.id, drawn);
        givePenaltyDraw(room, socket.id);
        room.drawnBy.delete(socket.id);
        pushLog(room, `${name} attempted extra ${drawn.rank} pair this turn — drawn returned + penalty`);
        room.turnStageBy.set(socket.id, "awaitEnd");
        broadcastRoom(room);
        return;
      }

      // add both to used
      const a1 = pushUsedWithTurnGuard(room, socket.id, drawn);
      const a2 = pushUsedWithTurnGuard(room, socket.id, tapped);

      // If somehow blocked (shouldn't here), stabilize:
      if (!a1.ok || !a2.ok) {
        // return drawn into hand as penalty already happened in guard
        room.drawnBy.delete(socket.id);
        room.turnStageBy.set(socket.id, "awaitEnd");
        broadcastRoom(room);
        return;
      }

      hand[slotIndex] = null;
      room.drawnBy.delete(socket.id);

      openClaim(room, drawn.rank);
      pushLog(room, `${name} discarded a matching pair (${drawn.rank})`);

      if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

      room.turnStageBy.set(socket.id, "awaitEnd");
      broadcastRoom(room);
      return;
    }

    // Not matching => swap: keep drawn, try to discard tapped to used (subject to turn cap)
    hand[slotIndex] = { card: drawn };
    room.drawnBy.delete(socket.id);

    const add = pushUsedWithTurnGuard(room, socket.id, tapped);
    if (add.ok) {
      openClaim(room, tapped.rank);
      pushLog(room, `${name} discarded a card`);
    } else {
      // tapped stayed in hand (we replaced it with drawn already), so we must put tapped back and keep drawn as penalty
      // To match your rule: attempted 3rd card returns to player + penalty draw.
      // We already placed tapped as penalty (same card) + penalty draw inside guard, BUT tapped is no longer in hand.
      // Fix by removing one instance: easiest is to treat this as "swap not allowed", revert swap:
      // Put tapped back into slotIndex and put drawn into penalty slot.
      // (This keeps game consistent.)
      hand[slotIndex] = { card: tapped };
      placePenaltyCard(room, socket.id, drawn);
      pushLog(room, `${name} discard blocked — swap reverted, drawn kept as penalty`);
    }

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

    room.turnStageBy.set(socket.id, "awaitEnd");
    broadcastRoom(room);
  });

  /**
   * Active player discards drawn card without swapping
   */
  socket.on("turn:discardDrawn", ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;

    const guard = actingGuard(room, socket);
    if (guard) return socket.emit("error:msg", guard);

    const stage = room.turnStageBy.get(socket.id) || "needDraw";
    if (stage !== "hasDrawn") return socket.emit("error:msg", "No drawn card to discard");

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return;

    const name = room.players.get(socket.id)?.name ?? "Unknown";
    const add = pushUsedWithTurnGuard(room, socket.id, drawn);

    room.drawnBy.delete(socket.id);

    if (add.ok) {
      openClaim(room, drawn.rank);
      pushLog(room, `${name} discarded drawn (${drawn.rank})`);
    } else {
      // Guard returned drawn to player + penalty draw
      pushLog(room, `${name} discard blocked — drawn returned + penalty`);
    }

    room.turnStageBy.set(socket.id, "awaitEnd");
    broadcastRoom(room);
  });

  /**
   * Active player throws a pair from their hand ONLY on their turn.
   * - This consumes exactly 2 cards of same rank into used pile
   * - Requires they already drew (so only one "action turn" state)
   * - The drawn card stays, and MUST be placed into one of the two slots (we do it automatically into slot a).
   */
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
    if (!hand[a]?.card || !hand[b]?.card) return socket.emit("error:msg", "Both slots must have cards");
    if (a === b) return socket.emit("error:msg", "Pick two different slots");

    const ca = hand[a].card;
    const cb = hand[b].card;
    const name = room.players.get(socket.id)?.name ?? "Unknown";

    if (ca.rank !== cb.rank) {
      givePenaltyDraw(room, socket.id);
      pushLog(room, `${name} attempted wrong pair — penalty`);
      broadcastRoom(room);
      return;
    }

    const rank = ca.rank;
    const usedThisTurn = room.turnRankAdds[rank] || 0;

    // Pair adds 2 of same rank this turn, allowed only if usedThisTurn == 0
    if (usedThisTurn !== 0) {
      // pair would exceed max-2-per-turn => pair stays, penalty draw
      givePenaltyDraw(room, socket.id);
      pushLog(room, `${name} attempted extra pair (${rank}) this turn — penalty`);
      broadcastRoom(room);
      return;
    }

    const g1 = pushUsedWithTurnGuard(room, socket.id, ca);
    const g2 = pushUsedWithTurnGuard(room, socket.id, cb);

    if (!g1.ok || !g2.ok) {
      // should not happen because usedThisTurn==0, but keep safe
      broadcastRoom(room);
      return;
    }

    openClaim(room, rank);

    // keep drawn by placing into slot a, clear slot b
    hand[a] = { card: drawn };
    hand[b] = null;
    room.drawnBy.delete(socket.id);

    pushLog(room, `${name} discarded a pair (${rank})`);

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);

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

  /**
   * CLAIM:
   * - Any player (including the active player) may attempt to claim during claim window.
   * - They click one of their hidden cards.
   * - If correct rank: card goes to used (subject to per-turn cap), they remove it from hand.
   * - If wrong rank: +1 penalty card (drawn) (the clicked card stays).
   * - Claim window stays open until next player draws.
   * - Only ONE successful claim total (winner locks it), others within 0.2s get penalty.
   */
  socket.on("used:claim", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    const c = room.claim;
    if (!c) return;

    // already won: second touch within 0.2 sec => penalty
    if (c.state === "won") {
      if (c.winAt && nowMs() - c.winAt <= 200) {
        givePenaltyDraw(room, socket.id);
        const name = room.players.get(socket.id)?.name ?? "Unknown";
        pushLog(room, `${name} was too slow on claim — penalty`);
        broadcastRoom(room);
      }
      return;
    }

    const hand = room.hands.get(socket.id) || [];
    if (!hand[slotIndex]?.card) return;

    const name = room.players.get(socket.id)?.name ?? "Unknown";
    const card = hand[slotIndex].card;

    if (card.rank !== c.rank) {
      givePenaltyDraw(room, socket.id);
      pushLog(room, `${name} claimed wrong — penalty`);
      broadcastRoom(room);
      return;
    }

    // correct rank: attempt to add to used (per-turn cap)
    const add = pushUsedWithTurnGuard(room, socket.id, card);
    if (!add.ok) {
      // blocked => card returned + penalty already applied by guard, so keep card (do NOT remove)
      broadcastRoom(room);
      return;
    }

    // remove from hand
    hand[slotIndex] = null;

    c.state = "won";
    c.winnerId = socket.id;
    c.winAt = nowMs();

    pushLog(room, `${name} claimed (${c.rank})`);

    if (maybeEndIfOut(room, socket.id)) return broadcastRoom(room);
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    // no-op (simple version)
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`KARGO server listening on :${PORT}`));
