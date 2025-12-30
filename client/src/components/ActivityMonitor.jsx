import { useMemo, useState } from "react";

export default function ActivityMonitor({ events = [] }) {
  const [open, setOpen] = useState(false);

  const latest = useMemo(() => {
    if (!events.length) return "Waiting for first move…";
    return events[0];
  }, [events]);

  return (
    <div className="kg-panel kg-activity">
      <div className="kg-activity-collapsed">
        <div className="kg-muted" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {latest}
        </div>
        <button className="kg-btn" onClick={() => setOpen(v => !v)}>
          {open ? "Close" : "Log"}
        </button>
      </div>

      {open && (
        <div className="kg-activity-expanded">
          {events.slice(0, 12).map((e, i) => (
            <div key={i} className="kg-logline">{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
