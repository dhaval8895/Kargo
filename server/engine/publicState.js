// Public state = what a given player is allowed to see.
// For MVP: you can see your whole hand. Others are hidden (but we keep 2x2 UI behavior on client).

export function toPublicState(state, viewerPlayerId) {
  const s = structuredClone(state);

  s.players = s.players.map((p) => {
    if (p.id === viewerPlayerId) return p;

    // Hide other players' cards:
    return {
      ...p,
      hand: p.hand.map((c) => ({ id: c.id, hidden: true }))
    };
  });

  // hide deck exact order (only counts)
  s.deck = { count: state.deck.length };

  // discard is public: show top card only (MVP)
  const discard = state.discard;
  s.discard = discard.length ? [discard[discard.length - 1]] : [];

  return s;
}
