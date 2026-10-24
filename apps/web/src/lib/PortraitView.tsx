import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Full-screen image (player Avatar, host Party tab portraits; `wide` for host Adventure tab maps). A click anywhere or Esc closes it. */
export function PortraitView({ name, src, appearance, wide, label, onClose }: { name: string; src: string; appearance?: string; wide?: boolean; label?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portaled: a sticky header's stacking context would keep it under other fixed UI.
  return createPortal(
    <div className={`portrait-view${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={label ?? `${name}'s portrait`} onClick={onClose}>
      <button className="portrait-close" aria-label="Close">✕</button>
      <img src={src} alt={name} />
      <h2>{name}</h2>
      {appearance?.trim() && <p>{appearance}</p>}
    </div>,
    document.body,
  );
}
