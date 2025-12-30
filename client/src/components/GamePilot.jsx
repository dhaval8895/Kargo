import React, { useEffect, useMemo, useState } from "react";
import Card from "./Card";
import ActivityMonitor from "./ActivityMonitor";
import PeekModal from "./PeekModal";
import { useRoom } from "./hooks/useRoom";

/**
 * GamePilot (Real MVP Hookup)
 * - Preserves your v1.0 Pilot UI look & structure
 * - Adds Create / Join / Ready
 * - Renders authoritative room state
 * - Keeps PeekModal behavior
 */
export default function GamePilot() {
  const room = useRoom();

  // --- UI / lobby inputs ---
  const [name, setName] = useState("Player");
  const [roomCode, setRoomCode] = useState("");

  // --- local-only UI helpers ---
  const [peek, setPeek] = useState(null);
  const [selectedCardId, setSelectedCardId] = useState(null);

  // "Bottom two shown once" behavior (client-side MVP):
  const [initialReveal, setInitialReveal] = useState(false);
  const [initialRevealUsed, setInitialRevealUsed] = useState(false);

  // --- derive "me" + my hand from public state ---
  const { me, myHand, opponents } = useMemo(() => {
    const state = room.state;
    if (!state || !room.playerId) return { me: null, myHand: [], opponents: [] };

    const me = state.players?.find((p) => p.id === room.playerId) || null;
    const others = (state.players || []).filter((p) => p.id !== room.playerId);

    return {
      me,
      myHand: me?.hand || [],
      opponents: others,
    };
  }, [room.state, room.playerId]);

  // Trigger initial reveal once when we first receive a 4-card hand in a started phase
  useEffect(() => {
    if (!room.state) return;
    if (initialRevealUsed) return;

    const hasFour = Array.isArray(myHand) && myHand.length === 4;
    const started = room.state.phase && room.state.phase !== "lobby";

    if (started && hasFour) {
      setInitialReveal(true);
      setInitialRevealUsed(true);
      const t = setTimeout(() => setInitialReveal(false), 2200);
      return () => clearTimeout(t);
    }
  }, [room.state, myHand, initialRevealUsed]);

  // Keep selection valid
  useEffect(() => {
    if (!selectedCardId) return;
    if (!myHand.some((c) => c.id === selectedCardId)) setSelectedCardId(null);
  }, [myHand, selectedCardId]);

  // --- actions ---
  async function onCreate() {
    const res = await room.createRoom(name?.trim() || "Player");
    if (!res?.ok) alert(res?.error || "Failed to create room");
  }

  async function onJoin() {
    const code = roomCode.trim();
    if (!code) return alert("Enter a room code");
    const res = await room.joinRoom(code, name?.trim() || "Player");
    if (!res?.ok) alert(res?.error || "Failed to join room");
  }

  async function send(action) {
    const res = await room.action(action);
    if (!res?.ok) alert(res?.error || "Action failed");
  }

  function revealCard(card) {
    // Keep your PeekModal flow
    setPeek(card);
  }

  const state = room.state;

  // Public discard top card (server sends only top in MVP)
  const discardTop = state?.discard?.[0] || null;

  // Deck count (server sends {count})
  const deckCount = state?.deck?.count ?? 0;

  const isMyTurn = state?.turnPlayerId && state.turnPlayerId === room.playerId;
  const canReady = state?.phase === "lobby" && room.roomId && room.playerId;
  const canDraw = isMyTurn && state?.turnStep === "draw";
  const canPlay = isMyTurn && state?.turnStep === "play";

  // --- UI ---
  return (
    <div style={styles.bg}>
      <div style={styles.wrap}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.title}>KARGO — Pilot</div>
          <div style={styles.chip}>
            {room.connected ? "Connected" : "Offline"}
            {room.roomId ? ` • Room: ${room.roomId}` : ""}
          </div>
        </div>

        {/* Lobby / Room Controls */}
        <div style={styles.lobbyBar}>
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
                placeholder="Room code"
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

              <div style={styles.turnChip}>
                {state?.phase === "lobby"
                  ? "Lobby"
                  : isMyTurn
                  ? `Your turn • ${state?.turnStep || ""}`
                  : "Waiting…"}
              </div>
            </>
          )}
        </div>

        {/* Activity Monitor */}
        <ActivityMonitor events={room.activity || []} />

        {/* Table */}
        <div style={styles.table}>
          {/* Opponents */}
          <div style={styles.opponents}>
            {opponents.length ? opponents.map((p) => p.name).join(" • ") : "No opponents yet"}
          </div>

          {/* Center */}
          <div style={styles.center}>
            <div>
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
                {canDraw ? "Click to draw" : isMyTurn ? "Play step" : "—"}
              </div>
            </div>

            <div>
              <div style={styles.label}>Discard</div>
              {discardTop ? (
                <Card rank={discardTop.rank} suit={discardTop.suit} faceDown={false} />
              ) : (
                <div style={styles.emptyPile}>Empty</div>
              )}
              <div style={styles.miniHelp}>
                {isMyTurn && state?.turnStep === "draw" && discardTop
                  ? "Swap w/ discard via button"
                  : "—"}
              </div>
            </div>
          </div>

          {/* Your Hand */}
          <div>
            <div style={styles.label}>
              Your Hand{" "}
              {me?.name ? <span style={{ opacity: 0.6 }}>• {me.name}</span> : null}
            </div>

            <div style={styles.hand}>
              {myHand.map((c, i) => {
                // MVP: "bottom two shown once" = indices 2 & 3
                const showFace =
                  initialReveal && (i === 2 || i === 3);

                const isSelected = selectedCardId === c.id;

                return (
                  <div
                    key={c.id || i}
                    style={{
                      borderRadius: 16,
                      outline: isSelected ? "2px solid rgba(255,255,255,.30)" : "2px solid transparent",
                      padding: 2,
                    }}
                  >
                    <Card
                      rank={c.rank}
                      suit={c.suit}
                      faceDown={!showFace} // face up only during initial reveal
                      onClick={() => {
                        // Click = select + peek
                        setSelectedCardId(c.id);
                        revealCard(c);
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              <button
                style={styles.btn}
                disabled={!canPlay || !selectedCardId}
                onClick={() => send({ type: "DISCARD", cardId: selectedCardId })}
                title={!selectedCardId ? "Select a card first" : "Discard selected (and end turn)"}
              >
                Discard
              </button>

              <button
                style={styles.btn}
                disabled={!canPlay || !selectedCardId}
                onClick={() => send({ type: "SWAP_WITH_HAND", targetCardId: selectedCardId })}
                title={!selectedCardId ? "Select a card first" : "Swap drawn card with selected"}
              >
                Swap (Hand)
              </button>

              <button
                style={styles.btn}
                disabled={!isMyTurn || state?.turnStep !== "draw" || !discardTop || !selectedCardId}
                onClick={() => send({ type: "SWAP_WITH_DISCARD", targetCardId: selectedCardId })}
                title="Swap top discard with selected (instead of drawing)"
              >
                Swap (Discard)
              </button>

              {/* Keep your Kargo button for now (server logic later) */}
              <button
                style={styles.btn}
                onClick={() => alert("Kargo logic comes after the core loop is stable.")}
              >
                Call Kargo
              </button>
            </div>

            <div style={styles.footerHelp}>
              Tip: click a card to select it (outline) and open PeekModal.
            </div>
          </div>
        </div>
      </div>

      {/* Peek Modal */}
      <PeekModal
        open={!!peek}
        card={peek}
        title="Peek"
        onClose={() => setPeek(null)}
      />
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
    padding: "10px 12px",
    borderRadius: 18,
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.12)",
    marginBottom: 10,
  },
  title: { fontWeight: 900 },
  chip: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.08)",
  },

  lobbyBar: {
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
    minWidth: 160,
  },
  turnChip: {
    marginLeft: "auto",
    fontSize: 12,
    padding: "8px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.12)",
    opacity: 0.9,
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
    gap: 30,
    padding: "12px 0",
  },

  deck: { width: 86, height: 118, position: "relative" },
  deckCard: {
    position: "absolute",
    inset: 0,
    borderRadius: 14,
    background:
      "linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.04))",
    border: "1px solid rgba(255,255,255,.16)",
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

  label: { fontSize: 12, opacity: 0.6, marginBottom: 6 },

  hand: {
    display: "grid",
    gridTemplateColumns: "repeat(2,1fr)",
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

  miniHelp: {
    fontSize: 11,
    opacity: 0.55,
    marginTop: 6,
    textAlign: "center",
  },

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
};
