import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { useTiming } from "../timing";
import { shake } from "./Effects";
import { DamageNumber, HpBar, InitiativeBanner } from "./Hud";

/** Over the combat shot: turn order snaps in, the attack lands on beat 3 with damage and HP drain. */
export const CombatOverlay: React.FC = () => {
  const f = useCurrentFrame();
  const { beat } = useTiming();
  const hit = beat(2);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", transform: shake(f, hit, 10) }}>
      <InitiativeBanner active={0} at={0} />
      <DamageNumber x={1150} y={470} at={hit} text="-9" crit={false} />
      <HpBar name="Kobold Skirmisher" max={12} from={12} to={3} at={hit} x={1290} y={880} w={520} />
    </AbsoluteFill>
  );
};
