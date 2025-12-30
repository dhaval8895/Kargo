import React, { useMemo, useState } from "react";

/**
 * MVP TURN LOOP (UPDATED)
 * Draw -> Optional Throw Pair (ONLY while holding drawn card) -> Else Swap -> End Turn
 *
 * UI: End Turn is always clickable (never "dead-gray").
 * If you try to end early, we show a friendly hint explaining what to do.
 */

/** Helpers */
const sameRank = (a, b) => a && b && a.rank === b.rank;

function cardLabel(c) {
  if (!c) return "";
  return `${c.rank}${c.suit || ""}`;
}

export default function GamePilot({
  // ----- These props are assumed to exist based on the current architecture -----
  me, // { id, name }
  gameState, // { currentTurnPlayerId, handsByPlayerId, discardTop, ... }
  actions, // { drawFromDeck, drawFromDiscard, swapWithHandIndex, throwPair, endTurn, log }
}) {
  const isMyTurn = gameState?.currentTurnPlayerId === me?.id;

  // Local (client) UI state — keep simple + deterministic
  const [drawnCard, setDrawnCard] = useState(null); // the drawn card you are holding this turn
  const [uiHint, setUiHint] = useState(""); // small helper text near buttons

  const myHand = useMemo(() => {
    return (gameState?.handsByPlayerId?.[me?.id] || []).slice();
  }, [gameState, me?.id]);

  // === Derived gating ===
  const holdingDrawn = !!drawnCard;

  // Pair options are ONLY available while holding drawn card
  const pairOptions = useMemo(() => {
    if (!isMyTurn || !holdingDrawn) return [];

    const opts = [];

    // Option A: Drawn-card match pair (drawn + one hand card of same rank)
    myHand.forEach((c, idx) => {
      if (sameRank(c, drawnCard)) {
        opts.push({
          id: `DRAWN_MATCH_${idx}`,
          kind: "DRAWN_MATCH",
          indices: [idx],
          label: `Throw pair: ${cardLabel(drawnCard)} + ${cardLabel(c)}`,
        });
      }
    });

    // Option B: Hand pair (two cards in hand) — keep drawn card
    for (let i = 0; i < myHand.length; i++) {
      for (let j = i + 1; j < myHand.length; j++) {
        if (sameRank(myHand[i], myHand[j])) {
          opts.push({
            id: `HAND_PAIR_${i}_${j}`,
            kind: "HAND_PAIR",
            indices: [i, j],
            label: `Throw hand pair: ${cardLabel(myHand[i])} + ${cardLabel(myHand[j])} (keep drawn)`,
          });
        }
      }
    }

    return opts;
  }, [isMyTurn, holdingDrawn, myHand, drawnCard]);

  // Swap is ONLY allowed if holding drawn card AND you did not throw a pair
  const canSwap = isMyTurn && holdingDrawn;

  // End Turn rule:
  // - You cannot end while holding a drawn card (must resolve it via throw pair OR swap)
  // But UI: button is ALWAYS clickable; we’ll show a hint if blocked.
  const endTurnBlockedReason = useMemo(() => {
    if (!isMyTurn) return "Not your turn.";
    if (holdingDrawn) return "You’re holding a drawn card — throw a pair (if available) or swap it into your hand.";
    return "";
  }, [isMyTurn, holdingDrawn]);

  // === Action handlers ===
  const clearHintSoon = () => {
    window.clearTimeout(clearHintSoon._t);
    clearHintSoon._t = window.setTimeout(() => setUiHint(""), 1800);
  };

  const onDrawDeck = async () => {
    setUiHint("");
    if (!isMyTurn) {
      setUiHint("Not your turn.");
      return clearHintSoon();
    }
    if (holdingDrawn) {
      setUiHint("You already drew a card — resolve it first.");
      return clearHintSoon();
    }

    const c = await actions.drawFromDeck?.();
    if (c) {
      setDrawnCard(c);
      actions.log?.({ player: me?.name, action: `drew from deck (${cardLabel(c)})` });
    }
  };

  const onDrawDiscard = async () => {
    setUiHint("");
    if (!isMyTurn) {
      setUiHint("Not your turn.");
      return clearHintSoon();
    }
    if (holdingDrawn) {
      setUiHint("You already drew a card — resolve it first.");
      return clearHintSoon();
    }

    const c = await actions.drawFromDiscard?.();
    if (c) {
      setDrawnCard(c);
      actions.log?.({ player: me?.name, action: `drew from discard (${cardLabel(c)})` });
    }
  };

  const onThrowPair = async (opt) => {
    setUiHint("");
    if (!isMyTurn || !holdingDrawn) return;

    // Throwing a pair ALWAYS resolves the drawn state and ends your “resolve drawn” requirement.
    // After a pair throw, you should NOT swap (per your rule).
    const payload =
      opt.kind === "DRAWN_MATCH"
        ? { kind: "DRAWN_MATCH", drawnCard, handIndices: opt.indices }
        : { kind: "HAND_PAIR", drawnCard, handIndices: opt.indices };

    const ok = await actions.throwPair?.(payload);
    if (ok) {
      actions.log?.({ player: me?.name, action: `threw pair (${opt.label})` });
      setDrawnCard(null);
      setUiHint("Pair thrown. Now you can End Turn.");
      clearHintSoon();
    }
  };

  const onClickHandCard = async (handIndex) => {
    setUiHint("");

    if (!isMyTurn) {
      setUiHint("Not your turn.");
      return clearHintSoon();
    }

    // IMPORTANT: While holding drawn card, clicking a hand card performs SWAP (no Peek).
    if (canSwap) {
      const ok = await actions.swapWithHandIndex?.({ drawnCard, handIndex });
      if (ok) {
        actions.log?.({
          player: me?.name,
          action: `swapped drawn (${cardLabel(drawnCard)}) with hand[${handIndex}]`,
        });
        setDrawnCard(null);
        setUiHint("Swapped. Now you can End Turn.");
        return clearHintSoon();
      }
      setUiHint("Swap failed. Try again.");
      return clearHintSoon();
    }

    // If not holding drawn card: (keep current behavior — Peek can live elsewhere)
    // Here we just hint so it’s obvious why nothing swapped.
    setUiHint("Draw a card first.");
    clearHintSoon();
  };

  const onEndTurn = async () => {
    setUiHint("");

    if (endTurnBlockedReason) {
      setUiHint(endTurnBlockedReason);
      return clearHintSoon();
    }

    const ok = await actions.endTurn?.();
    if (ok) {
      actions.log?.({ player: me?.name, action: "ended turn" });
      setUiHint("");
      // ensure no leaked drawn state
      setDrawnCard(null);
    }
  };

  // === UI ===
  return (
    <div style={{ padding: 16, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ fontSize: 14, opacity: 0.9 }}>
          Turn:{" "}
          <b style={{ opacity: 1 }}>
            {isMyTurn ? "You" : gameState?.playersById?.[gameState?.currentTurnPlayerId]?.name || "Opponent"}
          </b>
        </div>

        {/* Friendly End Turn button: always looks actionable */}
        <button
          onClick={onEndTurn}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: endTurnBlockedReason ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.18)",
            color: "white",
            cursor: "pointer",
            fontWeight: 700,
            letterSpacing: 0.3,
            boxShadow: endTurnBlockedReason ? "none" : "0 10px 24px rgba(0,0,0,0.25)",
            transform: endTurnBlockedReason ? "none" : "translateY(0)",
          }}
          title={endTurnBlockedReason || "End your turn"}
        >
          End Turn
          {endTurnBlockedReason ? (
            <span style={{ marginLeft: 10, fontWeight: 600, opacity: 0.75, fontSize: 12 }}>
              (finish draw)
            </span>
          ) : null}
        </button>
      </div>

      {/* Action row */}
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button
          onClick={onDrawDeck}
          style={btnStyle(isMyTurn && !holdingDrawn)}
          title={!isMyTurn ? "Not your turn" : holdingDrawn ? "Resolve your drawn card first" : "Draw from deck"}
        >
          Draw (Deck)
        </button>

        <button
          onClick={onDrawDiscard}
          style={btnStyle(isMyTurn && !holdingDrawn && !!gameState?.discardTop)}
          title={
            !isMyTurn
              ? "Not your turn"
              : holdingDrawn
              ? "Resolve your drawn card first"
              : !gameState?.discardTop
              ? "Discard is empty"
              : "Draw from discard"
          }
        >
          Draw (Discard)
        </button>

        {/* Pair throw options only show while holding drawn card */}
        {holdingDrawn ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ opacity: 0.85, fontSize: 13 }}>
              Drawn: <b>{cardLabel(drawnCard)}</b>
            </div>

            {pairOptions.length ? (
              pairOptions.map((opt) => (
                <button key={opt.id} onClick={() => onThrowPair(opt)} style={btnStyle(true)}>
                  {opt.label}
                </button>
              ))
            ) : (
              <div style={{ opacity: 0.75, fontSize: 13 }}>
                No pair available — click a hand card to swap.
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* hint */}
      {uiHint ? (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "rgba(0,0,0,0.25)" }}>
          <span style={{ opacity: 0.95, fontSize: 13 }}>{uiHint}</span>
        </div>
      ) : null}

      {/* Hand */}
      <div style={{ marginTop: 18 }}>
        <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 8 }}>Your hand (click to swap only when holding drawn)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 150px)", gap: 12 }}>
          {myHand.map((c, idx) => (
            <button
              key={idx}
              onClick={() => onClickHandCard(idx)}
              style={{
                width: 150,
                height: 210,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                color: "white",
                cursor: isMyTurn ? "pointer" : "not-allowed",
                boxShadow: holdingDrawn ? "0 14px 30px rgba(0,0,0,0.30)" : "none",
                opacity: isMyTurn ? 1 : 0.6,
              }}
              title={
                !isMyTurn
                  ? "Not your turn"
                  : holdingDrawn
                  ? "Swap: this card will go to discard, drawn card replaces it"
                  : "Draw first"
              }
            >
              <div style={{ fontSize: 20, fontWeight: 800 }}>{cardLabel(c)}</div>
              <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                {holdingDrawn ? "Click to swap" : "Draw to act"}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function btnStyle(enabled) {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: enabled ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
    color: "white",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.55,
    fontWeight: 700,
  };
}
