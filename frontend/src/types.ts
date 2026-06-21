// Mirrors the backend Pydantic contract (backend/app/schemas.py).

export interface Character {
  name: string;
  role: string;
  description: string;
  want?: string | null;
  fear?: string | null;
  contradiction?: string | null;
}

export interface DialogueLine {
  character: string;
  delivery?: string;
  line: string;
}

export interface Scene {
  scene_index: number;
  scene_title?: string | null;
  heading: string;
  scene_description: string;
  dialogue: DialogueLine[];
}

export interface Script {
  movie_title: string;
  tagline: string;
  mood: string;
  logline?: string;
  directed_in_the_style_of?: string;
  characters: Character[];
  scenes: Scene[];
}

export interface TraceStep {
  step: string;
  status: string;
  ts?: number;
  [k: string]: unknown;
}

export interface GenerateMeta {
  request_id?: string;
  mode?: string;
  converged?: boolean;
  score?: number | null;
  iterations?: number;
  situation?: string | null;
  mood?: string | null;
  director?: string | null;
  title?: string;
  trace?: TraceStep[];
}

export interface GenerateResponse {
  ok: boolean;
  script: Script;
  meta: GenerateMeta;
}

export interface GenerateRequest {
  situation: string;
  mood?: string | null;
  director?: string | null;
  characters_hint?: string | null;
}

export type RegenType =
  | "title"
  | "tagline"
  | "meta"
  | "scene"
  | "dialogue"
  | "characters";

export interface RegenerateRequest {
  script: Script;
  target: { type: RegenType; index?: number | null };
  mood?: string | null;
  director?: string | null;
  note?: string | null;
}

export interface Option {
  id: string;
  label: string;
}
export interface DirectorOption extends Option {
  image: string | null;
}
export interface Options {
  moods: Option[];
  directors: DirectorOption[];
}

// A history entry stored in localStorage.
export interface HistoryItem {
  id: string;
  title: string;
  mood: string | null;
  director: string | null;
  situation: string;
  date: string;
  script: Script;
}
