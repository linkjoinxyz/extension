function syncAuth() {
    const token = localStorage.getItem('lj_token')
    const email = localStorage.getItem('lj_email')
    if (token && email) {
        chrome.storage.local.set({ token, email })
        chrome.runtime.sendMessage({ type: 'login' }).catch(() => {})
    }
    document.documentElement.setAttribute('data-lj-ext', '1')
    window.dispatchEvent(new CustomEvent('lj:ready'))
}

function syncLastOpenedToExtension() {
    try {
        const data = JSON.parse(localStorage.getItem('lj_last_opened') || '{}')
        chrome.storage.local.set({ lj_last_opened: data })
    } catch {}
}

// Web app opened a meeting → sync lj_last_opened to extension storage
window.addEventListener('lj:opened', syncLastOpenedToExtension)

// Extension opened a meeting → sync lj_last_opened to localStorage
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.lj_last_opened) return
    try {
        const incoming = changes.lj_last_opened.newValue || {}
        const existing = JSON.parse(localStorage.getItem('lj_last_opened') || '{}')
        // Merge, keeping the most recent timestamp for each id
        const merged = { ...existing }
        for (const id in incoming) {
            if (!existing[id] || incoming[id] > existing[id]) merged[id] = incoming[id]
        }
        localStorage.setItem('lj_last_opened', JSON.stringify(merged))
    } catch {}
})

syncAuth()

// On load, pull extension's lj_last_opened into localStorage so web app sees prior opens
chrome.storage.local.get('lj_last_opened', (data) => {
    if (!data.lj_last_opened) return
    try {
        const existing = JSON.parse(localStorage.getItem('lj_last_opened') || '{}')
        const merged = { ...existing }
        for (const id in data.lj_last_opened) {
            if (!existing[id] || data.lj_last_opened[id] > existing[id]) merged[id] = data.lj_last_opened[id]
        }
        localStorage.setItem('lj_last_opened', JSON.stringify(merged))
    } catch {}
})

window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return
    if (e.data?.type === 'lj:login') syncAuth()
    if (e.data?.type === 'lj:logout') {
        chrome.storage.local.remove(['token', 'email'])
        chrome.runtime.sendMessage({ type: 'logout' }).catch(() => {})
    }
})
