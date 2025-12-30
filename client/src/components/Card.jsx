import React from "react";

const SUIT_SYMBOL = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  "♠": "♠",
  "♥": "♥",
  "♦": "♦",
  "♣": "♣",
};

function getSuitSymbol(suit) {
  if (!suit) return null;
  const key = String(suit).toLowerCase();
  return SUIT_SYMBOL[key] || null;
}

function isRedSuit(sym) {
  return sym === "♥" || sym === "♦";
}

/**
 * Visual-only Card component (no game logic).
 * Props:
 * - rank: "A","2"...,"10","J","Q","K" (or "?")
 * - suit: "spades"|"hearts"|"diamonds"|"clubs" OR "♠"|"♥"|"♦"|"♣"
 * - faceDown: true shows back
 */
export default function Card({
  rank = "?",
  suit,
  faceDown = true,
  onClick,
  style = {},
}) {
  const suitSym = getSuitSymbol(suit);
  const red = suitSym ? isRedSuit(suitSym) : false;

  const base = {
    width: 86,
    height: 118,
    borderRadius: 14,
    cursor: onClick ? "pointer" : "default",
    userSelect: "none",
    ...style,
  };

  // Card back: darker gradient + subtle pattern
  if (faceDown) {
    return (
      <div
        onClick={onClick}
        aria-label="Face down card"
        style={{
          ...base,
          position: "relative",
          border: "1px solid rgba(255,255,255,0.14)",
          background:
            "radial-gradient(140px 120px at 30% 25%, rgba(255,255,255,0.14), transparent 55%)," +
            "radial-gradient(120px 120px at 80% 70%, rgba(90,160,255,0.18), transparent 60%)," +
            "linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04))",
          boxShadow: "0 12px 28px rgba(0,0,0,.28)",
          overflow: "hidden",
        }}
      >
        {/* subtle pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.22,
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(255,255,255,0.22) 0 2px, transparent 2px 10px)",
            mixBlendMode: "overlay",
          }}
        />
        {/* inner border */}
        <div
          style={{
            position: "absolute",
            inset: 8,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.16)",
          }}
        />
      </div>
    );
  }

  // Card face: slightly dark, premium gradient surface
  return (
    <div
      onClick={onClick}
      aria-label={`Card ${rank}${suitSym ? ` ${suitSym}` : ""}`}
      style={{
        ...base,
        position: "relative",
        border: "1px solid rgba(255,255,255,0.10)",
        background:
          "radial-gradient(160px 140px at 30% 25%, rgba(255,255,255,0.10), transparent 55%)," +
          "radial-gradient(140px 140px at 80% 75%, rgba(255,180,80,0.10), transparent 60%)," +
          "linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))",
        boxShadow: "0 12px 28px rgba(0,0,0,.30)",
        color: "rgba(255,255,255,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* corners */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1,
          color: red ? "rgba(255,120,120,0.95)" : "rgba(255,255,255,0.90)",
        }}
      >
        <div>{rank}</div>
        <div style={{ marginTop: 3 }}>{suitSym || ""}</div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          fontSize: 12,
          fontWeight: 800,
          lineHeight: 1,
          transform: "rotate(180deg)",
          color: red ? "rgba(255,120,120,0.95)" : "rgba(255,255,255,0.90)",
        }}
      >
        <div>{rank}</div>
        <div style={{ marginTop: 3 }}>{suitSym || ""}</div>
      </div>

      {/* center pip */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          transform: "translateY(1px)",
        }}
      >
        <div
          style={{
            fontSize: 34,
            fontWeight: 900,
            letterSpacing: -0.6,
            color: red ? "rgba(255,120,120,0.95)" : "rgba(255,255,255,0.92)",
          }}
        >
          {rank}
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: red ? "rgba(255,120,120,0.95)" : "rgba(255,255,255,0.88)",
            opacity: suitSym ? 1 : 0.35,
          }}
        >
          {suitSym || "•"}
        </div>
      </div>

      {/* soft gloss */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 35%, transparent 70%, rgba(255,255,255,0.05) 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
