import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (location.hostname === "localhost" ? "http://localhost:10000" : "https://kargo-vyo1.onrender.com");

const socket = io(SERVER_URL, { transports: ["websocket"] });

function suitGlyph(s) {
  if (s === "S") return "♠";
  if (s === "H") return "♥";
  if (s === "D") return "♦";
  if (s === "C") return "♣";
  return "";
}
function isRedSuit(s) {
  return s === "H" || s === "D";
}

function CardFace({ card, faceDown = false, small = false }) {
  const cls = small ? "pcard pcardSmall" : "pcard";
  if (faceDown) {
    return (
      <div className={`${cls} pcardBack`}>
        <div style={{ width: 36, height: 56, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)" }} />
      </div>
    );
  }
  if (!card) {
    return (
      <div className={`${cls} pcardBack`} style={{ borderStyle: "dashed", opacity: 0.75 }}>
        <div className="smallNote">EMPTY</div>
      </div>
    );
  }
  const red = isRedSuit(card.suit);
  return (
    <div className={cls}>
      <div className={`corner ${red ? "red" : "black"}`}>
        <div>{card.rank}</div>
        <div className="suit">{suitGlyph(card.suit)}</div>
      </div>
      <div className={`bigSuit ${red ? "red" : "black"}`}>{suitGlyph(card.suit)}</div>
    </div>
  );
}

function UsedStack({ top2 }) {
  const a = top2?.[0] ?? null;
  const b = top2?.[1] ?? null;
  return (
    <div className="stackWrap">
      <div className="stackA">
        <CardFace card={a} faceDown={!a} small />
      </div>
      <div className="stackB">
        <CardFace card={b} faceDown={!b} small />
      </div>
    </div>
  );
}

export default function App() {
  const [room, setRoom] = useState(null);
  const [view, setView] = useState("home"); // home | room
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [drawn, setDrawn] = useState(null);
  const [toast, setToast] = useState("");
  const [pairPick, setPairPick] = useState([]);
  const [turnPopup, setTurnPopup] = useState(false);

  const toastTimer = useRef(null);
  const prevTurnRef = useRef(null);

  function showToast(m) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }

  useEffect(() => {
    socket.on("room:update", (state) => setRoom(state));
    socket.on("turn:drawn", (card) => setDrawn(card));
    socket.on("error:msg", (m) => showToast(m));
    return () => {
      socket.off("room:update");
      socket.off("turn:drawn");
      socket.off("error:msg");
    };
  }, []);

  const isMyTurn = useMemo(() => room?.phase === "playing" && room.turnPlayerId === socket.id, [room]);
  const myPlayer = useMemo(() => room?.players?.find((p) => p.id === socket.id) || null, [room]);
  const mySlots = myPlayer?.slots || [];
  const stage = room?.turnStage || "needDraw";
  const claim = room?.claim;
  const canClaim = useMemo(() => room?.phase === "playing" && !!claim && claim.state === "open", [room, claim]);

  useEffect(() => {
    if (!room) return;
    const cur = room.turnPlayerId;
    if (room.phase === "playing" && cur === socket.id && prevTurnRef.current !== cur) {
      setTurnPopup(true);
      setTimeout(() => setTurnPopup(false), 1100);
    }
    prevTurnRef.current = cur;
  }, [room]);

  function createRoom() {
    if (!name.trim()) return showToast("Enter your name");
    socket.emit("room:create", { name: name.trim() });
    setView("room");
  }
  function joinRoom() {
    if (!name.trim()) return showToast("Enter your name");
    if (!code.trim()) return showToast("Enter room code");
    socket.emit("room:join", { code: code.trim().toUpperCase(), name: name.trim() });
    setView("room");
  }

  function startGame() {
    socket.emit("game:start", { code: room.code });
    setDrawn(null);
    setPairPick([]);
  }
  function readyUp() {
    socket.emit("game:ready", { code: room.code });
  }

  function drawCard() {
    setDrawn(null);
    setPairPick([]);
    socket.emit("turn:draw", { code: room.code });
  }

  function discardDrawn() {
    socket.emit("turn:discardDrawn", { code: room.code });
    setDrawn(null);
    setPairPick([]);
  }

  function resolveTap(idx) {
    socket.emit("turn:resolveTap", { code: room.code, slotIndex: idx });
    setDrawn(null);
    setPairPick([]);
  }

  function endTurn() {
    socket.emit("turn:end", { code: room.code });
    setDrawn(null);
    setPairPick([]);
  }

  function tapSlot(idx) {
    if (isMyTurn && stage === "hasDrawn") {
      if (pairPick.length === 0) return setPairPick([idx]);
      if (pairPick.length === 1) {
        if (pairPick[0] === idx) return;
        return setPairPick([pairPick[0], idx]);
      }
    }
  }

  function throwPair() {
    if (pairPick.length !== 2) return showToast("Select 2 slots for pair");
    socket.emit("turn:discardPair", { code: room.code, a: pairPick[0], b: pairPick[1] });
    setPairPick([]);
    setDrawn(null);
  }

  function claimWith(idx) {
    socket.emit("used:claim", { code: room.code, slotIndex: idx });
  }

  if (view === "home") {
    return (
      <div className="page">
        <div className="header">
          <div className="headerInner">
            <div>
              <div className="brand">KARGO</div>
              <div className="subtle" style={{ fontSize: 12 }}>
                Always hidden • Ready shows bottom 2 once • Claim ends when next player draws
              </div>
            </div>
            <div className="pill">
              <span className="subtle" style={{ fontSize: 12 }}>Server</span>
              <span className="mono" style={{ fontSize: 11, opacity: 0.85 }}>{SERVER_URL}</span>
            </div>
          </div>
        </div>

        <div className="container" style={{ maxWidth: 520 }}>
          <div className="card">
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Your name</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add Your Name here…" />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btnPrimary" style={{ flex: 1 }} onClick={createRoom}>Create Room</button>
            </div>

            <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Join a room</div>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCDE" />
              <button className="btn btnBlue" style={{ width: "100%", marginTop: 10 }} onClick={joinRoom}>
                Join Room
              </button>
            </div>
          </div>
        </div>

        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  if (!room) {
    return (
      <div className="page" style={{ display: "grid", placeItems: "center" }}>
        <div className="subtle">Connecting…</div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const turnName = room.players.find((p) => p.id === room.turnPlayerId)?.name || "—";
  const canStart = room.phase === "lobby" && room.hostId === socket.id;
  const canReady = room.phase === "ready" && room.readyState && !room.readyState.mine;

  return (
    <div className="page">
      <div className="header">
        <div className="headerInner">
          <div>
            <div className="subtle" style={{ fontSize: 12 }}>Room</div>
            <div className="brand mono">{room.code}</div>
          </div>

          <div className="pill">
            <span className="subtle" style={{ fontSize: 12 }}>Phase</span>
            <span className="badge badgeOn">{room.phase}</span>
          </div>
        </div>
      </div>

      {/* Activity */}
      <div className="activity">
        <div className="activityInner">
          <div className="activityTitle">Activity (last 12)</div>
          {(room.activityLog || []).map((x, i) => (
            <div className="activityItem" key={i}>{x.msg}</div>
          ))}
          {(room.activityLog || []).length === 0 && <div className="smallNote">No activity yet</div>}
        </div>
      </div>

      {turnPopup && (
        <div className="turnPopup">
          <div className="turnBadge">Your turn</div>
        </div>
      )}

      <div className="container">
        {/* Top row: deck + used */}
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <div>
                <div className="smallNote">Deck</div>
                <CardFace faceDown small />
              </div>
              <div>
                <div className="smallNote">Used (last 2)</div>
                <UsedStack top2={room.usedTop2} />
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div className="smallNote">Turn</div>
              <div style={{ fontWeight: 900 }}>{turnName}{isMyTurn ? " (You)" : ""}</div>
              <div className="smallNote">
                Claim: {claim ? <b>{claim.rank} {claim.state === "open" ? "(open)" : "(won)"}</b> : "none"}
              </div>
            </div>
          </div>
        </div>

        {/* Scoreboards */}
        <div className="grid2" style={{ marginTop: 12 }}>
          <div className="card">
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Total Scoreboard</div>
            {(room.scoreboard || []).map((x) => (
              <div key={x.name} className="row" style={{ justifyContent: "space-between" }}>
                <div className="subtle">{x.name}</div>
                <div style={{ fontWeight: 900 }}>{x.score}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Rounds Played</div>
            {(room.stats || []).map((x) => (
              <div key={x.name} className="row" style={{ justifyContent: "space-between" }}>
                <div className="subtle">{x.name}</div>
                <div className="subtle">{x.roundsWon}/{x.roundsPlayed}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Last round */}
        {room.lastRound && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="smallNote">Last round winner</div>
                <div style={{ fontWeight: 1000, color: "rgba(167,243,208,.95)" }}>{room.lastRound.winnerName}</div>
              </div>
              <div className="smallNote">Reason: {room.lastRound.reason}</div>
            </div>
          </div>
        )}

        {/* Players */}
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900 }}>Players</div>
            <div className="smallNote">{room.phase === "lobby" ? "Lobby" : room.phase === "ready" ? "Ready check" : "Playing"}</div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            {room.players.map((p) => (
              <div key={p.id} className="pill">
                <span style={{ fontWeight: 900 }}>
                  {p.name}{p.id === socket.id ? " (You)" : ""}
                </span>
                <span className="badge">{p.id === room.hostId ? "HOST" : "PLAYER"}</span>
                <span className="smallNote">Slots: {p.totalSlots} • Cards: {p.nonEmptyCount}</span>
              </div>
            ))}
          </div>

          {room.phase === "lobby" && (
            <div style={{ marginTop: 10 }}>
              {canStart ? (
                <button className="btn btnPrimary" onClick={startGame}>Start Game</button>
              ) : (
                <div className="smallNote">Waiting for host to start…</div>
              )}
            </div>
          )}

          {room.phase === "ready" && (
            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <div className="smallNote">
                You can see your bottom 2 cards only now. Press Ready to hide them again.
              </div>
              <button className="btn btnBlue" disabled={!canReady} onClick={readyUp}>
                Ready
              </button>
            </div>
          )}
        </div>

        {/* Your cards */}
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900 }}>Your cards</div>
            <div className="smallNote">
              {room.phase === "playing" ? (isMyTurn ? "Your turn" : "Not your turn") : `Phase: ${room.phase}`} • Stage: {stage}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: 12, marginTop: 12 }}>
            {mySlots.map((s, idx) => {
              const selected = pairPick.includes(idx);
              return (
                <div key={idx} className="slotCard" style={selected ? { outline: "2px solid rgba(252,211,77,.55)" } : null}>
                  <div className="slotTop">
                    <div>Slot {idx}</div>
                    <div>{s.state}</div>
                  </div>

                  <CardFace card={s.faceUp ? s.card : null} faceDown={s.state === "card" && !s.faceUp} />

                  <div className="slotHint">
                    {room.phase === "playing" && canClaim
                      ? "Claim open: tap slot to try"
                      : room.phase === "playing" && isMyTurn && stage === "hasDrawn"
                      ? "Tap to select for pair"
                      : ""}
                  </div>

                  <div className="slotActions">
                    {room.phase === "playing" && canClaim && (
                      <button className="btn" onClick={() => claimWith(idx)}>Claim</button>
                    )}

                    {room.phase === "playing" && isMyTurn && stage === "hasDrawn" && (
                      <>
                        <button className="btn" onClick={() => tapSlot(idx)}>Select</button>
                        <button className="btn btnPrimary" onClick={() => resolveTap(idx)}>
                          Use slot
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {room.phase === "playing" && canClaim && (
            <div className="smallNote" style={{ marginTop: 10 }}>
              Claim rank is <b>{claim.rank}</b>. Wrong click = +1 penalty card. Window ends when the next player draws.
            </div>
          )}
        </div>
      </div>

      {room.phase === "playing" && (
        <div className="actionBar">
          <div className="actionInner">
            <div className="actionLabel">
              Turn: <b>{turnName}</b> {isMyTurn ? " • You" : ""}
              {drawn ? <span className="subtle"> • Drawn: {drawn.rank}{suitGlyph(drawn.suit)}</span> : null}
            </div>

            <button className="btn btnBlue" disabled={!isMyTurn || stage !== "needDraw"} onClick={drawCard}>
              Draw
            </button>
            <button className="btn btnPrimary" disabled={!isMyTurn || stage !== "hasDrawn"} onClick={discardDrawn}>
              Discard Drawn
            </button>
            <button className="btn btnAmber" disabled={!isMyTurn || stage !== "hasDrawn" || pairPick.length !== 2} onClick={throwPair}>
              Throw Pair
            </button>
            <button className="btn btnGreen" disabled={!isMyTurn || stage !== "awaitEnd"} onClick={endTurn}>
              End Turn
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
