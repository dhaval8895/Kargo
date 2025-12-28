// client/src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

/* ---------------- Error Boundary ---------------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }
  componentDidCatch(err, info) {
    console.error("UI crash:", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={page}>
          <div style={cardWrap}>
            <h2 style={{ marginTop: 0 }}>UI crashed</h2>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              <b>Error:</b> {String(this.state.err?.message || this.state.err || "Unknown")}
            </div>
            <button style={{ ...btn, marginTop: 14 }} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------- Card helpers ---------- */
function suitSymbol(suit) {
  if (suit === "S") return "♠";
  if (suit === "H") return "♥";
  if (suit === "D") return "♦";
  if (suit === "C") return "♣";
  return "🃏";
}
function isRedSuit(suit) {
  return suit === "H" || suit === "D";
}
function corner(small) {
  return {
    position: "absolute",
    top: 8,
    left: 8,
    fontWeight: 900,
    fontSize: small ? 12 : 14,
    lineHeight: 1,
  };
}
function corner2(small) {
  return {
    position: "absolute",
    bottom: 8,
    right: 8,
    fontWeight: 900,
    fontSize: small ? 12 : 14,
    lineHeight: 1,
    transform: "rotate(180deg)",
  };
}
function CardFace({ card, small }) {
  const rank = card?.rank;
  const suit = card?.suit;
  const sym = rank === "JOKER" ? "🃏" : suitSymbol(suit);
  const red = isRedSuit(suit);
  return (
    <>
      <div style={{ ...corner(small), color: red ? "#b91c1c" : "#111827" }}>
        {rank}
        <div style={{ fontSize: small ? 12 : 14 }}>{sym}</div>
      </div>
      <div style={{ fontSize: small ? 28 : 44, fontWeight: 900, color: red ? "#b91c1c" : "#111827" }}>
        {sym}
      </div>
      <div style={{ ...corner2(small), color: red ? "#b91c1c" : "#111827" }}>
        {rank}
        <div style={{ fontSize: small ? 12 : 14 }}>{sym}</div>
      </div>
    </>
  );
}
const slotLabel = {
  position: "absolute",
  top: 6,
  right: 8,
  fontSize: 11,
  opacity: 0.7,
  fontWeight: 900,
  color: "#111827",
  background: "rgba(255,255,255,0.85)",
  border: "1px solid rgba(17,24,39,0.12)",
  padding: "2px 6px",
  borderRadius: 999,
};

function PlayingCard({ slot, onClick, disabled, small = false, labelText, forceBack = false, highlight = false }) {
  const hasCard = !!slot || forceBack;
  const faceUp = !!slot?.faceUp && !!slot?.card;

  const W = small ? 56 : 86;
  const H = small ? 78 : 122;

  const outer = {
    width: W,
    height: H,
    borderRadius: 14,
    border: highlight ? "2px solid #2563eb" : "1px solid #111827",
    boxShadow: highlight ? "0 10px 26px rgba(37,99,235,0.22)" : "0 6px 16px rgba(0,0,0,0.12)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    userSelect: "none",
    background: faceUp ? "white" : "#0b1220",
    position: "relative",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
  };

  const backPattern = {
    position: "absolute",
    inset: 10,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.25)",
    background:
      "repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0, rgba(255,255,255,0.12) 6px, rgba(255,255,255,0.05) 6px, rgba(255,255,255,0.05) 12px)",
  };

  if (!hasCard) {
    return (
      <div
        style={{
          ...outer,
          background: "rgba(17,24,39,0.04)",
          border: highlight ? "2px solid #2563eb" : "1px dashed #9ca3af",
          boxShadow: "none",
        }}
        onClick={disabled ? undefined : onClick}
      >
        <span style={{ opacity: 0.35, fontWeight: 800 }}>—</span>
        {labelText && <div style={slotLabel}>{labelText}</div>}
      </div>
    );
  }

  return (
    <div style={outer} onClick={disabled ? undefined : onClick}>
      {faceUp ? (
        <CardFace card={slot.card} small={small} />
      ) : (
        <>
          <div style={backPattern} />
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 10,
              fontSize: small ? 10 : 12,
              opacity: 0.9,
              color: "white",
              fontWeight: 900,
              letterSpacing: 1,
            }}
          >
            KARGO
          </div>
        </>
      )}
      {labelText && <div style={slotLabel}>{labelText}</div>}
    </div>
  );
}

function UsedPileMini({ top2, count, claimRank, claimState }) {
  const box = { position: "relative", width: 220, height: 140 };
  const tag = {
    position: "absolute",
    right: 0,
    top: 0,
    fontSize: 12,
    opacity: 0.75,
  };

  const c1 = top2?.[0] ?? null;
  const c2 = top2?.[1] ?? null;

  return (
    <div style={box}>
      <div style={tag}>
        Used: <b>{count}</b>
        {claimRank ? (
          <span
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              background: claimState === "won" ? "#dcfce7" : "#fee2e2",
              color: claimState === "won" ? "#166534" : "#991b1b",
              fontWeight: 900,
            }}
          >
            {claimState === "won" ? `claimed ${claimRank}` : `claim ${claimRank}`}
          </span>
        ) : null}
      </div>

      <div style={{ position: "absolute", left: 0, top: 18, transform: "rotate(-2deg)" }}>
        <PlayingCard slot={c1 ? { faceUp: true, card: c1 } : null} forceBack={!c1} disabled={true} />
      </div>
      <div style={{ position: "absolute", left: 26, top: 8, transform: "rotate(2deg)" }}>
        <PlayingCard slot={c2 ? { faceUp: true, card: c2 } : null} forceBack={!c2} disabled={true} />
      </div>
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const socket = useMemo(() => {
    if (!SERVER_URL) return null;
    return io(SERVER_URL, { transports: ["websocket"] });
  }, []);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const [room, setRoom] = useState(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const [drawn, setDrawn] = useState(null);
  const [pairPick, setPairPick] = useState([]);
  const [peekModal, setPeekModal] = useState(null);

  const [turnToast, setTurnToast] = useState(false);
  const prevTurnPidRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onErr = (m) => setError(String(m || "Unknown error"));

    const onUpdate = (r) => {
      setRoom(r);
      setError("");

      if (r?.turnStage !== "hasDrawn") {
        setDrawn(null);
        setPairPick([]);
      }

      const myId = socket.id;
      const prevTurn = prevTurnPidRef.current;
      const curTurn = r?.turnPlayerId ?? null;
      if (myId && curTurn === myId && prevTurn !== myId && r?.phase === "playing") {
        setTurnToast(true);
        setTimeout(() => setTurnToast(false), 1400);
      }
      prevTurnPidRef.current = curTurn;
    };

    const onDrawn = (c) => {
      setDrawn(c);
      setPairPick([]);
      setPeekModal(null);
      setError("");
    };

    const onPower = (payload) => {
      if (!payload?.card) return;
      if (payload.type === "peekSelf") setPeekModal({ title: "Peek: your card", card: payload.card, qDecision: false });
      if (payload.type === "peekOther") setPeekModal({ title: "Peek: opponent card", card: payload.card, qDecision: false });
      if (payload.type === "qPeekThenDecide") setPeekModal({ title: "Q peeked card", card: payload.card, qDecision: true });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("error:msg", onErr);
    socket.on("room:update", onUpdate);
    socket.on("turn:drawn", onDrawn);
    socket.on("power:result", onPower);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("error:msg", onErr);
      socket.off("room:update", onUpdate);
      socket.off("turn:drawn", onDrawn);
      socket.off("power:result", onPower);
      socket.disconnect();
    };
  }, [socket]);

  const myId = socket?.id || null;
  const players = room?.players || [];
  const me = players.find((p) => p.id === myId) || null;

  const isHost = room?.hostId === myId;

  const kargoActive = !!room?.kargo;
  const activeFinalPlayerId = room?.kargo?.activeFinalPlayerId ?? null;
  const amIActiveFinal = kargoActive ? activeFinalPlayerId === myId : false;

  const isMyTurn = room?.turnPlayerId === myId;
  const amIAllowedToAct = room?.phase === "playing" && (kargoActive ? amIActiveFinal : isMyTurn);

  const powerMode = room?.powerState?.mode ?? "none";
  const turnStage = room?.turnStage ?? "needDraw";

  const claimRank = room?.claim?.rank ?? null;
  const claimState = room?.claim?.state ?? null;

  const canDraw = amIAllowedToAct && room?.phase === "playing" && turnStage === "needDraw";
  const canEndTurn = amIAllowedToAct && room?.phase === "playing" && turnStage === "awaitEnd";
  const canCallKargo = amIAllowedToAct && room?.phase === "playing" && !kargoActive;

  const canUsePower =
    !!drawn &&
    ["7", "8", "9", "10", "J", "Q"].includes(drawn.rank) &&
    turnStage === "hasDrawn" &&
    amIAllowedToAct;

  const canThrowPair =
    amIAllowedToAct && turnStage === "hasDrawn" && !!drawn && powerMode === "none" && pairPick.length === 2;

  const usedTop2 = room?.usedTop2 ?? [];
  const usedCount = room?.usedCount ?? 0;

  const turnName = players.find((p) => p.id === room?.turnPlayerId)?.name ?? "?";

  // first 4 shown as 2x2; extras as a row (face-down)
  const mySlots = me?.slots ?? [];
  const base4 = mySlots.slice(0, 4);
  const extras = mySlots.slice(4);
  const slotDisplayOrder = [2, 3, 0, 1]; // 2x2 order for first four

  const lastRound = room?.lastRound ?? null;

  if (!SERVER_URL) {
    return (
      <div style={page}>
        <div style={cardWrap}>
          <h2 style={{ marginTop: 0 }}>Missing VITE_SERVER_URL</h2>
          <div>Set it in Vercel to your Render URL.</div>
        </div>
      </div>
    );
  }

  function togglePairPick(slotIndex) {
    setPairPick((prev) => {
      if (prev.includes(slotIndex)) return prev.filter((x) => x !== slotIndex);
      if (prev.length >= 2) return [prev[1], slotIndex];
      return [...prev, slotIndex];
    });
  }

  function onTapMySlot(slotIndex) {
    if (!room || !me) return;
    if (room.phase !== "playing") return;

    // ✅ CLAIM is allowed for ANYONE (including thrower) UNTIL turn ends
    if (claimRank) {
      socket.emit("used:claim", { code: room.code, slotIndex });
      return;
    }

    // power modes
    if (powerMode === "selfPeekPick") {
      socket.emit("power:tapSelfCard", { code: room.code, slotIndex });
      return;
    }
    if (powerMode === "jPickMyCard") {
      socket.emit("power:tapMyCardForJSwap", { code: room.code, mySlotIndex: slotIndex });
      return;
    }
    if (powerMode === "qPickMyCard") {
      socket.emit("power:tapMyCardForQSwap", { code: room.code, mySlotIndex: slotIndex });
      return;
    }

    // normal play while hasDrawn
    if (amIAllowedToAct && turnStage === "hasDrawn" && powerMode === "none") {
      // pair selection UX
      if (pairPick.length > 0) {
        togglePairPick(slotIndex);
        return;
      }
      socket.emit("turn:resolveDrawTap", { code: room.code, slotIndex });
      return;
    }
  }

  function onTapOtherSlot(otherPlayerId, otherSlotIndex) {
    if (!room) return;
    if (powerMode === "otherPeekPick" || powerMode === "jPickOpponentCard" || powerMode === "qPickOpponentCard") {
      socket.emit("power:tapOtherCard", { code: room.code, otherPlayerId, otherSlotIndex });
    }
  }

  function opponentSlots(cardCount) {
    return Array.from({ length: cardCount }, (_, i) => i);
  }

  return (
    <div style={page}>
      <style>{`
        @keyframes toast {
          0% { transform: translateY(-10px); opacity: 0; }
          25% { transform: translateY(0px); opacity: 1; }
          75% { transform: translateY(0px); opacity: 1; }
          100% { transform: translateY(-10px); opacity: 0; }
        }
        @keyframes winnerPulse {
          0% { transform: scale(0.98); opacity: 0.6; }
          40% { transform: scale(1.02); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
      `}</style>

      {turnToast && (
        <div style={toastWrap}>
          <div style={toastCard}>Your turn</div>
        </div>
      )}

      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>KARGO</h1>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            Power claim enabled • Wrong claim = +1 • Penalties add face-down slots
          </div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            {connected ? "connected" : "disconnected"} • Server: {SERVER_URL}
          </div>
        </div>

        {room && (
          <button
            style={btnGhost}
            onClick={() => {
              socket.emit("room:leave", { code: room.code });
              setRoom(null);
              setDrawn(null);
              setPairPick([]);
              setPeekModal(null);
            }}
          >
            Leave room
          </button>
        )}
      </div>

      {!room ? (
        <div style={cardWrap}>
          <h2 style={{ marginTop: 0 }}>Join your friends</h2>

          <div style={row}>
            <label style={label}>Your name</label>
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Add Your Name here…" />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button style={btn} disabled={!name.trim() || !connected} onClick={() => socket.emit("room:create", { name: name.trim() })}>
              Create room
            </button>

            <input style={{ ...input, width: 160 }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" />

            <button
              style={btn}
              disabled={!name.trim() || !code.trim() || !connected}
              onClick={() => socket.emit("room:join", { code: code.trim(), name: name.trim() })}
            >
              Join room
            </button>
          </div>

          {error && <div style={errorBox}>{error}</div>}
        </div>
      ) : (
        <div style={cardWrap}>
          {/* ✅ End-of-round reveal + scoreboards */}
          {room.phase === "lobby" && lastRound && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 16,
                  border: "1px solid rgba(17,24,39,0.12)",
                  background:
                    "linear-gradient(90deg, rgba(99,102,241,0.18), rgba(16,185,129,0.18), rgba(244,63,94,0.18))",
                  backgroundSize: "220% 220%",
                  animation: "shimmer 1400ms ease-in-out infinite alternate, winnerPulse 650ms ease-out",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.75 }}>Winner</div>
                <div style={{ fontSize: 28, fontWeight: 950 }}>{lastRound.winnerName}</div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                  Round complete — all cards revealed below.
                </div>
              </div>

              {/* Round scoreboard */}
              {room.roundBoard?.deltas?.length ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Round scoreboard</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {room.roundBoard.deltas.map((d) => (
                      <div
                        key={d.name}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: 10,
                          border: "1px solid #e5e7eb",
                          borderRadius: 14,
                        }}
                      >
                        <div style={{ fontWeight: 900 }}>{d.name}</div>
                        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                          <div style={{ fontWeight: 900, color: d.delta < 0 ? "#166534" : "#991b1b" }}>
                            {d.delta >= 0 ? `+${d.delta}` : d.delta}
                          </div>
                          <div style={{ opacity: 0.7 }}>Total: {d.totalAfter}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Total scoreboard */}
              {room.scoreboard?.length ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Total scoreboard</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {[...room.scoreboard]
                      .sort((a, b) => a.score - b.score)
                      .map((s) => (
                        <div
                          key={s.name}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: 10,
                            border: "1px solid #e5e7eb",
                            borderRadius: 14,
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{s.name}</div>
                          <div style={{ fontWeight: 900 }}>{s.score}</div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}

              {/* Reveal hands */}
              {lastRound.reveal && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Revealed hands</div>
                  <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
                    {Object.entries(lastRound.reveal).map(([pname, cards]) => (
                      <div key={pname} style={{ padding: 12, borderRadius: 16, border: "1px solid #e5e7eb" }}>
                        <div style={{ fontWeight: 900, marginBottom: 10 }}>{pname}</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {(cards || []).map((c, idx) =>
                            c ? (
                              <PlayingCard key={idx} slot={{ faceUp: true, card: c }} disabled={true} />
                            ) : (
                              <PlayingCard key={idx} slot={null} disabled={true} />
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Room code</div>
              <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2 }}>{room.code}</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                Phase: <b>{room.phase}</b>{" "}
                {room.phase === "playing" && (
                  <>
                    • Turn: <b>{turnName}</b> • Stage: <b>{turnStage}</b> • Power: <b>{powerMode}</b>
                  </>
                )}
              </div>
            </div>

            {room.phase === "lobby" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {isHost ? (
                  <button style={btn} onClick={() => socket.emit("game:start", { code: room.code })}>
                    Start game
                  </button>
                ) : (
                  <div style={{ fontSize: 13, opacity: 0.8 }}>Waiting for host to start…</div>
                )}
              </div>
            )}

            {room.phase === "ready" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button style={btn} disabled={room.readyState?.mine} onClick={() => socket.emit("game:ready", { code: room.code })}>
                  {room.readyState?.mine ? "Ready ✓" : "Ready"}
                </button>
                <div style={{ fontSize: 13, opacity: 0.8 }}>
                  See <b>slot 0 & 1</b> now. After you press Ready, they hide again.
                </div>
              </div>
            )}
          </div>

          {/* Players */}
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Players</div>
            <div style={{ display: "grid", gap: 10 }}>
              {players.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={dot(p.id === myId ? "#16a34a" : "#9ca3af")} />
                    <div style={{ fontWeight: 900 }}>
                      {p.name}{" "}
                      {room.hostId === p.id && <span style={pill("#eef2ff", "#3730a3")}>HOST</span>}{" "}
                      {p.id === myId && <span style={pill("#ecfeff", "#0e7490")}>YOU</span>}
                      {room.phase === "ready" && room.readyState?.all?.find((x) => x.id === p.id)?.ready && (
                        <span style={pill("#dcfce7", "#166534")}>READY</span>
                      )}
                      {room.phase === "playing" && room.turnPlayerId === p.id && <span style={pill("#fee2e2", "#991b1b")}>TURN</span>}
                    </div>
                  </div>
                  <div style={{ opacity: 0.75 }}>
                    <b>{p.cardCount}</b> cards
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* TABLE FIRST */}
          {room.phase === "playing" && (
            <>
              <div style={{ marginTop: 16, display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Deck</div>
                  <PlayingCard forceBack={true} disabled={true} />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Drawn</div>
                  <PlayingCard
                    slot={drawn ? { faceUp: true, card: drawn } : null}
                    forceBack={!drawn}
                    disabled={!drawn}
                    onClick={() => {
                      if (!amIAllowedToAct || turnStage !== "hasDrawn" || !drawn) return;
                      socket.emit("turn:discardDrawn", { code: room.code });
                    }}
                  />
                  <div style={{ fontSize: 11, opacity: 0.65 }}>Tap drawn to discard</div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Used pile</div>
                  <UsedPileMini top2={usedTop2} count={usedCount} claimRank={claimRank} claimState={claimState} />
                </div>

                {/* Peek modal */}
                {peekModal && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid rgba(17,24,39,0.15)",
                      background: "rgba(255,255,255,0.95)",
                      display: "grid",
                      gap: 10,
                      minWidth: 260,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900 }}>{peekModal.title}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>Temporary reveal.</div>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <PlayingCard slot={{ faceUp: true, card: peekModal.card }} disabled={true} highlight={true} />
                      {peekModal.qDecision && powerMode === "qAwaitDecision" ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            style={btn}
                            onClick={() => {
                              setPeekModal(null);
                              socket.emit("power:qDecision", { code: room.code, accept: true });
                            }}
                          >
                            Swap
                          </button>
                          <button
                            style={btnGhost}
                            onClick={() => {
                              setPeekModal(null);
                              socket.emit("power:qDecision", { code: room.code, accept: false });
                            }}
                          >
                            Don’t swap
                          </button>
                        </div>
                      ) : (
                        <button style={btnGhost} onClick={() => setPeekModal(null)}>
                          Close
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button style={btn} disabled={!canDraw} onClick={() => socket.emit("turn:draw", { code: room.code })}>
                  Draw
                </button>

                <button style={btnGhost} disabled={!canUsePower || powerMode !== "none"} onClick={() => socket.emit("power:useOnce", { code: room.code })}>
                  Use Power
                </button>

                <button
                  style={btnGhost}
                  disabled={!amIAllowedToAct || turnStage !== "hasDrawn" || powerMode === "none"}
                  onClick={() => socket.emit("power:cancel", { code: room.code })}
                >
                  Cancel Power
                </button>

                <button
                  style={btn}
                  disabled={!canThrowPair}
                  onClick={() => {
                    const [a, b] = pairPick;
                    socket.emit("turn:discardPair", { code: room.code, a, b });
                    setPairPick([]);
                  }}
                >
                  Throw Pair
                </button>

                <button style={btnGhost} disabled={!amIAllowedToAct || turnStage !== "hasDrawn" || powerMode !== "none"} onClick={() => setPairPick([])}>
                  Clear Pair
                </button>

                <button style={btnGhost} disabled={!canCallKargo} onClick={() => socket.emit("kargo:call", { code: room.code })}>
                  Call KARGO
                </button>

                <button style={btn} disabled={!canEndTurn} onClick={() => socket.emit("turn:end", { code: room.code })}>
                  End Turn
                </button>

                <div style={{ fontSize: 12, opacity: 0.75 }}>{amIAllowedToAct ? "Your turn" : `Waiting for ${turnName}…`}</div>
              </div>
            </>
          )}

          {/* Your hand BELOW table */}
          {(room.phase === "ready" || room.phase === "playing") && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {room.phase === "ready" ? "Your cards (slot 0/1 visible once)" : "Your cards (tap)"}
                </div>
              </div>

              {/* First 4 cards in 2x2 */}
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 12 }}>
                {slotDisplayOrder.map((idx) => {
                  const slot = base4[idx] ?? null;
                  const selected = pairPick.includes(idx);
                  const realIndex = idx; // actual slot index in hand
                  return (
                    <PlayingCard
                      key={idx}
                      slot={slot}
                      labelText={`slot ${idx}`}
                      disabled={room.phase !== "playing" || !slot}
                      highlight={selected}
                      onClick={() => {
                        if (amIAllowedToAct && turnStage === "hasDrawn" && powerMode === "none" && pairPick.length === 0) {
                          // allow pair selection by starting with shift-like behavior: click "Clear Pair" then pick two,
                          // OR start picking by clicking Clear Pair? keep existing: tap empty does nothing.
                        }
                        onTapMySlot(realIndex);
                      }}
                    />
                  );
                })}
              </div>

              {/* Extra penalty cards as a row (face-down) */}
              {extras.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 8 }}>Penalty cards</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {extras.map((s, i) => (
                      <PlayingCard
                        key={i}
                        slot={null}
                        forceBack={true}
                        disabled={false}
                        labelText={`slot ${i + 4}`}
                        onClick={() => onTapMySlot(i + 4)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {room.phase === "playing" && claimRank && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#991b1b", fontWeight: 800 }}>
                  Claim is LIVE (rank {claimRank}) — anyone can tap a matching card to discard it. Wrong tap = +1 card. Second tap within 0.2s after winner = +1 card.
                </div>
              )}
            </div>
          )}

          {/* Opponents (only during power targeting) */}
          {room.phase === "playing" && (
            <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Opponents (tap only during power)</div>
              {players
                .filter((p) => p.id !== myId)
                .map((p) => (
                  <div key={p.id} style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb" }}>
                    <div style={{ fontWeight: 900, marginBottom: 10 }}>{p.name}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, max-content)", gap: 10 }}>
                      {opponentSlots(p.cardCount).map((i) => (
                        <PlayingCard
                          key={i}
                          slot={null}
                          forceBack={true}
                          disabled={!(powerMode === "otherPeekPick" || powerMode === "jPickOpponentCard" || powerMode === "qPickOpponentCard")}
                          small={true}
                          labelText={`slot ${i}`}
                          onClick={() => onTapOtherSlot(p.id, i)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {error && <div style={{ ...errorBox, marginTop: 14 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
function dot(color) {
  return { width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" };
}
function pill(bg, color) {
  return {
    marginLeft: 8,
    padding: "2px 8px",
    borderRadius: 999,
    background: bg,
    color,
    fontSize: 11,
    fontWeight: 900,
    border: "1px solid rgba(17,24,39,0.08)",
  };
}

const page = {
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
  maxWidth: 1300,
  margin: "0 auto",
  padding: 18,
  display: "grid",
  gap: 12,
  background: "#f8fafc",
  minHeight: "100vh",
};

const header = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 12,
};

const cardWrap = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "white",
};

const row = { display: "grid", gap: 6 };
const label = { fontSize: 13, opacity: 0.75 };

const input = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  width: 260,
  outline: "none",
};

const btn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const btnGhost = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const errorBox = {
  padding: 10,
  borderRadius: 12,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#9f1239",
  fontSize: 13,
};

const toastWrap = {
  position: "fixed",
  top: 16,
  left: 0,
  right: 0,
  display: "grid",
  placeItems: "center",
  zIndex: 80,
  pointerEvents: "none",
};
const toastCard = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(17,24,39,0.15)",
  background: "rgba(255,255,255,0.95)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
  fontWeight: 900,
  animation: "toast 1400ms ease-out",
};
