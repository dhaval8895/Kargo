export function validateAction(state, playerId, action) {
  if (!action || !action.type) return { ok: false, error: "Invalid action" };

  const me = (state.players || []).find((p) => p.id === playerId);
  if (!me) return { ok: false, error: "Player not found" };

  if (action.type === "READY") {
    if (state.phase !== "lobby") return { ok: false, error: "Not in lobby" };
    return { ok: true };
  }

  const isMyTurn = state.turnPlayerId === playerId;

  if (state.phase !== "turn") return { ok: false, error: "Game not started" };
  if (!isMyTurn) return { ok: false, error: "Not your turn" };

  switch (action.type) {
    case "DRAW": {
      if (state.turnStep !== "draw") return { ok: false, error: "You already drew" };
      if (!Array.isArray(state.deck) || state.deck.length === 0) return { ok: false, error: "Deck empty" };
      return { ok: true };
    }

    case "SWAP_WITH_DISCARD": {
      if (state.turnStep !== "draw") return { ok: false, error: "Must do this before drawing" };
      if (!Array.isArray(state.discard) || state.discard.length === 0) return { ok: false, error: "Discard empty" };
      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) return { ok: false, error: "You don't have that card" };
      return { ok: true };
    }

    case "SWAP_DRAWN_WITH_HAND": {
      if (state.turnStep !== "play") return { ok: false, error: "You must draw first" };
      if (!state.drawnCard) return { ok: false, error: "No drawn card" };
      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) return { ok: false, error: "You don't have that card" };
      return { ok: true };
    }

    case "DISCARD_DRAWN": {
      if (state.turnStep !== "play") return { ok: false, error: "You must draw first" };
      if (!state.drawnCard) return { ok: false, error: "No drawn card" };
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}
