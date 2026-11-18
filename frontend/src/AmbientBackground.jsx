import React from "react";

/* Visual only: flowing neon ribbons, glass bubbles, cube, ring and twinkling stars. */
const stars = Array.from({ length: 44 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  top: `${(i * 53 + 7) % 100}%`,
  delay: `${(i % 9) * -0.9}s`,
  duration: `${3 + (i % 5)}s`,
  size: `${1 + (i % 3)}px`,
}));

export default function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <svg className="nx-ribbons" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="nxCyan" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22e3d6" stopOpacity="0" />
            <stop offset=".45" stopColor="#22e3d6" stopOpacity=".55" />
            <stop offset="1" stopColor="#5aa7ff" stopOpacity=".08" />
          </linearGradient>
          <linearGradient id="nxViolet" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#5aa7ff" stopOpacity="0" />
            <stop offset=".5" stopColor="#9b6bff" stopOpacity=".6" />
            <stop offset="1" stopColor="#c9a6ff" stopOpacity=".1" />
          </linearGradient>
          <linearGradient id="nxLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#22e3d6" />
            <stop offset=".55" stopColor="#7fb6ff" />
            <stop offset="1" stopColor="#b48cff" />
          </linearGradient>
          <filter id="nxSoft"><feGaussianBlur stdDeviation="10" /></filter>
          <filter id="nxGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path className="nx-band nx-b1" filter="url(#nxSoft)" fill="url(#nxCyan)" d="M-100 560C150 430 330 450 520 560S900 760 1180 600L1180 700C900 860 640 700 480 640S120 560-100 680Z" />
        <path className="nx-band nx-b2" filter="url(#nxSoft)" fill="url(#nxViolet)" d="M650 400C930 300 1150 110 1350 170S1620 300 1700 240L1700 380C1560 440 1400 310 1250 300S930 500 650 490Z" />
        <path className="nx-band nx-b3" filter="url(#nxSoft)" fill="url(#nxCyan)" d="M880 900C1100 780 1350 820 1700 650L1700 780C1400 920 1150 890 880 980Z" />
        <path className="nx-line nx-l1" filter="url(#nxGlow)" stroke="url(#nxLine)" d="M-100 600C200 470 380 500 560 590S950 780 1250 610 1500 420 1700 470" />
        <path className="nx-line nx-l2" filter="url(#nxGlow)" stroke="url(#nxLine)" d="M600 450C900 360 1100 170 1350 190S1600 330 1700 300" />
        <path className="nx-line nx-l3" filter="url(#nxGlow)" stroke="url(#nxLine)" d="M-100 330C150 410 300 260 520 340S800 520 960 470" />
      </svg>

      <div className="nx-floor" />
      <div className="nx-fl nx-sphere nx-s1" style={{ "--d": 26 }} />
      <div className="nx-fl nx-sphere nx-s2" style={{ "--d": -34 }} />
      <div className="nx-fl nx-sphere nx-s3" style={{ "--d": 48 }} />
      <div className="nx-fl nx-ringwrap" style={{ "--d": -22 }}><div className="nx-ring" /></div>
      <div className="nx-fl nx-cubewrap" style={{ "--d": 40 }}>
        <div className="nx-cube"><i /><i /><i /><i /><i /><i /></div>
      </div>
      <div className="nx-stars">
        {stars.map((s, i) => (
          <i key={i} style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.duration }} />
        ))}
      </div>
      <div className="ambient-vignette" />
    </div>
  );
}
