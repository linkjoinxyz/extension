const BASE_URL = 'http://localhost:8000'
const BASE_WS_URL = 'ws://localhost:8000'
const PRE_MEET_MS = 5000

let webSocket = null
let reconnectTimer = null

// --- Auth ---

async function getAuth() {
    const { token, email } = await chrome.storage.local.get(['token', 'email'])
    return token && email ? { token, email } : null
}

async function apiFetch(path, options = {}) {
    const auth = await getAuth()
    if (!auth) return null
    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
                ...(options.headers || {}),
            },
        })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    }
}

// --- WebSocket ---

async function createWebsocket() {
    const auth = await getAuth()
    if (!auth) return

    const data = await apiFetch('/ws-ticket')
    if (!data?.ticket) {
        scheduleReconnect()
        return
    }

    if (webSocket) {
        webSocket.onclose = null
        webSocket.close()
    }

    webSocket = new WebSocket(`${BASE_WS_URL}/ws/database?ticket=${encodeURIComponent(data.ticket)}`)

    webSocket.onmessage = async (e) => {
        const msg = JSON.parse(e.data)
        await recreateAlarms(msg.links || [])
    }

    webSocket.onclose = () => {
        scheduleReconnect()
    }
}

function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(createWebsocket, 10000)
}

// --- Alarms ---

async function recreateAlarms(links) {
    await chrome.alarms.clearAll()
    chrome.alarms.create('resetWebsocket', { delayInMinutes: 60, periodInMinutes: 60 })

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const alarmData = {}

    function firstBizDay(year, month) {
        const dow = new Date(year, month, 1).getDay()
        return dow === 0 ? 2 : dow === 6 ? 3 : 1
    }

    function isPastEndDate(link) {
        if (!link.end_date) return false
        try {
            const [m, d, y] = link.end_date.split('/').map(Number)
            return new Date() > new Date(y, m - 1, d, 23, 59, 59)
        } catch { return false }
    }

    for (const link of links) {
        if (link.active === 'false' || !link.link) continue
        if (isPastEndDate(link)) continue

        if (link.repeat === 'same_weekday') {
            const info = changeTime([], link.time, 0)
            const today = new Date()
            for (let i = 0; i <= 62; i++) {
                const check = new Date(today)
                check.setDate(today.getDate() + i)
                check.setHours(info.hour, info.minute, 0, 0)
                if (check.getDate() === firstBizDay(check.getFullYear(), check.getMonth()) && check.getTime() > Date.now()) {
                    const alarmName = `lj-${link.id}-fbm`
                    chrome.alarms.create(alarmName, { when: check.getTime() - PRE_MEET_MS })
                    alarmData[alarmName] = { id: link.id, link: link.link, repeat: link.repeat, name: link.name, password: link.password || null }
                    const notifyWhen = check.getTime() - 2 * 60 * 1000
                    if (notifyWhen > Date.now()) {
                        const notifyName = `lj-notify-${link.id}-fbm`
                        chrome.alarms.create(notifyName, { when: notifyWhen })
                        alarmData[notifyName] = { notify: true, name: link.name }
                    }
                    break
                }
            }
            continue
        }

        if (/^day \d+$/.test(link.repeat)) {
            const dayNum = parseInt(link.repeat.split(' ')[1])
            const info = changeTime([], link.time, 0)
            const today = new Date()

            function effectiveDomDate(year, month, n) {
                const d = new Date(year, month, n)
                if (d.getMonth() !== month) return null
                const dow = d.getDay()
                if (dow === 6) d.setDate(d.getDate() + 2)
                if (dow === 0) d.setDate(d.getDate() + 1)
                return d
            }

            let target = null
            for (let offset = 0; offset <= 2; offset++) {
                const totalMonth = today.getMonth() + offset
                const yr = totalMonth > 11 ? today.getFullYear() + 1 : today.getFullYear()
                const mo = totalMonth % 12
                const candidate = effectiveDomDate(yr, mo, dayNum)
                if (!candidate) continue
                candidate.setHours(info.hour, info.minute, 0, 0)
                if (candidate.getTime() > Date.now()) { target = candidate; break }
            }

            if (target) {
                const alarmName = `lj-${link.id}-dom`
                chrome.alarms.create(alarmName, { when: target.getTime() - PRE_MEET_MS })
                alarmData[alarmName] = { id: link.id, link: link.link, repeat: link.repeat, name: link.name, password: link.password || null }
                const notifyWhen = target.getTime() - 2 * 60 * 1000
                if (notifyWhen > Date.now()) {
                    const notifyName = `lj-notify-${link.id}-dom`
                    chrome.alarms.create(notifyName, { when: notifyWhen })
                    alarmData[notifyName] = { notify: true, name: link.name }
                }
            }
            continue
        }

        if (link.repeat === 'month') {
            const info = changeTime([...link.days], link.time, 0)
            const today = new Date()
            const parts = (link.date || '').split('/')
            const refDay = parts.length === 3 ? parseInt(parts[1], 10) : NaN
            const weekNum = (!isNaN(refDay) && refDay >= 1) ? Math.ceil(refDay / 7) : 1

            function nthWeekdayInMonth(year, month, dayOfWeek, n) {
                const firstDay = new Date(year, month, 1)
                const diff = (dayOfWeek - firstDay.getDay() + 7) % 7
                const d = new Date(year, month, 1 + diff + (n - 1) * 7)
                d.setHours(info.hour, info.minute, 0, 0)
                return d.getMonth() === month ? d : null
            }

            for (const day of info.days) {
                const dayIndex = DAYS.indexOf(day)
                let target = nthWeekdayInMonth(today.getFullYear(), today.getMonth(), dayIndex, weekNum)
                if (!target || target.getTime() <= Date.now()) {
                    const nm = today.getMonth() === 11 ? 0 : today.getMonth() + 1
                    const ny = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear()
                    target = nthWeekdayInMonth(ny, nm, dayIndex, weekNum)
                }
                if (target && target.getTime() > Date.now()) {
                    const alarmName = `lj-${link.id}-${day}`
                    chrome.alarms.create(alarmName, { when: target.getTime() - PRE_MEET_MS })
                    alarmData[alarmName] = { id: link.id, link: link.link, repeat: link.repeat, name: link.name, password: link.password || null }
                    const notifyWhen = target.getTime() - 2 * 60 * 1000
                    if (notifyWhen > Date.now()) {
                        const notifyName = `lj-notify-${link.id}-${day}`
                        chrome.alarms.create(notifyName, { when: notifyWhen })
                        alarmData[notifyName] = { notify: true, name: link.name }
                    }
                }
            }
            continue
        }

        if (!link.days?.length) continue

        const info = changeTime([...link.days], link.time, 0)

        for (const day of info.days) {
            const today = new Date()
            const linkDay = new Date(today)
            const daysUntil = (7 - (today.getDay() - DAYS.indexOf(day))) % 7
            linkDay.setDate(linkDay.getDate() + daysUntil)

            const alreadyPassed =
                (info.hour < today.getHours() ||
                    (info.hour === today.getHours() && info.minute <= today.getMinutes())) &&
                daysUntil === 0
            if (alreadyPassed) linkDay.setDate(linkDay.getDate() + 7)

            linkDay.setHours(info.hour, info.minute, 0, 0)

            let delayMs = 0
            if (/^\d/.test(link.repeat)) {
                delayMs = 10080 * parseInt(link.repeat) * 60000
            }
            if (link.date) {
                const [_m, _d, _y] = link.date.split('/').map(Number)
                const diff = dateDiffInDays(today, new Date(_y, _m - 1, _d))
                if (diff < 0 || (diff === 0 && today.getTime() > linkDay.getTime())) continue
                delayMs += 1440 * diff * 60000
            }

            const when = linkDay.getTime() + delayMs
            if (when > Date.now()) {
                const alarmName = `lj-${link.id}-${day}`
                chrome.alarms.create(alarmName, { when: when - PRE_MEET_MS })
                alarmData[alarmName] = { id: link.id, link: link.link, repeat: link.repeat, name: link.name, password: link.password || null }

                const notifyWhen = when - 2 * 60 * 1000
                if (notifyWhen > Date.now()) {
                    const notifyName = `lj-notify-${link.id}-${day}`
                    chrome.alarms.create(notifyName, { when: notifyWhen })
                    alarmData[notifyName] = { notify: true, name: link.name }
                }
            }
        }
    }

    await chrome.storage.local.set({ alarmData })
}

// --- Chrome event listeners ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'resetWebsocket') {
        if (webSocket) webSocket.close()
        await createWebsocket()
        return
    }

    if (!alarm.name.startsWith('lj-')) return

    const { alarmData = {}, lj_last_opened = {} } = await chrome.storage.local.get(['alarmData', 'lj_last_opened'])
    const entry = alarmData[alarm.name]
    if (!entry) return

    if (entry.notify) {
        chrome.notifications.create(alarm.name, {
            type: 'basic',
            iconUrl: '/icons/logo-rounded.png',
            title: 'Meeting starting in 2 minutes',
            message: entry.name || 'Your meeting is about to start',
        })
        return
    }

    // Skip if web app already opened this meeting in the last 2 minutes
    if (lj_last_opened[entry.id] && Date.now() - lj_last_opened[entry.id] < 2 * 60 * 1000) return

    try {
        const proto = new URL(entry.link).protocol
        if (proto !== 'http:' && proto !== 'https:') return
    } catch { return }

    const premeetParams = new URLSearchParams({ name: entry.name || '', link: entry.link })
    if (entry.password) premeetParams.set('pw', entry.password)
    await chrome.windows.create({ url: chrome.runtime.getURL('premeet.html') + '?' + premeetParams, type: 'popup', width: 440, height: 360, focused: true })

    await chrome.storage.local.set({ lj_last_opened: { ...lj_last_opened, [entry.id]: Date.now() } })

    if (entry.repeat === 'never') {
        await apiFetch(`/links/${entry.id}/toggle`, {
            method: 'PATCH',
            body: JSON.stringify({ id: entry.id, active: 'false' }),
        })
    }
})

chrome.runtime.onInstalled.addListener(async () => {
    await createOffscreen()
    await setupContextMenu()
    await createWebsocket()
})

chrome.runtime.onStartup.addListener(async () => {
    await createOffscreen()
    await setupContextMenu()
    await createWebsocket()
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.keepAlive) return
    if (msg.type === 'login') {
        if (webSocket) webSocket.close()
        createWebsocket()
    }
    if (msg.type === 'logout') {
        if (webSocket) {
            webSocket.onclose = null
            webSocket.close()
            webSocket = null
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = null
        }
        chrome.alarms.clearAll()
    }
    if (msg.type === 'getLinks') {
        apiFetch('/links').then(result => sendResponse(result || null))
        return true
    }
    if (msg.type === 'extractMeeting') {
        apiFetch('/ai/extract-meeting', {
            method: 'POST',
            body: JSON.stringify({ subject: msg.subject, body: msg.body, user_timezone: msg.timezone }),
        }).then(result => sendResponse(result || null))
        return true
    }
    if (msg.type === 'createLink') {
        apiFetch('/links', {
            method: 'POST',
            body: JSON.stringify(msg.data),
        }).then(result => sendResponse({ ok: result !== null, result }))
        return true
    }
})

chrome.contextMenus.onClicked.addListener(async (e) => {
    const url = e.linkUrl || e.pageUrl
    const name = e.selectionText || url.replace(/^https?:\/\//, '').split('/')[0]
    await apiFetch('/bookmarks', {
        method: 'POST',
        body: JSON.stringify({ name, link: url }),
    })
})

// --- Utilities ---

async function setupContextMenu() {
    await chrome.contextMenus.removeAll()
    chrome.contextMenus.create({
        title: 'Add to LinkJoin',
        id: 'add-to-linkjoin',
        visible: true,
        contexts: ['all'],
    })
}

async function createOffscreen() {
    if (await chrome.offscreen.hasDocument?.()) return
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'keep service worker running',
    })
}

function changeTime(days, time, before) {
    const daysList = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    let hour = parseInt(time.split(':')[0])
    let minute = parseInt(time.split(':')[1])
    if (before) {
        minute -= before
        if (minute < 0) { hour--; minute += 60 }
        if (hour < 0) {
            hour += 24
            days = days.map(d => daysList[(daysList.indexOf(d) + 6) % 7])
        }
    }
    return { hour, minute, days }
}

function dateDiffInDays(a, b) {
    const MS_PER_DAY = 1000 * 60 * 60 * 24
    const utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
    const utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    return Math.floor((utc2 - utc1) / MS_PER_DAY)
}

