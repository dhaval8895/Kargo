import React, { useEffect, useMemo, useState } from "react";
import Card from "./Card";
import ActivityMonitor from "./ActivityMonitor";
import PeekModal from "./PeekModal";
import { useRoom } from "../hooks/useRoom";

/**
 * GamePilot.jsx — Real Multiplayer MVP UI
 * - Vite client on Vercel
 * - Socket.io server on Render
 * - Works with actions:
 *   READY, DRAW, SWAP_WITH_DISCARD, SWAP_DRAWN_WITH_HAND, DISCARD_DRAWN
 * - Shows drawn card in the center (always visible slot)
 * - Keeps your 2x2 hand grid + PeekModal + ActivityMonitor
 */
export default function GamePilot() {
  const room = useRoom();

  // Lobby inputs
  const [name, setName] = useState("Player");
  const [roomCode, setRoomCode] = useState("");

  // UI state
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [peekCard, setPeekCard] = useState(null);

  // “Bottom two revealed once” effect (client-side visual only)
  const [initialRevealActive, setInitialRevealActive] = useState(false);
  const [initialRevealUsedForHandKey, setInitialRevealUsedForHandKey] = useState(null);

  const state = room.state;

  const { me, myHand, opponents } = useMemo(() => {
    const s = state;
    if (!s || !room.playerId) return { me: null, myHand: [], opponents: [] };

    const me = s.players?.find((p) => p.id === room.playerId) || null;
    const others = (s.players || []).filter((p) => p.id !== room.playerId);

    return { me, myHand: me?.hand || [], opponents: others };
  }, [state, room.playerId]);

  const deckCount = state?.deck?.count ?? state?.deck?.length ?? 0;
  const discardTop = state?.discard?.[0] || null; // server sends top-only
  const drawn = state?.drawnCard || null;

  const isMyTurn = state?.turnPlayerId === room.playerId;
  const turnStep = state?.turnStep || "—";
  const phase = state?.phase || "—";

  // Enable/disable controls
  const canReady = phase === "lobby" && !!room.roomId && !!room.playerId;
  const canDraw = phase === "turn" && isMyTurn && turnStep === "draw";
  const canSwapDiscard =
    phase === "turn" && isMyTurn && turnStep === "draw" && !!discardTop && !!selectedCardId;
  const canSwapDrawn =
    phase === "turn" && isMyTurn && turnStep === "play" && !!drawn && !!selectedCardId;
  const canDiscardDrawn = phase === "turn" && isMyTurn && turnStep === "play" && !!drawn;

  // Keep selection valid
  useEffect(() => {
    if (!selectedCardId) return;
    if (!myHand.some((c) => c?.id === selectedCardId)) setSelectedCardId(null);
  }, [myHand, selectedCardId]);

  // Trigger initial reveal once per new hand (simple heuristic)
  useEffect(() => {
    if (!state || phase === "lobby") return;
    if (!myHand || myHand.length !== 4) return;

    // Create a stable-ish hand key from card ids
    const handKey = myHand.map((c) => c?.id).join("|");
    if (!handKey) return;

    if (initialRevealUsedForHandKey !== handKey) {
      setInitialRevealUsedForHandKey(handKey);
      setInitialRevealActive(true);
      const t = setTimeout(() => setInitialRevealActive(false), 2200);
      return () => clearTimeout(t);
    }
  }, [state, phase, myHand, initialRevealUsedForHandKey]);

  async function safeCall(promise, fallbackMsg) {
    try {
      const res = await promise;
      if (!res?.ok) alert(res?.error || fallbackMsg);
      return res;
    } catch (e) {
      alert(e?.message || fallbackMsg);
      return null;
    }
  }

  async function onCreateRoom() {
    await safeCall(room.createRoom(name?.trim() || "Player"), "Failed to create room");
  }

  async function onJoinRoom() {
    const code = (roomCode || "").trim();
    if (!code) return alert("Enter a 6-digit room code");
    await safeCall(room.joinRoom(code, name?.trim() || "Player"), "Failed to join room");
  }

  async function send(action) {
    await safeCall(room.action(action), "Action failed");
  }

  function onCardClick(card) {
    if (!card?.id) return;
    setSelectedCardId(card.id);
    setPeekCard(card);
  }

  // Hide UI cards for opponents (server already hides by sending {hidden:true})
  const opponentNames = opponents.map((p) => p.name).filter(Boolean).join(" • ");

  return (
    <div style={styles.bg}>
      <div style={styles.wrap}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.title}>KARGO — MVP</div>
            <div style={styles.sub}>
              {room.connected ? "Connected" : "Offline"}{" "}
              {room.roomId ? `• Room: ${room.roomId}` : ""}
            </div>
          </div>

          <div style={styles.pills}>
            <span style={styles.pill}>Phase: {phase}</span>
            <span style={styles.pill}>
              {phase === "turn" ? (isMyTurn ? `Your turn • ${turnStep}` : `Waiting • ${turnStep}`) : "—"}
            </span>
          </div>
        </div>

        {/* Lobby Controls */}
        <div style={styles.lobby}>
          <input
            style={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />

          {!room.roomId ? (
            <>
              <button style={styles.btn} onClick={onCreateRoom} disabled={!room.connected}>
                Create Room
              </button>

              <input
                style={styles.input}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                placeholder="Room code (6 digits)"
                inputMode="numeric"
              />
              <button style={styles.btn} onClick={onJoinRoom} disabled={!room.connected}>
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

        {/* Activity */}
        <ActivityMonitor events={room.activity || []} />

        {/* Table */}
        <div style={styles.table}>
          <div style={styles.opponents}>
            {opponentNames || "Waiting for players…"}
          </div>

          {/* Center piles */}
          <div style={styles.center}>
            {/* Draw pile */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Draw ({deckCount})</div>
              <div
                style={{
                  ...styles.deck,
                  opacity: canDraw ? 1 : 0.6,
                  cursor: canDraw ? "pointer" : "default",
                }}
                onClick={() => canDraw && send({ type: "DRAW" })}
                title={canDraw ? "Draw" : "Not available"}
              >
                <div style={styles.deckCard} />
                <div style={{ ...styles.deckCard, transform: "translate(3px,-3px)" }} />
                <div style={{ ...styles.deckCard, transform: "translate(6px,-6px)" }} />
              </div>
              <div style={styles.miniHelp}>
                {canDraw ? "Click to draw" : phase === "turn" ? "—" : "Not started"}
              </div>
            </div>

            {/* Drawn card (ALWAYS show slot) */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Drawn</div>
              {drawn ? (
                <Card rank={drawn.rank} suit={drawn.suit} faceDown={false} />
              ) : (
                <div style={styles.emptyPile}>—</div>
              )}
              <div style={styles.miniHelp}>
                {isMyTurn && turnStep === "play" ? "Swap or discard" : "—"}
              </div>
            </div>

            {/* Discard pile */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Discard</div>
              {discardTop ? (
                <Card rank={discardTop.rank} suit={discardTop.suit} faceDown={false} />
              ) : (
                <div style={styles.emptyPile}>Empty</div>
              )}
              <div style={styles.miniHelp}>
                {isMyTurn && turnStep === "draw" && discardTop ? "Swap before drawing" : "—"}
              </div>
            </div>
          </div>

          {/* Your hand */}
          <div style={{ marginTop: 6 }}>
            <div style={styles.label}>
              Your Hand {me?.name ? <span style={{ opacity: 0.6 }}>• {me.name}</span> : null}
            </div>

            <div style={styles.hand}>
              {myHand.map((c, i) => {
                // 2x2 grid: bottom two are indices 2,3
                const showFace = initialRevealActive && (i === 2 || i === 3);
                const isSelected = selectedCardId === c?.id;

                return (
                  <div
                    key={c?.id || i}
                    style={{
                      borderRadius: 16,
                      outline: isSelected ? "2px solid rgba(255,255,255,.30)" : "2px solid transparent",
                      padding: 2,
                    }}
                  >
                    <Card
                      rank={c?.rank}
                      suit={c?.suit}
                      faceDown={!showFace}
                      onClick={() => onCardClick(c)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              <button
                style={styles.btn}
                disabled={!canDiscardDrawn}
                onClick={() => send({ type: "DISCARD_DRAWN" })}
                title="Discard the drawn card (end turn)"
              >
                Discard Drawn
              </button>

              <button
                style={styles.btn}
                disabled={!canSwapDrawn}
                onClick={() => send({ type: "SWAP_DRAWN_WITH_HAND", targetCardId: selectedCardId })}
                title="Swap drawn card with your selected hand card (end turn)"
              >
                Swap Drawn → Hand
              </button>

              <button
                style={styles.btn}
                disabled={!canSwapDiscard}
                onClick={() => send({ type: "SWAP_WITH_DISCARD", targetCardId: selectedCardId })}
                title="Swap top discard with your selected hand card (instead of drawing)"
              >
                Swap Discard → Hand
              </button>

              <button
                style={styles.btnGhost}
                onClick={() => setSelectedCardId(null)}
                title="Clear selection"
              >
                Clear
              </button>
            </div>

            <div style={styles.footerHelp}>
              Tip: click a card to select it (outline) and peek.
            </div>
          </div>
        </div>
      </div>

      {/* Peek Modal */}
      <PeekModal open={!!peekCard} card={peekCard} title="Peek" onClose={() => setPeekCard(null)} />
    </div>
  );
}

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

  footerHelp: {
    fontSize: 11,
    opacity: 0.55,
    marginTop: 8,
    textAlign: "right",
  },

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
