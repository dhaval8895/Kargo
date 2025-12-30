import { useEffect, useMemo, useState } from "react";
import { getPairOptions } from "./useTurnResolution";

export default function GamePilot({
  me,
  gameState,
  actions,
  Lobby,          // ← your existing lobby component
  Table,          // ← your existing table/cards component
}) {
  const isMyTurn = gameState.currentTurnPlayerId === me.id;
  const myHand = gameState.handsByPlayerId[me.id] || [];

  const [drawnCard, setDrawnCard] = useState(null);
  const [hasSwapped, setHasSwapped] = useState(false);
  const [hint, setHint] = useState("");

  /** RESET PER TURN */
  useEffect(() => {
    setDrawnCard(null);
    setHasSwapped(false);
    setHint("");
  }, [gameState.currentTurnPlayerId]);

  /** PAIR OPTIONS (authoritative) */
  const pairOptions = useMemo(
    () =>
      getPairOptions({
        hand: myHand,
        drawnCard,
        hasSwapped,
      }),
    [myHand, drawnCard, hasSwapped]
  );

  const holdingDrawn = !!drawnCard;

  /** DRAW */
  async function onDrawDeck() {
    if (!isMyTurn || holdingDrawn) return;
    const c = await actions.drawFromDeck();
    setDrawnCard(c);
  }

  async function onDrawDiscard() {
    if (!isMyTurn || holdingDrawn) return;
    const c = await actions.drawFromDiscard();
    setDrawnCard(c);
  }

  /** THROW PAIR (BEFORE SWAP ONLY) */
  async function onThrowPair(option) {
    if (!holdingDrawn || hasSwapped) return;

    await actions.throwPair({
      type: option.type,
      drawnCard,
      indices: option.indices,
    });

    setDrawnCard(null);
    setHint("Pair thrown. End your turn.");
  }

  /** SWAP (ONLY IF NO PAIR USED) */
  async function onSwap(handIndex) {
    if (!holdingDrawn || hasSwapped) return;

    await actions.swapWithHandIndex({
      drawnCard,
      handIndex,
    });

    setDrawnCard(null);
    setHasSwapped(true);
    setHint("Swapped. End your turn.");
  }

  /** END TURN (FRIENDLY UX) */
  async function onEndTurn() {
    if (holdingDrawn) {
      setHint("Finish your draw: throw a pair or swap.");
      return;
    }
    await actions.endTurn();
  }

  return (
    <>
      {/* ✅ LOBBY / READY / GAME HEADER */}
      <Lobby gameState={gameState} />

      {/* ✅ MAIN TABLE / CARDS */}
      <Table
        gameState={gameState}
        drawnCard={drawnCard}
        onHandCardClick={onSwap}
      />

      {/* ✅ TURN CONTROLS */}
      <div className="turn-controls">
        <button onClick={onDrawDeck} disabled={!isMyTurn || holdingDrawn}>
          Draw (Deck)
        </button>

        <button onClick={onDrawDiscard} disabled={!isMyTurn || holdingDrawn}>
          Draw (Discard)
        </button>

        {pairOptions.length > 0 && (
          <div className="pair-options">
            {pairOptions.map((opt, i) => (
              <button key={i} onClick={() => onThrowPair(opt)}>
                Throw Pair
              </button>
            ))}
          </div>
        )}

        <button onClick={onEndTurn} className="end-turn">
          End Turn
        </button>

        {hint && <div className="turn-hint">{hint}</div>}
      </div>
    </>
  );
}
