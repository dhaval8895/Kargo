import { useState } from "react";
import ActivityMonitor from "./ActivityMonitor";
import Card from "./Card";

export default function GamePilot() {
  // Replace these with your real state later
  const [events, setEvents] = useState([
    "Player A called Kargo",
    "Player A discarded a pair of 7s",
    "Player B discarded 9",
  ]);

  // Example: your hand grows 2xN
  const hand = [
    { rank: "?", faceDown: true },
    { rank: "?", faceDown: true },
    { rank: "?", faceDown: true },
    { rank: "?", faceDown: true },
    // { rank: "?", faceDown: true }, // penalty example
  ];

  return (
    <div className="kg-bg">
      <div className="kg-wrap">
        <div className="kg-panel kg-topbar">
          <div className="kg-title">Kargo</div>
          <div className="kg-chip">Pilot UI</div>
        </div>

        <ActivityMonitor events={events} />

        <div className="kg-panel kg-table">
          {/* Opponents area (lightweight placeholder) */}
          <div className="kg-muted" style={{ padding: "6px 10px" }}>
            Player B • Player C
          </div>

          {/* Center: draw + discard */}
          <div className="kg-center">
            <div>
              <div className="kg-muted" style={{ fontSize: 12, marginBottom: 6 }}>Draw</div>
              <div className="kg-stack" title="Draw Deck">
                <div className="kg-cardback" />
                <div className="kg-cardback" />
                <div className="kg-cardback" />
              </div>
            </div>

            <div>
              <div className="kg-muted" style={{ fontSize: 12, marginBottom: 6 }}>Discard</div>
              <Card rank="6" faceDown={false} />
            </div>
          </div>

          {/* Your hand */}
          <div>
            <div className="kg-muted" style={{ fontSize: 12, padding: "0 10px 6px" }}>
              Your Hand
            </div>
            <div className="kg-hand">
              {hand.map((c, idx) => (
                <Card key={idx} rank={c.rank} faceDown={c.faceDown} onClick={() => {
                  setEvents(prev => [`Clicked slot ${idx}`, ...prev].slice(0, 12));
                }} />
              ))}
            </div>

            <div className="kg-btnrow">
              <button className="kg-btn" onClick={() => setEvents(prev => ["End Turn", ...prev].slice(0, 12))}>
                End Turn
              </button>
              <button className="kg-btn" onClick={() => setEvents(prev => ["Call Kargo", ...prev].slice(0, 12))}>
                Call Kargo
              </button>
            </div>
          </div>
        </div>

        <div className="kg-muted" style={{ fontSize: 12, textAlign: "center", paddingBottom: 8 }}>
          Minimal, mobile-safe layout • Activity log collapses • Real card feel
        </div>
      </div>
    </div>
  );
}
