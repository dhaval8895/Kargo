import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

function Card({ slot, onClick, disabled }) {
  const style = {
    width: 72, height: 96, borderRadius: 12,
    border: "1px solid #111827",
    display: "grid", placeItems: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: slot?.faceUp ? "white" : "#111827",
    color: slot?.faceUp ? "#111827" : "white",
    userSelect: "none"
  };

  let text = "—";
  if (slot) {
    if (slot.faceUp && slot.card) text = `${slot.card.rank}${slot.card.suit}`;
    else text = "🂠";
  }
  return <div style={style} onClick={disabled ? undefined : onClick}>{text}</div>;
}

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

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onErr = (m) => setError(String(m || "Unknown error"));
    const onUpdate = (r) => { setRoom(r); setError(""); };
    const onDrawn = (c) => { setDrawn(c); setError(""); };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("error:msg", onErr);
    socket.on("room:update", onUpdate);
    socket.on("turn:drawn", onDrawn);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("error:msg", onErr);
      socket.off("room:update", onUpdate);
      socket.off("turn:drawn", onDrawn);
      socket.disconnect();
    };
  }, [socket]);

  const myId = socket?.id;
  const me = room?.players?.find(p => p.id === myId);
  const isHost = room?.hostId === myId;
  const isMyTurn = room?.turnPlayerId === myId;
  const canStart = !!room && isHost && room.phase === "lobby" && (room.players?.length ?? 0) >= 2;

  // “peek once” UX: after first render of playing phase, auto-hide seen cards after you click "Done"
  useEffect(() => {
    if (!room) return;
    if (room.phase !== "playing") {
      setPeekDone(false);
      return;
    }
  }, [room?.phase]);

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
            Leave
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

            <button style={btn} disabled={!name.trim() || !code.trim() || !connected} onClick={() => socket.emit("room:join", { code: code.trim(), name: name.trim() })}>
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
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>{room.code}</div>
                <div style={{ opacity: 0.75, fontSize: 13, marginTop: 6 }}>
                  Phase: <b>{room.phase}</b> • Turn: <b>{room.players.find(p => p.id === room.turnPlayerId)?.name}</b>
                </div>
              </div>

              <div style={{ minWidth: 240 }}>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Scoreboard</div>
                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                  {room.scoreboard.slice().sort((a,b) => a.score - b.score).map(s => (
                    <div key={s.name} style={scoreRow}>
                      <span>{s.name}</span><b>{s.score}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {room.phase === "lobby" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button style={btn} disabled={!canStart} onClick={() => socket.emit("game:start", { code: room.code })}>
                  Start game
                </button>
                {!canStart && <div style={{ opacity: 0.75, fontSize: 13, alignSelf: "center" }}>
                  {isHost ? "Need at least 2 players." : "Waiting for host to start."}
                </div>}
              </div>
            )}

            {error && <div style={errorBox}>{error}</div>}
          </div>

          {room.phase === "playing" && (
            <>
              <div style={cardWrap}>
                <h3 style={{ marginTop: 0 }}>Center</h3>

                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Thrown card</div>
                    <div style={centerCard}>
                      {room.thrownCard ? `${room.thrownCard.rank}${room.thrownCard.suit}` : "—"}
                    </div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
                      Claim by clicking a matching rank card in your hand.
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Your turn actions</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        style={btn}
                        disabled={!isMyTurn || !!drawn}
                        onClick={() => socket.emit("turn:draw", { code: room.code })}
                      >
                        Draw
                      </button>

                      <button
                        style={btnGhost}
                        disabled={!isMyTurn || !drawn}
                        onClick={() => { socket.emit("turn:throwDrawn", { code: room.code }); setDrawn(null); }}
                      >
                        Throw face-up
                      </button>
                    </div>

                    {drawn && (
                      <div style={{ marginTop: 10, padding: 10, border: "1px solid #e5e7eb", borderRadius: 12 }}>
                        <div><b>Drawn:</b> {drawn.rank}{drawn.suit}</div>
                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {[0,1,2,3].map(i => (
                            <button
                              key={i}
                              style={btn}
                              onClick={() => { socket.emit("turn:keepSwap", { code: room.code, slotIndex: i }); setDrawn(null); }}
                            >
                              Keep → slot {i}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {!peekDone && (
                    <div style={{ padding: 12, border: "1px dashed #9ca3af", borderRadius: 12 }}>
                      <div style={{ fontWeight: 800 }}>Peek once</div>
                      <div style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>
                        Your bottom 2 are visible now. Click done to hide them.
                      </div>
                      <button style={{ ...btn, marginTop: 10 }} onClick={() => setPeekDone(true)}>Done</button>
                    </div>
                  )}
                </div>
              </div>

              <div style={cardWrap}>
                <h3 style={{ marginTop: 0 }}>Your hand (click to claim thrown card)</h3>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(me?.slots || []).map((slot, i) => {
                    // if peekDone, hide originally-faceUp slots too (we only know faceUp from server; so we just hide by UI)
                    const displaySlot = !slot ? null : (peekDone ? { ...slot, faceUp: false } : slot);

                    return (
                      <div key={i} style={{ textAlign: "center" }}>
                        <Card
                          slot={displaySlot}
                          disabled={!room.thrownCard}
                          onClick={() => socket.emit("thrown:claim", { code: room.code, slotIndex: i })}
                        />
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>slot {i}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 12, opacity: 0.75, fontSize: 13 }}>
                  Penalties add cards to the end of your hand (unseen).
                </div>
              </div>
            </>
          )}

          <div style={cardWrap}>
            <h3 style={{ marginTop: 0 }}>Players</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {room.players.map(p => (
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
        </>
      )}
    </div>
  );
}

/* styles */
function dot(color) {
  return { width: 10, height: 10, borderRadius: 999, background: color, display: "inline-block" };
}
const page = { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto", maxWidth: 1100, margin: "0 auto", padding: 18, display: "grid", gap: 12 };
const header = { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 };
const cardWrap = { border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, background: "white" };
const row = { display: "grid", gap: 6 };
const label = { fontSize: 13, opacity: 0.75 };
const input = { padding: "10px 12px", borderRadius: 12, border: "1px solid #d1d5db", width: 260, outline: "none" };
const btn = { padding: "10px 12px", borderRadius: 12, border: "1px solid #111827", background: "#111827", color: "white", cursor: "pointer", fontWeight: 700 };
const btnGhost = { padding: "10px 12px", borderRadius: 12, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontWeight: 700 };
const errorBox = { marginTop: 12, padding: 10, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#9f1239", fontSize: 13 };
const playerRow = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 12, border: "1px solid #e5e7eb" };
const scoreRow = { display: "flex", justifyContent: "space-between", padding: "8px 10px", borderRadius: 12, border: "1px solid #e5e7eb" };
const pill = { fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#eef2ff", border: "1px solid #c7d2fe", color: "#3730a3", fontWeight: 800 };
const pill2 = { fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "#ecfeff", border: "1px solid #a5f3fc", color: "#155e75", fontWeight: 800 };
const centerCard = { width: 120, height: 80, borderRadius: 14, border: "1px solid #111827", display: "grid", placeItems: "center", fontSize: 24, fontWeight: 900 };
