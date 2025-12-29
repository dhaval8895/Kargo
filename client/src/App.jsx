// client/src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (location.hostname === "localhost" ? "http://localhost:10000" : "https://kargo-vyo1.onrender.com");

const socket = io(SERVER_URL, { transports: ["websocket"] });

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

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
  const base = small ? "w-16 h-24" : "w-20 h-28";
  if (faceDown) {
    return (
      <div
        className={cx(
          base,
          "rounded-xl border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 shadow-md",
          "flex items-center justify-center"
        )}
      >
        <div className="w-10 h-14 rounded-lg bg-white/10 border border-white/10" />
      </div>
    );
  }
  if (!card) {
    return (
      <div
        className={cx(
          base,
          "rounded-xl border border-dashed border-white/20 bg-white/5 flex items-center justify-center"
        )}
      >
        <span className="text-white/25 text-xs">EMPTY</span>
      </div>
    );
  }
  const red = isRedSuit(card.suit);
  return (
    <div
      className={cx(
        base,
        "rounded-xl border border-white/10 bg-white shadow-md",
        "relative overflow-hidden"
      )}
    >
      <div className={cx("absolute inset-0 opacity-10", red ? "bg-red-400" : "bg-slate-900")} />
      <div className="absolute top-2 left-2 flex flex-col leading-none">
        <span className={cx("font-bold", red ? "text-red-600" : "text-slate-900")}>{card.rank}</span>
        <span className={cx("text-lg", red ? "text-red-600" : "text-slate-900")}>{suitGlyph(card.suit)}</span>
      </div>
      <div className="absolute bottom-2 right-2 text-3xl">
        <span className={cx(red ? "text-red-600" : "text-slate-900")}>{suitGlyph(card.suit)}</span>
      </div>
    </div>
  );
}

function StackedUsed({ top2 }) {
  // show last two used cards stacked (slight offset), face up
  const a = top2?.[0] ?? null;
  const b = top2?.[1] ?? null;

  return (
    <div className="relative w-24 h-32">
      <div className="absolute left-1 top-1 rotate-[-2deg]">
        <CardFace card={a} faceDown={!a} small />
      </div>
      <div className="absolute left-3 top-3 rotate-[1deg]">
        <CardFace card={b} faceDown={!b} small />
      </div>
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-black/70 border border-white/10 text-white text-sm shadow-lg z-50">
      {msg}
    </div>
  );
}

export default function App() {
  const [room, setRoom] = useState(null);
  const [me, setMe] = useState({ name: "", code: "" });
  const [view, setView] = useState("home"); // home | room
  const [drawn, setDrawn] = useState(null);
  const [toast, setToast] = useState("");
  const [pairPick, setPairPick] = useState([]); // two indices

  const toastTimer = useRef(null);
  const myId = socket.id;

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

  const isMyTurn = useMemo(() => {
    if (!room) return false;
    return room.phase === "playing" && room.turnPlayerId === socket.id;
  }, [room]);

  const myPlayer = useMemo(() => {
    if (!room) return null;
    return room.players.find((p) => p.id === socket.id) || null;
  }, [room]);

  const stage = room?.turnStage || "needDraw";
  const claim = room?.claim;

  const mySlots = myPlayer?.slots || [];

  const canClaim = useMemo(() => {
    if (!room || room.phase !== "playing") return false;
    return !!claim && claim.state === "open";
  }, [room, claim]);

  const canStart = room && room.phase === "lobby" && room.hostId === socket.id;
  const canReady = room && room.phase === "ready" && room.readyState && !room.readyState.mine;

  // "Your turn" popup
  const [turnPopup, setTurnPopup] = useState(false);
  const prevTurnRef = useRef(null);
  useEffect(() => {
    if (!room) return;
    const cur = room.turnPlayerId;
    if (room.phase === "playing" && cur === socket.id && prevTurnRef.current !== cur) {
      setTurnPopup(true);
      setTimeout(() => setTurnPopup(false), 1200);
    }
    prevTurnRef.current = cur;
  }, [room]);

  function createRoom() {
    if (!me.name.trim()) return showToast("Enter your name");
    socket.emit("room:create", { name: me.name.trim() });
    setView("room");
  }
  function joinRoom() {
    if (!me.name.trim()) return showToast("Enter your name");
    if (!me.code.trim()) return showToast("Enter room code");
    socket.emit("room:join", { code: me.code.trim().toUpperCase(), name: me.name.trim() });
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

  function endTurn() {
    socket.emit("turn:end", { code: room.code });
    setDrawn(null);
    setPairPick([]);
  }

  function tapMySlot(idx) {
    // Pair selection mode (only on my turn and after drawn)
    if (isMyTurn && stage === "hasDrawn") {
      if (pairPick.length === 0) {
        setPairPick([idx]);
        return;
      }
      if (pairPick.length === 1) {
        if (pairPick[0] === idx) return;
        setPairPick([pairPick[0], idx]);
        return;
      }
    }
  }

  function resolveTap(idx) {
    socket.emit("turn:resolveTap", { code: room.code, slotIndex: idx });
    setDrawn(null);
    setPairPick([]);
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
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-md mx-auto px-4 py-10">
          <h1 className="text-3xl font-extrabold tracking-tight">KARGO</h1>
          <p className="text-white/60 mt-2 text-sm">
            Always hidden • Ready shows bottom 2 once • Claim window ends when next player draws
          </p>

          <div className="mt-8 space-y-4">
            <label className="block text-sm text-white/70">Your name</label>
            <input
              value={me.name}
              onChange={(e) => setMe((s) => ({ ...s, name: e.target.value }))}
              placeholder="Add Your Name here…"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 outline-none"
            />

            <div className="flex gap-2">
              <button
                onClick={createRoom}
                className="flex-1 px-3 py-2 rounded-lg bg-white text-slate-900 font-semibold"
              >
                Create Room
              </button>
            </div>

            <div className="mt-6 border-t border-white/10 pt-6">
              <label className="block text-sm text-white/70">Room code</label>
              <input
                value={me.code}
                onChange={(e) => setMe((s) => ({ ...s, code: e.target.value }))}
                placeholder="ABCDE"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 outline-none uppercase"
              />

              <button
                onClick={joinRoom}
                className="w-full mt-3 px-3 py-2 rounded-lg bg-sky-400 text-slate-900 font-semibold"
              >
                Join Room
              </button>
            </div>
          </div>

          <Toast msg={toast} />
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-white/70">Connecting…</div>
      </div>
    );
  }

  const turnName = room.players.find((p) => p.id === room.turnPlayerId)?.name || "—";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-3 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm text-white/70">Room</div>
            <div className="text-lg font-bold tracking-wider">{room.code}</div>
          </div>

          <div className="text-right">
            <div className="text-sm text-white/70">Server</div>
            <div className="text-xs text-white/60 break-all">{SERVER_URL}</div>
          </div>
        </div>
      </div>

      {/* Activity log top-right */}
      <div className="fixed top-16 right-3 z-40 w-[min(320px,92vw)]">
        <div className="bg-black/40 border border-white/10 rounded-xl p-2">
          <div className="text-xs font-semibold text-white/70 mb-1">Activity</div>
          <div className="space-y-1 max-h-64 overflow-auto">
            {(room.activityLog || []).map((x, i) => (
              <div key={i} className="text-xs text-white/70 leading-snug">
                {x.msg}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Turn popup */}
      {turnPopup && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
          <div className="px-4 py-3 rounded-2xl bg-white text-slate-900 font-extrabold shadow-2xl animate-pulse">
            Your turn
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-3 py-5 pb-28">
        {/* TOP AREA: Deck + Used */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-xs text-white/70">Deck</div>
                <CardFace faceDown small />
              </div>
              <div>
                <div className="text-xs text-white/70">Used (last 2)</div>
                <StackedUsed top2={room.usedTop2} />
              </div>
            </div>

            <div className="ml-auto flex flex-col items-end">
              {room.phase === "playing" ? (
                <>
                  <div className="text-xs text-white/60">Turn</div>
                  <div className="text-sm font-bold">
                    {turnName} {isMyTurn ? " (You)" : ""}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    {claim ? (
                      <span>
                        Claim: <span className="font-semibold">{claim.rank}</span>{" "}
                        {claim.state === "open" ? "(open)" : "(won)"}
                      </span>
                    ) : (
                      <span>Claim: none</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm text-white/70">Phase: {room.phase}</div>
              )}
            </div>
          </div>

          {/* Scoreboards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <div className="text-sm font-semibold mb-2">Total Scoreboard</div>
              <div className="grid grid-cols-2 gap-2">
                {(room.scoreboard || []).map((x) => (
                  <div key={x.name} className="flex items-center justify-between text-sm">
                    <span className="text-white/80">{x.name}</span>
                    <span className="font-bold">{x.score}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <div className="text-sm font-semibold mb-2">Rounds Played</div>
              <div className="grid grid-cols-2 gap-2">
                {(room.stats || []).map((x) => (
                  <div key={x.name} className="flex items-center justify-between text-sm">
                    <span className="text-white/80">{x.name}</span>
                    <span className="text-white/80">
                      {x.roundsWon}/{x.roundsPlayed}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Last round reveal */}
          {room.lastRound && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm">
                  <span className="text-white/70">Last round winner:</span>{" "}
                  <span className="font-extrabold text-emerald-300 animate-pulse">
                    {room.lastRound.winnerName}
                  </span>
                </div>
                <div className="text-xs text-white/60">Reason: {room.lastRound.reason}</div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(room.lastRound.reveal || {}).map(([name, cards]) => (
                  <div key={name} className="bg-black/20 border border-white/10 rounded-xl p-2">
                    <div className="text-xs font-semibold text-white/80 mb-2">{name}</div>
                    <div className="flex flex-wrap gap-2">
                      {cards.map((c, i) => (
                        <CardFace key={i} card={c} faceDown={!c ? false : false} small />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 text-xs text-white/70">
                <div className="font-semibold mb-1">Round deltas:</div>
                <div className="flex flex-wrap gap-3">
                  {(room.lastRound.deltas || []).map((d) => (
                    <div key={d.name} className="px-2 py-1 rounded-lg bg-white/5 border border-white/10">
                      {d.name}: <span className="font-bold">{d.delta}</span> →{" "}
                      <span className="font-bold">{d.totalAfter}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Players / Lobby */}
        <div className="mt-5 bg-white/5 border border-white/10 rounded-2xl p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold">Players</div>
            <div className="text-xs text-white/60">
              {room.phase === "lobby" ? "Lobby" : room.phase === "ready" ? "Ready check" : "Playing"}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {room.players.map((p) => (
              <div
                key={p.id}
                className={cx(
                  "px-3 py-2 rounded-xl border text-sm",
                  p.id === room.turnPlayerId && room.phase === "playing"
                    ? "bg-emerald-500/15 border-emerald-400/30"
                    : "bg-white/5 border-white/10"
                )}
              >
                <div className="font-semibold">
                  {p.name}
                  {p.id === socket.id ? <span className="text-white/60"> (You)</span> : null}
                </div>
                <div className="text-xs text-white/60">
                  Slots: {p.totalSlots} • Cards: {p.nonEmptyCount}
                </div>
              </div>
            ))}
          </div>

          {/* Host start */}
          {room.phase === "lobby" && (
            <div className="mt-3">
              {canStart ? (
                <button
                  onClick={startGame}
                  className="px-3 py-2 rounded-lg bg-white text-slate-900 font-semibold"
                >
                  Start Game
                </button>
              ) : (
                <div className="text-xs text-white/60">Waiting for host to start…</div>
              )}
            </div>
          )}

          {/* Ready */}
          {room.phase === "ready" && (
            <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-white/70">
                You can see your bottom two cards only now. Once you press Ready, they hide again.
              </div>
              <button
                onClick={readyUp}
                disabled={!canReady}
                className={cx(
                  "px-3 py-2 rounded-lg font-semibold",
                  canReady ? "bg-sky-400 text-slate-900" : "bg-white/10 text-white/50"
                )}
              >
                Ready
              </button>
            </div>
          )}
        </div>

        {/* Your Cards */}
        <div className="mt-5 bg-white/5 border border-white/10 rounded-2xl p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold">Your cards</div>
            {room.phase === "playing" ? (
              <div className="text-xs text-white/60">
                {isMyTurn ? "Your turn" : "Not your turn"} • Stage: {stage}
              </div>
            ) : (
              <div className="text-xs text-white/60">Phase: {room.phase}</div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 w-fit">
            {mySlots.map((s, idx) => {
              const isSelected = pairPick.includes(idx);
              const faceDown = !(s.faceUp && s.card);

              return (
                <button
                  key={idx}
                  onClick={() => {
                    if (room.phase === "playing" && canClaim && !isMyTurn) {
                      // claim attempt (anytime claim open; cards are hidden)
                      claimWith(idx);
                      return;
                    }
                    if (room.phase === "playing" && isMyTurn && stage === "hasDrawn") {
                      // first choose for pair, or resolve swap/match with long press button below
                      tapMySlot(idx);
                      return;
                    }
                  }}
                  className={cx(
                    "text-left rounded-2xl p-2 border",
                    isSelected ? "border-amber-300/60 bg-amber-500/10" : "border-white/10 bg-black/10"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-white/60">Slot {idx}</div>
                    <div className="text-xs text-white/40">{s.state === "empty" ? "empty" : "card"}</div>
                  </div>
                  <CardFace card={s.faceUp ? s.card : null} faceDown={s.state === "card" && !s.faceUp} />
                  <div className="mt-2 text-xs text-white/60">
                    {room.phase === "playing" && canClaim && !isMyTurn
                      ? "Tap to claim (hidden)"
                      : room.phase === "playing" && isMyTurn && stage === "hasDrawn"
                      ? pairPick.length < 2
                        ? "Tap to select for pair"
                        : "Pair selected"
                      : ""}
                  </div>

                  {room.phase === "playing" && isMyTurn && stage === "hasDrawn" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        resolveTap(idx);
                      }}
                      className="mt-2 w-full px-2 py-1 rounded-lg bg-white text-slate-900 text-xs font-semibold"
                    >
                      Use this slot (swap / match)
                    </button>
                  )}
                </button>
              );
            })}
          </div>

          {/* Claim instruction */}
          {room.phase === "playing" && canClaim && (
            <div className="mt-3 text-xs text-white/70">
              Claim is open for <span className="font-bold">{claim.rank}</span>. Tap one of your cards to try. Wrong
              guess = +1 penalty card.
            </div>
          )}
        </div>

        {/* Bottom controls */}
        {room.phase === "playing" && (
          <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur border-t border-white/10">
            <div className="max-w-5xl mx-auto px-3 py-3 flex flex-wrap gap-2 items-center">
              <div className="text-xs text-white/70 mr-auto">
                Turn: <span className="font-semibold">{turnName}</span>
              </div>

              <button
                onClick={drawCard}
                disabled={!isMyTurn || stage !== "needDraw"}
                className={cx(
                  "px-3 py-2 rounded-lg font-semibold",
                  isMyTurn && stage === "needDraw" ? "bg-sky-400 text-slate-900" : "bg-white/10 text-white/50"
                )}
              >
                Draw
              </button>

              <button
                onClick={discardDrawn}
                disabled={!isMyTurn || stage !== "hasDrawn"}
                className={cx(
                  "px-3 py-2 rounded-lg font-semibold",
                  isMyTurn && stage === "hasDrawn" ? "bg-white text-slate-900" : "bg-white/10 text-white/50"
                )}
              >
                Discard Drawn
              </button>

              <button
                onClick={throwPair}
                disabled={!isMyTurn || stage !== "hasDrawn" || pairPick.length !== 2}
                className={cx(
                  "px-3 py-2 rounded-lg font-semibold",
                  isMyTurn && stage === "hasDrawn" && pairPick.length === 2
                    ? "bg-amber-300 text-slate-900"
                    : "bg-white/10 text-white/50"
                )}
              >
                Throw Pair
              </button>

              <button
                onClick={endTurn}
                disabled={!isMyTurn || stage !== "awaitEnd"}
                className={cx(
                  "px-3 py-2 rounded-lg font-semibold",
                  isMyTurn && stage === "awaitEnd" ? "bg-emerald-400 text-slate-900" : "bg-white/10 text-white/50"
                )}
              >
                End Turn
              </button>
            </div>
          </div>
        )}

      </div>

      <Toast msg={toast} />
    </div>
  );
}
