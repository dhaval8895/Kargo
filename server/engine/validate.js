export function validateAction(state, playerId, action) {
  if (!action?.type) return { ok: false, error: "Invalid action" };

  const me = (state.players || []).find((p) => p.id === playerId);
  if (!me) return { ok: false, error: "Player not found" };

  // Lobby
  if (action.type === "READY") {
    if (state.phase !== "lobby") return { ok: false, error: "Not in lobby" };
    return { ok: true };
  }

  // Turn gate
  if (state.phase !== "turn") return { ok: false, error: "Game not started" };
  if (state.turnPlayerId !== playerId) return { ok: false, error: "Not your turn" };

  switch (action.type) {
    case "DRAW": {
      if (state.turnStep !== "draw") return { ok: false, error: "You already drew" };
      if (!Array.isArray(state.deck) || state.deck.length === 0) return { ok: false, error: "Deck empty" };
      return { ok: true };
    }

    case "SWAP_DRAWN_WITH_HAND": {
      if (state.turnStep !== "swap") return { ok: false, error: "You must draw first" };
      if (!state.drawnCard) return { ok: false, error: "No drawn card" };
      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) return { ok: false, error: "You don't have that card" };
      return { ok: true };
    }

    case "END_TURN": {
      if (state.turnStep !== "pair") return { ok: false, error: "You must swap before ending turn" };
      return { ok: true };
    }

    case "THROW_PAIR": {
      if (state.turnStep !== "pair") return { ok: false, error: "Throw pair is only after swap" };
      const a = action.a;
      const b = action.b;
      if (!a || !b) return { ok: false, error: "Select two cards" };
      if (a === b) return { ok: false, error: "Pick two different cards" };

      const ids = new Set(me.hand.map((c) => c.id));
      if (!ids.has(a) || !ids.has(b)) return { ok: false, error: "Selected cards must be in your hand" };

      // Must have at least 1 card in deck to resolve success/fail outcomes
      if (!Array.isArray(state.deck) || state.deck.length === 0) {
        return { ok: false, error: "Deck empty" };
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}
