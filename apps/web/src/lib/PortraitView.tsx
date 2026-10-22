import { useEffect } from "react";
import { createPortal } from "react-dom";

/** Full-screen portrait (player Avatar, host Party tab). A click anywhere or Esc closes it. */
export function PortraitView({ name, src, appearance, onClose }: { name: string; src: string; appearance?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portaled: a sticky header's stacking context would keep it under other fixed UI.
  return createPortal(
    <div className="portrait-view" role="dialog" aria-modal="true" aria-label={`${name}'s portrait`} onClick={onClose}>
      <button className="portrait-close" aria-label="Close">✕</button>
      <img src={src} alt={name} />
      <h2>{name}</h2>
      {appearance?.trim() && <p>{appearance}</p>}
    </div>,
    document.body,
  );
}
