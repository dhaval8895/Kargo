import React from "react";

/**
 * Minimal visual card component.
 * - faceDown = true  → shows card back
 * - faceDown = false → shows rank
 * This does NOT assume any game logic.
 */
export default function Card({
  rank = "?",
  faceDown = true,
  onClick,
  style = {},
}) {
  if (faceDown) {
    return (
      <div
        onClick={onClick}
        style={{
          width: 86,
          height: 118,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.16)",
          background:
            "radial-gradient(140px 120px at 40% 35%, rgba(255,255,255,0.18), transparent 60%), linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05))",
          boxShadow: "0 12px 28px rgba(0,0,0,.22)",
          cursor: onClick ? "pointer" : "default",
          ...style,
        }}
      />
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        width: 86,
        height: 118,
        borderRadius: 14,
        background: "#f7f3ea",
        color: "#121821",
        border: "1px solid rgba(0,0,0,.1)",
        boxShadow: "0 12px 28px rgba(0,0,0,.22)",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 32,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        ...style,
      }}
    >
      <div style={{ position: "absolute", top: 8, left: 8, fontSize: 12 }}>
        {rank}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          fontSize: 12,
          transform: "rotate(180deg)",
        }}
      >
        {rank}
      </div>
      {rank}
    </div>
  );
}
