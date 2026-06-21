import { motion } from "framer-motion";
import type { Character } from "../types";

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}deg 65% 50%)`;
}

export default function CharacterCard({ c, index = 0 }: { c: Character; index?: number }) {
  const initials = c.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const hue = avatarColor(c.name);
  const hue2 = avatarColor(`${c.name}x`);

  return (
    <motion.div
      className="character-card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.06, 0.4) }}
      whileHover={{ y: -4 }}
    >
      <div className="character-avatar" style={{ background: `linear-gradient(135deg, ${hue}, ${hue2})` }}>
        {initials}
      </div>
      <div className="character-body">
        <div className="character-name">{c.name}</div>
        <div className="character-role">{c.role}</div>
        <div className="character-desc">{c.description}</div>
      </div>
    </motion.div>
  );
}
