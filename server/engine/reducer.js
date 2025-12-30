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

    // UPDATED: draw -> resolve (pair or swap) -> end
    // We'll keep a string so client can render UX if needed
    turnStep: "draw", // "draw" | "resolve"
  };
}

function deal4(s) {
  for (let i = 0; i < 4; i++) {
    for (const p of s.players) {
      p.hand.push(s.deck.pop());
    }
  }
}

function startTurns(s) {
  s.turnIndex = 0;
  s.turnPlayerId = s.players[0].id;
  s.turnStep = "draw";
  s.drawnCard = null;
}

function nextTurn(s) {
  s.turnIndex = (s.turnIndex + 1) % s.players.length;
  s.turnPlayerId = s.players[s.turnIndex].id;
  s.turnStep = "draw";
  s.drawnCard = null;
}

function removeCardsByIds(hand, ids) {
  const set = new Set(ids);
  return hand.filter((c) => !set.has(c.id));
}

function isPlayersTurn(s, playerId) {
  return s.phase === PHASES.TURN && s.turnPlayerId === playerId;
}

export function applyAction(state, playerId, action) {
  const s = clone(state);
  const me = s.players.find((p) => p.id === playerId);

  // Basic safety
  if (!me) return s;

  switch (action.type) {
    case "READY": {
      if (s.phase !== PHASES.LOBBY) return s;

      me.ready = true;

      if (s.players.length >= 2 && s.players.every((p) => p.ready)) {
        s.deck = shuffle(buildDeck());
        s.discard = [];
        s.drawnCard = null;

        // ensure hands exist
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

      s.drawnCard = s.deck.pop();
      s.turnStep = "resolve"; // now player must either throw pair or swap
      return s;
    }

    case "SWAP_DRAWN_WITH_HAND": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "resolve") return s;
      if (!s.drawnCard) return s;

      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      if (idx < 0) return s;

      const replaced = me.hand[idx];

      // swap in drawn card; replaced goes to discard
      me.hand[idx] = s.drawnCard;
      s.discard.push(replaced);

      // drawn resolved; player can now END_TURN
      s.drawnCard = null;

      // We intentionally DO NOT allow any pair throw after swap in this ruleset.
      // Keep step as "resolve" or "end" doesn't matter; END_TURN is gated by drawnCard null.
      return s;
    }

    /**
     * NEW ACTION 1:
     * Drawn + matching hand card are discarded together.
     * - Allowed only while holding drawnCard (before swap)
     * - Hand size decreases by 1 net (N - 1)
     * - Ends the turn immediately (nextTurn)
     *
     * payload: { type: "THROW_PAIR_WITH_DRAWN", targetCardId }
     */
    case "THROW_PAIR_WITH_DRAWN": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "resolve") return s;
      if (!s.drawnCard) return s;

      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      if (idx < 0) return s;

      const target = me.hand[idx];
      if (!target || target.rank !== s.drawnCard.rank) return s;

      // discard drawn + target
      s.discard.push(s.drawnCard, target);

      // remove target from hand, clear drawn
      me.hand.splice(idx, 1);
      s.drawnCard = null;

      // turn ends after a successful pair throw (per your flow)
      nextTurn(s);
      return s;
    }

    /**
     * NEW ACTION 2:
     * Throw a pair from hand and KEEP the drawn card.
     * - Allowed only while holding drawnCard (before swap)
     * - Two selected hand cards must match ranks
     * - Discard the two hand cards, add drawn into hand
     * - Net hand size decreases by 1 (N - 1)
     * - Ends the turn immediately (nextTurn)
     *
     * payload: { type: "THROW_PAIR_FROM_HAND_KEEP_DRAWN", a, b }
     */
    case "THROW_PAIR_FROM_HAND_KEEP_DRAWN": {
      if (!isPlayersTurn(s, playerId)) return s;
      if (s.turnStep !== "resolve") return s;
      if (!s.drawnCard) return s;

      const aId = action.a;
      const bId = action.b;
      if (!aId || !bId || aId === bId) return s;

      const a = me.hand.find((c) => c.id === aId);
      const b = me.hand.find((c) => c.id === bId);
      if (!a || !b) return s;
      if (a.rank !== b.rank) return s;

      // discard the pair
      s.discard.push(a, b);

      // remove both from hand
      me.hand = removeCardsByIds(me.hand, [aId, bId]);

      // keep the drawn card by putting it into hand
      me.hand.push(s.drawnCard);
      s.drawnCard = null;

      nextTurn(s);
      return s;
    }

    case "END_TURN": {
      if (!isPlayersTurn(s, playerId)) return s;

      // IMPORTANT: cannot end turn while holding a drawn card
      if (s.drawnCard) return s;

      nextTurn(s);
      return s;
    }

    /**
     * LEGACY: disable or ignore old THROW_PAIR behavior
     * because it conflicts with new rules (replacement/penalty draws).
     */
    case "THROW_PAIR": {
      // Keep as no-op to avoid breaking older clients
      return s;
    }

    default:
      return s;
  }
}
