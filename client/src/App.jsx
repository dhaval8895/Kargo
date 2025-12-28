import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function App() {
  const socket = useMemo(() => {
    if (!SERVER_URL) return null;
    return io(SERVER_URL, { transports: ["websocket"] });
  }, []);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [room, setRoom] = useState(null);

  // lobby form
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onErr = (m) => setError(String(m || "Unknown error"));
    const onUpdate = (r) => {
      setRoom(r);
      setError("");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("error:msg", onErr);
    socket.on("room:update", onUpdate);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("error:msg", onErr);
      socket.off("room:update", onUpdate);
      socket.disconnect();
    };
  }, [socket]);

  const myId = socket?.id;
  const isHost = room?.hostId && room.hostId === myId;
  const canStart = !!room && isHost && room.phase === "lobby" && (room.players?.length ?? 0) >= 2;

  if (!SERVER_URL) {
    return (
      <Page>
        <Card>
          <h2 style={{ marginTop: 0 }}>KARGO</h2>
          <p style={{ marginBottom: 8 }}>
            Your frontend is deployed, but it can’t find <b>VITE_SERVER_URL</b>.
          </p>
          <p style={{ marginTop: 0 }}>
            In Vercel → Project Settings → Environment Variables, add:
          </p>
          <CodeBlock
            text={`VITE_SERVER_URL = https://kargo-vyo1.onrender.com`}
          />
          <p style={{ marginBottom: 0 }}>Then redeploy (or trigger a new deploy).</p>
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <Header>
        <div>
          <h1 style={{ margin: 0 }}>KARGO</h1>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            Server: {SERVER_URL} • Socket: {connected ? "connected" : "disconnected"}
          </div>
        </div>
        {room && (
          <button
            style={btnGhost}
            onClick={() => {
              socket.emit("room:leave", { code: room.code });
              setRoom(null);
            }}
          >
            Leave room
          </button>
        )}
      </Header>

      {!room ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>Join your friends</h2>

          <div style={row}>
            <label style={label}>Your name</label>
            <input
              style={input}
              placeholder="Dhaval"
              value={name}
              onChange={(e) => setName(e.target.value)}
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

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                style={{ ...input, width: 160 }}
                placeholder="ROOM CODE"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button
                style={btn}
                disabled={!name.trim() || !code.trim() || !connected}
                onClick={() => socket.emit("room:join", { code: code.trim(), name: name.trim() })}
              >
                Join room
              </button>
            </div>
          </div>

          {error && <div style={errorBox}>{error}</div>}

          <div style={{ marginTop: 14, opacity: 0.8, fontSize: 13, lineHeight: 1.4 }}>
            Tip: Share the room code with friends once you create it.
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Room code</div>
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>
                  {room.code}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ opacity: 0.75, fontSize: 13 }}>Phase</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{room.phase}</div>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ opacity: 0.75, fontSize: 13, marginBottom: 6 }}>Players</div>
              <div style={{ display: "grid", gap: 8 }}>
                {(room.players || []).map((p) => (
                  <div key={p.id} style={playerRow}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={dot(p.id === room.turnPlayerId ? "#22c55e" : "#9ca3af")} />
                      <b>{p.name}</b>
                      {p.id === room.hostId && <span style={pill}>HOST</span>}
                      {p.id === myId && <span style={pill2}>YOU</span>}
                    </div>
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      {typeof p.cardCount === "number" ? `${p.cardCount} cards` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <button
                style={btn}
                disabled={!canStart}
                onClick={() => socket.emit("game:start", { code: room.code })}
              >
                Start game
              </button>
              {!canStart && room.phase === "lobby" && (
                <div style={{ opacity: 0.75, fontSize: 13, alignSelf: "center" }}>
                  {isHost ? "Need at least 2 players." : "Waiting for host to start."}
                </div>
              )}
            </div>

            {error && <div style={errorBox}>{error}</div>}
          </Card>

          <Card>
            <h3 style={{ marginTop: 0 }}>Scoreboard</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {(room.scoreboard || [])
                .slice()
                .sort((a, b) => a.score - b.score)
                .map((s) => (
                  <div key={s.name} style={scoreRow}>
                    <span>{s.name}</span>
                    <b>{s.score}</b>
                  </div>
                ))}
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}

/* ---------- tiny UI helpers ---------- */

function Page({ children }) {
  return <div style={page}>{children}</div>;
}

function Header({ children }) {
  return <div style={header}>{children}</div>;
}

function Card({ children }) {
  return <div style={cardWrap}>{children}</div>;
}

function CodeBlock({ text }) {
  return (
    <pre style={codeBox}>
      {text}
    </pre>
  );
}

function dot(color) {
  return {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: color,
    display: "inline-block"
  };
}

/* ---------- styles ---------- */

const page = {
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
  maxWidth: 980,
  margin: "0 auto",
  padding: 18,
  display: "grid",
  gap: 12
};

const header = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap"
};

const cardWrap = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  background: "white"
};

const row = { display: "grid", gap: 6 };
const label = { fontSize: 13, opacity: 0.75 };

const input = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  width: 260,
  outline: "none"
};

const btn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  cursor: "pointer",
  fontWeight: 700
};

const btnGhost = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "white",
  cursor: "pointer",
  fontWeight: 700
};

const errorBox = {
  marginTop: 12,
  padding: 10,
  borderRadius: 12,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#9f1239",
  fontSize: 13
};

const playerRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb"
};

const scoreRow = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb"
};

const pill = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
  color: "#3730a3",
  fontWeight: 800
};

const pill2 = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 999,
  background: "#ecfeff",
  border: "1px solid #a5f3fc",
  color: "#155e75",
  fontWeight: 800
};

const codeBox = {
  padding: 12,
  borderRadius: 12,
  background: "#0b1220",
  color: "white",
  overflowX: "auto",
  fontSize: 13
};
