const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

export function buildDeck() {
  const deck = [];
  let n = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `c_${n++}`, suit, rank });
    }
  }
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
