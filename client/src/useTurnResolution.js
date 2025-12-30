// src/useTurnResolution.js

/**
 * Turn Resolution Rules (LOCKED)
 *
 * After drawing:
 *  - You may throw a pair (ONLY before swap)
 *  - If you throw a pair, turn ends (hand size = N-1)
 *  - If you do NOT throw a pair, you MUST swap
 *  - After swap, pair throw is FORBIDDEN
 */

export function getPairOptions({ hand, drawnCard, hasSwapped }) {
  if (!drawnCard || hasSwapped) return [];

  const options = [];

  // Case 1: drawn card matches a hand card
  hand.forEach((c, i) => {
    if (c.rank === drawnCard.rank) {
      options.push({
        type: "DRAWN_MATCH",
        indices: [i],
      });
    }
  });

  // Case 2: pair already exists in hand
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].rank === hand[j].rank) {
        options.push({
          type: "HAND_PAIR",
          indices: [i, j],
        });
      }
    }
  }

  return options;
}
