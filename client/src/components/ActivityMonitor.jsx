import { useMemo, useState } from "react";

export default function ActivityMonitor({ events = [] }) {
  const [open, setOpen] = useState(false);

  // newest-first list, limited to last 12
  const latestFirst = useMemo(() => {
    if (!events?.length) return [];
    return [...events].slice(-12).reverse();
  }, [events]);

  const latest = useMemo(() => {
    if (!latestFirst.length) return { player: "", action: "Waiting for first move…" };
    return latestFirst[0];
  }, [latestFirst]);

  return (
    <div style={styles.wrap}>
      <div style={styles.row}>
        <div style={styles.latest}>
          <strong>{latest.player}</strong>{" "}
          <span>{latest.action}</span>
        </div>
        <button style={styles.btn} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Log"}
        </button>
      </div>

      {open && (
        <div style={styles.panel}>
          {latestFirst.map((e) => (
            <div key={e.id || `${e.player}-${e.ts}-${e.action}`} style={styles.line}>
              <strong>{e.player}</strong>{" "}
              <span>{e.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    borderRadius: 16,
    overflow: "hidden",
    background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(10px)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
  },
  latest: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    paddingRight: 10,
    flex: 1,
  },
  btn: {
    borderRadius: 14,
    padding: "8px 10px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
  },
  panel: {
    maxHeight: "34vh",
    overflow: "auto",
    padding: "10px 12px",
    borderTop: "1px solid rgba(255,255,255,0.10)",
  },
  line: {
    fontSize: 13,
    color: "rgba(255,255,255,0.65)",
    padding: "6px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
};
