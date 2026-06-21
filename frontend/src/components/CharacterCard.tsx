import type { Character } from "../types";

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}deg 55% 45%)`;
}

export default function CharacterCard({ c }: { c: Character }) {
  const initials = c.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="character-card">
      <div className="character-avatar" style={{ background: avatarColor(c.name) }}>
        {initials}
      </div>
      <div className="character-body">
        <div className="character-name">{c.name}</div>
        <div className="character-role">{c.role}</div>
        <div className="character-desc">{c.description}</div>
      </div>
    </div>
  );
}
