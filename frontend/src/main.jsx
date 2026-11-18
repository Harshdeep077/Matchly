import { createRoot } from "react-dom/client";
try { document.documentElement.dataset.theme = localStorage.getItem("theme") === "light" ? "light" : "dark"; } catch {}
import App from "./App.jsx";
import Parallax from "./Parallax.jsx";
import Sounds from "./Sounds.jsx";
import AmbientBackground from "./AmbientBackground.jsx";

import "./index.css";
import "@livekit/components-styles";
import "./futuristic-motion.css";
import "./aurora-glass.css";
import "./parallax-3d.css";
import "./matchly-neon.css";

createRoot(document.getElementById("root")).render(
  <>
    <AmbientBackground />
    <App />
    <Parallax />
    <Sounds />
  </>
);