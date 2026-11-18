import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/*
  Stage 2: mouse parallax + floating 3D shapes + 3D card tilt.
  - Visual only. It never reads or changes app data, API calls or proctoring code.
  - Switched off on the /test/ page (so face detection keeps all the CPU),
    for people who prefer reduced motion, and on touch screens.
  - Mounted from main.jsx, so App.jsx does not need any change.
*/
export default function Parallax() {
  const reduce = useReducedMotion();
  const [path, setPath] = useState(window.location.pathname);

  // Notice page changes (the app uses client-side routing, so we check the address now and then).
  useEffect(() => {
    const t = setInterval(() => setPath(p => (p === window.location.pathname ? p : window.location.pathname)), 400);
    return () => clearInterval(t);
  }, []);

  const off = reduce || path.startsWith("/test/");

  useEffect(() => {
    if (off) return;
    const root = document.documentElement;
    const fine = window.matchMedia("(pointer: fine)").matches;
    let raf = 0, mx = 0, my = 0, tx = 0, ty = 0, active = null;

    const loop = () => {
      tx += (mx - tx) * 0.08;
      ty += (my - ty) * 0.08;
      root.style.setProperty("--px", tx.toFixed(3));
      root.style.setProperty("--py", ty.toFixed(3));
      raf = Math.abs(mx - tx) > 0.002 || Math.abs(my - ty) > 0.002 ? requestAnimationFrame(loop) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const reset = el => { if (el) el.style.rotate = ""; };

    const onMove = e => {
      mx = (e.clientX / window.innerWidth - 0.5) * 2;
      my = (e.clientY / window.innerHeight - 0.5) * 2;
      kick();
      const el = e.target.closest ? e.target.closest(".tilt:not(.authpanel),.lift,.stat2") : null;
      if (active && active !== el) reset(active);
      active = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      const rx = -y * 12, ry = x * 12;
      const ang = Math.hypot(rx, ry);
      el.style.rotate = ang < 0.01 ? "" : `${rx} ${ry} 0 ${ang}deg`;
      el.style.setProperty("--mx", (x + 0.5) * 100 + "%");
      el.style.setProperty("--my", (y + 0.5) * 100 + "%");
    };
    const onLeave = () => { reset(active); active = null; mx = 0; my = 0; kick(); };
    const onScroll = () => root.style.setProperty("--sy", String(window.scrollY));

    if (fine) {
      document.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("mouseleave", onLeave);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      reset(active);
      root.style.setProperty("--px", "0");
      root.style.setProperty("--py", "0");
    };
  }, [off]);

  if (off) return null;
  // The immersive background is rendered by AmbientBackground; this component only handles card tilt and pointer parallax.
  return null;
}