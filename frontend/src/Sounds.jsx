import { useEffect, useRef, useState } from "react";

/*
  Sound effects, made live in the browser (no audio files needed).
  It only LISTENS to clicks, typing and what appears on screen.
  It never changes app data, API calls or proctoring logic.
  Use the round speaker button (bottom-left) to mute everything.
*/

// Master volume: raise this number for louder sounds, lower it for quieter ones.
const LOUD = 10.5;

export default function Sounds() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem("sound") !== "off"; } catch { return true; }
  });
  const onRef = useRef(on);
  onRef.current = on;
  const ctxRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("sound", on ? "on" : "off"); } catch { /* ignore */ }
  }, [on]);

  useEffect(() => {
    const ctx = () => {
      if (!ctxRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctxRef.current = new AC();
      }
      if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
      return ctxRef.current;
    };

    const tone = (freq, start, dur, type = "sine", vol = 0.05, endFreq) => {
      const c = ctx();
      if (!c) return;
      const t = c.currentTime + start;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.min(0.9, vol * LOUD), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    };

    // The sound library
    const S = {
      key: () => tone(1100 + Math.random() * 500, 0, 0.035, "triangle", 0.035),
      back: () => tone(700, 0, 0.04, "triangle", 0.03),
      enter: () => tone(500, 0, 0.08, "sine", 0.05),
      tap: () => tone(600, 0, 0.07, "triangle", 0.045, 420),          // normal buttons
      tick: () => tone(900, 0, 0.03, "triangle", 0.03),                // light buttons
      thud: () => tone(170, 0, 0.16, "sine", 0.09, 80),                // danger buttons
      blip: () => { tone(700, 0, 0.05, "sine", 0.04); tone(1000, 0.045, 0.06, "sine", 0.04); }, // menus, tabs
      swoosh: () => tone(300, 0, 0.28, "sine", 0.04, 950),             // light/dark toggle
      heartOn: () => { tone(660, 0, 0.07, "sine", 0.05); tone(880, 0.06, 0.12, "sine", 0.05); },
      heartOff: () => tone(500, 0, 0.1, "sine", 0.03, 330),
      bell: () => { tone(1200, 0, 0.32, "sine", 0.04); tone(1600, 0.09, 0.36, "sine", 0.03); },
      ding: () => { tone(1320, 0, 0.26, "sine", 0.05); tone(1760, 0.12, 0.34, "sine", 0.04); },
      drop: () => tone(230, 0, 0.12, "sine", 0.08, 140),
      open: () => tone(260, 0, 0.22, "sine", 0.035, 720),
      close: () => tone(720, 0, 0.2, "sine", 0.03, 260),
      warn: () => [0, 0.24, 0.48].forEach(t => tone(880, t, 0.2, "square", 0.12, 620)),
      err: () => tone(260, 0, 0.2, "sawtooth", 0.04, 170),
      ok: () => { tone(660, 0, 0.12, "sine", 0.05); tone(990, 0.1, 0.2, "sine", 0.05); },
      // Candidate selected: bright rising fanfare
      selected: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, i === 3 ? 0.5 : 0.16, "triangle", 0.06)),
      // Candidate rejected: soft falling "womp"
      rejected: () => { tone(330, 0, 0.2, "triangle", 0.07, 250); tone(262, 0.2, 0.36, "triangle", 0.07, 170); },
    };

    const last = {};
    let lastBig = 0;
    const play = (kind, gap = 0) => {
      if (!onRef.current) return;
      const now = performance.now();
      if (last[kind] && now - last[kind] < gap) return;
      last[kind] = now;
      try { S[kind] && S[kind](); } catch { /* sound must never break the app */ }
    };
    const big = kind => { lastBig = performance.now(); play(kind, 0); };
    const quiet = () => performance.now() - lastBig < 1200; // skip small tones right after selected/rejected

    // ---- typing ----
    const onKey = e => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (!t || !t.tagName) return;
      const type = (t.type || "").toLowerCase();
      const typing =
        t.tagName === "TEXTAREA" ||
        (t.tagName === "INPUT" && !["checkbox", "radio", "file", "button", "submit", "range", "color"].includes(type));
      if (!typing) return;
      if (e.key === "Backspace" || e.key === "Delete") play("back", 30);
      else if (e.key === "Enter") play("enter", 30);
      else if (e.key && e.key.length === 1) play("key", 30);
    };

    // ---- clicks ----
    const onClick = e => {
      if (!onRef.current) return;
      const t = e.target;
      if (!t || !t.closest || t.closest("[data-snd]")) return;
      // During a proctored test stay almost silent: only answer ticks and the warning button.
      if (document.querySelector('video[aria-label="Your camera preview"]')) {
        if (t.closest(".opt")) play("tick", 40);
        else if (t.closest(".proctor-warning-dismiss")) play("tap", 40);
        return;
      }
      const b = t.closest("button,a,[role=tab]");
      if (!b || b.disabled || b.closest(".qdots")) return;
      if (b.classList.contains("heart")) return play(b.getAttribute("aria-pressed") === "true" ? "heartOff" : "heartOn", 40);
      if (b.classList.contains("themebtn")) {
        if (b.closest(".bellwrap")) return play(b.getAttribute("aria-expanded") === "true" ? "tick" : "bell", 40);
        if ((b.getAttribute("aria-label") || "").includes("mode")) return play("swoosh", 40);
        return play("tick", 40);
      }
      if (b.matches(".roles button,[role=tab],a")) return play("blip", 40);
      if (b.classList.contains("danger")) return play("thud", 40);
      if (b.classList.contains("ghost") || b.classList.contains("linkbtn")) return play("tick", 40);
      play("tap", 40);
    };

    // Recruiter changes a status in the dropdown
    const onChange = e => {
      const t = e.target;
      if (t && t.tagName === "SELECT" && t.getAttribute("aria-label") === "Status") {
        if (t.value === "Selected") big("selected");
        else if (t.value === "Rejected") big("rejected");
      }
    };
    // Pipeline board drag and drop
    const onDrag = e => { if (e.target.closest && e.target.closest(".kcard")) play("tick", 80); };
    const onDrop = e => { if (e.target.closest && e.target.closest(".col")) play("drop", 80); };

    const unlock = () => { if (onRef.current) ctx(); };

    // ---- things appearing on screen ----
    const pick = (n, sel) => (n.matches && n.matches(sel) ? n : n.querySelector ? n.querySelector(sel) : null);
    const mo = new MutationObserver(list => {
      if (!onRef.current) return;
      for (const m of list) {
        if (m.type === "characterData") {
          const p = m.target.parentElement;
          if (p && p.closest(".proctor-warning-popup")) { play("warn", 600); return; }
          continue;
        }
        for (const n of m.removedNodes) {
          if (n.nodeType === 1 && pick(n, ".modal")) { play("close", 300); return; }
        }
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (pick(n, ".proctor-warning-backdrop")) { play("warn", 600); return; }
          const err = pick(n, ".note.err");
          if (err) { if (/reject/i.test(err.textContent)) big("rejected"); else if (!quiet()) play("err", 500); return; }
          const ok = pick(n, ".note.ok");
          if (ok) {
            const s = ok.textContent;
            if (/moved to selected/i.test(s)) big("selected");
            else if (/moved to rejected/i.test(s)) big("rejected");
            else if (!quiet()) play("ok", 500);
            return;
          }
          const toast = pick(n, ".toast");
          if (toast) {
            const s = toast.textContent;
            if (/reject/i.test(s)) big("rejected");
            else if (/select|hired|offer/i.test(s)) big("selected");
            else play("ding", 800);
            return;
          }
          if (pick(n, ".modal")) { play("open", 300); return; }
          if (n.querySelectorAll) {
            for (const h of n.querySelectorAll("h2")) {
              if (h.textContent.trim() === "You passed!") { big("selected"); return; }
            }
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("dragstart", onDrag, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    return () => {
      mo.disconnect();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("dragstart", onDrag, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
  }, []);

  return (
    <button
      type="button"
      data-snd="toggle"
      className="themebtn"
      onClick={() => setOn(v => !v)}
      aria-pressed={on}
      aria-label={on ? "Mute sounds" : "Turn sounds on"}
      title={on ? "Sounds on" : "Sounds off"}
      style={{ position: "fixed", left: 16, bottom: 16, zIndex: 90 }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 20, height: 20 }}>
        <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
        {on ? (<><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>) : <path d="M16 9l5 6M21 9l-5 6" />}
      </svg>
    </button>
  );
}