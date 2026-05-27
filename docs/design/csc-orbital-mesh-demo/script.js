const STATES = [
  { key: "startup", label: "BOOT", symbol: "◎", color: "#65D7FF" },
  { key: "idle", label: "IDLE", symbol: "◌", color: "#65D7FF" },
  { key: "work", label: "WORK", symbol: "◉", color: "#9B8CFF" },
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
  work: {
    name: "Active Execution",
    summary: "CSC is running tools and streaming progress through the current turn.",
    meta: "executing · turn 3 · Read + StrReplace · 38% context used",
    dock: {
      prompt: "◉ Orbital execution in progress",
      actions: ["Pause", "View tools", "Esc×2 abort"],
    },
    rows: [
      ["task", "add work scene to orbital mesh demo", "active"],
      ["tool", "Read docs/design/csc-orbital-mesh-demo/script.js", "running"],
      ["tool", "StrReplace index.html · styles.css", "queued"],
      ["stream", "3.2k tokens · turn 3 of ~8", "live"],
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
