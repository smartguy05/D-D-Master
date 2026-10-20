import { loadFont as loadCinzel } from "@remotion/google-fonts/Cinzel";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

// Same families and weights the app loads in apps/web/index.html.
const cinzel = loadCinzel("normal", { weights: ["600", "800"], subsets: ["latin"] });
const inter = loadInter("normal", { weights: ["400", "600"], subsets: ["latin"] });

/** Brand tokens from apps/web/src/styles/app.css. */
export const C = {
  bg: "#120d0a",
  panel: "#1e1612",
  panel2: "#2a1f18",
  line: "#4a3a2c",
  text: "#f1e6d0",
  muted: "#a8977e",
  gold: "#e0b83c",
  goldHi: "#ffd75e",
  goldDeep: "#6b4a12",
  ok: "#4cc46a",
  bad: "#e0463c",
  accent: "#7fe0ff",
  ink: "#2a1a10",
  parchment: "#e9d7b0",
} as const;

export const FONT = {
  display: `${cinzel.fontFamily}, Georgia, serif`,
  body: `${inter.fontFamily}, system-ui, sans-serif`,
};
