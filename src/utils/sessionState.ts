export type SessionState = 'idle' | 'running' | 'requires_action'

import { isProactiveActive } from '../proactive/index.js'

/**
 * Context carried with requires_action transitions so downstream
 * surfaces (CCR sidebar, push notifications) can show what the
 * session is blocked on, not just that it's blocked.
 *
 * Two delivery paths:
 * - tool_name + action_description → RequiresActionDetails proto
 *   (webhook payload, typed, logged in Datadog)
 * - full object → external_metadata.pending_action (queryable JSON
 *   on the Session, lets the frontend iterate on shape without
 *   proto round-trips)
 */
export type RequiresActionDetails = {
  tool_name: string
  /** Human-readable summary, e.g. "Editing src/foo.ts", "Running npm test" */
  action_description: string
  tool_use_id: string
  request_id: string
  /** Raw tool input — the frontend reads from external_metadata.pending_action.input
   * to parse question options / plan content without scanning the event stream. */
  input?: Record<string, unknown>
}

export type AutomationStatePhase = 'standby' | 'sleeping'

export type AutomationStateMetadata = {
  enabled: boolean
  phase: AutomationStatePhase | null
  next_tick_at: number | null
  sleep_until: number | null
}

import type { PermissionMode } from './permissions/PermissionMode.js'

// CCR external_metadata keys — push in onChangeAppState, restore in
// externalMetadataToAppState.
export type SessionExternalMetadata = {
  permission_mode?: string | null
  is_ultraplan_mode?: boolean | null
  model?: string | null
  pending_action?: RequiresActionDetails | null
  automation_state?: AutomationStateMetadata | null
  // Opaque — typed at the emit site. Importing PostTurnSummaryOutput here
  // would leak the import path string into sdk.d.ts via agentSdkBridge's
  // re-export of SessionState.
  post_turn_summary?: unknown
  // Mid-turn progress line from the forked-agent summarizer — fires every
  // ~5 steps / 2min so long-running turns still surface "what's happening
  // right now" before post_turn_summary arrives.
  task_summary?: string | null
}

type SessionStateChangedListener = (
  state: SessionState,
  details?: RequiresActionDetails,
) => void
type SessionMetadataChangedListener = (
  metadata: SessionExternalMetadata,
) => void
type PermissionModeChangedListener = (mode: PermissionMode) => void
type SessionMetadataListenerOptions = {
  replayCurrent?: boolean
}

/**
 * Consumer for session_state_changed SDK events. When registered, every
 * status transition pushes an event directly to this consumer (bypassing
 * the SDK event queue), ensuring external clients see status changes
 * immediately — not delayed until the next drainSdkEvents() call.
 *
 * Aligned with OpenCode's GlobalBus pattern: status events propagate
 * in real-time without buffering.
 */
export type SdkEventConsumer = (event: {
  type: 'system'
  subtype: 'session_state_changed'
  state: SessionState
}) => void

const stateListeners = new Set<SessionStateChangedListener>()
const metadataListeners = new Set<SessionMetadataChangedListener>()
const permissionModeListeners = new Set<PermissionModeChangedListener>()
const sdkEventConsumers = new Set<SdkEventConsumer>()

export function setSessionStateChangedListener(
  cb: SessionStateChangedListener | null,
): () => void {
  if (cb) {
    stateListeners.add(cb)
    return () => {
      stateListeners.delete(cb)
    }
  }
  return () => {}
}

export function setSessionMetadataChangedListener(
  cb: SessionMetadataChangedListener | null,
  options?: SessionMetadataListenerOptions,
): () => void {
  if (cb) {
    metadataListeners.add(cb)
    if (options?.replayCurrent) {
      const snapshot = getSessionMetadataSnapshot()
      if (Object.keys(snapshot).length > 0) {
        cb(snapshot)
      }
    }
    return () => {
      metadataListeners.delete(cb)
    }
  }
  return () => {}
}

/**
 * Register a listener for permission-mode changes from onChangeAppState.
 * Wired by print.ts to emit an SDK system:status message so CCR/IDE clients
 * see mode transitions in real time — regardless of which code path mutated
 * toolPermissionContext.mode (Shift+Tab, ExitPlanMode dialog, slash command,
 * bridge set_permission_mode, etc.).
 */
export function setPermissionModeChangedListener(
  cb: PermissionModeChangedListener | null,
): () => void {
  if (cb) {
    permissionModeListeners.add(cb)
    return () => {
      permissionModeListeners.delete(cb)
    }
  }
  return () => {}
}

/**
 * Register a consumer that receives session_state_changed events directly,
 * bypassing the SDK event queue. Use this in headless/stream-json mode to
 * push status transitions immediately to the output stream instead of
 * waiting for the next drainSdkEvents() call.
 *
 * Returns an unsubscribe function.
 */
export function registerSdkEventConsumer(cb: SdkEventConsumer): () => void {
  sdkEventConsumers.add(cb)
  return () => {
    sdkEventConsumers.delete(cb)
  }
}

let hasPendingAction = false
let currentState: SessionState = 'idle'
let currentAutomationState: AutomationStateMetadata | null = null
let currentMetadata: SessionExternalMetadata = {}

function normalizeAutomationState(
  state: AutomationStateMetadata | null | undefined,
): AutomationStateMetadata | null {
  if (!state || state.enabled !== true) {
    return null
  }

  return {
    enabled: true,
    phase:
      state.phase === 'standby' || state.phase === 'sleeping'
        ? state.phase
        : null,
    next_tick_at:
      typeof state.next_tick_at === 'number' ? state.next_tick_at : null,
    sleep_until:
      typeof state.sleep_until === 'number' ? state.sleep_until : null,
  }
}

function automationStateKey(state: AutomationStateMetadata | null): string {
  return JSON.stringify(state)
}

function applyMetadataUpdate(metadata: SessionExternalMetadata): void {
  const nextMetadata = { ...currentMetadata }
  for (const key of Object.keys(metadata) as Array<
    keyof SessionExternalMetadata
  >) {
    const value = metadata[key]
    if (value === undefined) {
      delete nextMetadata[key]
      continue
    }
    ;(nextMetadata as Record<string, unknown>)[key] = value
  }
  currentMetadata = nextMetadata
}

export function getSessionMetadataSnapshot(): SessionExternalMetadata {
  const snapshot: SessionExternalMetadata = { ...currentMetadata }
  if (currentAutomationState) {
    snapshot.automation_state = { ...currentAutomationState }
  } else if ('automation_state' in currentMetadata) {
    snapshot.automation_state = currentMetadata.automation_state ?? null
  }
  return snapshot
}

export function getSessionState(): SessionState {
  return currentState
}

export function notifySessionStateChanged(
  state: SessionState,
  details?: RequiresActionDetails,
): void {
  currentState = state

  // Notify all registered state listeners (CCR bridge, etc.)
  for (const listener of stateListeners) {
    listener(state, details)
  }

  // Push session_state_changed directly to SDK consumers (bypasses queue).
  // Aligned with OpenCode: status events propagate immediately via
  // bus.publish → GlobalBus → SSE, not buffered.
  for (const consumer of sdkEventConsumers) {
    consumer({
      type: 'system',
      subtype: 'session_state_changed',
      state,
    })
  }

  // Mirror details into external_metadata so GetSession carries the
  // pending-action context without proto changes. Cleared via RFC 7396
  // null on the next non-blocked transition.
  if (state === 'requires_action' && details) {
    hasPendingAction = true
    notifySessionMetadataChanged({
      pending_action: details,
    })
  } else if (hasPendingAction) {
    hasPendingAction = false
    notifySessionMetadataChanged({ pending_action: null })
  }

  // task_summary is written mid-turn by the forked summarizer; clear it at
  // idle so the next turn doesn't briefly show the previous turn's progress.
  if (state === 'idle') {
    notifySessionMetadataChanged({ task_summary: null })
  }

  if (state !== 'idle') {
    notifyAutomationStateChanged(
      isProactiveActive()
        ? {
            enabled: true,
            phase: null,
            next_tick_at: null,
            sleep_until: null,
          }
        : null,
    )
  }
}

export function notifySessionMetadataChanged(
  metadata: SessionExternalMetadata,
): void {
  applyMetadataUpdate(metadata)
  for (const listener of metadataListeners) {
    listener(metadata)
  }
}

export function notifyAutomationStateChanged(
  state: AutomationStateMetadata | null | undefined,
): void {
  const nextState = normalizeAutomationState(state)
  if (
    automationStateKey(nextState) === automationStateKey(currentAutomationState)
  ) {
    return
  }

  currentAutomationState = nextState
  applyMetadataUpdate({ automation_state: nextState })
  for (const listener of metadataListeners) {
    listener({ automation_state: nextState })
  }
}

/**
 * Fired by onChangeAppState when toolPermissionContext.mode changes.
 * Downstream listeners (CCR external_metadata PUT, SDK status stream) are
 * both wired through this single choke point so no mode-mutation path can
 * silently bypass them.
 */
export function notifyPermissionModeChanged(mode: PermissionMode): void {
  for (const listener of permissionModeListeners) {
    listener(mode)
  }
}

export function resetSessionStateForTests(): void {
  stateListeners.clear()
  metadataListeners.clear()
  permissionModeListeners.clear()
  sdkEventConsumers.clear()
  hasPendingAction = false
  currentState = 'idle'
  currentAutomationState = null
  currentMetadata = {}
}
