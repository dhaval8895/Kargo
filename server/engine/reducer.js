import { PHASES } from "./types.js";
import { buildDeck, shuffle } from "./deck.js";

// Node 18+ on Render
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
    turnStep: "draw", // draw -> resolve (swap or guess/match) -> end

    // per-draw lock for guessing pair
    resolve: { guessAttempted: false },

    // claim window stays open until next DRAW
    claim: null, // { open:boolean, rank:string, winnerPlayerId:null|string, attemptedBy:{[pid]:true}, openedOnTurnPlayerId }
    winnerPlayerId: null, // game ends when set
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
  // claim persists until next DRAW (per your rule)
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
    attemptedBy: {}, // pid -> true
    openedOnTurnPlayerId: s.turnPlayerId,
  };
}

function endGameIfEmptyHand(s, playerId) {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return;
  if (p.hand.length === 0) {
    s.winnerPlayerId = playerId;
  }
}

function removeCardById(hand, id) {
  const idx = hand.findIndex((c) => c.id === id);
  if (idx < 0) return { hand, removed: null };
  const removed = hand[idx];
  const next = hand.slice();
  next.splice(idx, 1);
  return { hand: next, removed };
}

export function applyAction(state, playerId, action) {
  const s = clone(state);
  const me = s.players.find((p) => p.id === playerId);
  if (!me) return s;

  // Game over guard
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

      // Per your rule: claim window remains open until next player draws.
      // So on any DRAW, we close it.
      if (s.claim?.open) s.claim.open = false;

      s.drawnCard = s.deck.pop();
      s.turnStep = "resolve";
      s.resolve = { guessAttempted: false };
      return s;
    }

    /**
     * Click a hand card while holding drawn (TURN PLAYER ONLY):
     * - If ranks match: discard drawn + clicked => N-1
     * - If ranks don't match: perform swap (discard clicked, drawn becomes hand card)
     * - No penalty for turn player
     * - After either, drawn clears, player must press End Turn
     * - Swap path opens claim window for discarded clicked card rank
     */
    case "SWAP_DRAWN_WITH_HAND": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "resolve") return s;
      if (!s.drawnCard) return s;

      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      if (idx < 0) return s;

      const clicked = me.hand[idx];

      // MATCH path
      if (clicked.rank === s.drawnCard.rank) {
        // discard drawn + clicked
        s.discard.push(s.drawnCard, clicked);
        // remove clicked, drawn resolved
        me.hand.splice(idx, 1);
        s.drawnCard = null;

        endGameIfEmptyHand(s, playerId);
        return s;
      }

      // NOT MATCH path => swap (discard clicked)
      me.hand[idx] = s.drawnCard;
      s.discard.push(clicked);
      s.drawnCard = null;

      // open claim on clicked rank
      openClaimWindow(s, clicked.rank);

      return s;
    }

    /**
     * Throw Pair (Guess) — ONLY turn player, ONLY once per draw:
     * payload: { type: "GUESS_PAIR", a, b }
     *
     * If same rank:
     * - discard a & b
     * - keep drawn (drawn joins hand)
     * - net N-1
     * If not same rank:
     * - selected cards stay
     * - penalty draw 1
     * - no retry (guessAttempted locks)
     * In both cases: drawn remains if fail; drawn clears if success (because it joins hand)
     * Player continues and must resolve drawn (swap) if still holding it, then press End.
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
        // success: discard two, keep drawn by putting into hand
        s.discard.push(a, b);
        me.hand = me.hand.filter((c) => c.id !== aId && c.id !== bId);

        me.hand.push(s.drawnCard);
        s.drawnCard = null;

        endGameIfEmptyHand(s, playerId);
        return s;
      }

      // fail: cards stay, penalty + no retry
      drawPenaltyCard(s, me);
      return s;
    }

    /**
     * Claim discard — any player while claim window is open.
     * payload: { type: "CLAIM_DISCARD", cardId }
     *
     * Rules:
     * - Any player (including turn player) can attempt.
     * - Only one attempt per player per claim window.
     * - If claim already has a winner, any further attempts:
     *    - matching or not -> clicked card stays + penalty draw 1
     * - If no winner yet:
     *    - if card rank matches claim rank -> winner discards 1 card (hand -1), becomes winner
     *    - else -> penalty draw 1, card stays
     */
    case "CLAIM_DISCARD": {
      if (!s.claim || !s.claim.open) return s;

      const cardId = action.cardId;
      if (!cardId) return s;

      const claimant = s.players.find((p) => p.id === playerId);
      if (!claimant) return s;

      // Only one attempt per player per claim window
      if (s.claim.attemptedBy[playerId]) return s;
      s.claim.attemptedBy[playerId] = true;

      const card = claimant.hand.find((c) => c.id === cardId);
      if (!card) return s;

      // If already claimed (winner exists), everyone else gets penalty + card back
      if (s.claim.winnerPlayerId) {
        drawPenaltyCard(s, claimant);
        return s;
      }

      // No winner yet: check match rank
      if (card.rank !== s.claim.rank) {
        // Wrong rank (not their turn) => penalty + keep card
        drawPenaltyCard(s, claimant);
        return s;
      }

      // Match => winner
      const { hand: nextHand, removed } = removeCardById(claimant.hand, cardId);
      if (!removed) return s;

      claimant.hand = nextHand;
      s.discard.push(removed);

      s.claim.winnerPlayerId = playerId;
      // claim window stays open until next DRAW, but winner is now locked

      endGameIfEmptyHand(s, playerId);
      return s;
    }

    case "END_TURN": {
      if (!isPlayersTurn(s, playerId)) return s;

      // cannot end while holding drawn
      if (s.drawnCard) return s;

      nextTurn(s);
      return s;
    }

    default:
      return s;
  }
}
