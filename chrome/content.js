const BASE_URL = 'https://linkjoin.xyz'

const MEETING_RE = /https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us\/j\/|meet\.google\.com\/[a-z-]{3,}|teams\.microsoft\.com\/l\/meetup-join\/|webex\.com\/meet\/|gotomeeting\.com\/join\/)[^\s"'<>]*/i

const DAYS_ALL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const REPEAT_OPTIONS = ['never', 'week', 'month', '2 times', '3 times', '4 times']
const REPEAT_LABELS = {
    'never': 'One-time',
    'week': 'Weekly',
    'month': 'Same date every month',
    '2 times': 'Every 2 weeks',
    '3 times': 'Every 3 weeks',
    '4 times': 'Every 4 weeks',
}

function normalizeRepeat(r) {
    if (!r) return 'never'
    if (REPEAT_OPTIONS.includes(r)) return r
    if (/^day \d+$/.test(r)) return r
    if (r === 'same_weekday') return r
    return 'never'
}

function repeatLabel(r) {
    if (r === 'same_weekday') return 'Same date every month'
    if (REPEAT_LABELS[r]) return REPEAT_LABELS[r]
    if (/^day \d+$/.test(r)) {
        const n = parseInt(r.split(' ')[1])
        const s = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'
        return `${n}${s} of month`
    }
    return r
}
// --- Date / time formatting helpers ---

function _dateFmt(d) {
    if (!d) return ''
    let i = 0, out = ''
    const m0 = d[0]
    if (m0 >= '2') {
        out = m0 + '/'; i = 1
    } else if (d.length > 1) {
        const raw = d.slice(0, 2), n = parseInt(raw)
        out = (n < 1 ? '01' : n > 12 ? '12' : raw) + '/'; i = 2
    } else {
        return m0
    }
    if (i >= d.length) return out
    const day0 = d[i]
    if (day0 >= '4') {
        out += day0 + '/'; i++
    } else if (d.length > i + 1) {
        const raw = d.slice(i, i + 2), n = parseInt(raw)
        out += (n < 1 ? '01' : n > 31 ? '31' : raw) + '/'; i += 2
    } else {
        return out + day0
    }
    if (i >= d.length) return out
    out += d.slice(i, i + 4)
    return out
}

function _dateFmtSimple(d) {
    let v = d
    if (d.length > 2) v = d.slice(0, 2) + '/' + d.slice(2)
    if (d.length > 4) v = d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4)
    return v
}

function _dateExpandYear(val) {
    const p = val.split('/')
    if (p.length === 3 && /^\d{2}$/.test(p[2])) return p[0] + '/' + p[1] + '/20' + p[2]
    return val
}

function _to12h(time24) {
    if (!time24 || !time24.includes(':')) return { h: '', m: '', period: 'AM' }
    const [hStr, mStr] = time24.split(':')
    let h = parseInt(hStr) || 0
    const m = String(parseInt(mStr) || 0).padStart(2, '0')
    const period = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return { h: String(h), m, period }
}

function _to24h(h12, m, period) {
    let h = parseInt(h12) || 0
    const min = String(parseInt(m) || 0).padStart(2, '0')
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    return `${h}:${min}`
}

const REMINDER_OPTIONS = [
    { value: 'false', label: 'Never' },
    { value: '5',     label: '5 min before' },
    { value: '10',    label: '10 min before' },
    { value: '15',    label: '15 min before' },
    { value: '30',    label: '30 min before' },
    { value: '60',    label: '1 hour before' },
]

const seen = new Set()
let overlayEl = null

// --- Gmail DOM watcher ---

function findMeetingLink(bodyEl) {
    for (const a of bodyEl.querySelectorAll('a[href]')) {
        MEETING_RE.lastIndex = 0
        if (MEETING_RE.test(a.href)) return a.href
    }
    MEETING_RE.lastIndex = 0
    const text = bodyEl.textContent || ''
    const bare = text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)?(?:zoom\.us\/j\/|meet\.google\.com\/[a-z-]{3,}|teams\.microsoft\.com\/l\/meetup-join\/|webex\.com\/meet\/|gotomeeting\.com\/join\/)[^\s"'<>]*/gi)
    if (!bare) return null
    const url = bare[0]
    return /^https?:\/\//.test(url) ? url : 'https://' + url
}

function getEmailSubject() {
    return document.querySelector('h2.hP')?.textContent?.trim() || ''
}

function urlsMatch(a, b) {
    try {
        const norm = u => new URL(/^https?:\/\//.test(u) ? u : 'https://' + u)
        const ua = norm(a), ub = norm(b)
        return ua.hostname === ub.hostname && ua.pathname === ub.pathname
    } catch { return a === b }
}

async function processEmailBody(bodyEl) {
    if (!chrome?.storage?.local) return
    const msgContainer = bodyEl.closest('[data-message-id]')
    const msgId = msgContainer?.dataset?.messageId
    if (msgId && seen.has(msgId)) return
    if (msgId) seen.add(msgId)

    const detectedLink = findMeetingLink(bodyEl)
    if (!detectedLink) return

    const { ljDismissed = [] } = await chrome.storage.local.get('ljDismissed')
    if (ljDismissed.some(url => urlsMatch(url, detectedLink))) return

    const linksData = await chrome.runtime.sendMessage({ type: 'getLinks' })
    if (linksData?.links?.some(l => l.link && urlsMatch(l.link, detectedLink))) return

    const subject = getEmailSubject()
    const text = bodyEl.textContent || ''
    showAnalyzing()

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

    chrome.runtime.sendMessage(
        { type: 'extractMeeting', subject, body: text, timezone },
        (result) => {
            removeAnalyzing()
            showOverlay(result || {}, detectedLink)
        }
    )
}

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue
            const bodies = node.matches?.('.a3s.aiL')
                ? [node]
                : [...node.querySelectorAll('.a3s.aiL')]
            for (const body of bodies) {
                processEmailBody(body)
            }
        }
    }
})

observer.observe(document.body, { childList: true, subtree: true })

function scanExisting() {
    document.querySelectorAll('.a3s.aiL').forEach(processEmailBody)
}

// Catch emails already in the DOM on load
setTimeout(scanExisting, 1000)

// Catch SPA navigation (Gmail uses history.pushState when opening emails)
const _origPushState = history.pushState.bind(history)
history.pushState = function (...args) {
    _origPushState(...args)
    setTimeout(scanExisting, 800)
}
window.addEventListener('popstate', () => setTimeout(scanExisting, 800))

// --- Analyzing badge ---

function showAnalyzing() {
    removeAnalyzing()
    const badge = document.createElement('div')
    badge.id = 'lj-analyzing'
    badge.textContent = 'LinkJoin: Analyzing meeting…'
    document.body.appendChild(badge)
}

function removeAnalyzing() {
    document.getElementById('lj-analyzing')?.remove()
}

// --- Overlay ---

function showOverlay(data, detectedLink) {
    removeOverlay()

    const el = document.createElement('div')
    el.id = 'lj-overlay'
    el.innerHTML = buildOverlayHTML(data, detectedLink)
    document.body.appendChild(el)
    overlayEl = el

    wireOverlay(el, data, detectedLink)
}

function removeOverlay() {
    document.getElementById('lj-overlay')?.remove()
    overlayEl = null
}

function buildOverlayHTML(data, detectedLink) {
    const name = data.name || ''
    const link = data.link || detectedLink || ''
    const t12 = _to12h(data.time || '')
    const date = data.date || ''
    const repeat = normalizeRepeat(data.repeat)

    const dayPills = DAYS_ALL.map(d => {
        const active = Array.isArray(data.days) && data.days.includes(d)
        return `<button class="lj-day-pill${active ? ' active' : ''}" data-day="${d}">${d}</button>`
    }).join('')

    const allRepeatOptions = [...REPEAT_OPTIONS, ...(/^day \d+$/.test(repeat) || repeat === 'same_weekday' ? [repeat] : [])]
    const repeatOptions = allRepeatOptions.map(v =>
        `<option value="${v}"${v === repeat ? ' selected' : ''}>${repeatLabel(v)}</option>`
    ).join('')

    return `
        <div class="lj-header">
            <span class="lj-title">LinkJoin</span>
            <span class="lj-sub">Meeting detected</span>
            <button class="lj-close" aria-label="Close">×</button>
        </div>
        <div class="lj-body">
            <label class="lj-label">Name <span class="lj-req">*</span></label>
            <input class="lj-input${!name ? ' lj-missing' : ''}" id="lj-name" type="text"
                value="${escAttr(name)}" placeholder="Meeting name">

            <label class="lj-label">Meeting link <span class="lj-req">*</span></label>
            <input class="lj-input${!link ? ' lj-missing' : ''}" id="lj-link" type="url"
                value="${escAttr(link)}" placeholder="https://zoom.us/j/...">

            <div id="lj-days-section"${repeat === 'month' ? ' style="display:none"' : ''}>
                <label class="lj-label">Days <span class="lj-req">*</span></label>
                <div class="lj-days${!Array.isArray(data.days) || !data.days.length ? ' lj-missing-days' : ''}" id="lj-days">
                    ${dayPills}
                </div>
            </div>

            <label class="lj-label">Time <span class="lj-req">*</span></label>
            <div class="lj-time-row">
                <input class="lj-input lj-time-part${!t12.h ? ' lj-missing' : ''}" id="lj-hour" type="text" placeholder="12" maxlength="2" value="${escAttr(t12.h)}">
                <span class="lj-time-colon">:</span>
                <input class="lj-input lj-time-part" id="lj-min" type="text" placeholder="00" maxlength="2" value="${escAttr(t12.m)}">
                <button class="lj-period-btn" id="lj-period" type="button">${escAttr(t12.period)}</button>
            </div>

            <label class="lj-label">Repeat</label>
            <select class="lj-select" id="lj-repeat">${repeatOptions}</select>

            <label class="lj-label">Start date <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#6b8fac;font-size:10px">(optional)</span></label>
            <input class="lj-input" id="lj-date" type="text" placeholder="MM/DD/YYYY" value="${escAttr(date)}">

            <label class="lj-label">Text reminder</label>
            <select class="lj-select" id="lj-reminder">${REMINDER_OPTIONS.map(o =>
                `<option value="${o.value}">${o.label}</option>`).join('')}</select>

            <div class="lj-error" id="lj-error" style="display:none"></div>
            <button class="lj-submit" id="lj-submit">Add to LinkJoin</button>
        </div>
    `
}

function wireOverlay(el, _data, detectedLink) {
    el.querySelector('.lj-close').addEventListener('click', async () => {
        if (detectedLink) {
            try {
                const { ljDismissed = [] } = await chrome.storage.local.get('ljDismissed')
                if (!ljDismissed.some(url => urlsMatch(url, detectedLink))) {
                    ljDismissed.push(detectedLink)
                    await chrome.storage.local.set({ ljDismissed })
                }
            } catch {}
        }
        removeOverlay()
    })

    // Hide day picker when repeat is "Same date every month"
    el.querySelector('#lj-repeat').addEventListener('change', () => {
        const isMonth = el.querySelector('#lj-repeat').value === 'month'
        el.querySelector('#lj-days-section').style.display = isMonth ? 'none' : ''
        updateSubmitState(el)
    })

    // Day pill toggles
    el.querySelectorAll('.lj-day-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            pill.classList.toggle('active')
            updateDaysMissing(el)
            updateSubmitState(el)
        })
    })

    // Date: smart slash insertion + year expansion on blur
    const dateInp = el.querySelector('#lj-date')
    dateInp.addEventListener('input', e => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
        const isDel = e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward'
        e.target.value = isDel ? _dateFmtSimple(digits) : _dateFmt(digits)
    })
    dateInp.addEventListener('blur', e => { e.target.value = _dateExpandYear(e.target.value) })

    // Time: 12h hour + minute + AM/PM
    const hourInp = el.querySelector('#lj-hour')
    const minInp = el.querySelector('#lj-min')
    const periodBtn = el.querySelector('#lj-period')

    hourInp.addEventListener('keydown', e => {
        if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(e.key)) return
        if (!/^\d$/.test(e.key)) { e.preventDefault(); return }
        const k = parseInt(e.key)
        const val = hourInp.value.replace(/\D/g, '')
        const allSel = hourInp.selectionStart === 0 && hourInp.selectionEnd === hourInp.value.length
        if (allSel) {
            if (k === 0) { e.preventDefault(); return }
        } else {
            if (val.length === 0 && k === 0) { e.preventDefault(); return }
            if (val.length === 1 && val[0] === '1' && k > 2) { e.preventDefault(); return }
            if (val.length >= 2) { e.preventDefault(); return }
        }
    })
    hourInp.addEventListener('input', e => {
        const val = e.target.value.replace(/\D/g, '').slice(0, 2)
        e.target.value = val
        hourInp.classList.toggle('lj-missing', !val)
        updateSubmitState(el)
        if ((val.length === 1 && parseInt(val) >= 2) || val.length === 2) {
            minInp.focus(); minInp.select()
        }
    })

    minInp.addEventListener('keydown', e => {
        if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(e.key)) return
        if (!/^\d$/.test(e.key)) { e.preventDefault(); return }
        const k = parseInt(e.key)
        const val = minInp.value.replace(/\D/g, '')
        const allSel = minInp.selectionStart === 0 && minInp.selectionEnd === minInp.value.length
        if (allSel) {
            if (k > 5) { e.preventDefault(); return }
        } else {
            if (val.length === 0 && k > 5) { e.preventDefault(); return }
            if (val.length >= 2) { e.preventDefault(); return }
        }
    })
    minInp.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2)
        updateSubmitState(el)
    })

    periodBtn.addEventListener('click', () => {
        periodBtn.textContent = periodBtn.textContent === 'AM' ? 'PM' : 'AM'
    })

    // Required field change → update submit state
    ;['lj-name', 'lj-link'].forEach(id => {
        el.querySelector(`#${id}`).addEventListener('input', () => {
            const input = el.querySelector(`#${id}`)
            input.classList.toggle('lj-missing', !input.value.trim())
            updateSubmitState(el)
        })
    })

    updateSubmitState(el)

    el.querySelector('#lj-submit').addEventListener('click', () => handleSubmit(el))
}

function updateDaysMissing(el) {
    const daysContainer = el.querySelector('#lj-days')
    const anyActive = daysContainer.querySelectorAll('.lj-day-pill.active').length > 0
    daysContainer.classList.toggle('lj-missing-days', !anyActive)
}

function updateSubmitState(el) {
    const name = el.querySelector('#lj-name').value.trim()
    const link = el.querySelector('#lj-link').value.trim()
    const hour = el.querySelector('#lj-hour').value.trim()
    const repeat = el.querySelector('#lj-repeat').value
    const days = [...el.querySelectorAll('.lj-day-pill.active')].map(p => p.dataset.day)
    const valid = name && link && hour && (repeat === 'month' || days.length > 0)
    el.querySelector('#lj-submit').disabled = !valid
}

async function handleSubmit(el) {
    const name = el.querySelector('#lj-name').value.trim()
    const link = el.querySelector('#lj-link').value.trim()
    const hourVal = el.querySelector('#lj-hour').value.trim()
    const minVal = el.querySelector('#lj-min').value.trim() || '00'
    const period = el.querySelector('#lj-period').textContent
    const time = _to24h(hourVal, minVal, period)
    const repeat = el.querySelector('#lj-repeat').value
    const date = el.querySelector('#lj-date').value.trim()
    const reminder = el.querySelector('#lj-reminder').value
    const errorEl = el.querySelector('#lj-error')
    let days
    if (repeat === 'month' && date) {
        const [mo, dy, yr] = date.split('/')
        const d = new Date(parseInt(yr), parseInt(mo) - 1, parseInt(dy))
        days = isNaN(d.getDay()) ? [] : [['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]]
    } else {
        days = [...el.querySelectorAll('.lj-day-pill.active')].map(p => p.dataset.day)
    }

    if (!name || !link || !hourVal || (repeat !== 'month' && !days.length)) {
        showError(errorEl, 'Please fill in all required fields.')
        return
    }

    const btn = el.querySelector('#lj-submit')
    btn.textContent = 'Adding…'
    btn.disabled = true

    try {
        const response = await chrome.runtime.sendMessage({
            type: 'createLink',
            data: { name, link, time, days, repeats: repeat, text: reminder, date, activated: true },
        })

        if (!response?.ok) {
            showError(errorEl, 'Failed to add meeting. Make sure you\'re logged in.')
            btn.textContent = 'Add to LinkJoin'
            updateSubmitState(el)
            return
        }

        btn.textContent = 'Added!'
        btn.classList.add('lj-success')
        setTimeout(removeOverlay, 1800)
    } catch {
        showError(errorEl, 'Connection error. Please try again.')
        btn.textContent = 'Add to LinkJoin'
        updateSubmitState(el)
    }
}

function showError(el, msg) {
    el.textContent = msg
    el.style.display = 'block'
}

function escAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
