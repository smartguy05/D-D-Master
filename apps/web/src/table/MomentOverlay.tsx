import type { Campaign, GameState, Moment } from "@dm/shared";
import { MOMENT_MS, type MomentVariant } from "./momentPlan";

/**
 * Full-screen moments over the map (CSS only, like CritBurst; keyframes in app.css). TablePage
 * picks the current one from the overlay queue (momentPlan) and keys it by moment id.
 */

interface Who {
  name: string;
  portraitUrl?: string;
}

function who(state: GameState, id?: string): Who | null {
  if (!id) return null;
  const c = state.characters.find((x) => x.id === id);
  if (c) return { name: c.name, portraitUrl: c.spriteUrl };
  const m = state.monsters.find((x) => x.id === id);
  return m ? { name: m.name, portraitUrl: m.spriteUrl } : null;
}

const GOLD_SPARKS = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 20) / 10,
  dur: 2.2 + ((i * 7) % 10) / 6,
  size: 6 + ((i * 5) % 8),
}));

function Sparks() {
  return (
    <div className="mo-sparks" aria-hidden>
      {GOLD_SPARKS.map((s, i) => (
        <i key={i} style={{ left: `${s.left}%`, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`, width: s.size, height: s.size }} />
      ))}
    </div>
  );
}

function CampaignEnd({ moment, state, campaign }: { moment: Moment; state: GameState; campaign: Campaign | null }) {
  const success = moment.outcome !== "failure";
  return (
    <div className="mo-campaign">
      {success && <Sparks />}
      <div className="mo-kicker">{campaign?.outline?.title ?? campaign?.name ?? "The campaign"}</div>
      <div className="mo-title">{success ? "Campaign Complete" : "The Tale Ends in Darkness"}</div>
      <div className="mo-party">
        {state.characters.map((c) => (
          <div key={c.id} className={`mo-hero ${c.conditions.some((x) => x.toLowerCase() === "dead") ? "fallen" : ""}`} style={{ borderColor: c.color }}>
            {c.spriteUrl ? <img src={c.spriteUrl} alt="" /> : <div className="mo-dot" style={{ background: c.color }} />}
            <div className="mo-hero-name">{c.name}</div>
            <div className="mo-hero-sub">
              Level {c.level} {c.className}
            </div>
          </div>
        ))}
      </div>
      {moment.text && <p className="mo-epilogue">{moment.text}</p>}
      <div className="mo-hint">click to close</div>
    </div>
  );
}

const TITLES: Partial<Record<MomentVariant, string>> = { victory: "VICTORY", defeat: "DEFEAT", fled: "ESCAPED" };
const SUBTITLES: Partial<Record<MomentVariant, string>> = { victory: "The foes are vanquished", defeat: "The party has fallen", fled: "The party flees the fight" };

export function MomentOverlay({
  moment,
  variant,
  state,
  campaign,
  onDismiss,
}: {
  moment: Moment;
  variant: MomentVariant;
  state: GameState;
  campaign: Campaign | null;
  onDismiss: () => void;
}) {
  const target = who(state, moment.targetId);
  const style = { ["--mo-dur" as string]: `${MOMENT_MS[variant]}ms` };
  if (variant === "turn_start") {
    if (!target) return null;
    return (
      <div className="moment-overlay turn_start" style={style} aria-live="polite">
        <div className="mo-turn">
          {target.portraitUrl && <img src={target.portraitUrl} alt="" />}
          <span>{target.name}'s turn</span>
        </div>
      </div>
    );
  }
  if (variant === "campaign_end") {
    return (
      <div className={`moment-overlay campaign_end ${moment.outcome === "failure" ? "failure" : "success"}`} style={style} onClick={onDismiss} role="dialog" aria-live="polite">
        <CampaignEnd moment={moment} state={state} campaign={campaign} />
      </div>
    );
  }
  if (variant === "death" || variant === "revived") {
    return (
      <div className={`moment-overlay ${variant}`} style={style} aria-live="polite">
        {variant === "revived" && <div className="mo-light" />}
        <div className="mo-text">
          {target?.portraitUrl && <img className="mo-portrait" src={target.portraitUrl} alt="" />}
          <div className="mo-title">{target?.name ?? "A hero"}</div>
          <div className="mo-sub">{variant === "death" ? "has fallen" : "returns to life"}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`moment-overlay ${variant}`} style={style} aria-live="polite">
      {variant === "victory" && <Sparks />}
      <div className="mo-text">
        <div className="mo-title">{TITLES[variant] ?? ""}</div>
        <div className="mo-sub">{SUBTITLES[variant] ?? ""}</div>
      </div>
    </div>
  );
}

/** Small "back up" toast for a PC who regained HP from 0 (revived + outcome rallied). */
export function RalliedToast({ name }: { name: string }) {
  return (
    <div className="rallied-toast" style={{ ["--mo-dur" as string]: `${MOMENT_MS.rallied}ms` }} aria-live="polite">
      ✚ <b>{name}</b> is back up!
    </div>
  );
}
