import React, { useState } from "react";
import Card from "./Card";
import ActivityMonitor from "./ActivityMonitor";
import PeekModal from "./PeekModal";

export default function GamePilot() {
  // --- PILOT STATE (LOCAL ONLY) ---
  const [events, setEvents] = useState([
    "Player A joined the room",
    "Player B joined the room",
    "Player C joined the room",
  ]);

  const [peek, setPeek] = useState(null);

  const [hand, setHand] = useState([
    { rank: "7", suit: "hearts", hidden: true },
    { rank: "Q", suit: "spades", hidden: true },
    { rank: "3", suit: "clubs", hidden: true },
    { rank: "10", suit: "diamonds", hidden: true },
  ]);

  const [discardTop, setDiscardTop] = useState({ rank: "6", suit: "spades" });

  // --- HAND ACTIONS ---
  function revealCard(i) {
    setPeek(hand[i]);
  }

  function endTurn() {
    setEvents((e) => ["Player A ended turn", ...e].slice(0, 12));
  }

  function callKargo() {
    setEvents((e) => ["Player A called Kargo", ...e].slice(0, 12));
  }

  // --- UI ---
  return (
    <div style={styles.bg}>
      <div style={styles.wrap}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.title}>KARGO — Pilot</div>
          <div style={styles.chip}>UI Test Mode</div>
        </div>

        {/* Activity Monitor */}
        <ActivityMonitor events={events} />

        {/* Table */}
        <div style={styles.table}>
          {/* Opponents */}
          <div style={styles.opponents}>Player B • Player C</div>

          {/* Center */}
          <div style={styles.center}>
            <div>
              <div style={styles.label}>Draw</div>
              <div style={styles.deck}>
                <div style={styles.deckCard} />
                <div style={{ ...styles.deckCard, transform: "translate(3px,-3px)" }} />
                <div style={{ ...styles.deckCard, transform: "translate(6px,-6px)" }} />
              </div>
            </div>

            <div>
              <div style={styles.label}>Discard</div>
              <Card
                rank={discardTop.rank}
                suit={discardTop.suit}
                faceDown={false}
              />
            </div>
          </div>

          {/* Your Hand */}
          <div>
            <div style={styles.label}>Your Hand</div>
            <div style={styles.hand}>
              {hand.map((c, i) => (
                <Card
                  key={i}
                  rank={c.rank}
                  suit={c.suit}
                  faceDown={c.hidden}
                  onClick={() => revealCard(i)}
                />
              ))}
            </div>

            <div style={styles.actions}>
              <button style={styles.btn} onClick={endTurn}>
                End Turn
              </button>
              <button style={styles.btn} onClick={callKargo}>
                Call Kargo
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Peek Modal */}
      <PeekModal
        open={!!peek}
        card={peek}
        title="Peek"
        onClose={() => setPeek(null)}
      />
    </div>
  );
}

const styles = {
  bg: {
    minHeight: "100vh",
    background:
      "radial-gradient(1100px 700px at 20% 10%, rgba(80,140,255,.18), transparent 55%)," +
      "radial-gradient(900px 700px at 80% 20%, rgba(255,180,80,.10), transparent 60%)," +
      "radial-gradient(900px 700px at 55% 95%, rgba(120,255,200,.08), transparent 55%)," +
      "#0b0f14",
    color: "rgba(255,255,255,.92)",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
  },
  wrap: { maxWidth: 980, margin: "0 auto", padding: 12 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 18,
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.12)",
    marginBottom: 10,
  },
  title: { fontWeight: 900 },
  chip: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.08)",
  },
  table: {
    background: "rgba(255,255,255,.07)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.12)",
    padding: 12,
  },
  opponents: { fontSize: 13, opacity: 0.7, marginBottom: 6 },
  center: {
    display: "flex",
    justifyContent: "center",
    gap: 30,
    padding: "12px 0",
  },
  deck: { width: 86, height: 118, position: "relative" },
  deckCard: {
    position: "absolute",
    inset: 0,
    borderRadius: 14,
    background:
      "linear-gradient(145deg, rgba(255,255,255,.12), rgba(255,255,255,.04))",
    border: "1px solid rgba(255,255,255,.16)",
  },
  label: { fontSize: 12, opacity: 0.6, marginBottom: 6 },
  hand: {
    display: "grid",
    gridTemplateColumns: "repeat(2,1fr)",
    gap: 10,
    justifyItems: "center",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
  },
  btn: {
    borderRadius: 14,
    padding: "10px 12px",
    background: "rgba(255,255,255,.10)",
    border: "1px solid rgba(255,255,255,.16)",
    color: "rgba(255,255,255,.92)",
    cursor: "pointer",
  },
};
