const BASE_URL = 'http://localhost:8000'
const APP_URL = 'http://localhost:5173'

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


function nextOccurrence(link) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const parts = (link.time || '0:00').split(':')
    const hour = parseInt(parts[0])
    const minute = parseInt(parts[1] || '0')
    if (isNaN(hour) || isNaN(minute)) return null

    let earliest = null
    for (const day of link.days) {
        const today = new Date()
        const d = new Date(today)
        const daysUntil = (7 - (today.getDay() - DAYS.indexOf(day))) % 7
        d.setDate(d.getDate() + daysUntil)

        const alreadyPassed =
            (hour < today.getHours() ||
                (hour === today.getHours() && minute <= today.getMinutes())) &&
            daysUntil === 0
        if (alreadyPassed) d.setDate(d.getDate() + 7)
        d.setHours(hour, minute, 0, 0)

        if (!earliest || d < earliest) earliest = d
    }
    return earliest
}

function formatNext(date) {
    if (!date) return ''
    const now = new Date()
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const diffDays = Math.round((dateMidnight - todayMidnight) / (1000 * 60 * 60 * 24))
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (diffDays === 0) return `Today at ${timeStr}`
    if (diffDays === 1) return `Tomorrow at ${timeStr}`
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]
    return `${dayName} at ${timeStr}`
}

// --- Render functions ---

function renderLogin(errorMsg) {
    document.getElementById('app').innerHTML = `
        <div class="header">
            <img src="/icons/logo-rounded.png" class="logo-icon" alt="">
            <span class="logo-text">LinkJoin</span>
        </div>
        <div class="login-form">
            <input type="email" id="login-email" placeholder="Email" autocomplete="email" />
            <input type="password" id="login-password" placeholder="Password" autocomplete="current-password" />
            <div id="login-error" class="error" style="display:${errorMsg ? 'block' : 'none'}">${errorMsg || ''}</div>
            <button id="login-btn">Log in</button>
        </div>
    `

    const emailEl = document.getElementById('login-email')
    const passEl = document.getElementById('login-password')
    const btnEl = document.getElementById('login-btn')
    const errEl = document.getElementById('login-error')

    const ERROR_LABELS = {
        email_not_found: 'No account found.',
        incorrect_password: 'Incorrect password.',
        no_password: 'Use the website to sign in with Google.',
        not_confirmed: 'Please confirm your email first.',
    }

    async function doLogin() {
        const email = emailEl.value.trim()
        const password = passEl.value
        if (!email || !password) return
        btnEl.disabled = true
        btnEl.textContent = ''
        errEl.style.display = 'none'
        try {
            const res = await fetch(`${BASE_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.detail || 'login_failed')
            await chrome.storage.local.set({ token: data.access_token, email: data.email })
            await renderDashboard()
        } catch (e) {
            const code = e.message || 'login_failed'
            errEl.textContent = ERROR_LABELS[code] || 'Login failed. Please try again.'
            errEl.style.display = 'block'
            btnEl.textContent = 'Log in'
            btnEl.disabled = false
        }
    }

    btnEl.addEventListener('click', doLogin)
    emailEl.addEventListener('keydown', e => { if (e.key === 'Enter') passEl.focus() })
    passEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin() })
}

async function renderDashboard() {
    const auth = await getAuth()
    document.getElementById('app').innerHTML = `
        <div class="header">
            <img src="/icons/logo-rounded.png" class="logo-icon" alt="">
            <span class="logo-text">LinkJoin</span>
            <button id="dashboard-btn">Dashboard</button>
            <button id="logout-btn">Log out</button>
        </div>
        <div class="user-email">${escHtml(auth.email)}</div>
        <div class="meetings-section">
            <div class="section-label">Upcoming meetings</div>
            <div id="meetings-list"><p class="muted-msg">Loading...</p></div>
        </div>
    `
    document.getElementById('dashboard-btn').addEventListener('click', () => {
        chrome.tabs.create({ url: `${APP_URL}/links` })
    })
    document.getElementById('logout-btn').addEventListener('click', handleLogout)

    const data = await apiFetch('/links')
    const list = document.getElementById('meetings-list')

    if (!data?.links) {
        list.innerHTML = '<p class="muted-msg">Could not load meetings.</p>'
        return
    }

    const upcoming = data.links
        .filter(l => l.days?.length)
        .map(l => ({ ...l, _next: nextOccurrence(l) }))
        .filter(l => l._next)
        .sort((a, b) => a._next - b._next)

    if (upcoming.length === 0) {
        list.innerHTML = '<p class="muted-msg">No upcoming meetings.</p>'
        return
    }

    list.innerHTML = upcoming.map(l => `
        <div class="meeting-card">
            <div class="meeting-name">${escHtml(l.name)}</div>
            <div class="meeting-meta">
                <span class="meeting-days">${l.days.join(', ')}</span>
                <span class="meeting-next">${formatNext(l._next)}</span>
            </div>
        </div>
    `).join('')
}

async function handleLogout() {
    await chrome.storage.local.remove(['token', 'email', 'links', 'alarmData'])
    chrome.runtime.sendMessage({ type: 'logout' })
    renderLogin()
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// --- Init ---

async function init() {
    const auth = await getAuth()
    if (auth) {
        await renderDashboard()
    } else {
        renderLogin()
    }
}

init()
