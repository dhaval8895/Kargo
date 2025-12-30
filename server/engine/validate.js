// server/validate.js
import { PHASES } from "./types.js";

export function validate(state, playerId, action) {
  if (!action || !action.type) return { ok: false, error: "Bad action" };
  if (state.winnerPlayerId) return { ok: false, error: "Game over" };

  const isTurnPlayer = state.phase === PHASES.TURN && state.turnPlayerId === playerId;

  // Lobby
  if (action.type === "READY") {
    if (state.phase !== PHASES.LOBBY) return { ok: false, error: "Not in lobby" };
    return { ok: true };
  }

  // Claim window: any player may attempt while open
  if (action.type === "CLAIM_DISCARD") {
    if (!state.claim || !state.claim.open) return { ok: false, error: "No claim window" };

    // one attempt per player per window (server authoritative)
    if (state.claim.attemptedBy && state.claim.attemptedBy[playerId]) {
      return { ok: false, error: "Already attempted claim" };
    }

    return { ok: true };
  }

  // Everything below requires turn phase + turn player
  if (state.phase !== PHASES.TURN) return { ok: false, error: "Not in turn phase" };
  if (!isTurnPlayer) return { ok: false, error: "Not your turn" };

  // Draw
  if (action.type === "DRAW") {
    if (state.turnStep !== "draw") return { ok: false, error: "You must resolve first" };
    if (state.drawnCard) return { ok: false, error: "Already holding drawn card" };
    return { ok: true };
  }

  // Resolve actions (after draw)
  // NOTE: Your new model is: draw -> resolve (swap/match OR guess) -> end
  if (action.type === "SWAP_DRAWN_WITH_HAND") {
    if (state.turnStep !== "resolve") return { ok: false, error: "You must draw first" };
    if (!state.drawnCard) return { ok: false, error: "You must draw first" };
    if (!action.targetCardId) return { ok: false, error: "Missing targetCardId" };
    return { ok: true };
  }

  if (action.type === "GUESS_PAIR") {
    if (state.turnStep !== "resolve") return { ok: false, error: "You must draw first" };
    if (!state.drawnCard) return { ok: false, error: "You must draw first" };
    if (!action.a || !action.b) return { ok: false, error: "Missing pair selection" };

    // no retry per draw (server authoritative)
    if (state.resolve?.guessAttempted) {
      return { ok: false, error: "No retry" };
    }
    return { ok: true };
  }

  // End turn
  if (action.type === "END_TURN") {
    if (state.drawnCard) return { ok: false, error: "Resolve your drawn card first" };
    return { ok: true };
  }

  // Unknown action
  return { ok: false, error: `Unknown action: ${action.type}` };
}
