/**
 * throwPair payload variants:
 * 1) { kind: "DRAWN_MATCH", drawnCard, handIndices: [i] }
 *    - discard drawnCard + hand[i]
 *    - keep rest of hand, NO swap
 *    - net hand size = N - 1
 *
 * 2) { kind: "HAND_PAIR", drawnCard, handIndices: [i, j] }
 *    - discard hand[i] + hand[j]
 *    - keep drawnCard (it becomes part of your hand effectively)
 *    - net hand size = N - 1
 *
 * Return true/false
 */
export async function throwPair({ kind, drawnCard, handIndices }, { getState, setState }) {
  const state = getState();
  const meId = state.me.id;
  const hand = [...state.handsByPlayerId[meId]];

  if (!drawnCard) return false;

  if (kind === "DRAWN_MATCH") {
    const [i] = handIndices;
    if (i == null || !hand[i]) return false;
    if (hand[i].rank !== drawnCard.rank) return false;

    const discardAdds = [drawnCard, hand[i]];

    // remove the matched card from hand, keep the rest
    hand.splice(i, 1);

    setState({
      ...state,
      handsByPlayerId: {
        ...state.handsByPlayerId,
        [meId]: hand,
      },
      discardPile: [...state.discardPile, ...discardAdds],
    });

    return true;
  }

  if (kind === "HAND_PAIR") {
    const [i, j] = handIndices;
    if (i == null || j == null) return false;
    if (!hand[i] || !hand[j]) return false;
    if (hand[i].rank !== hand[j].rank) return false;

    const a = hand[i];
    const b = hand[j];

    // remove higher index first to avoid shifting
    const hi = Math.max(i, j);
    const lo = Math.min(i, j);
    hand.splice(hi, 1);
    hand.splice(lo, 1);

    // keep drawn card: it should now be part of your hand
    hand.push(drawnCard);

    setState({
      ...state,
      handsByPlayerId: {
        ...state.handsByPlayerId,
        [meId]: hand,
      },
      discardPile: [...state.discardPile, a, b],
    });

    return true;
  }

  return false;
}
