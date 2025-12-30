export function validateAction(state, playerId, action) {
  if (!action?.type) return { ok: false, error: "Invalid action" };

  const me = state.players.find((p) => p.id === playerId);
  if (!me) return { ok: false, error: "Player not found" };

  const isMyTurn = state.turnPlayerId === playerId;

  switch (action.type) {
    case "READY": {
      if (state.phase !== "lobby") return { ok: false, error: "Not in lobby" };
      return { ok: true };
    }

    // ---- Turn: Step = "draw" (choose draw OR swap with discard) ----
    case "DRAW": {
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (!isMyTurn) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "draw") return { ok: false, error: "You already drew" };
      if (state.deck.length === 0) return { ok: false, error: "Deck empty" };
      return { ok: true };
    }

    case "SWAP_WITH_DISCARD": {
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (!isMyTurn) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "draw") return { ok: false, error: "Must do this before drawing" };
      if (state.discard.length === 0) return { ok: false, error: "Discard empty" };

      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) {
        return { ok: false, error: "You don't have that card" };
      }
      return { ok: true };
    }

    // ---- Turn: Step = "play" (after DRAW only) ----
    case "SWAP_DRAWN_WITH_HAND": {
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (!isMyTurn) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "play") return { ok: false, error: "You must draw first" };
      if (!state.drawnCard) return { ok: false, error: "No drawn card" };

      if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
      if (!me.hand.some((c) => c.id === action.targetCardId)) {
        return { ok: false, error: "You don't have that card" };
      }
      return { ok: true };
    }

    case "DISCARD_DRAWN": {
      if (state.phase !== "turn") return { ok: false, error: "Game not started" };
      if (!isMyTurn) return { ok: false, error: "Not your turn" };
      if (state.turnStep !== "play") return { ok: false, error: "You must draw first" };
      if (!state.drawnCard) return { ok: false, error: "No drawn card" };
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}
