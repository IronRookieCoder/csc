# CSC Orbital Mesh CLI UI Design

## Background

CSC needs a dedicated terminal CLI UI and UX direction that is distinct from
the current style, current competitors, and common AI chat templates. The first
deliverable is a browser-based static demo that presents the proposed terminal
style across five required states:

- startup
- idle
- working and waiting for permission
- complete
- blocked

The demo is intended for both internal review and external presentation. It
should be visually memorable, but the design must still serve CLI work: status
must be clear, decisions must be easy, and the implementation path must remain
low cost.

## Confirmed Direction

The selected direction is **CSC Orbital Mesh / 轨道网格舱**.

CSC is presented as a controllable task vessel rather than a generic chat
terminal. User input becomes instruction injection, assistant work becomes
orbital execution, permission prompts become human checkpoints, and terminal
outcomes become explicit docking or drift states.

The browser demo should use the **showcase design-system page** approach:

- a strong first-screen terminal preview for screenshots and external sharing
- a five-state scenario section for internal review
- a compact design-system section documenting tokens, symbols, states, motion,
  and feasibility

## Design Memory Points

### Orbital Status Rail

Every scene uses a compact status rail:

```text
BOOT -> IDLE -> CHECKPOINT -> COMPLETE -> BLOCKED
```

The active state is shown as a beacon. The rail gives users immediate answers
to where they are in the workflow and whether the system is running, paused, or
done.

### Beacon Symbol System

Use a small set of terminal-safe symbols:

| State | Primary | ANSI fallback | Meaning |
| --- | --- | --- | --- |
| Startup | `◎` | `*` | boot alignment |
| Idle | `◌` | `o` | standby orbit |
| Permission | `◍` | `@` | human checkpoint |
| Complete | `◆` | `#` | docked complete |
| Blocked | `◇!` | `!` | drift blocked |
| Track line | `┊` | `|` | secondary rail |
| User input | `>` | `>` | instruction |
| System inference | `∴` | `:` | derived status |

### Human Checkpoint Language

Permission prompts should be framed as **Human Checkpoint** states. This makes
the pause feel intentional and controlled rather than like a generic modal.
The checkpoint must show:

- what CSC wants to do
- why permission is needed
- what risk exists, if any
- what actions the user can take

## Page Architecture

The static demo should live in:

```text
docs/design/csc-orbital-mesh-demo/
```

Recommended files:

- `index.html`
- `styles.css`
- `script.js`

The page must work without Vite, build tooling, or new dependencies.

### First Screen

The first screen contains:

- product title: `CSC Orbital Mesh`
- short value line focused on controlled terminal work
- a large simulated terminal window
- state switcher for the five scenarios
- a hint of the scenario grid below the fold

The terminal preview is the main shareable screenshot surface.

### Scenario Grid

Below the hero, show all five states as compact terminal previews. This section
supports internal review by making the state language comparable in one view.

### Design System Summary

The final section documents:

- color tokens
- beacon symbols and ANSI fallbacks
- layout rules
- motion rules
- future Ink component mapping
- non-goals

## Scenario Specifications

### Startup: Boot Alignment

Purpose: make startup feel like environment alignment, not noisy logging.

Required information:

- CSC identity and version
- workspace path
- permission mode
- startup checks with short labels and durations

Example checks:

- config loaded
- project index warmed
- MCP channels checked
- tool pool ready

If a check fails, show one readable action hint rather than a stack trace.
The active rail state is `BOOT`, represented by `◎`.

### Idle: Standby Orbit

Purpose: reduce empty-screen uncertainty and show that CSC is ready.

Required information:

- quiet instruction input area
- current model
- context budget summary
- project status summary
- compact shortcut hints

The input placeholder should use command-language wording such as:

```text
Inject instruction...
```

The active rail state is `IDLE`, represented by `◌`. The visual treatment is
calm and low-contrast, with the orbital grid mostly in the background.

### Permission: Human Checkpoint

Purpose: make permission decisions fast and understandable.

Required information:

- requested action
- tool name
- target command, file, host, or path
- reason permission is needed
- risk signal when relevant
- available actions

Recommended actions:

- `Allow once`
- `Allow session`
- `Inspect`
- `Deny`

The active rail state is `CHECKPOINT`, represented by `◍`. The beacon color
switches to checkpoint yellow to make clear that the system is paused and
waiting for the user.

### Complete: Docked Complete

Purpose: confirm outcome and offer the next useful action.

Required information:

- concise completion summary
- changed file count
- test or verification status
- duration
- recommended next actions

Recommended actions:

- `Review diff`
- `Run tests`
- `New task`

The active rail state is `COMPLETE`, represented by `◆`. Use mint green as a
docking signal, not a full green success screen.

### Blocked: Drift Blocked

Purpose: turn failure into a recovery path.

Required information:

- specific blocked reason
- last successful step
- actions already attempted
- recommended recovery path

Examples:

- `Blocked by missing token`
- `Blocked by permission denial`
- `Blocked by network timeout`
- `Blocked by unresolved type error`

The active rail state is `BLOCKED`, represented by `◇!`. Use rose/magenta as a
boundary and beacon color, while keeping the main text readable.

## Visual Tokens

The selected high-contrast palette intentionally does not use current orange as
the primary color.

| Token | Value | Use |
| --- | --- | --- |
| `orbit-bg` | `#070713` | page and terminal base |
| `orbit-panel` | `#10101D` | primary terminal panels |
| `orbit-panel-raised` | `#17172A` | raised terminal surfaces |
| `orbit-text` | `#D7C8FF` | main terminal text |
| `orbit-muted` | `#8B82B8` | secondary terminal text |
| `orbit-blue` | `#65D7FF` | idle, navigation, secondary focus |
| `checkpoint-yellow` | `#FFDF5D` | permission and user decisions |
| `dock-green` | `#6CF2B8` | complete and safe continuation |
| `drift-rose` | `#FF5D8F` | blocked, denied, error |
| `orbit-line` | `rgba(215, 200, 255, 0.18)` | dividers and grid lines |

Color usage must remain semantic. Do not use all accent colors at once inside
a single small panel unless the content genuinely has multiple states.

## Layout Rules

Inside the simulated terminal, avoid generic card stacking. Use a three-layer
terminal vessel structure:

1. top rail: identity, status rail, workspace metadata
2. event stream: state-specific logs, summaries, or checkpoint details
3. action/input dock: command input or decision actions

The browser page may use cards around previews, but the terminal mock itself
should feel like one cohesive instrument panel.

## Motion Rules

Motion is intentionally low-cost:

- a slow scan line every 2-3 seconds
- a subtle pulse on the active beacon
- a short fade when switching scenes

Do not use WebGL, canvas, heavy particle effects, image dependencies, or
animations that are required for comprehension.

Ink implementation can later replace these with existing spinner and timer
patterns.

## Technical Scope

### In Scope

- one static browser demo page
- five switchable terminal states
- five state thumbnails or scenario previews
- responsive layout that does not break on mobile
- no build step
- no new package dependencies
- no changes to CLI runtime behavior

### Out of Scope

- real command execution
- live project status reads
- integration with Ink components
- theme picker integration
- WebGL/canvas effects
- product marketing site beyond the demo page
- replacing the existing CLI theme system

## Future Ink Mapping

If this design is later implemented in the real CLI, it can map to four small
components:

| Component | Responsibility | Existing capability |
| --- | --- | --- |
| `OrbitalStatusRail` | show current workflow state | Ink `Text`, `Box`, theme tokens |
| `BeaconText` | render state symbol and label | Ink `Text` |
| `CheckpointPanel` | permission checkpoint layout | existing permission dialog data |
| `OutcomeSummary` | complete and blocked summaries | existing message/status data |

These components should use existing theme infrastructure and semantic tokens.
The implementation must not require REPL architecture changes for the static
demo phase.

## Acceptance Criteria

1. Startup, idle, permission, complete, and blocked states are all visible on
   the same demo page, and the main preview can switch between them.
2. The first screen clearly shows the Orbital Mesh memory points: status rail,
   beacon symbols, and human checkpoint language.
3. Each state answers the user's practical questions: where am I, what is CSC
   doing, what can I do, and what happens next.
4. The demo uses only HTML, CSS, and minimal JavaScript.
5. The design can be mapped to Ink with `Text`, `Box`, theme tokens, and
   spinner/timer behavior.
6. The desktop screenshot has enough visual impact for external sharing.
7. Mobile layout remains readable with no overlapping or overflowing text.
8. No new runtime dependencies or CLI behavior changes are introduced.

## Non-Goals

- Do not make a generic AI chat interface.
- Do not directly reuse the existing orange-led visual style.
- Do not copy another terminal product's visual language.
- Do not sacrifice permission clarity for visual drama.
- Do not introduce a design that requires a complex rendering engine to land.

