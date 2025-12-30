import React, { useMemo, useState, useEffect } from "react";
import Card from "./Card";
import ActivityMonitor from "./ActivityMonitor";
import PeekModal from "./PeekModal";
import { useRoom } from "../hooks/useRoom";

export default function GamePilot() {
  const room = useRoom();
  const state = room.state;

  const [name, setName] = useState("Player");
  const [roomCode, setRoomCode] = useState("");
  const [peekCard, setPeekCard] = useState(null);

  // Guess pair UI
  const [pairMode, setPairMode] = useState(false);
  const [pairSel, setPairSel] = useState([]);
  const [hint, setHint] = useState("");

  const { me, myHand, opponents, playersById } = useMemo(() => {
    if (!state || !room.playerId) {
      return { me: null, myHand: [], opponents: [], playersById: {} };
    }
    const byId = {};
    for (const p of state.players || []) byId[p.id] = p;
    const me = state.players?.find((p) => p.id === room.playerId) || null;
    const others = (state.players || []).filter((p) => p.id !== room.playerId);
    return { me, myHand: me?.hand || [], opponents: others, playersById: byId };
  }, [state, room.playerId]);

  const phase = state?.phase || "—";
  const isMyTurn = state?.turnPlayerId === room.playerId;
  const turnStep = state?.turnStep || "—";
  const drawn = state?.drawnCard || null;
  const deckCount = state?.deck?.count ?? state?.deck?.length ?? 0;
  const discardTop = state?.discard?.[state?.discard?.length - 1] || null;

  const claim = state?.claim || null;
  const claimOpen = !!claim?.open;
  const claimRank = claim?.rank || null;

  const winnerPlayerId = state?.winnerPlayerId || null;
  const winnerName =
    winnerPlayerId && state?.players ? state.players.find((p) => p.id === winnerPlayerId)?.name : null;

  const serverBuild = state?.serverBuild || "";

  useEffect(() => {
    setHint("");
    setPairMode(false);
    setPairSel([]);
  }, [state?.turnPlayerId, state?.phase]);

  async function send(action) {
    const res = await room.action(action);
    if (!res?.ok) alert(res?.error || "Action failed");
  }

  const canReady = phase === "lobby" && !!room.roomId;
  const canDraw = phase === "turn" && isMyTurn && turnStep === "draw";
  const holdingDrawn = !!drawn;

  const endTurnBlockedReason = useMemo(() => {
    if (winnerPlayerId) return "Game ended.";
    if (phase !== "turn") return "Not in turn phase.";
    if (!isMyTurn) return "Not your turn.";
    if (holdingDrawn) return "Resolve drawn: click a hand card (match/swap), discard drawn, or guess pair.";
    return "";
  }, [winnerPlayerId, phase, isMyTurn, holdingDrawn]);

  function onHandCardClick(card) {
    if (!card?.id) return;
    if (winnerPlayerId) return;

    // Claim attempt (anyone) while claim is open
    if (claimOpen) {
      setHint("");
      send({ type: "CLAIM_DISCARD", cardId: card.id });
      return;
    }

    // Guess pair selection
    if (pairMode) {
      setPairSel((prev) => {
        const has = prev.includes(card.id);
        if (has) return prev.filter((x) => x !== card.id);
        if (prev.length >= 2) return prev;
        return [...prev, card.id];
      });
      return;
    }

    // Turn player holding drawn: clicking hand card triggers match-or-swap
    if (phase === "turn" && isMyTurn && holdingDrawn) {
      setHint("");
      send({ type: "SWAP_DRAWN_WITH_HAND", targetCardId: card.id });
      return;
    }

    // Otherwise peek
    setPeekCard(card);
  }

  function togglePairMode() {
    if (winnerPlayerId) return;
    if (!(phase === "turn" && isMyTurn && holdingDrawn)) {
      setHint("You can only Throw Pair on your turn after drawing.");
      return;
    }
    setHint("");
    setPairMode((v) => !v);
    setPairSel([]);
  }

  async function confirmGuessPair() {
    if (winnerPlayerId) return;
    if (!(phase === "turn" && isMyTurn && holdingDrawn)) {
      setHint("You can only Throw Pair on your turn after drawing.");
      return;
    }
    if (pairSel.length !== 2) return alert("Select exactly two cards");
    setHint("");
    await send({ type: "GUESS_PAIR", a: pairSel[0], b: pairSel[1] });
    setPairMode(false);
    setPairSel([]);
  }

  async function endTurn() {
    if (winnerPlayerId) return;
    if (endTurnBlockedReason) {
      setHint(endTurnBlockedReason);
      return;
    }
    setHint("");
    await send({ type: "END_TURN" });
    setPairMode(false);
    setPairSel([]);
  }

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

  // Feed ActivityMonitor from server state log (so penalties show).
  // If you already have room.activity, this will still prefer it.
  const activityEvents = useMemo(() => {
    const base = (room.activity && room.activity.length ? room.activity : state?.log || []).slice(-30);

    // Normalize into ActivityMonitor-friendly objects
    return base.map((e) => {
      if (typeof e === "string") return e;
      // our server log: {ts, playerId, type, text}
      if (e && e.text) {
        const playerName = e.playerId ? playersById[e.playerId]?.name || e.playerId : "System";
        return { player: playerName, action: e.text };
      }
      // fallback
      return e;
    });
  }, [room.activity, state?.log, playersById]);

  return (
    <div style={styles.bg}>
      <div style={styles.wrap}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>KARGO — MVP</div>
            <div style={styles.sub}>
              {room.connected ? "Connected" : "Kargo is offline"}
              {room.roomId ? ` • Room: ${room.roomId}` : ""}
              {serverBuild ? ` • Server: ${serverBuild}` : ""}
            </div>
          </div>

          <div style={styles.pills}>
            <span style={styles.pill}>Phase: {winnerPlayerId ? "GAME OVER" : phase}</span>
            <span style={styles.pill}>
              {winnerPlayerId
                ? `Winner: ${winnerName || winnerPlayerId}`
                : phase === "turn"
                ? isMyTurn
                  ? `Your turn • ${turnStep}`
                  : `Waiting • ${turnStep}`
                : "—"}
            </span>
            {claimOpen ? <span style={styles.pill}>Claim: {claimRank}</span> : null}
          </div>
        </div>

        <div style={styles.lobby}>
          <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />

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

        <ActivityMonitor events={activityEvents} />

        <div style={styles.table}>
          <div style={styles.center}>
            {/* Draw */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Draw ({deckCount})</div>
              <div
                style={{
                  ...styles.deck,
                  opacity: canDraw && !winnerPlayerId ? 1 : 0.6,
                  cursor: canDraw && !winnerPlayerId ? "pointer" : "default",
                }}
                onClick={() => canDraw && !winnerPlayerId && send({ type: "DRAW" })}
                title={canDraw ? "Click to draw" : "Not available"}
              >
                <div style={styles.deckCard} />
                <div style={{ ...styles.deckCard, transform: "translate(3px,-3px)" }} />
                <div style={{ ...styles.deckCard, transform: "translate(6px,-6px)" }} />
              </div>
              <div style={styles.miniHelp}>{canDraw ? "Click to draw" : "—"}</div>
            </div>

            {/* Drawn (CLICKABLE TO DISCARD) */}
            <div style={styles.pileCol}>
              <div style={styles.label}>Drawn</div>

              <div
                style={{
                  cursor: phase === "turn" && isMyTurn && drawn && !winnerPlayerId ? "pointer" : "default",
                }}
                onClick={() => {
                  if (phase === "turn" && isMyTurn && drawn && !winnerPlayerId) {
                    send({ type: "DISCARD_DRAWN" });
                  }
                }}
                title={phase === "turn" && isMyTurn && drawn ? "Click to discard drawn card" : ""}
              >
                {drawn ? (
                  <Card rank={drawn.rank} suit={drawn.suit} faceDown={false} />
                ) : (
                  <div style={styles.emptyPile}>—</div>
                )}
              </div>

              <div style={styles.miniHelp}>
                {winnerPlayerId
                  ? "Game ended"
                  : isMyTurn && drawn
                  ? "Click drawn to discard • click ONE hand card to match/swap • or Throw Pair"
                  : "—"}
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
              <div style={styles.miniHelp}>{claimOpen ? "Claim window open" : "—"}</div>
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
                    <Card rank={c?.rank} suit={c?.suit} faceDown={false} onClick={() => onHandCardClick(c)} />
                  </div>
                );
              })}
            </div>

            <div style={styles.actions}>
              <button
                style={styles.btn}
                disabled={!(phase === "turn" && isMyTurn && holdingDrawn) || winnerPlayerId}
                onClick={togglePairMode}
                title="Guess pair (select 2 cards) — only on your turn after drawing"
              >
                {pairMode ? "Cancel Pair" : "Throw Pair"}
              </button>

              <button
                style={styles.btn}
                disabled={!pairMode || pairSel.length !== 2 || winnerPlayerId}
                onClick={confirmGuessPair}
                title="Confirm selected guess pair"
              >
                Confirm
              </button>

              <button style={styles.btnGhost} onClick={endTurn} title={endTurnBlockedReason || "End turn"}>
                End Turn{endTurnBlockedReason ? " (finish draw)" : ""}
              </button>
            </div>

            {hint ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75, textAlign: "right" }}>{hint}</div>
            ) : (
              <div style={styles.footerHelp}>
                {winnerPlayerId
                  ? `Winner: ${winnerName || winnerPlayerId}`
                  : claimOpen
                  ? `Claim open for rank ${claimRank} (any player can try once)`
                  : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      <PeekModal open={!!peekCard} card={peekCard} title="Peek" onClose={() => setPeekCard(null)} />
    </div>
  );
}

// keep your existing styles (unchanged baseline)
const styles = {
  bg: {
    minHeight: "100vh",
    background:
      "radial-gradient(1100px 700px at 20% 10%, rgba(80,140,255,.18), transparent 55%)," +
      "radial-gradient(900px 700px at 80% 20%, rgba(255,180,80,.10), transparent 60%)," +
      "radial-gradient(900px 700px at 55% 95%, rgba(120,255,200,.08), transparent 55%)," +
      "#0b0f14",
    color: "rgba(255,255,255,.92)",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
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
  center: { display: "flex", justifyContent: "center", gap: 22, padding: "12px 0", flexWrap: "wrap" },
  pileCol: { display: "grid", justifyItems: "center", gap: 6, minWidth: 110 },
  deck: { width: 86, height: 118, position: "relative" },
  deckCard: {
    position: "absolute",
    inset: 0,
    borderRadius: 14,
    background: "linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.04))",
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
  hand: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, justifyItems: "center" },
  actions: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 10 },
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
