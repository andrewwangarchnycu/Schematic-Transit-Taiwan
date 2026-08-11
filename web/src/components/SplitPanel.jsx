import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "tw-transit-split-percent";
// Previously the side panel was a fixed 380px sliver and the map got
// whatever was left (usually the large majority of the screen). A 50/50
// split roughly halves the map's old share while staying draggable from
// there in either direction.
const DEFAULT_PERCENT = 50;
const MIN_PERCENT = 20;
const MAX_PERCENT = 80;

function isRowLayout() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;
}

// Draggable divider between the side panel and the map/schematic panel,
// used by every tab. Desktop (row layout) drags horizontally to resize
// width; the mobile stacked layout (column) drags vertically to resize
// height -- same component, axis picked at drag time from the current
// layout.
export default function SplitPanel({ side, main, mainClassName = "", mainRef }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(false);
  const [percent, setPercent] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? Number(localStorage.getItem(STORAGE_KEY)) : NaN;
    return saved > 0 && saved < 100 ? saved : DEFAULT_PERCENT;
  });

  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, String(percent));
  }, [percent]);

  function updateFromPointer(e) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = isRowLayout() ? ((e.clientX - rect.left) / rect.width) * 100 : ((e.clientY - rect.top) / rect.height) * 100;
    setPercent(Math.max(MIN_PERCENT, Math.min(MAX_PERCENT, raw)));
  }

  function onPointerDown(e) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (draggingRef.current) updateFromPointer(e);
  }
  function onPointerUp() {
    draggingRef.current = false;
  }

  return (
    <div className="split-container" ref={containerRef}>
      <aside className="side-panel" style={{ flexBasis: `${percent}%` }}>
        {side}
      </aside>
      <div
        className="split-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="separator"
        aria-orientation="vertical"
      />
      <main className={`map-panel ${mainClassName}`} ref={mainRef}>
        {main}
      </main>
    </div>
  );
}
