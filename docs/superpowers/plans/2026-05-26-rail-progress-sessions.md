# Rail Progress Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `Progress` and `Sessions` as simultaneous first-class sections in the right-side `ActivityRail`.

**Architecture:** Keep the existing data flow. `ActivityRail` already receives `topBarState`, which contains both `pipeline` and current session metadata. Replace the mode-switched header with two small render helpers that always render together when `topBarState` exists.

**Tech Stack:** Bun, TypeScript, React/Ink, `bun:test`, existing `renderToString()` test helper.

---

## File Structure

- Modify `src/components/activity-rail/ActivityRail.tsx`
  - Replace `RailHeader` with `ProgressSection` and `SessionsSection`.
  - Keep `PipelineRow`, glyph/color helpers, width truncation, and existing props.
- Modify `src/components/activity-rail/__tests__/ActivityRail.test.tsx`
  - Update assertions that encode the old mutual exclusion behavior.
  - Add active/idle coverage for simultaneous `Progress` and `Sessions`.
- Keep `src/utils/topBar.ts` unchanged.
  - It already provides `pipeline`, `sessionTitle`, and `branch`.
- Keep `src/utils/activityRail.ts` unchanged.
  - This task does not add `ActivityRailState.sessions`.

---

### Task 1: Lock Desired Rail Rendering With Tests

**Files:**
- Modify: `src/components/activity-rail/__tests__/ActivityRail.test.tsx`

- [ ] **Step 1: Update the idle top-bar test to expect both sections**

Replace the existing `renders project information in the rail header` test with:

```tsx
  test('renders idle progress and sessions sections together', async () => {
    const out = await renderToString(<ActivityRail state={state} width={34} topBarState={topBarState} />);

    expect(out).toContain('Progress');
    expect(out).toContain('✓ Context');
    expect(out).toContain('◷ Changes');
    expect(out).toContain('○ Verify');
    expect(out).toContain('Sessions');
    expect(out).toContain('Fix login timeout');
    expect(out).toContain('docs/csc-ui-redesign');
    expect(out).not.toContain('CoStrict v4.0.13');
    expect(out).toContain('Change Set');
  });
```

- [ ] **Step 2: Update the active top-bar test to expect both sections**

Replace the existing `renders active pipeline information in the rail header` test with:

```tsx
  test('renders active progress and sessions sections together', async () => {
    const out = await renderToString(
      <ActivityRail
        state={state}
        width={34}
        topBarState={{ ...topBarState, mode: 'active' }}
        charset="unicode"
      />,
    );

    expect(out).toContain('Progress');
    expect(out).toContain('✓ Context');
    expect(out).toContain('◷ Changes');
    expect(out).toContain('○ Verify');
    expect(out).toContain('src/login.ts');
    expect(out).toContain('Sessions');
    expect(out).toContain('Fix login timeout');
    expect(out).toContain('docs/csc-ui-redesign');
    expect(out).not.toContain('CoStrict v4.0.13');
  });
```

- [ ] **Step 3: Update tests that still expect the singular old header label**

In this file, replace assertions for the old label:

```tsx
expect(out).toContain('Session');
```

with:

```tsx
expect(out).toContain('Sessions');
```

Only do this for tests where `topBarState` is provided and the rail should show current session metadata. Keep negative assertions conceptually equivalent:

```tsx
expect(out).not.toContain('Sessions');
```

- [ ] **Step 4: Run the focused test and verify failure**

Run:

```bash
bun test src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected before implementation: FAIL. The failure should show missing `Sessions` in active rail rendering or mismatched old `Session` expectations.

---

### Task 2: Render Progress And Sessions As Separate Sections

**Files:**
- Modify: `src/components/activity-rail/ActivityRail.tsx`

- [ ] **Step 1: Replace the mode-switched header with section helpers**

Remove the existing `RailHeader` function and add these two helpers in the same area:

```tsx
function ProgressSection({
  state,
  contentWidth,
  capabilities,
}: {
  state: TopBarState;
  contentWidth: number;
  capabilities: TerminalCapabilities;
}): React.ReactNode {
  return (
    <Section title="Progress">
      {state.pipeline.map(phase => (
        <PipelineRow key={phase.id} phase={phase} contentWidth={contentWidth} capabilities={capabilities} />
      ))}
    </Section>
  );
}

function SessionsSection({
  state,
  contentWidth,
}: {
  state: TopBarState;
  contentWidth: number;
}): React.ReactNode {
  return (
    <Section title="Sessions">
      <Box width={contentWidth}>
        <Text wrap="truncate-end">{state.sessionTitle}</Text>
      </Box>
      <Box width={contentWidth}>
        <Text dimColor wrap="truncate-end">
          {state.branch}
        </Text>
      </Box>
    </Section>
  );
}
```

- [ ] **Step 2: Render both helpers when `topBarState` exists**

Replace the current `RailHeader` render block:

```tsx
      {topBarState !== undefined && (
        <RailHeader state={topBarState} contentWidth={contentWidth} capabilities={capabilities} />
      )}
```

with:

```tsx
      {topBarState !== undefined && (
        <>
          <ProgressSection state={topBarState} contentWidth={contentWidth} capabilities={capabilities} />
          <SessionsSection state={topBarState} contentWidth={contentWidth} />
        </>
      )}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
bun test src/components/activity-rail/__tests__/ActivityRail.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add src/components/activity-rail/ActivityRail.tsx src/components/activity-rail/__tests__/ActivityRail.test.tsx docs/superpowers/plans/2026-05-26-rail-progress-sessions.md
git commit -m "fix: show rail progress and sessions together"
```

---

## Self-Review

- Spec coverage: The plan covers simultaneous `Progress` and `Sessions`, keeps existing data flow, preserves width/threshold behavior, and leaves multi-session data out of scope.
- Placeholder scan: No placeholder steps remain.
- Type consistency: Helper props use existing `TopBarState`, `TerminalCapabilities`, and `contentWidth` names from `ActivityRail.tsx`.
