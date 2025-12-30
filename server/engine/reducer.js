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
    turnStep: "draw", // draw -> swap -> pair
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

function removeCardsByIds(hand, idA, idB) {
  return hand.filter((c) => c.id !== idA && c.id !== idB);
}

export function applyAction(state, playerId, action) {
  const s = clone(state);
  const me = s.players.find((p) => p.id === playerId);

  switch (action.type) {
    case "READY": {
      me.ready = true;

      if (s.players.length >= 2 && s.players.every((p) => p.ready)) {
        s.deck = shuffle(buildDeck());
        s.discard = [];
        s.drawnCard = null;

        deal4(s);

        s.phase = PHASES.TURN;
        startTurns(s);
      }
      return s;
    }

    case "DRAW": {
      s.drawnCard = s.deck.pop();
      s.turnStep = "swap";
      return s;
    }

    case "SWAP_DRAWN_WITH_HAND": {
      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      const replaced = me.hand[idx];

      // swap in drawn card; replaced goes to discard
      me.hand[idx] = s.drawnCard;
      s.discard.push(replaced);

      s.drawnCard = null;
      s.turnStep = "pair";
      return s;
    }

    case "END_TURN": {
      nextTurn(s);
      return s;
    }

    case "THROW_PAIR": {
      const aId = action.a;
      const bId = action.b;

      const a = me.hand.find((c) => c.id === aId);
      const b = me.hand.find((c) => c.id === bId);

      const isPair = a && b && a.rank === b.rank;

      if (isPair) {
        // Discard the pair
        s.discard.push(a, b);
        me.hand = removeCardsByIds(me.hand, aId, bId);

        // Keep game moving: draw 1 replacement
        if (s.deck.length > 0) {
          me.hand.push(s.deck.pop());
        }
      } else {
        // Failed attempt: keep both + penalty card (draw 1)
        if (s.deck.length > 0) {
          me.hand.push(s.deck.pop());
        }
      }

      nextTurn(s);
      return s;
    }

    default:
      return s;
  }
}
