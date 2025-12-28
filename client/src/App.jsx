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
            <h2 style={{ marginTop: 0 }}>UI crashed (caught)</h2>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
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

function PlayingCard({ slot, onClick, disabled, small = false, labelText, forceBack = false, forceFrontCard = null, highlight = false }) {
  const hasCard = !!slot || !!forceFrontCard || forceBack;
  const faceUp = !!forceFrontCard || (!!slot?.faceUp && !!slot?.card);

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
          border: "1px dashed #9ca3af",
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
        <CardFace card={forceFrontCard || slot.card} small={small} />
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

/* ---------- Used pile stack ---------- */
function UsedPileStack({ topCard, count }) {
  const base = {
    width: 86,
    height: 122,
    borderRadius: 14,
    border: "1px solid rgba(17,24,39,0.35)",
    background: "rgba(17,24,39,0.06)",
    position: "absolute",
    left: 0,
    top: 0,
  };

  return (
    <div style={{ position: "relative", width: 120, height: 150 }}>
      <div style={{ ...base, left: 10, top: 12 }} />
      <div style={{ ...base, left: 6, top: 8 }} />
      <div style={{ ...base, left: 3, top: 4 }} />
      <div style={{ position: "absolute", left: 0, top: 0 }}>
        <PlayingCard slot={topCard ? { faceUp: true, card: topCard } : null} forceBack={!topCard} disabled={true} />
      </div>
      <div style={{ position: "absolute", left: 98, top: 10, fontSize: 12, opacity: 0.75 }}>
        Used: <b>{count}</b>
      </div>
    </div>
  );
}

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
  const [powerPeek, setPowerPeek] = useState(null);
  const [winnerSplash, setWinnerSplash] = useState(null);

  const [turnToast, setTurnToast] = useState(false);
  const prevTurnPidRef = useRef(null);

  // Pair selection for "throw two cards same rank"
  const [pairPick, setPairPick] = useState([]); // array of slot indices length 0..2

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onErr = (m) => setError(String(m || "Unknown error"));

    const onUpdate = (r) => {
      setRoom(r);
      setError("");

      if (r?.phase !== "playing") {
        setDrawn(null);
        setPairPick([]);
      }

      if (r?.lastRound?.winnerName) {
        setWinnerSplash({ name: r.lastRound.winnerName });
        setTimeout(() => setWinnerSplash(null), 2500);
      }

      // your turn popup
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
      setError("");
    };

    const onPower = (payload) => {
      if (!payload?.card) return;
      if (payload.type === "peekSelf") setPowerPeek({ title: `Peek: your card`, card: payload.card });
      if (payload.type === "peekOther") setPowerPeek({ title: `Peek: opponent card`, card: payload.card });
      if (payload.type === "qPeekThenDecide") {
        setPowerPeek({
          title: `Q peeked card`,
          card: payload.card,
          qDecision: true,
        });
      }
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
  const scoreboard = room?.scoreboard || [];
  const stats = room?.stats || [];
  const roundBoard = room?.roundBoard || null;

  const me = players.find((p) => p.id === myId) || null;

  const isHost = room?.hostId === myId;
  const isMyTurn = room?.turnPlayerId === myId;

  const kargoActive = !!room?.kargo;
  const activeFinalPlayerId = room?.kargo?.activeFinalPlayerId ?? null;
  const amIActiveFinal = kargoActive ? activeFinalPlayerId === myId : false;

  const amIAllowedToAct = room?.phase === "playing" && (kargoActive ? amIActiveFinal : isMyTurn);

  const inReadyPhase = room?.phase === "ready";
  const readyMine = room?.readyState?.mine ?? false;

  const powerMode = room?.powerState?.mode ?? "none";
  const turnStage = room?.turnStage ?? "needDraw"; // needDraw | hasDrawn | awaitEnd

  const drawnRank = drawn?.rank ?? null;
  const canPower = !!drawnRank && ["7", "8", "9", "10", "J", "Q"].includes(drawnRank);

  // SLOT ORDER DISPLAY: top row = slot 2 & 3, bottom row = slot 0 & 1
  const slotDisplayOrder = [2, 3, 0, 1];

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

  const roundSorted = roundBoard?.deltas
    ? [...roundBoard.deltas].sort((a, b) => a.delta - b.delta)
    : null;

  const allowPairThrow = amIAllowedToAct && !!drawn && turnStage === "hasDrawn" && powerMode === "none";
  const canEndTurn = amIAllowedToAct && room?.phase === "playing" && turnStage === "awaitEnd";
  const canDraw = amIAllowedToAct && room?.phase === "playing" && turnStage === "needDraw";
  const canCallKargo = amIAllowedToAct && room?.phase === "playing" && !kargoActive; // now stays available until you end your turn / next player draws

  // IMPORTANT FIX: Used-claim is allowed for ANYONE anytime while thrownCard exists.
  const canClaimUsed = room?.phase === "playing" && !!room?.thrownCard;

  return (
    <div style={page}>
      <style>{`
        @keyframes pop {
          0% { transform: translateY(12px) scale(0.96); opacity: 0; }
          60% { transform: translateY(0px) scale(1.02); opacity: 1; }
          100% { transform: translateY(0px) scale(1); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
        @keyframes toast {
          0% { transform: translateY(-10px); opacity: 0; }
          25% { transform: translateY(0px); opacity: 1; }
          75% { transform: translateY(0px); opacity: 1; }
          100% { transform: translateY(-10px); opacity: 0; }
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
            Always hidden • Race claim for everyone • Turn ends only when you click End Turn
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
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dhaval" />
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
        <>
          {winnerSplash && (
            <div style={winnerOverlay}>
              <div style={winnerCard}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Round Winner</div>
                <div style={winnerName}>{winnerSplash.name}</div>
              </div>
            </div>
          )}

          {/* SCOREBOARDS + Round reveal */}
          <div style={cardWrap}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Room code</div>
                <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>{room.code}</div>
                <div style={{ opacity: 0.75, fontSize: 13, marginTop: 6 }}>
                  Phase: <b>{room.phase}</b> • Turn: <b>{players.find((p) => p.id === room.turnPlayerId)?.name ?? "—"}</b>{" "}
                  {room.phase === "playing" && (
                    <>
                      • Stage: <b>{room.turnStage}</b>
                    </>
                  )}
                </div>
                {room.kargo && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #fde68a", background: "#fffbeb" }}>
                    <div style={{ fontWeight: 900 }}>KARGO called by {room.kargo.callerName}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Final player: <b>{players.find((p) => p.id === room.kargo.activeFinalPlayerId)?.name ?? "—"}</b>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ minWidth: 260 }}>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard (This round)</div>
                {!roundSorted ? (
                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>No completed round yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                    {roundSorted.map((s) => (
                      <div key={s.name} style={scoreRow}>
                        <span>{s.name}</span>
                        <b>{s.delta > 0 ? `+${s.delta}` : s.delta}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ minWidth: 260 }}>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard (Total points)</div>
                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                  {scoreboard
                    .slice()
                    .sort((a, b) => a.score - b.score)
                    .map((s) => (
                      <div key={s.name} style={scoreRow}>
                        <span>{s.name}</span>
                        <b>{s.score}</b>
                      </div>
                    ))}
                </div>
              </div>

              <div style={{ minWidth: 260 }}>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard (Games/rounds)</div>
                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                  {stats
                    .slice()
                    .sort((a, b) => b.roundsWon - a.roundsWon)
                    .map((s) => (
                      <div key={s.name} style={scoreRow}>
                        <span>{s.name}</span>
                        <span style={{ fontSize: 12, opacity: 0.75 }}>
                          Played <b>{s.roundsPlayed}</b> • Won <b>{s.roundsWon}</b>
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {room.phase === "lobby" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button style={btn} disabled={!isHost || players.length < 2} onClick={() => socket.emit("game:start", { code: room.code })}>
                  Start game
                </button>
                {!isHost && <div style={{ opacity: 0.75, fontSize: 13, alignSelf: "center" }}>Waiting for host…</div>}
              </div>
            )}

            {/* End-of-round reveal */}
            {room.phase === "lobby" && room.lastRound?.reveal && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Round recap — revealed hands</div>
                <div style={{ display: "grid", gap: 10 }}>
                  {Object.entries(room.lastRound.reveal).map(([playerName, cards]) => (
                    <div key={playerName} style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "white" }}>
                      <div style={{ fontWeight: 900 }}>{playerName}</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                        {cards.map((c, idx) => (
                          <PlayingCard
                            key={idx}
                            slot={c ? { faceUp: true, card: c } : null}
                            forceBack={!c}
                            disabled={true}
                            labelText={`slot ${idx}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inReadyPhase && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                <div style={{ fontWeight: 900 }}>Ready check</div>
                <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
                  This is your only chance to see your bottom two cards (slot 0 & slot 1). When you hit Ready, they hide again.
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 12, marginTop: 12 }}>
                  {slotDisplayOrder.map((slotIndex) => {
                    const s = me?.slots?.[slotIndex] ?? null;
                    const forceFrontCard = s?.faceUp ? s?.card : null;

                    return (
                      <PlayingCard
                        key={slotIndex}
                        slot={s && !forceFrontCard ? { faceUp: false, card: null } : s}
                        forceFrontCard={forceFrontCard}
                        forceBack={!s}
                        disabled={true}
                        labelText={`slot ${slotIndex}`}
                      />
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button style={btn} disabled={readyMine} onClick={() => socket.emit("game:ready", { code: room.code })}>
                    {readyMine ? "Ready ✅" : "Ready"}
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  {(room.readyState?.all || []).map((p) => (
                    <div key={p.id} style={{ fontSize: 13, opacity: 0.8 }}>
                      {p.name}: <b>{p.ready ? "Ready" : "Not ready"}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <div style={errorBox}>{error}</div>}
          </div>

          {/* Playing UI */}
          {room.phase === "playing" && (
            <div style={cardWrap}>
              <h3 style={{ marginTop: 0 }}>Center</h3>

              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Active thrown card (race claim)</div>

                  <PlayingCard
                    slot={room.thrownCard ? { faceUp: true, card: room.thrownCard } : null}
                    forceBack={!room.thrownCard}
                    disabled={true}
                  />

                  <div style={{ maxWidth: 280, fontSize: 12, opacity: 0.75, lineHeight: 1.35, marginTop: 8 }}>
                    Anyone can claim by tapping a matching rank card. Wrong claim = +1 penalty card. Second click within 0.2s = penalty.
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Used pile</div>
                  <UsedPileStack topCard={room.usedPileTop} count={room.usedPileCount || 0} />
                </div>

                <div style={{ flex: 1, minWidth: 520 }}>
                  <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>
                    Actions {kargoActive ? "(final turns)" : ""}{" "}
                    {amIAllowedToAct ? "" : <span style={{ opacity: 0.7 }}>• waiting…</span>}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={btn} disabled={!canDraw} onClick={() => socket.emit("turn:draw", { code: room.code })}>
                      Draw
                    </button>

                    <button
                      style={btnGhost}
                      disabled={!amIAllowedToAct || !drawn || turnStage !== "hasDrawn"}
                      onClick={() => {
                        socket.emit("turn:discardDrawn", { code: room.code });
                        setDrawn(null);
                        setPairPick([]);
                      }}
                      title="Discard the drawn card to USED pile (then you can still Call Kargo, or End Turn)"
                    >
                      Discard drawn
                    </button>

                    <button
                      style={btnGhost}
                      disabled={!amIAllowedToAct || !drawn || !canPower || turnStage !== "hasDrawn"}
                      onClick={() => socket.emit("power:useOnce", { code: room.code })}
                      title="Use power (single-use). After power finishes, drawn card moves to USED pile."
                    >
                      Use Power
                    </button>

                    <button
                      style={btnGhost}
                      disabled={!amIAllowedToAct || !drawn || turnStage !== "hasDrawn" || powerMode === "none"}
                      onClick={() => socket.emit("power:cancel", { code: room.code })}
                    >
                      Cancel Power
                    </button>

                    <button
                      style={btnGhost}
                      disabled={!canCallKargo}
                      onClick={() => socket.emit("kargo:call", { code: room.code })}
                      title="You can call Kargo any time during YOUR turn until the next player draws"
                    >
                      Call KARGO
                    </button>

                    <button
                      style={btn}
                      disabled={!canEndTurn}
                      onClick={() => {
                        socket.emit("turn:end", { code: room.code });
                        setDrawn(null);
                        setPairPick([]);
                      }}
                      title="End your turn (then the next player can draw)"
                    >
                      End Turn
                    </button>
                  </div>

                  {/* Pair throw UI */}
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>Drawn:</div>
                        <div style={{ marginTop: 8 }}>
                          <PlayingCard
                            slot={drawn ? { faceUp: true, card: drawn } : null}
                            forceBack={!drawn}
                            disabled={!drawn}
                          />
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 280 }}>
                        <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
                          Tap one of your cards:
                          <ul style={{ margin: "6px 0 0 18px" }}>
                            <li>Match rank → discard both (to USED) and keep playing (await End Turn)</li>
                            <li>No match → swap; your replaced card becomes the thrown card (race claim)</li>
                          </ul>
                          Optional: select <b>two</b> of your cards to throw a pair (same rank). Wrong pair → penalty.
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                          <button
                            style={btnGhost}
                            disabled={!allowPairThrow}
                            onClick={() => setPairPick([])}
                            title="Clear pair selection"
                          >
                            Clear pair pick
                          </button>

                          <button
                            style={btn}
                            disabled={!allowPairThrow || pairPick.length !== 2}
                            onClick={() => {
                              socket.emit("turn:discardPair", { code: room.code, a: pairPick[0], b: pairPick[1] });
                              setDrawn(null);
                              setPairPick([]);
                            }}
                            title="Throw a pair (must have drawn card). Wrong pair gives penalty."
                          >
                            Throw Pair
                          </button>
                        </div>

                        {pairPick.length > 0 && (
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                            Pair picked slots: <b>{pairPick.join(", ")}</b>
                          </div>
                        )}

                        {powerMode !== "none" && (
                          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                            Power mode: <b>{powerMode}</b>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Your hand (always hidden) */}
              <div style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>Your hand</h3>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 12 }}>
                  {slotDisplayOrder.map((i) => {
                    const slot = me?.slots?.[i] ?? null;
                    const hasCard = !!slot;

                    const highlight = pairPick.includes(i);

                    // Clicking a card can do:
                    // - power selections
                    // - resolve drawn
                    // - claim used pile (ANYONE anytime)
                    // - pair selection (when drawn exists)
                    const disabled =
                      (!hasCard && !canClaimUsed) ||
                      (hasCard &&
                        !(
                          canClaimUsed || // allow claim anytime
                          (amIAllowedToAct &&
                            (powerMode === "selfPeekPick" ||
                              powerMode === "jPickMyCard" ||
                              powerMode === "qPickMyCard" ||
                              (drawn && turnStage === "hasDrawn")))
                        ));

                    return (
                      <PlayingCard
                        key={i}
                        slot={hasCard ? { faceUp: false, card: null } : null}
                        forceBack={hasCard}
                        labelText={`slot ${i}`}
                        disabled={disabled}
                        highlight={highlight}
                        onClick={() => {
                          // 1) race claim is allowed for everyone
                          if (canClaimUsed && hasCard) {
                            // If you are currently in your own turn and you also have drawn card,
                            // prioritize resolving draw when it's your turn + drawn exists.
                            // Otherwise this should be a used:claim attempt.
                            const shouldResolveDraw = amIAllowedToAct && drawn && turnStage === "hasDrawn" && powerMode === "none";
                            if (!shouldResolveDraw) {
                              socket.emit("used:claim", { code: room.code, slotIndex: i });
                              return;
                            }
                          }

                          if (!amIAllowedToAct) return;

                          // 2) power selection steps
                          if (powerMode === "selfPeekPick") {
                            socket.emit("power:tapSelfCard", { code: room.code, slotIndex: i });
                            return;
                          }
                          if (powerMode === "jPickMyCard") {
                            socket.emit("power:tapMyCardForSwap", { code: room.code, mySlotIndex: i });
                            return;
                          }
                          if (powerMode === "qPickMyCard") {
                            socket.emit("power:tapMyCardForQ", { code: room.code, mySlotIndex: i });
                            return;
                          }

                          // 3) pair select mode (only if drawn exists and stage hasDrawn)
                          if (drawn && turnStage === "hasDrawn" && powerMode === "none") {
                            // if already picked 2, treat click as resolve draw on that slot
                            if (pairPick.length < 2) {
                              setPairPick((prev) => {
                                if (prev.includes(i)) return prev.filter((x) => x !== i);
                                return [...prev, i].slice(0, 2);
                              });
                              return;
                            }
                          }

                          // 4) normal draw resolution
                          if (drawn && turnStage === "hasDrawn" && powerMode === "none") {
                            socket.emit("turn:resolveDrawTap", { code: room.code, slotIndex: i });
                            setDrawn(null);
                            setPairPick([]);
                            return;
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Opponents */}
              <div style={{ marginTop: 18 }}>
                <h3 style={{ marginTop: 0 }}>Opponents</h3>
                <div style={{ display: "grid", gap: 12 }}>
                  {players
                    .filter((p) => p.id !== myId)
                    .map((p) => (
                      <div key={p.id} style={{ padding: 12, borderRadius: 12, border: "1px solid #e5e7eb" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <b>{p.name}</b>
                          <span style={{ fontSize: 13, opacity: 0.7 }}>{p.cardCount} cards</span>
                        </div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                          {[0, 1, 2, 3].map((idx) => {
                            const hasCard = !!(p.slots?.[idx]);
                            const canTarget =
                              amIAllowedToAct &&
                              hasCard &&
                              (powerMode === "otherPeekPick" || powerMode === "jPickOpponentCard" || powerMode === "qPickOpponentCard");

                            return (
                              <PlayingCard
                                key={idx}
                                slot={hasCard ? { faceUp: false, card: null } : null}
                                forceBack={hasCard}
                                labelText={`slot ${idx}`}
                                disabled={!canTarget}
                                onClick={() =>
                                  socket.emit("power:tapOtherCard", {
                                    code: room.code,
                                    otherPlayerId: p.id,
                                    otherSlotIndex: idx,
                                  })
                                }
                              />
                            );
                          })}
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                          9/10: Use Power → tap opponent card (peek) • J/Q: select your card then opponent card
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* Players list */}
          <div style={cardWrap}>
            <h3 style={{ marginTop: 0 }}>Players</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {players.map((p) => (
                <div key={p.id} style={playerRow}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={dot(p.id === room.turnPlayerId ? "#22c55e" : "#9ca3af")} />
                    <b>{p.name}</b>
                    {p.id === room.hostId && <span style={pill}>HOST</span>}
                    {p.id === myId && <span style={pill2}>YOU</span>}
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 13 }}>{p.cardCount} cards</div>
                </div>
              ))}
            </div>
          </div>

          {/* Peek / Q decision modal */}
          {powerPeek && (
            <div style={modalBackdrop} onClick={() => setPowerPeek(null)}>
              <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>{powerPeek.title}</div>
                <PlayingCard slot={{ faceUp: true, card: powerPeek.card }} disabled={true} />
                {powerPeek.qDecision ? (
                  <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                    <button
                      style={btn}
                      onClick={() => {
                        socket.emit("power:qDecision", { code: room.code, accept: true });
                        setPowerPeek(null);
                      }}
                    >
                      Swap
                    </button>
                    <button
                      style={btnGhost}
                      onClick={() => {
                        socket.emit("power:qDecision", { code: room.code, accept: false });
                        setPowerPeek(null);
                      }}
                    >
                      Don’t swap
                    </button>
                  </div>
                ) : (
                  <button style={{ ...btn, marginTop: 14 }} onClick={() => setPowerPeek(null)}>
                    Close
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
function dot(color) {
  return { width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" };
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
  marginTop: 12,
  padding: 10,
  borderRadius: 12,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#9f1239",
  fontSize: 13,
};

const playerRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
};

const scoreRow = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
};

const pill = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
  color: "#3730a3",
  fontWeight: 900,
};

const pill2 = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#ecfeff",
  border: "1px solid #a5f3fc",
  color: "#155e75",
  fontWeight: 900,
};

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "grid",
  placeItems: "center",
  zIndex: 50,
};

const modalCard = {
  background: "white",
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  padding: 16,
  width: 300,
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};

const winnerOverlay = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "start center",
  pointerEvents: "none",
  zIndex: 60,
};

const winnerCard = {
  marginTop: 18,
  padding: "12px 16px",
  borderRadius: 16,
  border: "1px solid rgba(17,24,39,0.15)",
  background: "linear-gradient(90deg, #ffffff, #f8fafc, #ffffff)",
  backgroundSize: "200% 200%",
  animation: "pop 350ms ease-out, shimmer 1200ms linear infinite",
  boxShadow: "0 18px 50px rgba(0,0,0,0.18)",
};

const winnerName = {
  fontSize: 22,
  fontWeight: 1000,
  letterSpacing: 0.5,
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
