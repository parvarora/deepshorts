import type { TraceStep } from "./types";

export const MOOD_EMOJI: Record<string, string> = {
  "maximum-drama": "🎬",
  "bollywood-blockbuster": "🎬",
  "south-indian-mass": "🔥",
  "comedy-chaos": "😂",
  "corporate-war": "💼",
  "action-thriller": "🔫",
  "spy-thriller": "🕶️",
  "sci-fi-epic": "🤖",
  "mythological-epic": "⚔️",
  "romantic-drama": "❤️",
  "tragic-masterpiece": "😭",
  horror: "👻",
  "political-thriller": "🏛️",
  "sports-underdog": "🏆",
  "historical-epic": "📜",
  "random-madness": "🎲",
};

export function moodEmoji(id?: string | null): string {
  if (!id) return "🎬";
  return MOOD_EMOJI[id] || "🎭";
}

/** Fixed stages shown in the pipeline stepper for a full generation. */
export const STAGE_KEYS = ["dispatch", "architect", "screenwriter", "critic", "finalize"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const STAGE_TITLES: Record<StageKey, string> = {
  dispatch: "Reading the brief",
  architect: "Designing the film",
  screenwriter: "Writing the scenes",
  critic: "Script doctor review",
  finalize: "Final cut",
};

/** Turn a raw pipeline trace step into a friendly label + detail for the UI. */
export function describeStep(t: TraceStep): { label: string; detail: string } {
  const g = (k: string) => (t as any)[k];
  switch (t.step) {
    case "dispatch":
      return { label: "Reading the brief", detail: "Setting the stage" };
    case "architect":
      return {
        label: "Designing the film",
        detail: [
          g("title") ? `“${g("title")}”` : "",
          g("characters") != null ? `${g("characters")} characters` : "",
          g("scenes_planned") != null ? `${g("scenes_planned")} scenes planned` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "screenwriter":
      return {
        label: g("revision") ? `Revising the script (pass ${g("pass_no")})` : "Writing the scenes",
        detail: g("scenes_written") != null ? `${g("scenes_written")} scenes` : "",
      };
    case "critic":
      return {
        label: "Script doctor reviewing",
        detail: `score ${g("score")} / 100 · ${g("passed") ? "approved ✦" : "sending notes"}`,
      };
    case "finalize":
      return { label: "Final cut", detail: g("converged") ? "approved" : "best effort" };
    case "regen_scene":
      return { label: "Reshooting the scene", detail: `scene ${g("index")}` };
    case "regen_dialogue":
      return { label: "Punching up the dialogue", detail: `scene ${g("index")}` };
    case "regen_meta":
      return { label: "New title & tagline", detail: "" };
    case "regen_characters":
      return { label: "Recasting", detail: "" };
    default:
      return { label: t.step, detail: "" };
  }
}
