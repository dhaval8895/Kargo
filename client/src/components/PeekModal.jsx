import React from "react";
import Card from "./Card";

export default function PeekModal({ open, title = "Peek", card, onClose }) {
  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.title}>{title}</div>
          <button style={styles.btn} onClick={onClose}>Close</button>
        </div>

        <div style={styles.body}>
          <Card
            faceDown={false}
            rank={card?.rank ?? "?"}
            suit={card?.suit}
            style={{ width: 120, height: 165, borderRadius: 18 }}
          />
        </div>

        <div style={styles.note}>
          Close this to resume the game.
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.62)",
    backdropFilter: "blur(10px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: 14,
  },
  modal: {
    width: "min(420px, 100%)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  title: { fontWeight: 800, color: "rgba(255,255,255,0.92)" },
  btn: {
    borderRadius: 14,
    padding: "8px 10px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
  },
  body: { padding: 18, display: "flex", justifyContent: "center" },
  note: {
    padding: "0 14px 14px",
    fontSize: 12,
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
  },
};
