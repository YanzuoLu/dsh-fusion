// Browser half, loaded by the DSH web shell as a classic script.
window.__ModuleLoader__.load({
  id: 'dsh-fusion',
  factory: (require) => {
    const { useEffect, useRef, useState, useSyncExternalStore } = require('react')
    const { Fragment, jsx, jsxs } = require('react/jsx-runtime')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const { Toast, IconEnhanceOutlineRegular, IconWarningOutlineRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const ID = 'dsh-fusion'
    const SLOT = 'conversation.input.right'
    // dsh-side-chat's Start seat is -20 and dsh-subagent-model keeps the
    // default 0, so this seat lands after the former and before the latter.
    const ORDER = -10
    const NAME = 'Devin Fusion'
    const identity = (value) => value

    // The official composer model trigger and its states. The name takes the
    // trigger body color and the state the caption color of the effort label.
    // A compact row hides only the name, so the icon keeps its On/Off state.
    const CSS = `
.dsh-fusion-trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}
.dsh-fusion-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fusion-trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dsh-fusion-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-fusion-icon{display:var(--dsh-composer-model-icon-display,none);flex:none}
.dsh-fusion-text{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dsh-fusion-name{display:var(--dsh-composer-model-text-display,inline)}
.dsh-fusion-state{color:var(--dsw-alias-label-caption)}
@media(max-width:767px){
.dsh-fusion-trigger{padding:0 3px}
}
`

    const statusText = {
      serviceUnavailable: (status) => `Service temporarily unavailable (HTTP ${status})`,
      reauthRequired: (status) => `Authentication required. Please sign in again (HTTP ${status})`,
      httpError: (status) => `Request failed (HTTP ${status})`,
      unexpectedResponse: (status) => `Unexpected server response (HTTP ${status}). Please try again later`,
    }
    const errorText = ({ kind, message, uiCode, status }) => {
      const detail = uiCode ? statusText[uiCode](status) : status !== undefined ? `${message} (HTTP ${status})` : message
      return kind === 'loadError'
        ? `Could not load ${NAME}: ${detail}${status === 503 ? '. Retrying automatically' : ''}`
        : `Could not save ${NAME}: ${detail}`
    }

    const responseError = (uiCode, status) => Object.assign(new Error(`HTTP ${status}`), { uiCode, status })
    const httpError = (status) => responseError(status === 503 ? 'serviceUnavailable' : status === 401 ? 'reauthRequired' : 'httpError', status)
    // A proxy or reloading host may return text instead of the API envelope.
    // Only the fields the toggle reads are checked; other fields are ignored.
    const validState = (value, sessionId) => value !== null && typeof value === 'object'
      && value.sessionId === sessionId && typeof value.rootSessionId === 'string'
      && typeof value.enabled === 'boolean' && typeof value.inherited === 'boolean'
    async function callHost(endpoint, payload, signal) {
      const response = await fetch(`api/devin-fusion/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal,
      })
      let result
      try {
        result = await response.json()
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') throw error
        if (!response.ok) throw httpError(response.status)
        if (error?.name === 'SyntaxError') throw responseError('unexpectedResponse', response.status)
        throw error
      }
      if (result?.ok === false && typeof result.error?.message === 'string') {
        throw Object.assign(new Error(result.error.message), { status: response.status })
      }
      if (!response.ok) throw httpError(response.status)
      if (result?.ok !== true || !validState(result.value, payload.sessionId)) throw responseError('unexpectedResponse', response.status)
      return result.value
    }

    const initial = (sessionId) => ({ sessionId, value: null, loading: false, saving: false, error: null })
    function createController() {
      const state = createSnapshotStore(initial())
      const lifetime = new AbortController()
      // Writes outlive a view switch. Returning to that session waits for its
      // write to settle before reading, so an abort cannot create a stale read.
      const writes = new Map()
      let active, read, generation = 0, errorId = 0
      const current = (seat) => active === seat && seat.generation === generation && !lifetime.signal.aborted
      const patch = (seat, values) => {
        if (current(seat)) state.set({ ...state.getSnapshot(), ...values })
      }
      const fail = (seat, kind, error) => {
        if (!current(seat)) return
        const message = typeof error?.message === 'string' ? error.message : String(error)
        const { uiCode, status } = error ?? {}
        if (kind === 'loadError') {
          // One unavailable read is common while the host reconfigures. The
          // next poll retries it quietly; only a repeated failure is reported.
          seat.failures503 = status === 503 ? seat.failures503 + 1 : 0
          if (seat.failures503 === 1) return
        }
        const previous = state.getSnapshot().error
        if (previous?.kind !== kind || previous.message !== message || previous.uiCode !== uiCode || previous.status !== status) {
          patch(seat, { error: { id: ++errorId, kind, message, uiCode, status } })
        }
      }
      const abortRead = () => { read?.controller.abort(); read = undefined }
      const refresh = async () => {
        const seat = active
        if (!seat || !current(seat) || document.visibilityState !== 'visible' || writes.has(seat.sessionId) || read) return
        const request = { controller: new AbortController() }
        read = request
        patch(seat, { loading: true })
        try {
          const value = await callHost('get', { sessionId: seat.sessionId }, request.controller.signal)
          if (read === request && current(seat)) {
            seat.failures503 = 0
            // A recovered read resolves only read failures. A save failure
            // stays until its toast is dismissed.
            const { error } = state.getSnapshot()
            patch(seat, { value, error: error?.kind === 'saveError' ? error : null })
          }
        } catch (error) {
          if (read === request && !request.controller.signal.aborted) fail(seat, 'loadError', error)
        } finally {
          if (read === request) { read = undefined; patch(seat, { loading: false }) }
        }
      }
      const mount = (sessionId) => {
        if (lifetime.signal.aborted || typeof sessionId !== 'string' || sessionId.length === 0) return () => {}
        active?.release()
        const seat = { sessionId, generation: ++generation, failures503: 0 }
        active = seat
        state.set(initial(sessionId))
        const onVisibility = () => {
          if (document.visibilityState === 'visible') void refresh()
          else { abortRead(); patch(seat, { loading: false }) }
        }
        const timer = setInterval(() => { void refresh() }, 5000)
        document.addEventListener('visibilitychange', onVisibility)
        seat.release = () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
          if (current(seat)) { abortRead(); active = undefined }
        }
        const writing = writes.get(sessionId)
        if (writing) {
          patch(seat, { loading: true })
          void writing.then(() => { if (current(seat)) void refresh() })
        } else void refresh()
        return seat.release
      }
      const toggle = (sessionId) => {
        const seat = active, value = state.getSnapshot().value
        // The trigger is disabled for the whole write. This synchronous guard
        // also stops a second click in the render gap from sending another write.
        // An inherited flag belongs to the root main session; the host rejects
        // writes to it even before the native subagent address is known.
        if (!seat || !current(seat) || seat.sessionId !== sessionId || !value || value.inherited || writes.has(sessionId)) return
        abortRead()
        patch(seat, { saving: true, loading: false, error: null })
        const operation = callHost('set', { sessionId, enabled: !value.enabled }, lifetime.signal).then((accepted) => {
          patch(seat, { value: accepted, error: null })
        }).catch((error) => {
          fail(seat, 'saveError', error)
        }).finally(() => {
          writes.delete(sessionId)
          patch(seat, { saving: false })
        })
        writes.set(sessionId, operation)
        return operation
      }
      return {
        state, mount, refresh, toggle,
        dispose() { active?.release(); lifetime.abort() },
      }
    }

    // Owner props carry no lock for this slot. The seat follows the official
    // model seat: locked when the owner says so, the session is removed, or the
    // composer input is not live. Only the selected main view reads or writes.
    function FusionToggle({ sessionId, locked, useInput, useSession, useSessions, isSubagent, controller }) {
      const ready = useInput((input) => input !== undefined)
      const removed = useSession((session) => session.removed) === true
      const catalog = useSessions(identity)
      const state = useSyncExternalStore(controller.state.subscribe, controller.state.getSnapshot, controller.state.getSnapshot)
      const [dismissedError, setDismissedError] = useState(null)
      const buttonRef = useRef(null)
      const subagent = isSubagent()
      const selected = (catalog.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0
      const available = selected && ready && !removed && !subagent
      useEffect(() => {
        if (available) return controller.mount(sessionId)
      }, [available, sessionId, controller])
      if (subagent) return null
      const own = state.sessionId === sessionId
      const value = own ? state.value : null
      const saving = own && state.saving
      const disabled = locked === true || !available || value === null || value.inherited || saving
      const label = `${NAME} ${value === null ? 'Loading…' : value.enabled ? 'On' : 'Off'}`
      const error = own ? state.error : null
      return jsxs(Fragment, { children: [
        jsxs('button', {
          ref: buttonRef, type: 'button', className: 'dsh-fusion-trigger', disabled,
          title: label, 'aria-label': label,
          'aria-pressed': value === null ? undefined : value.enabled,
          'aria-busy': saving || (own && state.loading),
          onClick: () => { if (!disabled) void controller.toggle(sessionId) },
          children: [
            jsx(IconEnhanceOutlineRegular, { size: 16, className: 'dsh-fusion-icon' }),
            jsxs('span', { className: 'dsh-fusion-text', children: [
              jsx('span', { className: 'dsh-fusion-name', children: NAME }),
              ' ',
              jsx('span', { className: 'dsh-fusion-state', children: label.slice(NAME.length + 1) }),
            ] }),
          ],
        }),
        error && error.id !== dismissedError && jsx(Toast, {
          text: errorText(error), icon: jsx(IconWarningOutlineRegular, {}),
          anchor: buttonRef.current?.closest('[data-composer-card]') ?? null,
          onDone: () => setDismissedError(error.id),
        }, error.id),
      ] })
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.inject(['sessions'], (ctx) => {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', ID)
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'devin-fusion: styles')
        const controller = createController()
        ctx.effect(() => controller.dispose, 'devin-fusion: requests')
        const sessions = ctx.sessions
        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT, id: ID, order: ORDER,
          inject: (sessionId) => ({
            controller,
            // Addressed subagents follow their root main session.
            isSubagent: () => sessions.subagentAddress(sessionId) !== undefined,
          }),
        }, FusionToggle))
      })
    }
    return { name: ID, inject, apply }
  },
})
