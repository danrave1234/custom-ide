/** Vide mark: a V drawn as a code chevron, followed by a live cursor. */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <defs>
        <linearGradient id="vide-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e2433" />
          <stop offset="1" stopColor="#0b0e13" />
        </linearGradient>
        <linearGradient id="vide-v" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9d3ff" />
          <stop offset="0.55" stopColor="#9d8fff" />
          <stop offset="1" stopColor="#6a58f5" />
        </linearGradient>
      </defs>
      <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#vide-bg)" />
      <rect x="36" y="36" width="952" height="952" rx="212" fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="8" />
      <polyline
        points="256,296 468,712 680,296"
        fill="none"
        stroke="url(#vide-v)"
        strokeWidth="112"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="624" y="636" width="152" height="80" rx="40" fill="#4ade80" />
    </svg>
  );
}
