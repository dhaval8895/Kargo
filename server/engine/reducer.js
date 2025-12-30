import { PHASES } from "./types.js";
import { buildDeck, shuffle } from "./deck.js";

const clone = (obj) => structuredClone(obj);

export function createInitialState() {
  return {
    phase: PHASES.LOBBY,
    players: [],
    deck: [],
    discard: [],
    drawnCard: null,

    turnPlayerId: null,
    turnIndex: 0,
    turnStep: "draw", // "draw" | "resolve"

    // per-draw lock for guessing pair
    resolve: { guessAttempted: false },

    // claim window persists until NEXT DRAW
    claim: null, // { open, rank, winnerPlayerId, attemptedBy:{} }
    winnerPlayerId: null, // instant win if any hand hits 0
  };
}

function deal4(s) {
  for (let i = 0; i < 4; i++) {
    for (const p of s.players) p.hand.push(s.deck.pop());
  }
}

function startTurns(s) {
  s.turnIndex = 0;
  s.turnPlayerId = s.players[0].id;
  s.turnStep = "draw";
  s.drawnCard = null;
  s.resolve = { guessAttempted: false };
  s.claim = null;
}

function nextTurn(s) {
  s.turnIndex = (s.turnIndex + 1) % s.players.length;
  s.turnPlayerId = s.players[s.turnIndex].id;
  s.turnStep = "draw";
  s.drawnCard = null;
  s.resolve = { guessAttempted: false };
  // claim stays open until next DRAW (your rule)
}

function isPlayersTurn(s, playerId) {
  return s.phase === PHASES.TURN && s.turnPlayerId === playerId;
}

function drawPenaltyCard(s, player) {
  if (s.deck.length > 0) player.hand.push(s.deck.pop());
}

function openClaimWindow(s, rank) {
  s.claim = {
    open: true,
    rank,
    winnerPlayerId: null,
    attemptedBy: {},
  };
}

function removeCardById(hand, id) {
  const idx = hand.findIndex((c) => c.id === id);
  if (idx < 0) return { hand, removed: null };
  const removed = hand[idx];
  const next = hand.slice();
  next.splice(idx, 1);
  return { hand: next, removed };
}

function endGameIfEmptyHand(s, pid) {
  const p = s.players.find((x) => x.id === pid);
  if (p && p.hand.length === 0) s.winnerPlayerId = pid;
}

export function applyAction(state, playerId, action) {
  const s = clone(state);
  const me = s.players.find((p) => p.id === playerId);
  if (!me) return s;

  // hard stop on game end
  if (s.winnerPlayerId) return s;

  switch (action.type) {
    case "READY": {
      if (s.phase !== PHASES.LOBBY) return s;
      me.ready = true;

      if (s.players.length >= 2 && s.players.every((p) => p.ready)) {
        s.deck = shuffle(buildDeck());
        s.discard = [];
        s.drawnCard = null;
        s.claim = null;
        s.winnerPlayerId = null;

        for (const p of s.players) p.hand = p.hand || [];
        deal4(s);

        s.phase = PHASES.TURN;
        startTurns(s);
      }
      return s;
    }

    case "DRAW": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "draw") return s;
      if (s.drawnCard) return s;
      if (s.deck.length === 0) return s;

      // close claim when next player draws (your rule)
      if (s.claim?.open) s.claim.open = false;

      s.drawnCard = s.deck.pop();
      s.turnStep = "resolve";
      s.resolve = { guessAttempted: false };
      return s;
    }

    /**
     * Turn player clicks a hand card while holding drawn:
     * - If ranks match: discard drawn + clicked, hand becomes N-1
     * - If ranks don't match: swap; clicked goes to discard; open claim window
     * - No penalty for turn player
     * - Drawn always clears
     */
    case "SWAP_DRAWN_WITH_HAND": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "resolve") return s;
      if (!s.drawnCard) return s;

      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      if (idx < 0) return s;

      const clicked = me.hand[idx];

      if (clicked.rank === s.drawnCard.rank) {
        s.discard.push(s.drawnCard, clicked);
        me.hand.splice(idx, 1);
        s.drawnCard = null;

        endGameIfEmptyHand(s, playerId);
        return s;
      }

      // not match => swap
      me.hand[idx] = s.drawnCard;
      s.discard.push(clicked);
      s.drawnCard = null;

      openClaimWindow(s, clicked.rank);
      return s;
    }

    /**
     * Guess pair (Throw Pair button) — ONLY turn player, ONLY once per draw
     * payload: { type:"GUESS_PAIR", a, b }
     *
     * success:
     *  - discard a,b
     *  - drawn joins hand
     *  - net N-1
     * fail:
     *  - keep a,b
     *  - penalty draw 1
     *  - drawn stays (player can swap after)
     */
    case "GUESS_PAIR": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "resolve") return s;
      if (!s.drawnCard) return s;

      if (s.resolve?.guessAttempted) return s;
      s.resolve.guessAttempted = true;

      const aId = action.a;
      const bId = action.b;
      if (!aId || !bId || aId === bId) return s;

      const a = me.hand.find((c) => c.id === aId);
      const b = me.hand.find((c) => c.id === bId);
      if (!a || !b) return s;

      if (a.rank === b.rank) {
        s.discard.push(a, b);
        me.hand = me.hand.filter((c) => c.id !== aId && c.id !== bId);

        me.hand.push(s.drawnCard);
        s.drawnCard = null;

        endGameIfEmptyHand(s, playerId);
        return s;
      }

      // fail => penalty, drawn remains, no retry
      drawPenaltyCard(s, me);
      return s;
    }

    /**
     * Claim discard — any player while claim is open
     * payload: { type:"CLAIM_DISCARD", cardId }
     *
     * - each player can attempt ONCE per claim window
     * - first matching claim wins: discard 1 card (same rank)
     * - late or wrong claims: penalty draw 1; clicked card stays
     * - claim stays open until next DRAW, but winner is locked
     */
    case "CLAIM_DISCARD": {
      if (!s.claim || !s.claim.open) return s;

      const claimant = s.players.find((p) => p.id === playerId);
      if (!claimant) return s;

      const cardId = action.cardId;
      if (!cardId) return s;

      // one attempt per window
      if (s.claim.attemptedBy[playerId]) return s;
      s.claim.attemptedBy[playerId] = true;

      const card = claimant.hand.find((c) => c.id === cardId);
      if (!card) return s;

      // winner already exists => late attempt => penalty
      if (s.claim.winnerPlayerId) {
        drawPenaltyCard(s, claimant);
        return s;
      }

      // wrong rank => penalty
      if (card.rank !== s.claim.rank) {
        drawPenaltyCard(s, claimant);
        return s;
      }

      // match => winner
      const { hand: nextHand, removed } = removeCardById(claimant.hand, cardId);
      if (!removed) return s;

      claimant.hand = nextHand;
      s.discard.push(removed); // claimed card becomes top discard
      s.claim.winnerPlayerId = playerId;

      endGameIfEmptyHand(s, playerId);
      return s;
    }

    case "END_TURN": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.drawnCard) return s; // must resolve drawn first
      nextTurn(s);
      return s;
    }

    default:
      return s;
  }
}
