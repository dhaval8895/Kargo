import React, { useMemo, useState, useEffect } from "react";
import Card from "./Card";
import ActivityMonitor from "./ActivityMonitor";
import PeekModal from "./PeekModal";
import { useRoom } from "../hooks/useRoom";

export default function GamePilot() {
  const room = useRoom();

  // Lobby
  const [name, setName] = useState("Player");
  const [roomCode, setRoomCode] = useState("");

  // Peek
  const [peekCard, setPeekCard] = useState(null);

  // Throw-pair UI
  const [pairMode, setPairMode] = useState(false);
  const [pairSel, setPairSel] = useState([]); // [idA, idB]

  // ✅ NEW: UX hint + local swap gate
  const [hint, setHint] = useState("");
  const [swappedThisDraw, setSwappedThisDraw] = useState(false);

  const state = room.state;

  const { me, myHand, opponents } = useMemo(() => {
    if (!state || !room.playerId) return { me: null, myHand: [], opponents: [] };
    const me = state.players?.find((p) => p.id === room.playerId) || null;
    const others = (state.players || []).filter((p) => p.id !== room.playerId);
    return { me, myHand: me?.hand || [], opponents: others };
  }, [state, room.playerId]);

  const phase = state?.phase || "—";
  const isMyTurn = state?.turnPlayerId === room.playerId;
  const turnStep = state?.turnStep || "—";

  const deckCount = state?.deck?.count ?? 0;
  const discardTop = state?.discard?.[0] || null;
  const drawn = state?.drawnCard || null;

  // Reset local gates whenever drawn changes or turn changes
  useEffect(() => {
    setHint("");
    setPairMode(false);
    setPairSel([]);
    // If there is no drawn card, you are not in a "post-draw" state
    if (!drawn) setSwappedThisDraw(false);
  }, [drawn, state?.turnPlayerId]);

  const canReady = phase === "lobby" && !!room.roomId;

  // Draw is only allowed by your server step gate (leave as-is)
  const canDraw = phase === "turn" && isMyTurn && turnStep === "draw";

  // Swap-by-click is allowed whenever you have a drawn card on your turn
  // ✅ plus local gate: after you swap once, drawn becomes null anyway, but keep the flag for clarity
  const canSwapByClick = phase === "turn" && isMyTurn && !!drawn;

  /**
   * ✅ NEW RULE:
   * Throw Pair is ONLY allowed immediately after draw, BEFORE swap.
   * That means:
   *  - must be your turn
   *  - must be holding drawn
   *  - must NOT have swapped since drawing
   *
   * We do NOT rely on server turnStep === "pair" anymore because that was the old rule.
   */
  const canThrowPair = phase === "turn" && isMyTurn && !!drawn && !swappedThisDraw;

  /**
   * ✅ End Turn UX:
   * Button is always clickable.
   * But "allowed" only when:
   *  - not your turn => blocked
   *  - OR you are holding drawn => blocked (must throw pair or swap)
   */
  const endTurnBlockedReason = useMemo(() => {
    if (phase !== "turn") return "Not in turn phase.";
    if (!isMyTurn) return "Not your turn.";
    if (drawn) return "Resolve your drawn card: throw a pair (if possible) or swap it.";
    return "";
  }, [phase, isMyTurn, drawn]);

  async function onCreate() {
    const res = await room.createRoom(name?.trim() || "Player");
    if (!res?.ok) alert(res?.error || "Failed to create room");
  }

  async function onJoin() {
    const code = (roomCode || "").trim();
    if (!code) return alert("Enter room code");
    const res = await room.joinRoom(code, name?.trim() || "Player");
    if (!res?.ok) alert(res?.error || "Failed to join room");
  }

  async function send(action) {
    const res = await room.action(action);
    if (!res?.ok) alert(res?.error || "Action failed");
  }

  function onHandCardClick(card) {
    if (!card?.id) return;

    // Pair selection mode (hand-hand pair)
    if (pairMode) {
      setPairSel((prev) => {
        const has = prev.includes(card.id);
        if (has) return prev.filter((x) => x !== card.id);
        if (prev.length >= 2) return prev; // max 2
        return [...prev, card.id];
      });
      return;
    }

    // ✅ Swap-by-click wins over peek
    if (canSwapByClick) {
      setHint("");
      setSwappedThisDraw(true);
      send({ type: "SWAP_DRAWN_WITH_HAND", targetCardId: card.id });
      return;
    }

    // Otherwise: peek
    setPeekCard(card);
  }

  function togglePairMode() {
    if (!canThrowPair) {
      setHint(drawn ? "You must throw pair BEFORE swap." : "Draw a card first.");
      return;
    }
    setHint("");
    setPairMode((v) => !v);
    setPairSel([]);
  }

  // ✅ NEW: one-click option when drawn matches a hand card
  const drawnMatchTargets = useMemo(() => {
    if (!canThrowPair || !drawn) return [];
    const matches = myHand.filter((c) => c?.rank === drawn.rank);
    return matches;
  }, [canThrowPair, drawn, myHand]);

  async function throwPairWithDrawn(targetHandCardId) {
    if (!canThrowPair || !drawn) return;
    setHint("");
    // NEW action type (server must support)
    await send({ type: "THROW_PAIR_WITH_DRAWN", targetCardId: targetHandCardId });
    setPairMode(false);
    setPairSel([]);
  }

  async function confirmPair() {
    if (!canThrowPair) {
      setHint(drawn ? "You must throw pair BEFORE swap." : "Draw a card first.");
      return;
    }
    if (pairSel.length !== 2) return alert("Select exactly two cards");

    setHint("");

    // NEW action type: two hand cards, keep drawn (server must support)
    await send({ type: "THROW_PAIR_FROM_HAND_KEEP_DRAWN", a: pairSel[0], b: pairSel[1] });

    setPairMode(false);
    setPairSel([]);
  }

  async function endTurn() {
    // Always clickable; if blocked, show hint
    if (endTurnBlockedReason) {
      setHint(endTurnBlockedReason);
      return;
    }
    setHint("");
    await send({ type: "END_TURN" });
    setPairMode(false);
    setPairSel([]);
  }

  const opponentNames = opponents.map((p) => p.name).filter(Boolean).join(" • ");

  return (
    <div style={styles.bg}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>KARGO — MVP</div>
            <div style={styles.sub}>
              {room.connected ? "Connected" : "Kargo is offline"}{" "}
              {room.roomId ? `• Room: ${room.roomId}` : ""}
            </div>
          </div>
          <div style={styles.pills}>
            <span style={styles.pill}>Phase: {phase}</span>
            <span style={styles.pill}>
              {phase === "turn"
                ? isMyTurn
                  ? `Your turn • ${turnStep}`
                  : `Waiting • ${turnStep}`
                : "—"}
            </span>
          </div>
        </div>

        <div style={styles.lobby}>
          <input
            style={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />

          {!room.roomId ? (
            <>
              <button style={styles.btn} onClick={onCreate} disabled={!room.connected}>
                Create Room
              </button>

              <input
                style={styles.input}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="Room code (6 digits)"
                inputMode="numeric"
              />
              <button style={styles.btn} onClick={onJoin} disabled={!room.connected}>
                Join Room
              </button>
            </>
          ) : (
            <>
              <button style={styles.btn} onClick={() => send({ type: "READY" })} disabled={!canReady}>
                Ready
              </button>
              <div style={styles.roomHelp}>
                Share code: <b>{room.roomId}</b>
              </div>
            </>
          )}
        </div>

        <ActivityMonitor events={room.activity || []} />

        <div style={styles.table}>
          <div style={styles.opponents}>{opponentNames || "Waiting for players…"}</div>

          <div style={styles.center}>
            {/* Draw */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Draw ({deckCount})</div>
              <div
                style={{
                  ...styles.deck,
                  opacity: canDraw ? 1 : 0.6,
                  cursor: canDraw ? "pointer" : "default",
                }}
                onClick={() => canDraw && send({ type: "DRAW" })}
                title={canDraw ? "Click to draw" : "Not available"}
              >
                <div style={styles.deckCard} />
                <div style={{ ...styles.deckCard, transform: "translate(3px,-3px)" }} />
                <div style={{ ...styles.deckCard, transform: "translate(6px,-6px)" }} />
              </div>
              <div style={styles.miniHelp}>{canDraw ? "Click to draw" : "—"}</div>
            </div>

            {/* Drawn */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Drawn</div>
              {drawn ? (
                <Card rank={drawn.rank} suit={drawn.suit} faceDown={false} />
              ) : (
                <div style={styles.emptyPile}>—</div>
              )}
              <div style={styles.miniHelp}>
                {isMyTurn && drawn ? (canThrowPair ? "Throw pair OR click a hand card to swap" : "Click a hand card to swap") : "—"}
              </div>
            </div>

            {/* Discard */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Discard</div>
              {discardTop ? (
                <Card rank={discardTop.rank} suit={discardTop.suit} faceDown={false} />
              ) : (
                <div style={styles.emptyPile}>Empty</div>
              )}
              <div style={styles.miniHelp}>—</div>
            </div>
          </div>

          {/* Hand */}
          <div style={{ marginTop: 6 }}>
            <div style={styles.label}>
              Your Hand {me?.name ? <span style={{ opacity: 0.6 }}>• {me.name}</span> : null}
            </div>

            <div style={styles.hand}>
              {myHand.map((c, i) => {
                const selected = pairSel.includes(c?.id);
                return (
                  <div
                    key={c?.id || i}
                    style={{
                      borderRadius: 16,
                      outline: selected ? "2px solid rgba(255,255,255,.30)" : "2px solid transparent",
                      padding: 2,
                    }}
                  >
                    <Card
                      rank={c?.rank}
                      suit={c?.suit}
                      faceDown={false}
                      onClick={() => onHandCardClick(c)}
                    />
                  </div>
                );
              })}
            </div>

            <div style={styles.actions}>
              {/* ✅ New: quick “drawn match” button(s) */}
              {canThrowPair && drawnMatchTargets.length > 0 ? (
                drawnMatchTargets.map((c) => (
                  <button
                    key={c.id}
                    style={styles.btn}
                    onClick={() => throwPairWithDrawn(c.id)}
                    title="Throw pair using drawn + this matching card"
                  >
                    Throw {drawn.rank} Pair
                  </button>
                ))
              ) : null}

              <button
                style={styles.btn}
                disabled={!canThrowPair}
                onClick={togglePairMode}
                title="Throw a hand pair (keep drawn) — only before swap"
              >
                {pairMode ? "Cancel Pair" : "Throw Pair"}
              </button>

              <button
                style={styles.btn}
                disabled={!pairMode || pairSel.length !== 2 || !canThrowPair}
                onClick={confirmPair}
                title="Confirm selected hand pair"
              >
                Confirm
              </button>

              {/* ✅ End Turn: always clickable */}
              <button
                style={{
                  ...styles.btnGhost,
                  opacity: endTurnBlockedReason ? 1 : styles.btnGhost.opacity,
                }}
                onClick={endTurn}
                title={endTurnBlockedReason || "End turn"}
              >
                End Turn{endTurnBlockedReason ? " (finish draw)" : ""}
              </button>
            </div>

            {/* ✅ New hint area */}
            {hint ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, textAlign: "right" }}>
                {hint}
              </div>
            ) : (
              <div style={styles.footerHelp}>
                {isMyTurn && drawn ? "Resolve drawn: throw pair (if possible) or swap by clicking a hand card." : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      <PeekModal open={!!peekCard} card={peekCard} title="Peek" onClose={() => setPeekCard(null)} />
    </div>
  );
}

// styles unchanged (copied verbatim from your file)
const styles = {
  bg: {
    minHeight: "100vh",
    background:
      "radial-gradient(1100px 700px at 20% 10%, rgba(80,140,255,.18), transparent 55%)," +
      "radial-gradient(900px 700px at 80% 20%, rgba(255,180,80,.10), transparent 60%)," +
      "radial-gradient(900px 700px at 55% 95%, rgba(120,255,200,.08), transparent 55%)," +
      "#0b0f14",
    color: "rgba(255,255,255,.92)",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
  },
  wrap: { maxWidth: 980, margin: "0 auto", padding: 12 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 18,
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.12)",
    marginBottom: 10,
    alignItems: "center",
  },
  title: { fontWeight: 900, letterSpacing: 0.4 },
  sub: { fontSize: 12, opacity: 0.7, marginTop: 2 },
  pills: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
  pill: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.12)",
    opacity: 0.95,
  },
  lobby: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 10,
    padding: 10,
    borderRadius: 18,
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  input: {
    borderRadius: 14,
    padding: "10px 12px",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.14)",
    color: "rgba(255,255,255,.92)",
    outline: "none",
    minWidth: 170,
  },
  roomHelp: {
    fontSize: 12,
    opacity: 0.8,
    marginLeft: "auto",
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.12)",
  },
  table: {
    background: "rgba(255,255,255,.07)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.12)",
    padding: 12,
  },
  opponents: { fontSize: 13, opacity: 0.7, marginBottom: 6 },
  center: {
    display: "flex",
    justifyContent: "center",
    gap: 22,
    padding: "12px 0",
    flexWrap: "wrap",
  },
  pileCol: { display: "grid", justifyItems: "center", gap: 6, minWidth: 110 },
  deck: { width: 86, height: 118, position: "relative" },
  deckCard: {
    position: "absolute",
    inset: 0,
    borderRadius: 14,
    background:
      "linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.04))",
    border: "1px solid rgba(255,255,255,.16)",
    boxShadow: "0 12px 28px rgba(0,0,0,.28)",
  },
  emptyPile: {
    width: 86,
    height: 118,
    borderRadius: 14,
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.12)",
    opacity: 0.7,
  },
  label: { fontSize: 12, opacity: 0.6, marginBottom: 2 },
  hand: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
    justifyItems: "center",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  miniHelp: { fontSize: 11, opacity: 0.55, textAlign: "center" },
  footerHelp: { fontSize: 11, opacity: 0.55, marginTop: 8, textAlign: "right" },
  btn: {
    borderRadius: 14,
    padding: "10px 12px",
    background: "rgba(255,255,255,.10)",
    border: "1px solid rgba(255,255,255,.16)",
    color: "rgba(255,255,255,.92)",
    cursor: "pointer",
  },
  btnGhost: {
    borderRadius: 14,
    padding: "10px 12px",
    background: "transparent",
    border: "1px solid rgba(255,255,255,.16)",
    color: "rgba(255,255,255,.80)",
    cursor: "pointer",
    opacity: 0.9,
  },
};
