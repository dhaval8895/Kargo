// client/src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

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
function CardFace({ card, small }) {
  const rank = card?.rank ?? "?";
  const suit = card?.suit ?? "J";
  const sym = rank === "JOKER" ? "🃏" : suitSymbol(suit);
  const red = isRedSuit(suit);
  const W = small ? 56 : 86;
  const H = small ? 78 : 122;

  return (
    <div style={{ width: W, height: H, borderRadius: 14, background: "white", border: "1px solid #111827", boxShadow: "0 6px 16px rgba(0,0,0,0.12)", position: "relative", display: "grid", placeItems: "center" }}>
      <div style={{ position: "absolute", top: 8, left: 8, fontWeight: 900, fontSize: small ? 12 : 14, lineHeight: 1, color: red ? "#b91c1c" : "#111827" }}>
        {rank}
        <div style={{ fontSize: small ? 12 : 14 }}>{sym}</div>
      </div>
      <div style={{ fontSize: small ? 28 : 44, fontWeight: 900, color: red ? "#b91c1c" : "#111827" }}>{sym}</div>
      <div style={{ position: "absolute", bottom: 8, right: 8, fontWeight: 900, fontSize: small ? 12 : 14, lineHeight: 1, transform: "rotate(180deg)", color: red ? "#b91c1c" : "#111827" }}>
        {rank}
        <div style={{ fontSize: small ? 12 : 14 }}>{sym}</div>
      </div>
    </div>
  );
}

function CardBack({ small, label }) {
  const W = small ? 56 : 86;
  const H = small ? 78 : 122;
  return (
    <div style={{ width: W, height: H, borderRadius: 14, background: "#0b1220", border: "1px solid rgba(255,255,255,0.22)", boxShadow: "0 6px 16px rgba(0,0,0,0.12)", position: "relative", overflow: "hidden", display: "grid", placeItems: "center" }}>
      <div
        style={{
          position: "absolute",
          inset: 10,
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.22)",
          background:
            "repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0, rgba(255,255,255,0.14) 6px, rgba(255,255,255,0.06) 6px, rgba(255,255,255,0.06) 12px)",
        }}
      />
      <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: small ? 10 : 12, opacity: 0.9, color: "white", fontWeight: 900, letterSpacing: 1 }}>KARGO</div>
      {label && <div style={{ position: "absolute", top: 6, right: 8, fontSize: 11, fontWeight: 900, opacity: 0.75, color: "#111827", background: "rgba(255,255,255,0.85)", border: "1px solid rgba(17,24,39,0.12)", padding: "2px 6px", borderRadius: 999 }}>{label}</div>}
    </div>
  );
}

/* ---------------- App ---------------- */
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

      // clear drawn if server says not in hasDrawn stage
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
      setDrawn(c || null);
      setPairPick([]);
      setPeekModal(null);
      setError("");
    };

    const onPower = (payload) => {
      const card = payload?.card;
      if (!card?.rank) return;
      if (payload.type === "peekSelf") setPeekModal({ title: "Peek: your card", card, qDecision: false });
      if (payload.type === "peekOther") setPeekModal({ title: "Peek: opponent card", card, qDecision: false });
      if (payload.type === "qPeekThenDecide") setPeekModal({ title: "Q peeked card", card, qDecision: true });
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
  const kargoCallerId = room?.kargo?.callerId ?? null;
  const kargoCallerName = room?.kargo?.callerName ?? null;
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
    !!drawn && ["7", "8", "9", "10", "J", "Q"].includes(drawn.rank) && turnStage === "hasDrawn" && amIAllowedToAct;

  const usedTop2 = room?.usedTop2 ?? [];
  const usedCount = room?.usedCount ?? 0;

  const turnName = players.find((p) => p.id === room?.turnPlayerId)?.name ?? "?";

  const mySlots = me?.slots ?? [];
  const base4 = mySlots.slice(0, 4);
  const extras = mySlots.slice(4);

  // display order: deck/used then your cards; and slots 0,1 are bottom; 2,3 top
  const slotDisplayOrder = [2, 3, 0, 1];

  // only show real occupied slots for opponent targeting
  const myOccupied = me?.occupied ?? [];
  const activityLog = room?.activityLog ?? [];

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

  function tapMySlot(slotIndex) {
    if (!room || !me) return;
    if (room.phase !== "playing") return;

    // claims always allowed while claim is open
    if (claimRank) {
      socket.emit("used:claim", { code: room.code, slotIndex });
      return;
    }

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

    if (amIAllowedToAct && turnStage === "hasDrawn" && powerMode === "none") {
      socket.emit("turn:resolveDrawTap", { code: room.code, slotIndex });
      return;
    }
  }

  function tapOtherSlot(otherPlayerId, otherSlotIndex) {
    if (!room) return;

    // kargo protection: disable caller
    if (kargoActive && otherPlayerId === kargoCallerId) return;

    if (powerMode === "otherPeekPick" || powerMode === "jPickOpponentCard" || powerMode === "qPickOpponentCard") {
      socket.emit("power:tapOtherCard", { code: room.code, otherPlayerId, otherSlotIndex });
    }
  }

  function togglePairPick(slotIndex) {
    if (!amIAllowedToAct || turnStage !== "hasDrawn") return;
    if (!me?.slots?.[slotIndex]?.card) return;

    setPairPick((prev) => {
      const exists = prev.includes(slotIndex);
      let next = exists ? prev.filter((x) => x !== slotIndex) : [...prev, slotIndex];
      if (next.length > 2) next = next.slice(1);
      return next;
    });
  }

  function discardPairNow() {
    if (pairPick.length !== 2) return;
    socket.emit("turn:discardPair", { code: room.code, a: pairPick[0], b: pairPick[1] });
    setPairPick([]);
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
      `}</style>

      {turnToast && (
        <div style={toastWrap}>
          <div style={toastCard}>Your turn</div>
        </div>
      )}

      <div style={header}>
        <div>
          <h1 style={{ margin: 0 }}>KARGO</h1>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            Claim stays open until next draw • Wrong claim = +1 • J/Q logs show slot indices only
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
              setPeekModal(null);
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14, alignItems: "start" }}>
          <div style={cardWrap}>
            {/* TOP BAR */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Room</div>
                <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 2 }}>{room.code}</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                  Phase: <b>{room.phase}</b>
                  {room.phase === "playing" && (
                    <>
                      {" "}
                      • Turn: <b>{turnName}</b> • Stage: <b>{turnStage}</b> • Power: <b>{powerMode}</b>
                    </>
                  )}
                </div>
              </div>

              {/* LOBBY controls */}
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

              {/* READY */}
              {room.phase === "ready" && (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button style={btn} disabled={room.readyState?.mine} onClick={() => socket.emit("game:ready", { code: room.code })}>
                    {room.readyState?.mine ? "Ready ✓" : "Ready"}
                  </button>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    You can see <b>slot 0 & 1</b> once. Press Ready to hide them again.
                  </div>
                </div>
              )}
            </div>

            {/* Sticky KARGO banner */}
            {kargoActive && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  color: "#92400e",
                  fontWeight: 900,
                }}
              >
                Kargo was called by {kargoCallerName} — Finish last round
              </div>
            )}

            {/* Lobby player list */}
            {room.phase === "lobby" && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Players</div>
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {players.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: 10, border: "1px solid #e5e7eb", borderRadius: 14 }}>
                      <div style={{ fontWeight: 900 }}>{p.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{p.id === room.hostId ? "Host" : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PLAYING TABLE */}
            {room.phase === "playing" && (
              <>
                <div style={{ marginTop: 16, display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Deck</div>
                    <CardBack />
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Drawn</div>
                    {drawn ? (
                      <div
                        style={{ cursor: amIAllowedToAct && turnStage === "hasDrawn" ? "pointer" : "default" }}
                        onClick={() => {
                          if (!amIAllowedToAct || turnStage !== "hasDrawn" || !drawn) return;
                          socket.emit("turn:discardDrawn", { code: room.code });
                        }}
                        title="Tap drawn to discard"
                      >
                        <CardFace card={drawn} />
                      </div>
                    ) : (
                      <CardBack label="drawn" />
                    )}
                    <div style={{ fontSize: 11, opacity: 0.65 }}>Tap drawn to discard</div>
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Used (last 2)</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      {usedTop2[0] ? <CardFace card={usedTop2[0]} /> : <CardBack label="used" />}
                      {usedTop2[1] ? <CardFace card={usedTop2[1]} /> : <CardBack label="used" />}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Used count: <b>{usedCount}</b>{" "}
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
                  </div>

                  {/* Peek modal (private to player) */}
                  {peekModal?.card?.rank && (
                    <div style={{ padding: 12, borderRadius: 14, border: "1px solid rgba(17,24,39,0.15)", background: "rgba(255,255,255,0.95)", display: "grid", gap: 10, minWidth: 260 }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{peekModal.title}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>Temporary reveal.</div>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <CardFace card={peekModal.card} />
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

                  <button style={btnGhost} disabled={!canCallKargo} onClick={() => socket.emit("kargo:call", { code: room.code })}>
                    Call KARGO
                  </button>

                  <button style={btn} disabled={!canEndTurn} onClick={() => socket.emit("turn:end", { code: room.code })}>
                    End Turn
                  </button>

                  <div style={{ fontSize: 12, opacity: 0.75 }}>{amIAllowedToAct ? "Your turn" : `Waiting for ${turnName}…`}</div>
                </div>

                {claimRank && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#991b1b", fontWeight: 800 }}>
                    Claim is LIVE (rank {claimRank}) — ends when the next player draws. Tap your matching card to discard it.
                  </div>
                )}
              </>
            )}

            {/* YOUR CARDS (ready + playing) */}
            {(room.phase === "ready" || room.phase === "playing") && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {room.phase === "ready" ? "Your cards (slot 0/1 visible once)" : "Your cards (tap to play / claim / swap)"}
                </div>

                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 12 }}>
                  {slotDisplayOrder.map((idx) => {
                    const slot = base4[idx] ?? null;
                    const isSelectedForPair = pairPick.includes(idx);
                    const clickable = room.phase === "playing" && !!slot;
                    return (
                      <div key={idx} style={{ display: "grid", gap: 6 }}>
                        {slot?.faceUp && slot?.card ? (
                          <div onClick={() => clickable && tapMySlot(idx)} style={{ cursor: clickable ? "pointer" : "default" }}>
                            <CardFace card={slot.card} />
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              if (!clickable) return;
                              // in hasDrawn stage, allow selecting two cards for pair discard by clicking + shift style
                              if (amIAllowedToAct && turnStage === "hasDrawn") togglePairPick(idx);
                              tapMySlot(idx);
                            }}
                            style={{ cursor: clickable ? "pointer" : "default", outline: isSelectedForPair ? "3px solid #2563eb" : "none", borderRadius: 16 }}
                          >
                            <CardBack label={`slot ${idx}`} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* penalty cards rendered as real slots */}
                {extras.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 8 }}>Extra cards</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {extras.map((_, i) => {
                        const slotIndex = i + 4;
                        const isSelectedForPair = pairPick.includes(slotIndex);
                        return (
                          <div
                            key={slotIndex}
                            style={{ cursor: room.phase === "playing" ? "pointer" : "default", outline: isSelectedForPair ? "3px solid #2563eb" : "none", borderRadius: 16 }}
                            onClick={() => {
                              if (room.phase !== "playing") return;
                              if (amIAllowedToAct && turnStage === "hasDrawn") togglePairPick(slotIndex);
                              tapMySlot(slotIndex);
                            }}
                          >
                            <CardBack label={`slot ${slotIndex}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pair action button */}
                {room.phase === "playing" && amIAllowedToAct && turnStage === "hasDrawn" && pairPick.length === 2 && (
                  <div style={{ marginTop: 12 }}>
                    <button style={btn} onClick={discardPairNow}>
                      Throw selected pair
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* OPPONENTS */}
            {room.phase === "playing" && (
              <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Opponents (tap only during 9/10, J/Q)</div>

                {players
                  .filter((p) => p.id !== myId)
                  .map((p) => {
                    const disabledByKargo = kargoActive && p.id === kargoCallerId;
                    const canTarget =
                      !disabledByKargo &&
                      (powerMode === "otherPeekPick" || powerMode === "jPickOpponentCard" || powerMode === "qPickOpponentCard");

                    return (
                      <div key={p.id} style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <div style={{ fontWeight: 900 }}>{p.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            cards: <b>{p.cardCount}</b> {disabledByKargo ? "• protected (KARGO)" : ""}
                          </div>
                        </div>

                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {(p.occupied || []).map((slotIdx) => (
                            <div key={slotIdx} style={{ cursor: canTarget ? "pointer" : "default", opacity: canTarget ? 1 : 0.6 }} onClick={() => canTarget && tapOtherSlot(p.id, slotIdx)}>
                              <CardBack small label={`slot ${slotIdx}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {error && <div style={{ ...errorBox, marginTop: 14 }}>{error}</div>}
          </div>

          {/* Activity Log */}
          <div style={{ ...cardWrap, position: "sticky", top: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Activity</div>
            <div style={{ display: "grid", gap: 8 }}>
              {activityLog.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.7 }}>No activity yet…</div>
              ) : (
                activityLog.map((x) => (
                  <div key={x.t} style={{ fontSize: 13, padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "#f9fafb" }}>
                    {x.msg}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- styles ---------- */
const page = {
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
  maxWidth: 1320,
  margin: "0 auto",
  padding: 18,
  display: "grid",
  gap: 12,
  background: "#f8fafc",
  minHeight: "100vh",
};

const header = { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 };

const cardWrap = { border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, background: "white" };

const row = { display: "grid", gap: 6 };
const label = { fontSize: 13, opacity: 0.75 };

const input = { padding: "10px 12px", borderRadius: 12, border: "1px solid #d1d5db", width: 260, outline: "none" };

const btn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const btnGhost = { padding: "10px 12px", borderRadius: 12, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontWeight: 800 };

const errorBox = { padding: 10, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#9f1239", fontSize: 13 };

const toastWrap = { position: "fixed", top: 16, left: 0, right: 0, display: "grid", placeItems: "center", zIndex: 80, pointerEvents: "none" };

const toastCard = {
  padding: "10px 14px",
  borderRadius: 16,
  border: "1px solid rgba(17,24,39,0.15)",
  background: "rgba(255,255,255,0.97)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
  fontWeight: 900,
  animation: "toast 1400ms ease-out",
  minWidth: 240,
  textAlign: "center",
};
