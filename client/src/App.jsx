// client/src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

/* ---------------- Error Boundary (prevents blank screen) ---------------- */
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
            <h2 style={{ marginTop: 0 }}>UI crashed (but we caught it)</h2>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
              <b>Error:</b> {String(this.state.err?.message || this.state.err || "Unknown")}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
              Fix: redeploy after updating code. If this keeps happening, copy the error above and send it to me.
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

/* ---------- Card UI helpers ---------- */
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

function PlayingCard({ slot, onClick, disabled, small = false, labelText }) {
  const hasCard = !!slot;
  const faceUp = !!slot?.faceUp && !!slot?.card;

  const W = small ? 56 : 86;
  const H = small ? 78 : 122;

  const outer = {
    width: W,
    height: H,
    borderRadius: 14,
    border: "1px solid #111827",
    boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
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

/* ---------- Used pile stack (flat) ---------- */
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
        <PlayingCard slot={topCard ? { faceUp: true, card: topCard } : null} disabled={true} />
      </div>
      <div style={{ position: "absolute", left: 98, top: 10, fontSize: 12, opacity: 0.75 }}>
        Used: <b>{count}</b>
      </div>
    </div>
  );
}

/* ---------------- App Wrapper ---------------- */
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

/* ---------------- Main App ---------------- */
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

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onErr = (m) => setError(String(m || "Unknown error"));

    const onUpdate = (r) => {
      setRoom(r);
      setError("");

      if (r?.phase !== "playing") setDrawn(null);

      if (r?.lastRound?.winnerName) {
        setWinnerSplash({ name: r.lastRound.winnerName });
        setTimeout(() => setWinnerSplash(null), 2500);
      }
    };

    const onDrawn = (c) => {
      setDrawn(c);
      setError("");
    };

    const onPower = (payload) => {
      if (!payload?.card) return;
      if (payload.type === "peekSelf") {
        setPowerPeek({ title: `Peek: your slot ${payload.slotIndex}`, card: payload.card });
      } else if (payload.type === "peekOther") {
        setPowerPeek({ title: `Peek: opponent slot ${payload.slotIndex}`, card: payload.card });
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

  const me = players.find((p) => p.id === myId) || null;

  const isHost = room?.hostId === myId;
  const isMyTurn = room?.turnPlayerId === myId;

  const kargoActive = !!room?.kargo;
  const activeFinalPlayerId = room?.kargo?.activeFinalPlayerId ?? null;
  const amIActiveFinal = kargoActive ? activeFinalPlayerId === myId : false;

  const amIAllowedToAct = room?.phase === "playing" && (kargoActive ? amIActiveFinal : isMyTurn);

  const swapOffer = room?.swapOffer ?? null;
  const inReadyPhase = room?.phase === "ready";
  const readyMine = room?.readyState?.mine ?? false;

  const powerMode = room?.powerState?.mode ?? "none";

  const drawnRank = drawn?.rank ?? null;
  const canPower = !!drawnRank && ["7", "8", "9", "10", "J", "Q"].includes(drawnRank);

  if (!SERVER_URL) {
    return (
      <div style={page}>
        <div style={cardWrap}>
          <h2 style={{ marginTop: 0 }}>Missing VITE_SERVER_URL</h2>
          <div>Set it in Vercel to your Render URL (https://…onrender.com).</div>
        </div>
      </div>
    );
  }

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
      `}</style>

      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>KARGO</h1>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Tap-to-resolve • Ready gate • J/Q offer swaps</div>
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
            <button
              style={btn}
              disabled={!name.trim() || !connected}
              onClick={() => socket.emit("room:create", { name: name.trim() })}
            >
              Create room
            </button>

            <input
              style={{ ...input, width: 160 }}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
            />

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
          {/* Winner Splash */}
          {winnerSplash && (
            <div style={winnerOverlay}>
              <div style={winnerCard}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Round Winner</div>
                <div style={winnerName}>{winnerSplash.name}</div>
              </div>
            </div>
          )}

          <div style={cardWrap}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Room code</div>
                <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>{room.code}</div>
                <div style={{ opacity: 0.75, fontSize: 13, marginTop: 6 }}>
                  Phase: <b>{room.phase}</b> • Turn:{" "}
                  <b>{players.find((p) => p.id === room.turnPlayerId)?.name ?? "—"}</b>
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
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard (Points)</div>
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
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard (Rounds)</div>
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

            {/* Lobby actions */}
            {room.phase === "lobby" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button style={btn} disabled={!isHost || players.length < 2} onClick={() => socket.emit("game:start", { code: room.code })}>
                  Start game
                </button>
                {!isHost && <div style={{ opacity: 0.75, fontSize: 13, alignSelf: "center" }}>Waiting for host…</div>}
              </div>
            )}

            {/* READY phase */}
            {inReadyPhase && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                <div style={{ fontWeight: 900 }}>Ready check</div>
                <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
                  Peek your two bottom cards now. When everyone hits Ready, all cards flip facedown and play begins.
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
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

          {/* Swap offer prompt */}
          {swapOffer && (
            <div style={cardWrap}>
              <h3 style={{ marginTop: 0 }}>Swap Offer</h3>
              <div style={{ opacity: 0.8, marginBottom: 10 }}>
                <b>{swapOffer.fromName}</b> wants your card in slot <b>{swapOffer.toSlotIndex}</b>.
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                  Tap which of <b>{swapOffer.fromName}</b>’s cards you want in exchange.
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {(players.find((p) => p.id === swapOffer.fromId)?.slots || []).map((slot, idx) => (
                  <PlayingCard
                    key={idx}
                    slot={slot ? { faceUp: false, card: null } : null}
                    disabled={!slot}
                    labelText={`slot ${idx}`}
                    onClick={() => socket.emit("swap:accept", { code: room.code, offerId: swapOffer.id, fromSlotIndex: idx })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Playing UI */}
          {room.phase === "playing" && (
            <div style={cardWrap}>
              <h3 style={{ marginTop: 0 }}>Center</h3>

              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Active used card (race claim)</div>
                  <PlayingCard slot={room.thrownCard ? { faceUp: true, card: room.thrownCard } : null} disabled={true} />
                  <div style={{ maxWidth: 280, fontSize: 12, opacity: 0.75, lineHeight: 1.35, marginTop: 8 }}>
                    Penalties happen only here: wrong rank match = +1 unseen penalty card.
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Used pile</div>
                  <UsedPileStack topCard={room.usedPileTop} count={room.usedPileCount || 0} />
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
                    When the draw deck ends, used pile reshuffles automatically.
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 380 }}>
                  <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>
                    Actions {kargoActive ? "(final turns)" : ""}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={btn} disabled={!amIAllowedToAct || !!drawn || !!swapOffer} onClick={() => socket.emit("turn:draw", { code: room.code })}>
                      Draw
                    </button>

                    <button
                      style={btnGhost}
                      disabled={!amIAllowedToAct || !!drawn || kargoActive || !!swapOffer}
                      onClick={() => socket.emit("kargo:call", { code: room.code })}
                    >
                      Call KARGO
                    </button>
                  </div>

                  <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb" }}>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>Drawn:</div>

                      <PlayingCard
                        slot={drawn ? { faceUp: true, card: drawn } : null}
                        disabled={!drawn || !canPower}
                        onClick={() => {
                          if (!drawn) return;
                          if (!canPower) return;

                          if (drawn.rank === "Q" && powerMode === "qConfirmOffer") {
                            socket.emit("power:qConfirm", { code: room.code });
                            return;
                          }
                          socket.emit("power:activate", { code: room.code });
                        }}
                        labelText={drawn && canPower ? "tap for power" : ""}
                      />

                      <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 360 }}>
                        After drawing: <b>tap one of your cards</b>.
                        <ul style={{ margin: "6px 0 0 18px" }}>
                          <li>Match rank → discard both</li>
                          <li>No match → swap (no penalty)</li>
                        </ul>
                      </div>
                    </div>

                    {drawn?.rank === "Q" && powerMode === "qConfirmOffer" && (
                      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                        Q: You peeked a card. Tap the drawn Q again to send the offer.
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

              {/* Your hand */}
              <div style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>Your hand</h3>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {(me?.slots || []).map((slot, i) => (
                    <div key={i} style={{ textAlign: "center" }}>
                      <PlayingCard
                        slot={slot}
                        labelText={`slot ${i}`}
                        disabled={(!room.thrownCard && !drawn && powerMode !== "selfPeekPick")}
                        onClick={() => {
                          if (powerMode === "selfPeekPick") {
                            socket.emit("power:tapSelfCard", { code: room.code, slotIndex: i });
                            return;
                          }

                          if (drawn && amIAllowedToAct) {
                            socket.emit("turn:resolveDrawTap", { code: room.code, slotIndex: i });
                            setDrawn(null);
                            return;
                          }

                          if (room.thrownCard) {
                            socket.emit("used:claim", { code: room.code, slotIndex: i });
                            return;
                          }
                        }}
                      />
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{slot ? "" : "empty"}</div>
                    </div>
                  ))}
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
                          {(p.slots || []).map((slot, idx) => (
                            <PlayingCard
                              key={idx}
                              slot={slot ? { faceUp: false, card: null } : null}
                              labelText={`slot ${idx}`}
                              disabled={!slot || !drawn || !["otherPeekPick", "jPickOpponentCard", "qPickOpponentCard"].includes(powerMode)}
                              onClick={() =>
                                socket.emit("power:tapOtherCard", {
                                  code: room.code,
                                  otherPlayerId: p.id,
                                  otherSlotIndex: idx,
                                })
                              }
                            />
                          ))}
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                          For 9/10/J/Q: tap drawn card → then tap an opponent card.
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

          {/* Peek modal */}
          {powerPeek && (
            <div style={modalBackdrop} onClick={() => setPowerPeek(null)}>
              <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>{powerPeek.title}</div>
                <PlayingCard slot={{ faceUp: true, card: powerPeek.card }} disabled={true} />
                <button style={{ ...btn, marginTop: 14 }} onClick={() => setPowerPeek(null)}>
                  Close
                </button>
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
  maxWidth: 1200,
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
  width: 280,
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
