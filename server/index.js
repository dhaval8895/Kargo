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
  return (hand || [])
    .filter(Boolean)
    .reduce((sum, slot) => sum + cardValue(slot.card), 0);
}

function countCards(hand) {
  return (hand || []).filter(Boolean).length;
}

function nowMs() {
  return Date.now();
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
    // 2 jokers per deck
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

/** -------------------- Used window logic --------------------
 * usedWindow can be in two states:
 * - state="open": claimable by matching rank
 * - state="postWin": not claimable, but within 200ms still penalizes fast second-clicks
 *
 * IMPORTANT FIX for “3x 7s” bug:
 * - The usedWindow card is added to usedPile ONLY ONCE.
 * - After the first correct claim, we mark state="postWin" and DO NOT re-add on expiry.
 */
function tickUsedWindow(room) {
  if (!room.usedWindow) return;

  const w = room.usedWindow;
  const t = nowMs();

  if (w.state === "open") {
    // auto-expire after 2s -> push card to usedPile
    if (t - w.openedAt > 2000) {
      room.usedPile.push(w.card);
      room.usedWindow = null;
    }
    return;
  }

  if (w.state === "postWin") {
    // post-win penalty window expires quickly
    if (t > w.postWinUntil) {
      room.usedWindow = null;
    }
  }
}

function broadcastRoom(room) {
  tickUsedWindow(room);
  for (const pid of room.order) {
    io.to(pid).emit("room:update", publicRoomView(room, pid));
  }
}

/** -------------------- KARGO flow --------------------
 * room.kargo = null OR
 * {
 *   callerId,
 *   callerName,
 *   calledAt,
 *   finalTurns: [playerId1, playerId2, ...]  // everyone except caller, in turn order starting next player
 *   index: 0,
 *   brokenByOut: false
 * }
 */
function buildFinalTurns(room, callerId) {
  const order = room.order;
  const start = room.turnIndex; // caller is calling on their turn
  const afterCallerIndex = (start + 1) % order.length;

  const finalTurns = [];
  for (let i = 0; i < order.length; i++) {
    const pid = order[(afterCallerIndex + i) % order.length];
    if (pid !== callerId) finalTurns.push(pid);
  }
  return finalTurns;
}

function endRoundAndScore_Standard(room, winnerPid, reason = "out") {
  const winnerName = room.players.get(winnerPid)?.name ?? "Unknown";
  for (const pid of room.order) {
    const name = room.players.get(pid)?.name ?? "Unknown";
    const prev = room.scoreboard.get(name) ?? 0;

    if (pid === winnerPid) room.scoreboard.set(name, prev - 20);
    else room.scoreboard.set(name, prev + handTotal(room.hands.get(pid) || []));
  }

  room.lastRound = { winnerPid, winnerName, reason, endedAt: nowMs() };
  resetToLobby(room);
}

function endRoundAndScore_KargoCompare(room) {
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

  // If someone has same OR less than caller -> break kargo compare rule
  const breakers = totals.filter((x) => x.pid !== callerId && x.total <= callerTotal);

  if (breakers.length > 0) {
    // caller +40
    room.scoreboard.set(callerName, (room.scoreboard.get(callerName) ?? 0) + 40);

    // all with <= caller get -10
    for (const b of breakers) {
      room.scoreboard.set(b.name, (room.scoreboard.get(b.name) ?? 0) - 10);
    }

    // everyone else gets 0 change
    room.lastRound = {
      winnerPid: callerId,
      winnerName: callerName,
      reason: "kargo_broken_by_total",
      endedAt: nowMs(),
    };
    resetToLobby(room);
    return;
  }

  // caller strictly least -> caller -20, everyone else adds total
  room.scoreboard.set(callerName, (room.scoreboard.get(callerName) ?? 0) - 20);
  for (const t of totals) {
    if (t.pid === callerId) continue;
    room.scoreboard.set(t.name, (room.scoreboard.get(t.name) ?? 0) + t.total);
  }

  room.lastRound = {
    winnerPid: callerId,
    winnerName: callerName,
    reason: "kargo_success",
    endedAt: nowMs(),
  };
  resetToLobby(room);
}

function resetToLobby(room) {
  room.phase = "lobby";
  room.deck = [];
  room.usedPile = [];
  room.usedWindow = null;
  room.drawnBy = new Map();
  room.turnIndex = 0;
  room.hands = new Map();
  room.turnFlags = new Map();
  room.kargo = null;
}

function maybeEndIfOut(room, pid, outReason = "out") {
  const hand = room.hands.get(pid) || [];
  if (countCards(hand) !== 0) return false;

  // If KARGO is active and someone else goes out during final-turn phase -> breaks KARGO
  if (room.kargo && room.phase === "playing") {
    // winner gets standard -20 / others totals
    // plus caller gets +40 (break kargo)
    const callerId = room.kargo.callerId;
    const callerName = room.players.get(callerId)?.name ?? room.kargo.callerName ?? "Caller";
    room.scoreboard.set(callerName, (room.scoreboard.get(callerName) ?? 0) + 40);

    endRoundAndScore_Standard(room, pid, "kargo_broken_by_out");
    return true;
  }

  endRoundAndScore_Standard(room, pid, outReason);
  return true;
}

/** -------------------- Room view -------------------- */
function publicRoomView(room, viewerId) {
  const activeUsedCard = room.usedWindow?.card ?? null;

  // show only the LAST used card (client stacks it)
  const lastUsed = room.usedPile.length ? room.usedPile[room.usedPile.length - 1] : null;
  const usedCount = room.usedPile.length;

  const viewerFlags = room.turnFlags.get(viewerId) || { keptDrawnThisTurn: false };
  const isMyTurn = room.order[room.turnIndex] === viewerId;

  const k = room.kargo
    ? {
        callerId: room.kargo.callerId,
        callerName: room.kargo.callerName,
        finalTurns: room.kargo.finalTurns,
        index: room.kargo.index,
        activeFinalPlayerId: room.kargo.finalTurns[room.kargo.index] ?? null,
      }
    : null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    deckRemaining: room.deck.length,
    turnPlayerId: room.order[room.turnIndex] ?? null,

    // old name kept so your client doesn't break
    thrownCard: activeUsedCard,

    usedPileTop: lastUsed,
    usedPileCount: usedCount,

    lastRound: room.lastRound ?? null,
    kargo: k,

    viewer: {
      keptDrawnThisTurn: !!viewerFlags.keptDrawnThisTurn,
      canDiscardSeenPair: isMyTurn && !!viewerFlags.keptDrawnThisTurn && canSeenPairDiscard(room, viewerId),
    },

    players: room.order.map((pid) => {
      const name = room.players.get(pid)?.name ?? "Unknown";
      const hand = room.hands.get(pid) || [];
      const slots = hand.map((slot) => {
        if (!slot) return null;
        if (pid === viewerId) return { faceUp: !!slot.faceUp, card: slot.faceUp ? slot.card : null };
        return { faceUp: false, card: null };
      });
      return { id: pid, name, cardCount: countCards(hand), slots };
    }),

    scoreboard: Array.from(room.scoreboard.entries()).map(([name, score]) => ({ name, score })),
  };
}

/** -------------------- Start round -------------------- */
function startRound(room) {
  const n = room.order.length;
  room.deckCount = n <= 5 ? 2 : 3;

  room.deck = makeDecks(room.deckCount);
  room.usedPile = [];
  room.usedWindow = null;

  room.hands = new Map();
  room.drawnBy = new Map();
  room.turnFlags = new Map();

  room.phase = "playing";
  room.turnIndex = 0;
  room.kargo = null;

  for (const pid of room.order) {
    room.turnFlags.set(pid, { keptDrawnThisTurn: false });

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
  // If KARGO is active, final turns control whose turn is next
  if (room.kargo) {
    // move to next final player
    room.kargo.index += 1;

    // if finals exhausted -> evaluate totals vs caller
    if (room.kargo.index >= room.kargo.finalTurns.length) {
      endRoundAndScore_KargoCompare(room);
      return;
    }

    // set turnIndex to that player in order
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
  hand.push({ card: c, faceUp: false }); // unseen penalty card
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
      usedWindow: null,

      hands: new Map(),
      turnIndex: 0,
      drawnBy: new Map(),
      turnFlags: new Map(),

      lastRound: null,
      kargo: null,
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

  /** ----------- CALL KARGO (only on your turn, with no pending drawn card) ----------- */
  socket.on("kargo:call", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;
    if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    if (room.drawnBy.has(socket.id)) return socket.emit("error:msg", "Resolve your drawn card first");
    if (room.kargo) return socket.emit("error:msg", "KARGO already called");

    const callerName = room.players.get(socket.id)?.name ?? "Caller";

    room.kargo = {
      callerId: socket.id,
      callerName,
      calledAt: nowMs(),
      finalTurns: buildFinalTurns(room, socket.id),
      index: -1, // nextTurn() will move to 0
    };

    // move to the first final player immediately
    nextTurn(room);
    broadcastRoom(room);
  });

  /** ----------- DRAW ----------- */
  socket.on("turn:draw", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    // When KARGO active, only the active final player can act
    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

    if (room.drawnBy.has(socket.id)) return socket.emit("error:msg", "You already drew");

    ensureDeck(room);
    const drawn = room.deck.pop();
    if (!drawn) return socket.emit("error:msg", "Deck empty");

    room.drawnBy.set(socket.id, drawn);
    socket.emit("turn:drawn", drawn);
    broadcastRoom(room);
  });

  /** ----------- KEEP -> SLOT (RULE: cannot keep into EMPTY slot) ----------- */
  socket.on("turn:keepSwap", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    if (!hand) return;

    const replaced = hand[slotIndex];
    if (!replaced) return socket.emit("error:msg", "Cannot keep into an empty slot");

    // swap
    hand[slotIndex] = { card: drawn, faceUp: true };
    room.drawnBy.delete(socket.id);
    room.turnFlags.set(socket.id, { keptDrawnThisTurn: true });

    // replaced becomes usedWindow (or goes to usedPile if window already open)
    if (room.usedWindow) {
      room.usedPile.push(replaced.card);
    } else {
      room.usedWindow = { card: replaced.card, state: "open", openedAt: nowMs() };
    }

    if (maybeEndIfOut(room, socket.id, "out")) return broadcastRoom(room);
    broadcastRoom(room);
  });

  /** ----------- DISCARD DRAWN + MATCH SLOT (slot can be faceUp or faceDown) ----------- */
  socket.on("turn:discardDrawnMatch", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    const slot = hand?.[slotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    if (slot.card.rank !== drawn.rank) {
      return socket.emit("error:msg", "Selected slot does not match the drawn rank");
    }

    // discard both
    room.usedPile.push(drawn);
    room.usedPile.push(slot.card);

    hand[slotIndex] = null;
    room.drawnBy.delete(socket.id);

    if (maybeEndIfOut(room, socket.id, "out")) return broadcastRoom(room);

    // end turn
    nextTurn(room);
    broadcastRoom(room);
  });

  /** ----------- NEW: TAP UNSEEN SLOT while holding drawn card ----------- */
  socket.on("turn:tryMatchUnseen", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    const hand = room.hands.get(socket.id);
    const slot = hand?.[slotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    if (slot.faceUp) return socket.emit("error:msg", "That slot is not unseen");

    // reveal it (it becomes seen after this attempt)
    slot.faceUp = true;

    if (slot.card.rank === drawn.rank) {
      // match -> discard both
      room.usedPile.push(drawn);
      room.usedPile.push(slot.card);
      hand[slotIndex] = null;
      room.drawnBy.delete(socket.id);

      if (maybeEndIfOut(room, socket.id, "out")) return broadcastRoom(room);
      nextTurn(room);
      broadcastRoom(room);
      return;
    }

    // mismatch -> keep unseen card (now seen), penalty +1 unseen card,
    // and drawn becomes active used card (since you didn't keep it)
    givePenaltyCard(room, socket.id);

    room.drawnBy.delete(socket.id);
    if (room.usedWindow) {
      room.usedPile.push(drawn);
    } else {
      room.usedWindow = { card: drawn, state: "open", openedAt: nowMs() };
    }

    // end turn
    nextTurn(room);
    broadcastRoom(room);
  });

  /** ----------- DISCARD SEEN PAIR (slots 0 & 1) AFTER KEEP THIS TURN ----------- */
  socket.on("turn:discardSeenPair", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

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

    if (maybeEndIfOut(room, socket.id, "out")) return broadcastRoom(room);

    nextTurn(room);
    broadcastRoom(room);
  });

  /** ----------- END TURN (does not hide used card) ----------- */
  socket.on("turn:end", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

    if (room.drawnBy.has(socket.id)) return socket.emit("error:msg", "Resolve your drawn card first");

    nextTurn(room);
    broadcastRoom(room);
  });

  /** ----------- DON'T KEEP (throw drawn -> usedWindow) ----------- */
  socket.on("turn:throwDrawn", ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    if (room.kargo) {
      const activeFinal = room.kargo.finalTurns[room.kargo.index] ?? null;
      if (activeFinal !== socket.id) return socket.emit("error:msg", "Not your final turn");
    } else {
      if (room.order[room.turnIndex] !== socket.id) return socket.emit("error:msg", "Not your turn");
    }

    const drawn = room.drawnBy.get(socket.id);
    if (!drawn) return socket.emit("error:msg", "Draw first");

    room.drawnBy.delete(socket.id);

    if (room.usedWindow) room.usedPile.push(drawn);
    else room.usedWindow = { card: drawn, state: "open", openedAt: nowMs() };

    nextTurn(room);
    broadcastRoom(room);
  });

  /** ----------- CLAIM USED CARD (race claim + second-touch penalty) ----------- */
  socket.on("thrown:claim", ({ code, slotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    const w = room.usedWindow;
    if (!w) return socket.emit("error:msg", "No active used card");

    // In postWin state: only penalize within window; no discards.
    if (w.state === "postWin") {
      if (nowMs() <= w.postWinUntil) {
        // penalty if they try to touch during post-win window
        givePenaltyCard(room, socket.id);
      }
      broadcastRoom(room);
      return;
    }

    const hand = room.hands.get(socket.id);
    const slot = hand?.[slotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");

    // must match rank
    if (slot.card.rank !== w.card.rank) {
      givePenaltyCard(room, socket.id);
      broadcastRoom(room);
      return;
    }

    // FIRST correct claim:
    // discard their selected card + used card to usedPile ONCE
    room.usedPile.push(slot.card);
    hand[slotIndex] = null;

    room.usedPile.push(w.card);

    // IMPORTANT: switch to postWin so we DO NOT add w.card again later
    room.usedWindow = {
      state: "postWin",
      postWinUntil: nowMs() + 200,
    };

    if (maybeEndIfOut(room, socket.id, "out")) return broadcastRoom(room);
    broadcastRoom(room);
  });

  /** ----------- POWER (basic): 7/8 peek own slot; 9/10 peek other's slot ----------- */
  socket.on("power:peekSelf", ({ code, mySlotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    const hand = room.hands.get(socket.id) || [];
    const slot = hand[mySlotIndex];
    if (!slot) return socket.emit("error:msg", "Empty slot");
    // reveal only to player (server tells client)
    socket.emit("power:result", { type: "peekSelf", slotIndex: mySlotIndex, card: slot.card });
  });

  socket.on("power:peekOther", ({ code, otherPlayerId, otherSlotIndex }) => {
    const room = rooms.get(code);
    if (!room || room.phase !== "playing") return;

    const otherHand = room.hands.get(otherPlayerId) || [];
    const otherSlot = otherHand[otherSlotIndex];
    if (!otherSlot) return socket.emit("error:msg", "Other slot empty");
    socket.emit("power:result", { type: "peekOther", otherPlayerId, slotIndex: otherSlotIndex, card: otherSlot.card });
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
