export function toPublicState(state, viewerPlayerId) {
  const s = structuredClone(state);

  // Hide other players' hands
  s.players = s.players.map((p) => {
    if (p.id === viewerPlayerId) return p;
    return {
      ...p,
      hand: p.hand.map((c) => ({ id: c.id, hidden: true })),
    };
  });

  // Deck: only count
  s.deck = { count: state.deck.length };

  // Discard: show top card only
  const discard = state.discard;
  s.discard = discard.length ? [discard[discard.length - 1]] : [];

  // ✅ Drawn card: only visible to the current turn player
  const isTurnPlayer = state.turnPlayerId === viewerPlayerId;
  s.drawnCard = isTurnPlayer ? state.drawnCard : null;

  return s;
}
