/**
 * Simple logger
 */

const levels = { debug: 0, info: 1, warn: 2, error: 3 }
const envLevel = process.env.LOG_LEVEL || 'info'
const currentLevel = levels[envLevel] ?? 1

function pad (n) { return n < 10 ? '0' + n : '' + n }

function ts () {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fmt (args) {
  return args.map(a => {
    if (a instanceof Error) return a.stack || a.message
    if (typeof a === 'object') { try { return JSON.stringify(a, null, 2) } catch (e) { return String(a) } }
    return String(a)
  }).join(' ')
}

module.exports = {
  debug (...args) { if (currentLevel <= 0) console.log(`[DEBUG] ${ts()} ${fmt(args)}`) },
  info (...args) { if (currentLevel <= 1) console.log(`[INFO] ${ts()} ${fmt(args)}`) },
  warn (...args) { if (currentLevel <= 2) console.warn(`[WARN] ${ts()} ${fmt(args)}`) },
  error (...args) { if (currentLevel <= 3) console.error(`[ERROR] ${ts()} ${fmt(args)}`) },
}
