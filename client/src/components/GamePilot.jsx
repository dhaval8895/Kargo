import React, { useMemo, useState } from "react";

/**
 * MVP TURN LOOP (UPDATED TO YOUR RULE)
 * Draw -> Optional Throw Pair (ONLY while holding drawn card) -> Else Swap -> End Turn
 *
 * IMPORTANT:
 * - Pair throw is ONLY allowed while you are holding a drawn card (before swap).
 * - After swap, pair throw is NOT allowed.
 * - End Turn is always clickable; if blocked, it shows why.
 */

const sameRank = (a, b) => a && b && a.rank === b.rank;

function cardLabel(c) {
  if (!c) return "";
  return `${c.rank}${c.suit || ""}`;
}

export default function GamePilot({ me, gameState, actions }) {
  const isMyTurn = gameState?.currentTurnPlayerId === me?.id;

  const [drawnCard, setDrawnCard] = useState(null);
  const [uiHint, setUiHint] = useState("");

  const myHand = useMemo(() => {
    return (gameState?.handsByPlayerId?.[me?.id] || []).slice();
  }, [gameState, me?.id]);

  const holdingDrawn = !!drawnCard;

  // Pair options exist ONLY while holding a drawn card (before swap)
  const pairOptions = useMemo(() => {
    if (!isMyTurn || !holdingDrawn) return [];

    const opts = [];

    // A) Drawn match (drawn + one matching hand card)
    myHand.forEach((c, idx) => {
      if (sameRank(c, drawnCard)) {
        opts.push({
          id: `DRAWN_MATCH_${idx}`,
          kind: "DRAWN_MATCH",
          handIndices: [idx],
          label: `Throw: ${cardLabel(drawnCard)} + ${cardLabel(c)}`,
        });
      }
    });

    // B) Hand pair (two same-rank in hand) — keep drawn card
    for (let i = 0; i < myHand.length; i++) {
      for (let j = i + 1; j < myHand.length; j++) {
        if (sameRank(myHand[i], myHand[j])) {
          opts.push({
            id: `HAND_PAIR_${i}_${j}`,
            kind: "HAND_PAIR",
            handIndices: [i, j],
            label: `Throw: ${cardLabel(myHand[i])} + ${cardLabel(myHand[j])} (keep drawn)`,
          });
        }
      }
    }

    return opts;
  }, [isMyTurn, holdingDrawn, myHand, drawnCard]);

  // Swap is ONLY while holding drawn (and only if you didn't throw pair)
  const canSwap = isMyTurn && holdingDrawn;

  const endTurnBlockedReason = useMemo(() => {
    if (!isMyTurn) return "Not your turn.";
    if (holdingDrawn) return "Resolve your drawn card: throw a pair (if available) or swap it into your hand.";
    return "";
  }, [isMyTurn, holdingDrawn]);

  const clearHintSoon = () => {
    window.clearTimeout(clearHintSoon._t);
    clearHintSoon._t = window.setTimeout(() => setUiHint(""), 1800);
  };

  const onDrawDeck = async () => {
    setUiHint("");
    if (!isMyTurn) return bounceHint("Not your turn.");
    if (holdingDrawn) return bounceHint("You already drew — resolve it first.");

    const c = await actions.drawFromDeck?.();
    if (c) {
      setDrawnCard(c);
      actions.log?.({ player: me?.name, action: `drew deck (${cardLabel(c)})` });
    }
  };

  const onDrawDiscard = async () => {
    setUiHint("");
    if (!isMyTurn) return bounceHint("Not your turn.");
    if (holdingDrawn) return bounceHint("You already drew — resolve it first.");
    if (!gameState?.discardTop) return bounceHint("Discard is empty.");

    const c = await actions.drawFromDiscard?.();
    if (c) {
      setDrawnCard(c);
      actions.log?.({ player: me?.name, action: `drew discard (${cardLabel(c)})` });
    }
  };

  const onThrowPair = async (opt) => {
    setUiHint("");
    if (!isMyTurn || !holdingDrawn) return;

    const ok = await actions.throwPair?.({
      kind: opt.kind,
      drawnCard,
      handIndices: opt.handIndices,
    });

    if (ok) {
      actions.log?.({ player: me?.name, action: `threw pair (${opt.label})` });
      setDrawnCard(null);
      setUiHint("Pair thrown. Click End Turn.");
      return clearHintSoon();
    }

    bounceHint("Pair throw failed (server rejected).");
  };

  const onClickHandCard = async (handIndex) => {
    setUiHint("");
    if (!isMyTurn) return bounceHint("Not your turn.");

    // While holding drawn card, clicking a hand card performs swap (NO peek here)
    if (canSwap) {
      const ok = await actions.swapWithHandIndex?.({ drawnCard, handIndex });
      if (ok) {
        actions.log?.({
          player: me?.name,
          action: `swapped drawn (${cardLabel(drawnCard)}) with hand[${handIndex}]`,
        });
        setDrawnCard(null);
        setUiHint("Swapped. Click End Turn.");
        return clearHintSoon();
      }
      return bounceHint("Swap failed (server rejected).");
    }

    // Not holding drawn: this build doesn’t swap; (peek can be elsewhere)
    return bounceHint("Draw a card first.");
  };

  const onEndTurn = async () => {
    setUiHint("");
    if (endTurnBlockedReason) return bounceHint(endTurnBlockedReason);

    const ok = await actions.endTurn?.();
    if (ok) {
      actions.log?.({ player: me?.name, action: "ended turn" });
      setDrawnCard(null);
      setUiHint("");
    } else {
      bounceHint("End turn failed (server rejected).");
    }
  };

  function bounceHint(msg) {
    setUiHint(msg);
    clearHintSoon();
  }

  return (
    <div style={{ padding: 16, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.9 }}>
          Turn: <b>{isMyTurn ? "You" : "Opponent"}</b>
        </div>

        {/* End Turn is ALWAYS clickable + informative */}
        <button
          onClick={onEndTurn}
          title={endTurnBlockedReason || "End your turn"}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: endTurnBlockedReason ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.18)",
            color: "white",
            cursor: "pointer",
            fontWeight: 800,
            letterSpacing: 0.3,
            boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
          }}
        >
          End Turn
          {endTurnBlockedReason ? (
            <span style={{ marginLeft: 10, fontWeight: 600, opacity: 0.75, fontSize: 12 }}>
              (finish draw)
            </span>
          ) : null}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={onDrawDeck} style={btnStyle(isMyTurn && !holdingDrawn)}>
          Draw (Deck)
        </button>

        <button onClick={onDrawDiscard} style={btnStyle(isMyTurn && !holdingDrawn && !!gameState?.discardTop)}>
          Draw (Discard)
        </button>

        {holdingDrawn ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ opacity: 0.9, fontSize: 13 }}>
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

      {uiHint ? (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 12, background: "rgba(0,0,0,0.25)" }}>
          <span style={{ opacity: 0.95, fontSize: 13 }}>{uiHint}</span>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 8 }}>Your hand</div>
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
                opacity: isMyTurn ? 1 : 0.6,
              }}
              title={!isMyTurn ? "Not your turn" : holdingDrawn ? "Click to swap" : "Draw first"}
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
