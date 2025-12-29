import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣", J: "🃏" };
const isRedSuit = (s) => s === "H" || s === "D";
const cardLabel = (c) => (c?.rank ? `${c.rank}${c.suit && c.suit !== "J" ? SUIT_SYMBOL[c.suit] : ""}` : "");

function PlayingCard({ slot, onClick, disabled, highlight, forceBack, small, labelText }) {
  const hasCard = !!slot?.card?.rank;
  const faceUp = !!slot?.faceUp;

  const showFace = hasCard && !forceBack && faceUp;

  const w = small ? 64 : 92;
  const h = small ? 84 : 120;

  const base = {
    width: w,
    height: h,
    borderRadius: 14,
    border: "1px solid rgba(17,24,39,0.18)",
    background: showFace ? "rgba(255,255,255,0.98)" : "rgba(17,24,39,0.06)",
    display: "grid",
    placeItems: "center",
    position: "relative",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    boxShadow: highlight ? "0 12px 26px rgba(99,102,241,0.18)" : "0 10px 22px rgba(17,24,39,0.10)",
    userSelect: "none",
  };

  if (!hasCard) {
    return (
      <div
        style={{
          ...base,
          background: "rgba(17,24,39,0.03)",
          border: "1px dashed rgba(17,24,39,0.22)",
          boxShadow: "none",
          cursor: "default",
          opacity: 0.8,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.6 }}>{labelText || "empty"}</div>
      </div>
    );
  }

  if (!showFace) {
    return (
      <div style={base} onClick={disabled ? undefined : onClick}>
        <div
          style={{
            width: "86%",
            height: "86%",
            borderRadius: 12,
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(99,102,241,0.55), rgba(15,23,42,0.96))",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        />
        <div style={{ position: "absolute", bottom: 6, fontSize: 10, opacity: 0.7 }}>{labelText || ""}</div>
      </div>
    );
  }

  const c = slot.card;
  const red = isRedSuit(c.suit);

  return (
    <div style={base} onClick={disabled ? undefined : onClick}>
      <div style={{ position: "absolute", top: 8, left: 10, fontWeight: 900, color: red ? "#dc2626" : "#111827" }}>
        {c.rank}
      </div>
      <div style={{ fontSize: small ? 26 : 34, color: red ? "#dc2626" : "#111827" }}>{SUIT_SYMBOL[c.suit] || ""}</div>
      <div style={{ position: "absolute", bottom: 8, right: 10, fontWeight: 900, color: red ? "#dc2626" : "#111827" }}>
        {c.rank}
      </div>
      <div style={{ position: "absolute", bottom: 6, left: 10, fontSize: 10, opacity: 0.6 }}>{labelText || ""}</div>
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const [room, setRoom] = useState(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const [drawn, setDrawn] = useState(null);
  const [peekModal, setPeekModal] = useState(null);
  const [swapToast, setSwapToast] = useState(null);

  const [turnToast, setTurnToast] = useState(false);
  const prevTurnPidRef = useRef(null);

  useEffect(() => {
    if (!SERVER_URL) return;
    const s = io(SERVER_URL, { transports: ["websocket"] });
    setSocket(s);
    return () => s.disconnect();
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onErr = (m) => setError(String(m || "Unknown error"));

    const onUpdate = (r) => {
      setRoom(r);
      setError("");

      // turn popup
      const turnPid = r?.turnPlayerId || null;
      if (r?.phase === "playing" && turnPid && prevTurnPidRef.current && prevTurnPidRef.current !== turnPid) {
        setTurnToast(true);
        setTimeout(() => setTurnToast(false), 1200);
      }
      prevTurnPidRef.current = turnPid;

      if (r?.turnStage !== "hasDrawn") setDrawn(null);
    };

    const onDrawn = (card) => setDrawn(card);

    const onPower = (payload) => {
      const card = payload?.card;
      if (!card?.rank) return; // defensive
      if (payload.type === "peekSelf") setPeekModal({ title: "Peek: your card", card, qDecision: false });
      if (payload.type === "peekOther") setPeekModal({ title: "Peek: opponent card", card, qDecision: false });
      if (payload.type === "qPeekThenDecide") setPeekModal({ title: "Q peeked card", card, qDecision: true });
    };

    const onSwap = (p) => {
      // For J/Q we never show card faces
      const message = p?.message || null;
      if (!message) return;
      setSwapToast({
        kind: p.kind,
        withPlayer: p.withPlayer,
        message,
        mySlot: p.mySlot,
        otherSlot: p.otherSlot,
      });
      setTimeout(() => setSwapToast(null), 2200);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("error:msg", onErr);
    socket.on("room:update", onUpdate);
    socket.on("turn:drawn", onDrawn);
    socket.on("power:result", onPower);
    socket.on("swap:notice", onSwap);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("error:msg", onErr);
      socket.off("room:update", onUpdate);
      socket.off("turn:drawn", onDrawn);
      socket.off("power:result", onPower);
      socket.off("swap:notice", onSwap);
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

  const hasPenaltyCards = !!me && me.slots.length > 4 && me.slots.slice(4).some((s) => s?.card);
  const canCallKargo = amIAllowedToAct && room?.phase === "playing" && !kargoActive && !hasPenaltyCards;

  const canUsePower =
    !!drawn &&
    ["7", "8", "9", "10", "J", "Q"].includes(drawn.rank) &&
    turnStage === "hasDrawn" &&
    amIAllowedToAct;

  const usedTop2 = room?.usedTop2 ?? [];
  const usedCount = room?.usedCount ?? 0;

  const turnName = players.find((p) => p.id === room?.turnPlayerId)?.name ?? "";

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

  function onTapMySlot(slotIndex) {
    if (!room || !me) return;
    if (room.phase !== "playing") return;

    // Claim window (anyone can claim)
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

  function onTapOtherSlot(otherPlayerId, otherSlotIndex) {
    if (!room) return;
    if (powerMode === "otherPeekPick" || powerMode === "jPickOpponentCard" || powerMode === "qPickOpponentCard") {
      socket.emit("power:tapOtherCard", { code: room.code, otherPlayerId, otherSlotIndex });
    }
  }

  function opponentSlotsByLen(len) {
    return Array.from({ length: len }, (_, i) => i);
  }

  const totalWinner = room?.lastRound?.totalWinner ?? null;
  const roundWinner = room?.lastRound?.roundWinner ?? null;

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
          0% { transform: scale(0.98); }
          50% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
      `}</style>

      {room?.activityLog?.length ? (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            width: 280,
            maxWidth: "86vw",
            zIndex: 20,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(17,24,39,0.12)",
            borderRadius: 14,
            padding: 10,
            boxShadow: "0 10px 28px rgba(17,24,39,0.18)",
            backdropFilter: "blur(6px)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Activity</div>
          <div style={{ display: "grid", gap: 6 }}>
            {room.activityLog.slice(0, 12).map((a) => (
              <div key={a.t} style={{ fontSize: 12, lineHeight: 1.25, opacity: 0.9 }}>
                {a.msg}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {room?.kargo?.callerName ? (
        <div
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            top: 12,
            zIndex: 25,
            padding: "10px 14px",
            borderRadius: 999,
            border: "1px solid rgba(244,63,94,0.35)",
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 12px 30px rgba(244,63,94,0.18)",
            fontWeight: 950,
            fontSize: 13,
          }}
        >
          Kargo was called by <span style={{ color: "#be123c" }}>{room.kargo.callerName}</span> — Finish last round.
        </div>
      ) : null}

      {turnToast && room?.phase === "playing" && (
        <div style={toastWrap}>
          <div style={toastCard}>Your turn</div>
        </div>
      )}

      {swapToast && (
        <div style={toastWrap}>
          <div style={toastCard}>
            <div style={{ fontWeight: 900 }}>
              {swapToast.kind} swap with <span style={{ color: "#2563eb" }}>{swapToast.withPlayer}</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
              {swapToast.message}
              {swapToast.kind === "Q" && Number.isFinite(swapToast.mySlot) && Number.isFinite(swapToast.otherSlot) ? (
                <> (your slot {swapToast.mySlot} ↔ their slot {swapToast.otherSlot})</>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>Kargo</h1>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Always hidden • 7/8 peek only • 9/10 peek other • J unseen swap • Q seen swap
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, opacity: connected ? 0.75 : 0.5 }}>{connected ? "Connected" : "Disconnected"}</div>
          {room && (
            <button
              style={btnGhost}
              onClick={() => {
                socket.emit("room:leave", { code: room.code });
                setRoom(null);
                setDrawn(null);
                setPeekModal(null);
                setSwapToast(null);
              }}
            >
              Leave room
            </button>
          )}
        </div>
      </div>

      {!room ? (
        <div style={cardWrap}>
          <h2 style={{ marginTop: 0 }}>Join your friends</h2>

          <div style={{ display: "grid", gap: 10, maxWidth: 380 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Add Your Name here…"
              style={input}
            />

            <div style={{ display: "flex", gap: 10 }}>
              <button
                style={btn}
                onClick={() => socket.emit("room:create", { name: name.trim() || "Player" })}
              >
                Create room
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Room code"
                style={{ ...input, width: 140 }}
              />
              <button
                style={btnGhost}
                onClick={() => socket.emit("room:join", { code: code.trim(), name: name.trim() || "Player" })}
              >
                Join room
              </button>
            </div>

            {error && <div style={errorBox}>{error}</div>}
          </div>
        </div>
      ) : (
        <div style={cardWrap}>
          {room.phase === "lobby" && room.lastRound && (
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
                <div style={{ fontSize: 12, opacity: 0.75 }}>Winners</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                  {totalWinner && (
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "#ecfeff",
                        border: "1px solid #cffafe",
                        fontWeight: 950,
                      }}
                    >
                      Total Winner: <span style={{ color: "#0e7490" }}>{totalWinner}</span>
                    </div>
                  )}
                  {roundWinner && (
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        background: "#dcfce7",
                        border: "1px solid #bbf7d0",
                        fontWeight: 950,
                      }}
                    >
                      Round Winner: <span style={{ color: "#166534" }}>{roundWinner}</span>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Round complete — all cards revealed below.</div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={pill}>
              Room: <b>{room.code}</b>
            </div>
            <div style={pill}>
              Phase: <b>{room.phase}</b>
            </div>
            <div style={pill}>
              Turn: <b>{turnName || "—"}</b>
            </div>
            <div style={pill}>
              Used: <b>{usedCount}</b>
            </div>
            {claimRank && (
              <div style={{ ...pill, borderColor: "rgba(244,63,94,0.35)", background: "rgba(244,63,94,0.06)" }}>
                Claim open: <b>{claimRank}</b> {claimState === "won" ? "(claimed)" : ""}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
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

            {room.phase === "lobby" && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(17,24,39,0.12)",
                  background: "rgba(255,255,255,0.9)",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.85, marginBottom: 8 }}>Players</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {players.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(17,24,39,0.12)",
                        background: p.id === room.hostId ? "rgba(99,102,241,0.12)" : "rgba(17,24,39,0.04)",
                        fontSize: 12,
                        fontWeight: 850,
                      }}
                    >
                      {p.name}
                      {p.id === room.hostId ? " (host)" : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {room.phase === "ready" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button style={btn} onClick={() => socket.emit("game:ready", { code: room.code })}>
                  Ready (hide bottom cards)
                </button>
                <div style={{ fontSize: 12, opacity: 0.7 }}>This is your only peek at the bottom two.</div>
              </div>
            )}

            {room.phase === "playing" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Deck</div>
                    <PlayingCard slot={{ faceUp: false, card: { rank: "X", suit: "S" } }} disabled={true} />
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Active / Used (top 2)</div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <PlayingCard
                        slot={usedTop2[0] ? { faceUp: true, card: usedTop2[0] } : { faceUp: false, card: { rank: "X", suit: "S" } }}
                        disabled={true}
                      />
                      <PlayingCard
                        slot={usedTop2[1] ? { faceUp: true, card: usedTop2[1] } : { faceUp: false, card: { rank: "X", suit: "S" } }}
                        disabled={true}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Drawn</div>
                    <PlayingCard
                      slot={drawn ? { faceUp: true, card: drawn } : { faceUp: false, card: { rank: "", suit: "" } }}
                      disabled={!amIAllowedToAct || turnStage !== "hasDrawn"}
                      highlight={!!drawn}
                      onClick={() => socket.emit("turn:discardDrawn", { code: room.code })}
                      labelText={drawn ? "tap to discard" : ""}
                    />
                  </div>
                </div>

                {peekModal?.card?.rank && (
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

                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button style={btn} disabled={!canDraw} onClick={() => socket.emit("turn:draw", { code: room.code })}>
                    Draw
                  </button>

                  <button
                    style={btnGhost}
                    disabled={!canUsePower}
                    onClick={() => socket.emit("power:useOnce", { code: room.code })}
                  >
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
                    style={btnGhost}
                    disabled={!canCallKargo}
                    onClick={() => {
                      if (hasPenaltyCards) {
                        setError("You can’t call Kargo with penalty cards.");
                        return;
                      }
                      socket.emit("kargo:call", { code: room.code });
                    }}
                  >
                    Call KARGO
                  </button>

                  <button style={btn} disabled={!canEndTurn} onClick={() => socket.emit("turn:end", { code: room.code })}>
                    End turn
                  </button>

                  {hasPenaltyCards && !kargoActive && (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Kargo blocked: you have penalty cards.
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 18 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Your cards (tap to place / claim / power)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, max-content)", gap: 12 }}>
                    {(me?.slots || []).map((s, i) => (
                      <PlayingCard
                        key={i}
                        slot={s}
                        disabled={!room || room.phase !== "playing"}
                        highlight={amIAllowedToAct && turnStage === "hasDrawn"}
                        labelText={`slot ${i}`}
                        onClick={() => onTapMySlot(i)}
                      />
                    ))}
                  </div>
                </div>

                {room.phase === "playing" && (
                  <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Opponents (tap only during power)</div>
                    {players
                      .filter((p) => p.id !== myId)
                      .map((p) => (
                        <div key={p.id} style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb" }}>
                          <div style={{ fontWeight: 900, marginBottom: 10 }}>{p.name}</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, max-content)", gap: 10 }}>
                            {opponentSlotsByLen((p.slots || []).length || p.cardCount).map((i) => (
                              <PlayingCard
                                key={i}
                                slot={p.slots && p.slots[i] ? p.slots[i] : null}
                                forceBack={!!(p.slots && p.slots[i] && p.slots[i].card)}
                                disabled={
                                  !(
                                    (powerMode === "otherPeekPick" ||
                                      powerMode === "jPickOpponentCard" ||
                                      powerMode === "qPickOpponentCard") &&
                                    p.slots &&
                                    p.slots[i] &&
                                    p.slots[i].card
                                  )
                                }
                                small={true}
                                labelText={p.slots && p.slots[i] && p.slots[i].card ? `slot ${i}` : "empty"}
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
        </div>
      )}
    </div>
  );
}

/* ---------------- Styles (no CSS file) ---------------- */
const page = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #0b1020, #0f172a 45%, #111827)",
  color: "white",
  padding: 16,
};

const header = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const cardWrap = {
  maxWidth: 980,
  margin: "0 auto",
  background: "rgba(255,255,255,0.92)",
  color: "#111827",
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
};

const input = {
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid rgba(17,24,39,0.18)",
  outline: "none",
  fontSize: 14,
};

const btn = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(99,102,241,0.45)",
  background: "#4f46e5",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const btnGhost = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(17,24,39,0.16)",
  background: "rgba(255,255,255,0.92)",
  color: "#111827",
  fontWeight: 900,
  cursor: "pointer",
};

const pill = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(17,24,39,0.12)",
  background: "rgba(17,24,39,0.04)",
  fontSize: 12,
};

const toastWrap = {
  position: "fixed",
  top: 70,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 30,
  animation: "toast 1200ms ease-out",
};

const toastCard = {
  padding: "10px 14px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(17,24,39,0.14)",
  color: "#111827",
  fontWeight: 900,
  boxShadow: "0 18px 45px rgba(0,0,0,0.18)",
};

const errorBox = {
  padding: 10,
  borderRadius: 12,
  background: "rgba(244,63,94,0.12)",
  border: "1px solid rgba(244,63,94,0.25)",
  color: "#7f1d1d",
  fontWeight: 800,
};
