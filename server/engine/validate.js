export function validateAction(state, playerId, action) {
  if (!action?.type) return { ok: false, error: "Invalid action" };

  const me = state.players.find((p) => p.id === playerId);
  if (!me) return { ok: false, error: "Player not found" };

  switch (action.type) {
    case "READY":
      if (state.phase !== "lobby") return { ok: false, error: "Not in lobby" };
      return { ok: true };

    case "DRAW":
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (state.turnPlayerId !== playerId) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "draw") return { ok: false, error: "Must draw first" };
      if (state.deck.length === 0) return { ok: false, error: "Deck empty" };
      return { ok: true };

    case "DISCARD":
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (state.turnPlayerId !== playerId) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "play") return { ok: false, error: "Must draw before discarding" };
      if (!action.cardId) return { ok: false, error: "Missing cardId" };
      if (!me.hand.some((c) => c.id === action.cardId)) return { ok: false, error: "You don't have that card" };
      return { ok: true };

    case "SWAP_WITH_HAND":
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (state.turnPlayerId !== playerId) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "play") return { ok: false, error: "Must draw before swapping" };
      if (!state.drawnCard) return { ok: false, error: "No drawn card to swap" };
      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) return { ok: false, error: "You don't have that target card" };
      return { ok: true };

    case "SWAP_WITH_DISCARD":
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (state.turnPlayerId !== playerId) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "draw") return { ok: false, error: "Swap-with-discard happens instead of drawing" };
      if (state.discard.length === 0) return { ok: false, error: "Discard empty" };
      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) return { ok: false, error: "You don't have that target card" };
      return { ok: true };

    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}
