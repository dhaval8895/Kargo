// client/src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, err: error };
  }
  componentDidCatch(error) {
    console.error("UI crashed:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ ...page, padding: 18 }}>
          <div style={cardWrap}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>UI crashed</div>
            <div style={{ marginTop: 10, ...errorBox }}>
              {String(this.state.err?.message || this.state.err || "Unknown error")}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
              Refresh the page. If this keeps happening, copy the console error and send it to me.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function suitSymbol(s) {
  if (s === "S") return "♠";
  if (s === "C") return "♣";
  if (s === "H") return "♥";
  if (s === "D") return "♦";
  return "";
}

function isRedSuit(s) {
  return s === "H" || s === "D";
}

function rankLabel(r) {
  return r;
}

function PlayingCard({ slot, forceBack = false, disabled = false, onClick, badge }) {
  const faceUp = !!slot?.faceUp;
  const card = slot?.card;
  const showFront = !forceBack && faceUp && !!card;

  const border = disabled ? "1px solid #e5e7eb" : "1px solid rgba(17,24,39,0.18)";
  const bg = showFront ? "white" : "#0f172a";
  const color = showFront ? (isRedSuit(card.suit) ? "#dc2626" : "#111827") : "rgba(255,255,255,0.88)";

  return (
    <div
      onClick={disabled ? undefined : onClick}
      role={disabled ? undefined : "button"}
      style={{
        width: 86,
        height: 120,
        borderRadius: 16,
        border,
        background: bg,
        boxShadow: "0 8px 18px rgba(15,23,42,0.10)",
        display: "grid",
        placeItems: "center",
        cursor: disabled ? "default" : "pointer",
        position: "relative",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {showFront ? (
        <div style={{ width: "100%", height: "100%", padding: 10, display: "grid", gridTemplateRows: "auto 1fr auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color }}>
            <span>{rankLabel(card.rank)}</span>
            <span>{suitSymbol(card.suit)}</span>
          </div>
          <div style={{ display: "grid", placeItems: "center", fontSize: 42, color, fontWeight: 900 }}>
            {suitSymbol(card.suit)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color, transform: "rotate(180deg)" }}>
            <span>{rankLabel(card.rank)}</span>
            <span>{suitSymbol(card.suit)}</span>
          </div>
        </div>
      ) : (
        <div style={{ width: "100%", height: "100%", padding: 10, display: "grid", placeItems: "center" }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 40%, rgba(255,255,255,0.10) 100%)",
              display: "grid",
              placeItems: "center",
              color: "rgba(255,255,255,0.85)",
              fontWeight: 900,
              letterSpacing: 1,
              fontSize: 12,
            }}
          >
            KARGO
          </div>
        </div>
      )}

      {!!badge && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgba(17,24,39,0.10)",
            border: "1px solid rgba(17,24,39,0.15)",
            fontSize: 11,
            fontWeight: 900,
            color: showFront ? "#111827" : "rgba(255,255,255,0.9)",
          }}
        >
          {badge}
        </div>
      )}
    </div>
  );
}

function Stack({ top2, count, showBackWhenEmpty = false }) {
  const top = top2?.[0] || null;
  const second = top2?.[1] || null;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Used (last 2) • {count ?? 0}
      </div>

      <div style={{ position: "relative", width: 92, height: 130 }}>
        {/* bottom card */}
        <div style={{ position: "absolute", top: 6, left: 6 }}>
          <PlayingCard slot={second ? { faceUp: true, card: second } : showBackWhenEmpty ? { faceUp: false, card: null } : null} forceBack={!second} disabled />
        </div>

        {/* top card */}
        <div style={{ position: "absolute", top: 0, left: 0 }}>
          <PlayingCard
            slot={top ? { faceUp: true, card: top } : showBackWhenEmpty ? { faceUp: false, card: null } : null}
            forceBack={!top}
            disabled
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [toast, setToast] = useState("");

  const [name, setName] = useState("");
  const [room, setRoom] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const [drawn, setDrawn] = useState(null);

  const [peekModal, setPeekModal] = useState(null);
  const toastTimer = useRef(null);

  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  }

  useEffect(() => {
    const s = io(SERVER_URL || window.location.origin, { transports: ["websocket"] });
    setSocket(s);

    function onConnect() {
      setConnected(true);
      setErrMsg("");
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onErr(msg) {
      setErrMsg(String(msg || "Error"));
      showToast(String(msg || "Error"));
    }
    function onUpdate(r) {
      setRoom(r);
    }
    function onDrawn(card) {
      setDrawn(card);
    }
    function onPower(payload) {
      if (!payload) return;
      if (payload.type === "peekSelf") {
        setPeekModal({ title: "Peek your card", card: payload.card });
        return;
      }
      if (payload.type === "peekOther") {
        setPeekModal({ title: `Peek ${payload.playerName}'s card`, card: payload.card });
        return;
      }
      if (payload.type === "qPreview") {
        setPeekModal({
          title: `Q preview: ${payload.otherPlayerName}`,
          card: payload.card,
          q: {
            otherPlayerId: payload.otherPlayerId,
            otherSlotIndex: payload.otherSlotIndex,
          },
        });
        return;
      }
    }
    function onSwap(payload) {
      // keep it compact — never reveal card faces
      if (payload?.type === "J") {
        showToast(`${payload.aName} swapped with ${payload.bName}`);
      } else if (payload?.type === "Q") {
        showToast(`${payload.aName} swapped with ${payload.bName}`);
      }
    }

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("error:msg", onErr);
    s.on("room:update", onUpdate);
    s.on("turn:drawn", onDrawn);
    s.on("power:result", onPower);
    s.on("swap:notice", onSwap);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("error:msg", onErr);
      s.off("room:update", onUpdate);
      s.off("turn:drawn", onDrawn);
      s.off("power:result", onPower);
      s.off("swap:notice", onSwap);
      s.disconnect();
    };
  }, []);

  const myId = socket?.id || null;
  const players = room?.players || [];
  const me = players.find((p) => p.id === myId) || null;

  const isHost = room?.hostId === myId;

  const turnName = useMemo(() => {
    const p = players.find((x) => x.id === room?.turnPlayerId);
    return p?.name || "—";
  }, [room?.turnPlayerId, players]);

  const turnStage = room?.turnStage || "—";
  const powerMode = room?.powerState?.mode ?? "none";

  const usedTop2 = room?.usedTop2 || [];
  const usedCount = room?.usedCount || 0;

  const claimRank = room?.claim?.rank || null;

  const lastRound = room?.lastRound || null;

  const amIAllowedToAct = room?.phase === "playing" && room?.turnPlayerId === myId;

  function safeName(n) {
    return String(n || "").trim().slice(0, 18);
  }

  function createRoom() {
    if (!socket) return;
    const n = safeName(name);
    if (!n) return showToast("Add your name first.");
    socket.emit("room:create", { name: n });
  }

  function joinRoom() {
    if (!socket) return;
    const n = safeName(name);
    if (!n) return showToast("Add your name first.");
    const c = String(joinCode || "").toUpperCase().trim();
    if (!c) return showToast("Enter a room code.");
    socket.emit("room:join", { code: c, name: n });
  }

  function leaveRoom() {
    if (!socket) return;
    socket.emit("room:leave", { code: room?.code });
    setRoom(null);
    setDrawn(null);
    setPeekModal(null);
  }

  function onTapMySlot(slotIndex) {
    if (!room || !me) return;
    if (room.phase !== "playing") return;

    if (claimRank) {
      socket.emit("used:claim", { code: room.code, slotIndex });
      return;
    }

    if (powerMode === "selfPeekPick") {
      socket.emit("power:tapSelfCard", { code: room.code, slotIndex });
      return;
    }

    if (powerMode === "otherPeekPick") {
      // selecting your own card does nothing in otherPeek mode
      return;
    }

    if (powerMode === "jPickMyCard") {
      socket.emit("power:tapMyCardForJSwap", { code: room.code, slotIndex });
      return;
    }

    if (powerMode === "qPickMyCard") {
      socket.emit("power:tapMyCardForQSwap", { code: room.code, slotIndex });
      return;
    }

    if (!amIAllowedToAct) return;

    // Core action: resolve draw by tapping a slot
    if (turnStage === "hasDrawn" && drawn) {
      socket.emit("turn:resolveDrawTap", { code: room.code, slotIndex });
      return;
    }

    showToast("Draw a card first.");
  }

  function onTapOtherSlot(otherPlayerId, slotIndex) {
    if (!room) return;
    if (room.phase !== "playing") return;

    if (powerMode === "otherPeekPick") {
      socket.emit("power:tapOtherCard", { code: room.code, otherPlayerId, slotIndex });
      return;
    }

    if (powerMode === "jPickOtherCard") {
      socket.emit("power:tapOtherForJSwap", { code: room.code, otherPlayerId, slotIndex });
      return;
    }

    if (powerMode === "qPickOtherCard") {
      socket.emit("power:tapOtherForQSwap", { code: room.code, otherPlayerId, slotIndex });
      return;
    }
  }

  if (!room) {
    return (
      <ErrorBoundary>
        <div style={page}>
          <div style={header}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 26, fontWeight: 950 }}>Kargo</div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Browser-only multiplayer</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Socket: <b>{connected ? "connected" : "disconnected"}</b>
            </div>
          </div>

          <div style={cardWrap}>
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Your name</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Add Your Name here…"
                  style={input}
                />
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button style={btn} onClick={createRoom}>
                  Create room
                </button>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="ROOM CODE" style={inputSm} />
                  <button style={btn} onClick={joinRoom}>
                    Join
                  </button>
                </div>
              </div>

              {errMsg && <div style={errorBox}>{errMsg}</div>}
            </div>
          </div>

          {toast && (
            <div style={toastWrap}>
              <div style={toastCard}>{toast}</div>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div style={page}>
        <div style={header}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 26, fontWeight: 950 }}>Kargo</div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              Always hidden • 7/8 peek only • 9/10 peek other • J unseen swap • Q seen swap
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Socket: <b>{connected ? "connected" : "disconnected"}</b>
            </div>
            <button style={btnGhost} onClick={leaveRoom}>
              Leave room
            </button>
          </div>
        </div>

        {/* KARGO banner (persistent) */}
        {room.kargo?.calledById && (
          <div
            style={{
              ...cardWrap,
              border: "1px solid rgba(245,158,11,0.35)",
              background: "#fffbeb",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 950 }}>Kargo was called by {room.kargo.calledByName || "a player"}.</div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>Finish the last round.</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Call stays active until the next draw.</div>
          </div>
        )}

        <div style={cardWrap}>
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

              {/* PLAYERS list (Lobby names restored) */}
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>Players</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {players.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid #e5e7eb",
                        background: p.id === myId ? "#ecfeff" : "#f8fafc",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {p.name}
                      {p.id === room.hostId ? " (Host)" : ""}
                      {p.id === room.turnPlayerId && room.phase === "playing" ? " • Turn" : ""}
                    </div>
                  ))}
                </div>
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
                  See <b>slot 0 & 1</b> now. After Ready, they hide.
                </div>

                {/* READY: show 2×2 matrix (bottom row = slot 0/1 shown once) */}
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Your 2×2 cards (slot <b>0</b> & <b>1</b> are shown once). Top row is hidden.
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 10 }}>
                    {[2, 3, 0, 1].map((idx) => {
                      const s = me?.slots?.[idx] || null;
                      const isBottomSeen = idx === 0 || idx === 1;
                      const slot = s ? { ...s, faceUp: isBottomSeen } : null;
                      return <PlayingCard key={idx} slot={slot} forceBack={!isBottomSeen} />;
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* TABLE FIRST */}
        {room.phase === "playing" && (
          <>
            <div style={cardWrap}>
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Deck</div>
                  <PlayingCard forceBack={true} disabled={true} />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Drawn</div>
                  <PlayingCard slot={drawn ? { faceUp: true, card: drawn } : { faceUp: false, card: null }} forceBack={!drawn} disabled />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      style={btn}
                      disabled={!amIAllowedToAct || turnStage !== "needDraw"}
                      onClick={() => {
                        socket.emit("turn:draw", { code: room.code });
                      }}
                    >
                      Draw
                    </button>
                    <button
                      style={btnGhost}
                      disabled={!amIAllowedToAct || turnStage !== "hasDrawn" || !drawn}
                      onClick={() => socket.emit("turn:discard", { code: room.code })}
                    >
                      Discard drawn
                    </button>
                    <button
                      style={btnGhost}
                      disabled={!amIAllowedToAct || (!drawn && turnStage !== "hasDrawn")}
                      onClick={() => socket.emit("kargo:call", { code: room.code })}
                    >
                      Call Kargo
                    </button>
                  </div>
                </div>

                <Stack top2={usedTop2} count={usedCount} showBackWhenEmpty={true} />

                <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                  <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>Activity</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {(room.activityLog || []).map((x, idx) => (
                      <div
                        key={`${x.ts}-${idx}`}
                        style={{
                          fontSize: 12,
                          padding: "6px 8px",
                          borderRadius: 12,
                          background: "#f8fafc",
                          border: "1px solid #e5e7eb",
                        }}
                      >
                        {x.msg}
                      </div>
                    ))}
                    {(!room.activityLog || room.activityLog.length === 0) && (
                      <div style={{ fontSize: 12, opacity: 0.7 }}>No moves yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div style={cardWrap}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div style={{ fontWeight: 950, fontSize: 16 }}>Your cards</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Tap a slot to resolve your draw • Claim window rank: <b>{claimRank || "—"}</b>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 10 }}>
                {/* 2×2 matrix order: top row slots 2/3, bottom row slots 0/1 */}
                {[2, 3, 0, 1, ...(me?.slots?.slice(4).map((_, i) => i + 4) || [])].map((idx) => {
                  const s = me?.slots?.[idx] || null;
                  const isEmpty = !s?.card;
                  if (isEmpty) {
                    return (
                      <div
                        key={idx}
                        style={{
                          width: 86,
                          height: 120,
                          borderRadius: 16,
                          border: "1px dashed rgba(17,24,39,0.25)",
                          background: "rgba(255,255,255,0.6)",
                          display: "grid",
                          placeItems: "center",
                          color: "rgba(17,24,39,0.55)",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                        onClick={() => onTapMySlot(idx)}
                      >
                        empty
                      </div>
                    );
                  }
                  return (
                    <PlayingCard
                      key={idx}
                      slot={s}
                      forceBack={!s.faceUp}
                      onClick={() => onTapMySlot(idx)}
                      badge={`slot ${idx}`}
                    />
                  );
                })}
              </div>
            </div>

            <div style={cardWrap}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Other players</div>
              <div style={{ marginTop: 10, display: "grid", gap: 14 }}>
                {players
                  .filter((p) => p.id !== myId)
                  .map((p) => (
                    <div key={p.id} style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#f8fafc" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 950 }}>{p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>{p.id === room.turnPlayerId ? "Playing now" : ""}</div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {/* IMPORTANT: for other players, show ONLY slots that actually have a card */}
                        {p.slots
                          .map((s, idx) => ({ s, idx }))
                          .filter(({ s }) => !!s?.card)
                          .map(({ s, idx }) => (
                            <PlayingCard
                              key={idx}
                              slot={{ ...s, faceUp: false }}
                              forceBack={true}
                              onClick={() => onTapOtherSlot(p.id, idx)}
                              badge={`slot ${idx}`}
                            />
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}

        {/* scoreboards / end of round */}
        {room.phase === "lobby" && lastRound && (
          <div style={cardWrap}>
            <div style={{ fontWeight: 950, fontSize: 16 }}>Last round</div>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {lastRound.players?.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 14,
                      padding: 12,
                      background: "white",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                      <div style={{ fontWeight: 950 }}>{p.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Total: {p.total}</div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {(p.cards || []).map((card, idx) => (
                        <PlayingCard key={idx} slot={{ faceUp: true, card }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>Round deltas</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(room.roundBoard?.deltas || []).map((d, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "white",
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      {d.name}: {d.delta > 0 ? `+${d.delta}` : d.delta}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.7, fontWeight: 900 }}>Overall scoreboard</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(room.scoreboard || []).map((s, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "white",
                        fontSize: 12,
                        fontWeight: 900,
                      }}
                    >
                      {s.name}: {s.score}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Peek modal */}
        {peekModal?.card?.rank && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15,23,42,0.35)",
              display: "grid",
              placeItems: "center",
              padding: 18,
              zIndex: 70,
            }}
            onClick={() => setPeekModal(null)}
          >
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
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <div style={{ fontWeight: 900 }}>{peekModal.title}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Temporary reveal.</div>
              </div>
              <div style={{ display: "grid", placeItems: "center" }}>
                <PlayingCard slot={{ faceUp: true, card: peekModal.card }} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                {peekModal.q ? (
                  <>
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
                  </>
                ) : (
                  <button style={btnGhost} onClick={() => setPeekModal(null)}>
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div style={toastWrap}>
            <div style={toastCard}>{toast}</div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

/* styles (baseline UI — unchanged) */
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

const header = { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 };

const cardWrap = { border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, background: "white" };

const input = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

const inputSm = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  width: 140,
  outline: "none",
  textTransform: "uppercase",
  letterSpacing: 1,
};

const btn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(17,24,39,0.2)",
  background: "#111827",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const btnGhost = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "white",
  cursor: "pointer",
  fontWeight: 800,
};

const errorBox = { padding: 10, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#9f1239", fontSize: 13 };

const toastWrap = { position: "fixed", top: 16, left: 0, right: 0, display: "grid", placeItems: "center", zIndex: 80, pointerEvents: "none" };

const toastCard = {
  padding: "10px 14px",
  borderRadius: 16,
  border: "1px solid rgba(17,24,39,0.15)",
  background: "rgba(255,255,255,0.95)",
  fontWeight: 900,
  boxShadow: "0 14px 30px rgba(15,23,42,0.18)",
};
