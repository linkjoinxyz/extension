const SECS = 5
const CIRC = 238.76
const params = new URLSearchParams(location.search)
const name = params.get('name') || 'Your meeting'
const link = params.get('link') || ''
const pw = params.get('pw') || ''

let validLink = false
try {
  const p = new URL(link).protocol
  validLink = p === 'http:' || p === 'https:'
} catch {}

document.getElementById('name').textContent = name

const pwBtn = document.getElementById('pw-btn')
if (pw) {
  pwBtn.style.display = ''
  pwBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(pw).then(() => {
      pwBtn.textContent = 'Copied!'
      setTimeout(() => { pwBtn.textContent = 'Copy password' }, 2000)
    }).catch(() => {
      pwBtn.textContent = 'Copy failed'
      setTimeout(() => { pwBtn.textContent = 'Copy password' }, 2000)
    })
  })
}

document.getElementById('join-btn').addEventListener('click', () => {
  if (validLink) window.open(link, '_blank', 'noopener,noreferrer')
})

document.getElementById('dismiss-btn').addEventListener('click', () => window.close())

if (!validLink) {
  document.getElementById('ring-wrap').style.display = 'none'
  document.getElementById('join-btn').style.display = 'none'
}

if (validLink) {
  let secs = SECS
  const ring = document.getElementById('ring')
  const secsEl = document.getElementById('secs')

  function tick() {
    secsEl.textContent = secs
    ring.style.strokeDashoffset = CIRC * (1 - secs / SECS)
    if (secs <= 0) { window.open(link, '_blank', 'noopener,noreferrer'); return }
    secs--
    setTimeout(tick, 1000)
  }
  tick()
}
