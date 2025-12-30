import { PHASES } from "./types.js";
import { buildDeck, shuffle } from "./deck.js";

// Works on Node 18+. If you still need fallback, tell me and I'll swap to JSON clone.
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
    turnStep: "draw", // "draw" -> ("play" if you drew) -> next turn
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
  const alive = s.players;
  s.turnIndex = (s.turnIndex + 1) % alive.length;
  s.turnPlayerId = alive[s.turnIndex].id;
  s.turnStep = "draw";
  s.drawnCard = null;
}

export function applyAction(state, playerId, action) {
  const s = clone(state);
  const me = s.players.find((p) => p.id === playerId);

  switch (action.type) {
    case "READY": {
      me.ready = true;

      // Auto-start when 2+ players and all ready
      if (s.players.length >= 2 && s.players.every((p) => p.ready)) {
        s.phase = PHASES.DEALT;

        s.deck = shuffle(buildDeck());
        s.discard = [];
        s.drawnCard = null;

        deal4(s);
        startTurns(s);

        s.phase = PHASES.TURN;
      }
      return s;
    }

    // ---- Step: draw ----
    case "DRAW": {
      s.drawnCard = s.deck.pop();
      s.turnStep = "play";
      return s;
    }

    case "SWAP_WITH_DISCARD": {
      // Instead of drawing, you take top discard into your hand slot
      const top = s.discard.pop(); // top discard card

      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      const replaced = me.hand[idx];

      me.hand[idx] = top;
      s.discard.push(replaced);

      // Since you didn't draw, your turn ends immediately
      nextTurn(s);
      return s;
    }

    // ---- Step: play (only after DRAW) ----
    case "SWAP_DRAWN_WITH_HAND": {
      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      const replaced = me.hand[idx];

      me.hand[idx] = s.drawnCard;
      s.discard.push(replaced);

      s.drawnCard = null;
      nextTurn(s);
      return s;
    }

    case "DISCARD_DRAWN": {
      s.discard.push(s.drawnCard);
      s.drawnCard = null;
      nextTurn(s);
      return s;
    }

    default:
      return s;
  }
}
