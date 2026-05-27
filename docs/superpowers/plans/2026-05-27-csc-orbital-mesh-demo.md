# CSC Orbital Mesh Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static browser demo for the CSC Orbital Mesh terminal CLI UI, showing startup, idle, permission checkpoint, complete, and blocked states.

**Architecture:** The demo is a dependency-free static page under `docs/design/csc-orbital-mesh-demo/`. `index.html` owns semantic content, `styles.css` owns the Orbital Mesh visual system and responsive layout, and `script.js` owns only scene switching and thumbnail synchronization.

**Tech Stack:** HTML5, CSS custom properties, vanilla JavaScript, browser static file loading.

---

## File Structure

- Create: `docs/design/csc-orbital-mesh-demo/index.html`
  - Defines page structure, hero terminal, scene switcher, scenario grid, and design-system summary.
  - Loads `styles.css` and `script.js`.
- Create: `docs/design/csc-orbital-mesh-demo/styles.css`
  - Defines Orbital Mesh color tokens, terminal vessel layout, state rail, beacon styling, responsive rules, and low-cost CSS motion.
- Create: `docs/design/csc-orbital-mesh-demo/script.js`
  - Stores the five scene data objects.
  - Renders the active hero terminal state.
  - Keeps scene buttons and scenario cards in sync.
- Modify: no production source files.
- Test manually in browser and with lightweight command checks.

## Task 1: Create Static Demo Shell

**Files:**
- Create: `docs/design/csc-orbital-mesh-demo/index.html`

- [ ] **Step 1: Create the demo directory**

Run:

```powershell
New-Item -ItemType Directory -Force docs\design\csc-orbital-mesh-demo
```

Expected: PowerShell reports the directory exists or was created.

- [ ] **Step 2: Add the initial HTML shell**

Create `docs/design/csc-orbital-mesh-demo/index.html` with exactly this content:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CSC Orbital Mesh CLI UI Demo</title>
    <meta
      name="description"
      content="CSC Orbital Mesh terminal CLI UI demo across startup, idle, permission, complete, and blocked states."
    />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="page-shell">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero-copy">
          <p class="eyebrow">CSC Terminal CLI UI</p>
          <h1 id="page-title">Orbital Mesh / 轨道网格舱</h1>
          <p class="hero-lede">
            A high-contrast command vessel for controlled AI coding work:
            clear state, fast checkpoints, and recoverable outcomes.
          </p>
          <div class="hero-actions" aria-label="Scene switcher">
            <button class="scene-button is-active" type="button" data-scene="startup">Boot</button>
            <button class="scene-button" type="button" data-scene="idle">Idle</button>
            <button class="scene-button" type="button" data-scene="permission">Checkpoint</button>
            <button class="scene-button" type="button" data-scene="complete">Complete</button>
            <button class="scene-button" type="button" data-scene="blocked">Blocked</button>
          </div>
        </div>

        <section class="terminal-vessel hero-terminal" aria-label="CSC Orbital Mesh terminal preview">
          <div class="terminal-topline">
            <div>
              <span class="terminal-brand">CSC // ORBITAL MESH</span>
              <span class="terminal-version">v2.1.888</span>
            </div>
            <div class="terminal-meta" id="hero-meta">workspace D:\code\csc</div>
          </div>

          <div class="status-rail" id="hero-rail" aria-label="Workflow status rail"></div>
          <div class="scanline" aria-hidden="true"></div>

          <div class="terminal-body" id="hero-terminal-body"></div>
          <div class="terminal-dock" id="hero-terminal-dock"></div>
        </section>
      </section>

      <section class="scenario-section" aria-labelledby="scenario-title">
        <div class="section-heading">
          <p class="eyebrow">Five Required CLI States</p>
          <h2 id="scenario-title">State language for real terminal work</h2>
          <p>
            Each state answers the user's practical questions: where am I, what
            is CSC doing, what can I do, and what happens next.
          </p>
        </div>
        <div class="scenario-grid" id="scenario-grid"></div>
      </section>

      <section class="system-section" aria-labelledby="system-title">
        <div class="section-heading">
          <p class="eyebrow">Design System Summary</p>
          <h2 id="system-title">Memorable, useful, and cheap to ship</h2>
        </div>

        <div class="system-grid">
          <article class="system-card">
            <h3>Color Tokens</h3>
            <ul>
              <li><span class="swatch swatch-bg"></span><code>#070713</code> orbit background</li>
              <li><span class="swatch swatch-blue"></span><code>#65D7FF</code> idle and navigation</li>
              <li><span class="swatch swatch-yellow"></span><code>#FFDF5D</code> human checkpoint</li>
              <li><span class="swatch swatch-green"></span><code>#6CF2B8</code> docked complete</li>
              <li><span class="swatch swatch-rose"></span><code>#FF5D8F</code> drift blocked</li>
            </ul>
          </article>

          <article class="system-card">
            <h3>Beacon Symbols</h3>
            <dl class="symbol-list">
              <div><dt>◎</dt><dd>Boot alignment</dd></div>
              <div><dt>◌</dt><dd>Standby orbit</dd></div>
              <div><dt>◍</dt><dd>Human checkpoint</dd></div>
              <div><dt>◆</dt><dd>Docked complete</dd></div>
              <div><dt>◇!</dt><dd>Drift blocked</dd></div>
            </dl>
          </article>

          <article class="system-card">
            <h3>Implementation Boundary</h3>
            <p>
              Static HTML, CSS, and minimal JavaScript only. No build step, no
              WebGL, no canvas, no runtime integration, and no changes to the
              existing CLI.
            </p>
          </article>
        </div>
      </section>
    </main>

    <script src="./script.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Verify the shell references expected assets**

Run:

```powershell
Select-String -Path docs\design\csc-orbital-mesh-demo\index.html -Pattern "styles.css","script.js","scenario-grid","hero-terminal-body"
```

Expected: all four patterns are found.

- [ ] **Step 4: Commit the HTML shell**

Run:

```powershell
git add docs/design/csc-orbital-mesh-demo/index.html
git commit -m "docs: add CSC orbital mesh demo shell"
```

Expected: commit succeeds with one new file.

## Task 2: Add Orbital Mesh Visual System

**Files:**
- Create: `docs/design/csc-orbital-mesh-demo/styles.css`

- [ ] **Step 1: Add the CSS visual system**

Create `docs/design/csc-orbital-mesh-demo/styles.css` with exactly this content:

```css
:root {
  color-scheme: dark;
  --orbit-bg: #070713;
  --orbit-bg-2: #0b0b1a;
  --orbit-panel: #10101d;
  --orbit-panel-raised: #17172a;
  --orbit-text: #d7c8ff;
  --orbit-muted: #8b82b8;
  --orbit-line: rgba(215, 200, 255, 0.18);
  --orbit-blue: #65d7ff;
  --checkpoint-yellow: #ffdf5d;
  --dock-green: #6cf2b8;
  --drift-rose: #ff5d8f;
  --shadow: rgba(0, 0, 0, 0.38);
  --mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--orbit-bg);
}

body {
  margin: 0;
  min-width: 320px;
  color: var(--orbit-text);
  font-family: var(--sans);
  background:
    radial-gradient(circle at 12% 8%, rgba(101, 215, 255, 0.16), transparent 28rem),
    radial-gradient(circle at 88% 4%, rgba(255, 93, 143, 0.12), transparent 25rem),
    linear-gradient(180deg, #070713 0%, #0a0a16 48%, #070713 100%);
}

button {
  font: inherit;
}

.page-shell {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 28px 0 48px;
}

.hero {
  min-height: 92vh;
  display: grid;
  grid-template-columns: minmax(280px, 0.82fr) minmax(520px, 1.18fr);
  align-items: center;
  gap: 34px;
}

.hero-copy {
  padding: 24px 0;
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--orbit-blue);
  font-family: var(--mono);
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  overflow-wrap: anywhere;
}

h1 {
  margin: 0;
  max-width: 10ch;
  font-size: clamp(3.1rem, 8vw, 6.8rem);
  line-height: 0.88;
  letter-spacing: 0;
}

h2 {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 3.4rem);
  line-height: 1;
  letter-spacing: 0;
}

h3 {
  margin: 0 0 12px;
  font-size: 1rem;
  letter-spacing: 0;
}

.hero-lede {
  max-width: 48ch;
  margin: 24px 0 0;
  color: var(--orbit-muted);
  font-size: 1rem;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 28px;
}

.scene-button {
  min-height: 34px;
  border: 1px solid var(--orbit-line);
  border-radius: 6px;
  padding: 7px 10px;
  color: var(--orbit-text);
  background: rgba(16, 16, 29, 0.74);
  cursor: pointer;
}

.scene-button:hover,
.scene-button:focus-visible,
.scene-button.is-active {
  border-color: var(--scene-color, var(--orbit-blue));
  color: var(--scene-color, var(--orbit-blue));
  outline: none;
}

.terminal-vessel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--orbit-line);
  border-radius: 10px;
  background:
    linear-gradient(rgba(101, 215, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(101, 215, 255, 0.035) 1px, transparent 1px),
    var(--orbit-panel);
  background-size: 26px 26px;
  box-shadow: 0 30px 70px var(--shadow), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.hero-terminal {
  min-height: 610px;
  padding: 18px;
}

.terminal-topline {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--orbit-line);
  font-family: var(--mono);
  font-size: 0.78rem;
}

.terminal-brand {
  color: var(--orbit-text);
  font-weight: 800;
  letter-spacing: 0.08em;
}

.terminal-version,
.terminal-meta {
  color: var(--orbit-muted);
}

.status-rail {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0 10px;
  font-family: var(--mono);
  font-size: 0.72rem;
}

.rail-node {
  position: relative;
  min-height: 42px;
  border: 1px solid var(--orbit-line);
  border-radius: 6px;
  padding: 8px;
  color: var(--orbit-muted);
  background: rgba(7, 7, 19, 0.62);
}

.rail-node.is-active {
  border-color: var(--scene-color);
  color: var(--scene-color);
  box-shadow: 0 0 22px rgba(101, 215, 255, 0.16);
}

.rail-beacon {
  display: inline-block;
  margin-right: 5px;
  animation: beacon-pulse 2.4s ease-in-out infinite;
}

.scanline {
  height: 3px;
  margin: 12px 0 18px;
  background: linear-gradient(90deg, transparent, var(--scene-color, var(--orbit-blue)), transparent);
  opacity: 0.78;
  animation: scan 3s ease-in-out infinite;
}

.terminal-body {
  min-height: 338px;
  font-family: var(--mono);
  font-size: 0.88rem;
  line-height: 1.6;
}

.scene-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.scene-beacon {
  color: var(--scene-color);
  font-size: 1.35rem;
}

.scene-title h3 {
  margin: 0;
  font-family: var(--mono);
  font-size: 1rem;
  text-transform: uppercase;
}

.scene-title p {
  margin: 2px 0 0;
  color: var(--orbit-muted);
}

.event-list {
  display: grid;
  gap: 8px;
}

.event-row,
.summary-row {
  display: grid;
  grid-template-columns: 9ch 1fr auto;
  gap: 12px;
  align-items: baseline;
  padding: 8px 10px;
  border: 1px solid rgba(215, 200, 255, 0.1);
  border-radius: 6px;
  background: rgba(7, 7, 19, 0.45);
}

.event-label {
  color: var(--scene-color);
}

.event-detail {
  color: var(--orbit-text);
}

.event-meta {
  color: var(--orbit-muted);
}

.checkpoint-panel,
.outcome-panel {
  border: 1px solid var(--scene-color);
  border-radius: 8px;
  padding: 14px;
  background: color-mix(in srgb, var(--scene-color) 10%, transparent);
}

.checkpoint-grid {
  display: grid;
  grid-template-columns: 12ch 1fr;
  gap: 8px 14px;
}

.checkpoint-grid dt {
  color: var(--orbit-muted);
}

.checkpoint-grid dd {
  margin: 0;
}

.terminal-dock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--orbit-line);
  font-family: var(--mono);
}

.dock-prompt {
  flex: 1 1 220px;
  min-width: 0;
  color: var(--orbit-muted);
}

.dock-action {
  border: 1px solid var(--scene-color);
  border-radius: 6px;
  padding: 6px 9px;
  color: var(--scene-color);
  background: rgba(7, 7, 19, 0.68);
}

.scenario-section,
.system-section {
  padding: 56px 0 0;
}

.section-heading {
  max-width: 760px;
  margin-bottom: 22px;
}

.section-heading p:not(.eyebrow) {
  color: var(--orbit-muted);
  line-height: 1.7;
}

.scenario-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(180px, 1fr));
  gap: 14px;
}

.scenario-card {
  min-height: 230px;
  padding: 14px;
  cursor: pointer;
}

.scenario-card.is-active {
  border-color: var(--scene-color);
}

.scenario-card .status-rail {
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  margin: 10px 0;
}

.scenario-card .rail-node {
  min-height: 8px;
  padding: 0;
  border-radius: 999px;
  font-size: 0;
}

.scenario-card h3 {
  font-family: var(--mono);
  color: var(--scene-color);
}

.scenario-card p {
  margin: 8px 0 0;
  color: var(--orbit-muted);
  font-size: 0.86rem;
  line-height: 1.55;
}

.system-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.system-card {
  border: 1px solid var(--orbit-line);
  border-radius: 10px;
  padding: 18px;
  background: rgba(16, 16, 29, 0.82);
}

.system-card ul {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.system-card p,
.system-card li,
.symbol-list dd {
  color: var(--orbit-muted);
  line-height: 1.65;
}

.swatch {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 3px;
  vertical-align: -0.1rem;
}

.swatch-bg {
  background: var(--orbit-bg);
}

.swatch-blue {
  background: var(--orbit-blue);
}

.swatch-yellow {
  background: var(--checkpoint-yellow);
}

.swatch-green {
  background: var(--dock-green);
}

.swatch-rose {
  background: var(--drift-rose);
}

.symbol-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.symbol-list div {
  display: grid;
  grid-template-columns: 3ch 1fr;
  gap: 10px;
}

.symbol-list dt {
  color: var(--orbit-blue);
  font-family: var(--mono);
}

.symbol-list dd {
  margin: 0;
}

@keyframes scan {
  0%,
  100% {
    opacity: 0.25;
    transform: translateX(-8%);
  }
  50% {
    opacity: 0.85;
    transform: translateX(8%);
  }
}

@keyframes beacon-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (max-width: 1040px) {
  .hero {
    min-height: auto;
    grid-template-columns: 1fr;
    padding-top: 28px;
  }

  h1 {
    max-width: 12ch;
  }

  .scenario-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .system-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .page-shell {
    width: min(100% - 20px, 1180px);
    padding-top: 12px;
  }

  .hero-terminal {
    min-height: 0;
    padding: 12px;
  }

  .terminal-topline,
  .event-row,
  .summary-row {
    grid-template-columns: 1fr;
  }

  .terminal-topline {
    display: grid;
  }

  .status-rail {
    grid-template-columns: 1fr;
  }

  .rail-node {
    min-height: 34px;
  }

  .scenario-grid {
    grid-template-columns: 1fr;
  }

  .checkpoint-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Verify CSS contains the required visual tokens**

Run:

```powershell
Select-String -Path docs\design\csc-orbital-mesh-demo\styles.css -Pattern "#070713","#65D7FF","#FFDF5D","#6CF2B8","#FF5D8F"
```

Expected: each color token is found.

- [ ] **Step 3: Commit the CSS visual system**

Run:

```powershell
git add docs/design/csc-orbital-mesh-demo/styles.css
git commit -m "docs: add CSC orbital mesh demo styling"
```

Expected: commit succeeds with one new file.

## Task 3: Implement Scene Data and Rendering

**Files:**
- Create: `docs/design/csc-orbital-mesh-demo/script.js`

- [ ] **Step 1: Add the JavaScript renderer**

Create `docs/design/csc-orbital-mesh-demo/script.js` with exactly this content:

```js
const STATES = [
  { key: "startup", label: "BOOT", symbol: "◎", color: "#65D7FF" },
  { key: "idle", label: "IDLE", symbol: "◌", color: "#65D7FF" },
  { key: "permission", label: "CHECKPOINT", symbol: "◍", color: "#FFDF5D" },
  { key: "complete", label: "COMPLETE", symbol: "◆", color: "#6CF2B8" },
  { key: "blocked", label: "BLOCKED", symbol: "◇!", color: "#FF5D8F" },
];

const SCENES = {
  startup: {
    name: "Boot Alignment",
    summary: "Aligning workspace, tools, and execution lanes before the first instruction.",
    meta: "workspace D:\\code\\csc · permissions default · model sonnet",
    dock: {
      prompt: "∴ Startup checks are being aligned",
      actions: ["Open config", "View diagnostics"],
    },
    rows: [
      ["config", "settings and feature flags loaded", "42ms"],
      ["index", "project file map warmed", "184ms"],
      ["mcp", "3 channels checked", "211ms"],
      ["tools", "tool pool ready for permission mode", "33ms"],
    ],
  },
  idle: {
    name: "Standby Orbit",
    summary: "Ready for the next instruction without filling the screen with tutorial noise.",
    meta: "workspace D:\\code\\csc · context 61% free · git 2 changed",
    dock: {
      prompt: "> Inject instruction...",
      actions: ["/model", "/permissions", "/status"],
    },
    rows: [
      ["model", "sonnet lane active", "ready"],
      ["context", "128k window · 61% free", "stable"],
      ["project", "D:\\code\\csc", "indexed"],
      ["shortcuts", "type / for command orbit", "armed"],
    ],
  },
  permission: {
    name: "Human Checkpoint",
    summary: "CSC is paused at a user decision point before a meaningful action runs.",
    meta: "checkpoint pending · PowerShellTool · network boundary",
    dock: {
      prompt: "◍ Awaiting human checkpoint",
      actions: ["Allow once", "Allow session", "Inspect", "Deny"],
    },
    checkpoint: {
      action: "PowerShell wants network access",
      target: "api.github.com",
      reason: "Fetch release metadata for version comparison",
      risk: "External network request; no file writes",
    },
  },
  complete: {
    name: "Docked Complete",
    summary: "Work has landed with a compact result summary and useful next actions.",
    meta: "session docked · 3 files changed · checks passed",
    dock: {
      prompt: "◆ Outcome docked",
      actions: ["Review diff", "Run tests", "New task"],
    },
    rows: [
      ["summary", "Orbital Mesh spec added", "done"],
      ["files", "1 design spec created", "clean"],
      ["checks", "markdown structure verified", "passed"],
      ["time", "elapsed 6m 18s", "logged"],
    ],
  },
  blocked: {
    name: "Drift Blocked",
    summary: "A blocked state shows the reason, last safe point, and recovery route.",
    meta: "blocked · missing token · recoverable",
    dock: {
      prompt: "◇! Recovery route required",
      actions: ["Add token", "Retry check", "Open docs"],
    },
    rows: [
      ["reason", "Blocked by missing token", "required"],
      ["last-ok", "workspace and tools initialized", "safe"],
      ["tried", "checked config and environment", "complete"],
      ["next", "set API token, then retry auth", "action"],
    ],
  },
};

const heroRail = document.querySelector("#hero-rail");
const heroBody = document.querySelector("#hero-terminal-body");
const heroDock = document.querySelector("#hero-terminal-dock");
const heroMeta = document.querySelector("#hero-meta");
const scenarioGrid = document.querySelector("#scenario-grid");
const sceneButtons = Array.from(document.querySelectorAll(".scene-button"));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getState(sceneKey) {
  return STATES.find((state) => state.key === sceneKey) ?? STATES[0];
}

function renderRail(activeKey, compact = false) {
  return STATES.map((state) => {
    const isActive = state.key === activeKey;
    const label = compact ? "" : `<span class="rail-beacon">${state.symbol}</span>${state.label}`;
    return `<div class="rail-node${isActive ? " is-active" : ""}" style="--scene-color: ${state.color}">${label}</div>`;
  }).join("");
}

function renderRows(scene) {
  if (scene.checkpoint) {
    const checkpoint = scene.checkpoint;
    return `
      <div class="checkpoint-panel">
        <dl class="checkpoint-grid">
          <dt>Action</dt><dd>${escapeHtml(checkpoint.action)}</dd>
          <dt>Target</dt><dd>${escapeHtml(checkpoint.target)}</dd>
          <dt>Reason</dt><dd>${escapeHtml(checkpoint.reason)}</dd>
          <dt>Risk signal</dt><dd>${escapeHtml(checkpoint.risk)}</dd>
        </dl>
      </div>
    `;
  }

  return `
    <div class="event-list">
      ${scene.rows
        .map(
          ([label, detail, meta]) => `
            <div class="event-row">
              <span class="event-label">${escapeHtml(label)}</span>
              <span class="event-detail">${escapeHtml(detail)}</span>
              <span class="event-meta">${escapeHtml(meta)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderHero(sceneKey) {
  const scene = SCENES[sceneKey] ?? SCENES.startup;
  const state = getState(sceneKey);

  document.documentElement.style.setProperty("--scene-color", state.color);
  heroMeta.textContent = scene.meta;
  heroRail.innerHTML = renderRail(sceneKey);
  heroBody.innerHTML = `
    <div class="scene-title">
      <span class="scene-beacon">${state.symbol}</span>
      <div>
        <h3>${escapeHtml(scene.name)}</h3>
        <p>${escapeHtml(scene.summary)}</p>
      </div>
    </div>
    ${renderRows(scene)}
  `;
  heroDock.innerHTML = `
    <div class="dock-prompt">${escapeHtml(scene.dock.prompt)}</div>
    ${scene.dock.actions.map((action) => `<span class="dock-action">${escapeHtml(action)}</span>`).join("")}
  `;

  sceneButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scene === sceneKey);
    button.style.setProperty("--scene-color", state.color);
  });

  document.querySelectorAll(".scenario-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.scene === sceneKey);
  });
}

function renderScenarioGrid() {
  scenarioGrid.innerHTML = STATES.map((state) => {
    const scene = SCENES[state.key];
    return `
      <article class="terminal-vessel scenario-card" data-scene="${state.key}" style="--scene-color: ${state.color}" tabindex="0">
        <h3>${state.symbol} ${escapeHtml(scene.name)}</h3>
        <div class="status-rail" aria-hidden="true">${renderRail(state.key, true)}</div>
        <p>${escapeHtml(scene.summary)}</p>
      </article>
    `;
  }).join("");

  document.querySelectorAll(".scenario-card").forEach((card) => {
    card.addEventListener("click", () => renderHero(card.dataset.scene));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        renderHero(card.dataset.scene);
      }
    });
  });
}

sceneButtons.forEach((button) => {
  button.addEventListener("click", () => renderHero(button.dataset.scene));
});

renderScenarioGrid();
renderHero("startup");
```

- [ ] **Step 2: Verify all five scene keys exist**

Run:

```powershell
Select-String -Path docs\design\csc-orbital-mesh-demo\script.js -Pattern "startup","idle","permission","complete","blocked"
```

Expected: all five scene keys are found.

- [ ] **Step 3: Commit the scene renderer**

Run:

```powershell
git add docs/design/csc-orbital-mesh-demo/script.js
git commit -m "docs: add CSC orbital mesh demo scenes"
```

Expected: commit succeeds with one new file.

## Task 4: Manual Browser Verification

**Files:**
- Inspect: `docs/design/csc-orbital-mesh-demo/index.html`
- Inspect: `docs/design/csc-orbital-mesh-demo/styles.css`
- Inspect: `docs/design/csc-orbital-mesh-demo/script.js`

- [ ] **Step 1: Open the demo directly in the browser**

Run:

```powershell
Start-Process (Resolve-Path docs\design\csc-orbital-mesh-demo\index.html)
```

Expected:

- The page opens without a build step.
- The first screen shows `CSC Orbital Mesh / 轨道网格舱`.
- The terminal preview shows the `Boot Alignment` state.

- [ ] **Step 2: Verify scene switching**

In the browser, click these controls in order:

```text
Boot
Idle
Checkpoint
Complete
Blocked
```

Expected:

- The hero terminal title changes for each state.
- The active status rail node changes for each state.
- The dock actions change for each state.
- The active scenario card changes for each state.

- [ ] **Step 3: Verify required state content**

Confirm these exact visible labels are present across the page:

```text
Boot Alignment
Standby Orbit
Human Checkpoint
Docked Complete
Drift Blocked
Allow once
Allow session
Inspect
Deny
Review diff
Run tests
New task
```

Expected: all labels are visible in the correct scene or scenario card.

- [ ] **Step 4: Verify mobile layout**

Resize the browser to approximately 390px wide.

Expected:

- No text overlaps.
- The status rail stacks vertically in the hero terminal.
- Scenario cards become one column.
- Dock actions wrap instead of overflowing.

- [ ] **Step 5: Commit any verification fixes**

If verification required CSS or JS edits, commit them:

```powershell
git add docs/design/csc-orbital-mesh-demo
git commit -m "fix: polish CSC orbital mesh demo layout"
```

Expected: commit succeeds only if fixes were made. If no fixes were needed, skip this step.

## Task 5: Final Static Checks and Summary

**Files:**
- Inspect: `docs/design/csc-orbital-mesh-demo/index.html`
- Inspect: `docs/design/csc-orbital-mesh-demo/styles.css`
- Inspect: `docs/design/csc-orbital-mesh-demo/script.js`

- [ ] **Step 1: Confirm no external dependencies are used**

Run:

```powershell
Select-String -Path docs\design\csc-orbital-mesh-demo\* -Pattern "https://","http://","node_modules","cdn","import "
```

Expected: no output. The relative `./styles.css` and `./script.js` references are allowed and should not appear in this command.

- [ ] **Step 2: Confirm acceptance-critical labels exist**

Run:

```powershell
Select-String -Path docs\design\csc-orbital-mesh-demo\* -Pattern "Orbital Mesh","Human Checkpoint","Boot Alignment","Standby Orbit","Docked Complete","Drift Blocked"
```

Expected: every acceptance-critical label is found at least once.

- [ ] **Step 3: Review git diff**

Run:

```powershell
git diff --stat HEAD
git status --short
```

Expected:

- Only `docs/design/csc-orbital-mesh-demo/` files are modified or untracked.
- `.superpowers/` may remain untracked from brainstorming, but it must not be committed.

- [ ] **Step 4: Commit final demo if needed**

If Task 4 did not already commit all changes, run:

```powershell
git add docs/design/csc-orbital-mesh-demo
git commit -m "docs: add CSC orbital mesh static demo"
```

Expected: commit succeeds. If there are no changes to commit, skip this step.

- [ ] **Step 5: Report completion**

Final response should include:

```text
Implemented the static CSC Orbital Mesh demo at docs/design/csc-orbital-mesh-demo/index.html.
Verified direct browser opening, five scene switches, required labels, mobile wrapping, and no external dependencies.
```

If any verification step could not be performed, state exactly which step was skipped and why.

