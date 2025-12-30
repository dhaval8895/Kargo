import { PHASES } from "./types.js";
import { buildDeck, shuffle } from "./deck.js";

export function createInitialState() {
  return {
    phase: PHASES.LOBBY,
    players: [],
    deck: [],
    discard: [],
    drawnCard: null,
    turnPlayerId: null,
    turnIndex: 0,
    turnStep: "draw" // "draw" -> "play"
  };
}

function deal4(state) {
  for (let i = 0; i < 4; i++) {
    for (const p of state.players) {
      p.hand.push(state.deck.pop());
    }
  }
}

function nextTurn(state) {
  const alive = state.players;
  state.turnIndex = (state.turnIndex + 1) % alive.length;
  state.turnPlayerId = alive[state.turnIndex].id;
  state.turnStep = "draw";
  state.drawnCard = null;
}

export function applyAction(state, playerId, action) {
  // Copy “enough” for MVP (not perfect immutability, but deterministic)
  const s = structuredClone(state);
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
        // first player
        s.turnIndex = 0;
        s.turnPlayerId = s.players[0].id;
        s.turnStep = "draw";
        s.phase = PHASES.TURN;
      }
      return s;
    }

    case "DRAW": {
      s.drawnCard = s.deck.pop();
      s.turnStep = "play";
      return s;
    }

    case "DISCARD": {
      const idx = me.hand.findIndex((c) => c.id === action.cardId);
      const [card] = me.hand.splice(idx, 1);

      // If player had a drawn card and chooses to discard from hand, put drawn card into hand first (simple rule)
      // But for MVP: require they either DISCARD drawnCard (by swapping) OR discard from hand and then discard drawnCard.
      // We'll implement cleaner: if drawnCard exists, discard it if they discarded a hand card.
      s.discard.push(card);

      if (s.drawnCard) {
        s.discard.push(s.drawnCard);
        s.drawnCard = null;
      }

      nextTurn(s);
      return s;
    }

    case "SWAP_WITH_HAND": {
      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      const target = me.hand[idx];
      me.hand[idx] = s.drawnCard;
      s.discard.push(target);
      s.drawnCard = null;
      nextTurn(s);
      return s;
    }

    case "SWAP_WITH_DISCARD": {
      // swap top discard with one of your hand cards (happens in draw step instead of drawing)
      const top = s.discard.pop();
      const idx = me.hand.findIndex((c) => c.id === action.targetCardId);
      const target = me.hand[idx];
      me.hand[idx] = top;
      s.discard.push(target);

      // after swap, you go to play step (you already “took” instead of drawing)
      s.turnStep = "play";
      s.drawnCard = null;
      return s;
    }

    default:
      return s;
  }
}
