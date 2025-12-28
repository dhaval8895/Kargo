// client/src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

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

function PlayingCard({ slot, onClick, disabled, small = false, stackedOffset = 0 }) {
  const hasCard = !!slot;
  const faceUp = !!slot?.faceUp && !!slot?.card;

  const rank = slot?.card?.rank;
  const suit = slot?.card?.suit;
  const sym = suitSymbol(suit);
  const red = isRedSuit(suit);

  const W = small ? 56 : 82;
  const H = small ? 78 : 116;

  const outer = {
    width: W,
    height: H,
    borderRadius: 14,
    border: "1px solid #111827",
    boxShadow: small ? "0 2px 8px rgba(0,0,0,0.12)" : "0 6px 16px rgba(0,0,0,0.12)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    userSelect: "none",
    background: faceUp ? "white" : "#0b1220",
    position: "relative",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    transform: `translate(${stackedOffset}px, ${stackedOffset}px)`,
  };

  const corner = {
    position: "absolute",
    top: 8,
    left: 8,
    fontWeight: 900,
    fontSize: small ? 12 : 14,
    lineHeight: 1,
    color: faceUp ? (red ? "#b91c1c" : "#111827") : "rgba(255,255,255,0.9)",
  };

  const corner2 = {
    position: "absolute",
    bottom: 8,
    right: 8,
    fontWeight: 900,
    fontSize: small ? 12 : 14,
    lineHeight: 1,
    transform: "rotate(180deg)",
    color: faceUp ? (red ? "#b91c1c" : "#111827") : "rgba(255,255,255,0.9)",
  };

  const pip = {
    fontSize: small ? 28 : 42,
    fontWeight: 900,
    color: faceUp ? (red ? "#b91c1c" : "#111827") : "rgba(255,255,255,0.9)",
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
      </div>
    );
  }

  return (
    <div style={outer} onClick={disabled ? undefined : onClick}>
      {faceUp ? (
        <>
          <div style={corner}>
            {rank}
            <div style={{ fontSize: small ? 12 : 14 }}>{rank === "JOKER" ? "🃏" : sym}</div>
          </div>

          <div style={pip}>{rank === "JOKER" ? "🃏" : sym}</div>

          <div style={corner2}>
            {rank}
            <div style={{ fontSize: small ? 12 : 14 }}>{rank === "JOKER" ? "🃏" : sym}</div>
          </div>
        </>
      ) : (
        <>
          <div style={backPattern} />
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 10,
              fontSize: small ? 10 : 12,
              opacity: 0.85,
              color: "white",
              fontWeight: 900,
              letterSpacing: 1,
            }}
          >
            KARGO
          </div>
        </>
      )}
    </div>
  );
}

function cardRankFromSlot(slot) {
  return slot?.card?.rank ?? null;
}

/* ---------- App ---------- */
export default function App() {
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
  const [peekDone, setPeekDone] = useState(false);

  const [powerPeek, setPowerPeek] = useState(null); // { title, card }

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
        setPeekDone(false);
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

  const myId = socket?.id;
  const me = room?.players?.find((p) => p.id === myId);
  const isHost = room?.hostId === myId;

  const isMyTurn = room?.turnPlayerId === myId;
  const canStart =
    !!room && isHost && room.phase === "lobby" && (room.players?.length ?? 0) >= 2;

  const kargoActive = !!room?.kargo;
  const activeFinalPlayerId = room?.kargo?.activeFinalPlayerId ?? null;
  const amIActiveFinal = kargoActive ? activeFinalPlayerId === myId : false;
  const amIAllowedToAct = room?.phase === "playing" && (kargoActive ? amIActiveFinal : isMyTurn);

  // Determine if user has any visible power cards
  const mySlots = me?.slots || [];
  const myVisibleRanks = mySlots.map(cardRankFromSlot);

  const hasPower7or8 = myVisibleRanks.some((r) => r === "7" || r === "8");
  const hasPower9or10 = myVisibleRanks.some((r) => r === "9" || r === "10");

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

  return (
    <div style={page}>
      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>KARGO</h1>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            UI v4 (KARGO call + unseen match + stacked used pile)
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
            <input
              style={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dhaval"
            />
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
          <div style={cardWrap}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Room code</div>
                <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>{room.code}</div>
                <div style={{ opacity: 0.75, fontSize: 13, marginTop: 6 }}>
                  Phase: <b>{room.phase}</b> • Turn:{" "}
                  <b>{room.players.find((p) => p.id === room.turnPlayerId)?.name ?? "—"}</b>
                </div>

                {kargoActive && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #fde68a", background: "#fffbeb" }}>
                    <div style={{ fontWeight: 900 }}>
                      KARGO called by {room.kargo.callerName}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Final turns in progress… current final player:{" "}
                      <b>{room.players.find((p) => p.id === activeFinalPlayerId)?.name ?? "—"}</b>
                    </div>
                  </div>
                )}

                {room.lastRound && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "#f8fafc" }}>
                    <div style={{ fontWeight: 900 }}>
                      Last round: {room.lastRound.winnerName} • {room.lastRound.reason}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ minWidth: 260 }}>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard</div>
                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                  {room.scoreboard
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
            </div>

            {room.phase === "lobby" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button
                  style={btn}
                  disabled={!canStart}
                  onClick={() => socket.emit("game:start", { code: room.code })}
                >
                  Start game
                </button>
                {!canStart && (
                  <div style={{ opacity: 0.75, fontSize: 13, alignSelf: "center" }}>
                    {isHost ? "Need at least 2 players." : "Waiting for host to start."}
                  </div>
                )}
              </div>
            )}

            {error && <div style={errorBox}>{error}</div>}
          </div>

          {room.phase === "playing" && (
            <>
              <div style={cardWrap}>
                <h3 style={{ marginTop: 0 }}>Center</h3>

                <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>
                      Active used card (race claim)
                    </div>
                    <PlayingCard
                      slot={room.thrownCard ? { faceUp: true, card: room.thrownCard } : null}
                      disabled={true}
                    />
                    <div style={{ maxWidth: 280, fontSize: 12, opacity: 0.75, lineHeight: 1.35, marginTop: 8 }}>
                      Click a matching rank in your hand to claim. Wrong claim = +1 penalty card.
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 360 }}>
                    <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>
                      Used pile (top card stacked)
                    </div>

                    <div style={{ position: "relative", height: 140, display: "grid", placeItems: "start" }}>
                      {/* Fake stack behind */}
                      <div style={{ position: "absolute", left: 0, top: 0 }}>
                        <PlayingCard slot={room.usedPileTop ? { faceUp: true, card: room.usedPileTop } : null} disabled={true} stackedOffset={10} />
                      </div>
                      <div style={{ position: "absolute", left: 0, top: 0 }}>
                        <PlayingCard slot={room.usedPileTop ? { faceUp: true, card: room.usedPileTop } : null} disabled={true} stackedOffset={5} />
                      </div>
                      <div style={{ position: "absolute", left: 0, top: 0 }}>
                        <PlayingCard slot={room.usedPileTop ? { faceUp: true, card: room.usedPileTop } : null} disabled={true} stackedOffset={0} />
                      </div>

                      <div style={{ marginLeft: 95, marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                        Cards in used pile: <b>{room.usedPileCount}</b>
                        <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                          When deck ends, used pile reshuffles automatically.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 360 }}>
                    <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>
                      Your actions {kargoActive ? "(final turns mode)" : ""}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        style={btn}
                        disabled={!amIAllowedToAct || !!drawn}
                        onClick={() => socket.emit("turn:draw", { code: room.code })}
                      >
                        Draw
                      </button>

                      <button
                        style={btnGhost}
                        disabled={!amIAllowedToAct || !drawn}
                        onClick={() => {
                          socket.emit("turn:throwDrawn", { code: room.code });
                          setDrawn(null);
                        }}
                      >
                        Don’t keep (make used)
                      </button>

                      <button
                        style={btnGhost}
                        disabled={!amIAllowedToAct}
                        onClick={() => socket.emit("turn:end", { code: room.code })}
                      >
                        End turn
                      </button>

                      <button
                        style={btnGhost}
                        disabled={!room.viewer?.canDiscardSeenPair}
                        onClick={() => socket.emit("turn:discardSeenPair", { code: room.code })}
                      >
                        Discard seen pair
                      </button>

                      <button
                        style={btnWarn}
                        disabled={!amIAllowedToAct || !!drawn || kargoActive}
                        onClick={() => socket.emit("kargo:call", { code: room.code })}
                        title="Call KARGO (only on your turn and with no drawn card pending)"
                      >
                        CALL KARGO
                      </button>
                    </div>

                    {/* Power buttons (basic) */}
                    <div style={{ marginTop: 10, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Power cards</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          style={btnGhost}
                          disabled={!hasPower7or8}
                          onClick={() => {
                            // peek your slot 0 by default; you can change later
                            socket.emit("power:peekSelf", { code: room.code, mySlotIndex: 0 });
                          }}
                        >
                          7/8: Peek self (slot 0)
                        </button>

                        <button
                          style={btnGhost}
                          disabled={!hasPower9or10 || (room.players?.length ?? 0) < 2}
                          onClick={() => {
                            // peek first other player slot 0 by default
                            const other = room.players.find((p) => p.id !== myId);
                            if (!other) return;
                            socket.emit("power:peekOther", { code: room.code, otherPlayerId: other.id, otherSlotIndex: 0 });
                          }}
                        >
                          9/10: Peek other (slot 0)
                        </button>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
                        Next: J swap + Q peek-then-swap (coming next step).
                      </div>
                    </div>

                    {!peekDone && (
                      <div style={{ marginTop: 10, padding: 12, border: "1px dashed #9ca3af", borderRadius: 12 }}>
                        <div style={{ fontWeight: 900 }}>Peek once</div>
                        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
                          Your bottom 2 are visible now. Click done to hide them.
                        </div>
                        <button style={{ ...btn, marginTop: 10 }} onClick={() => setPeekDone(true)}>
                          Done
                        </button>
                      </div>
                    )}

                    {drawn && (
                      <div style={{ marginTop: 10, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 900 }}>Drawn:</div>
                          <PlayingCard slot={{ faceUp: true, card: drawn }} disabled={true} />
                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            Click a slot in your hand:
                            <ul style={{ margin: "6px 0 0 18px" }}>
                              <li>Seen slot: if match → discards both</li>
                              <li>Unseen slot: tries match; mismatch → penalty + used card</li>
                              <li>Or keep → swap with a NON-empty slot</li>
                            </ul>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {mySlots.map((slot, i) => {
                            // cannot keep into empty slot
                            const canKeepInto = !!slot;
                            return (
                              <button
                                key={i}
                                style={btn}
                                disabled={!canKeepInto}
                                onClick={() => {
                                  socket.emit("turn:keepSwap", { code: room.code, slotIndex: i });
                                  setDrawn(null);
                                }}
                                title={!canKeepInto ? "Cannot keep into an empty slot" : ""}
                              >
                                Keep → slot {i}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={cardWrap}>
                <h3 style={{ marginTop: 0 }}>
                  Your hand{" "}
                  <span style={{ fontSize: 12, opacity: 0.65 }}>
                    {drawn
                      ? "(click a slot to match/discard or try-match unseen)"
                      : room.thrownCard
                      ? "(click a slot to claim active used card)"
                      : ""}
                  </span>
                </h3>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {mySlots.map((slot, i) => {
                    const displaySlot = !slot
                      ? null
                      : peekDone
                      ? { ...slot, faceUp: false }
                      : slot;

                    const canClaimUsed = !!room.thrownCard;
                    const canInteractWithDrawn = !!drawn && amIAllowedToAct;

                    return (
                      <div key={i} style={{ textAlign: "center" }}>
                        <PlayingCard
                          slot={displaySlot}
                          disabled={!(canClaimUsed || canInteractWithDrawn)}
                          onClick={() => {
                            if (canInteractWithDrawn) {
                              // If empty do nothing
                              if (!slot) return;

                              // If slot is unseen -> use tryMatchUnseen
                              if (!slot.faceUp) {
                                socket.emit("turn:tryMatchUnseen", { code: room.code, slotIndex: i });
                                setDrawn(null);
                                return;
                              }

                              // slot is seen -> discard drawn if matching, else server will error
                              socket.emit("turn:discardDrawnMatch", { code: room.code, slotIndex: i });
                              setDrawn(null);
                              return;
                            }

                            if (canClaimUsed) {
                              // claim used card
                              if (!slot) return;
                              socket.emit("thrown:claim", { code: room.code, slotIndex: i });
                            }
                          }}
                        />
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>slot {i}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>
                  Penalties add new unseen slots (slot 5, 6, …). Win by hitting 0 cards.
                </div>
              </div>
            </>
          )}

          <div style={cardWrap}>
            <h3 style={{ marginTop: 0 }}>Players</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {room.players.map((p) => (
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

const btnWarn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #b45309",
  background: "#f59e0b",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 900,
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
