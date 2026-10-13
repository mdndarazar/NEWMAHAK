/**
 * tsx-parse-check.mjs — بررسی نحویِ فایل‌های .tsx بدون tsc / بدون node_modules.
 *
 * چه‌کار می‌کند: JSX را به فراخوانی تابع (`__J(...)`) تبدیل می‌کند و همه‌ی
 * عبارت‌های داخل `{...}` را دست‌نخورده به‌عنوان آرگومان نگه می‌دارد، بعد فایل
 * حاصل را با `node --experimental-strip-types` *پارس* می‌کند. اگر SyntaxError
 * بدهد ⇒ خطای نحوی واقعی (با شماره خط). اگر ERR_MODULE_NOT_FOUND بدهد ⇒ فایل
 * سالم پارس شده است (چون رزولوشن ماژول بعد از پارس اتفاق می‌افتد).
 * این جای تایپ‌چک را نمی‌گیرد؛ فقط خطای نحوی و تگ/آکولاد نبسته را می‌گیرد.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'await', 'new', 'delete', 'void'])

function transform(src, file) {
  let i = 0
  let out = ''
  let lastTok = ''
  const n = src.length
  const errs = []

  const isIdent = (c) => /[A-Za-z0-9_$]/.test(c)

  function exprPosition() {
    if (lastTok === '') return true
    if (KEYWORDS.has(lastTok)) return true
    if (/[A-Za-z0-9_$]$/.test(lastTok)) return false
    if (lastTok === ')' || lastTok === ']' || lastTok === 'str') return false
    return true // ( { , ; = : ? => && || ! + - etc.
  }

  function readString(quote) {
    let s = src[i++]
    while (i < n) {
      const c = src[i]
      if (c === '\\') { s += src[i] + (src[i + 1] ?? ''); i += 2; continue }
      if (quote === '`' && c === '$' && src[i + 1] === '{') {
        s += '${'
        i += 2
        s += readBalancedBraces() + '}'
        continue
      }
      s += c; i++
      if (c === quote) return s
    }
    errs.push(`رشته‌ی بسته‌نشده تا انتهای فایل (شروع نزدیک نویسه ${i})`)
    return s
  }

  function looksLikeRegex(previous) {
    const trimmed = previous.trimEnd()
    if (!trimmed) return true
    const last = trimmed[trimmed.length - 1]
    return /[([{:;,=!?&|+\-*%^~<>]/.test(last) || /\b(?:return|case|throw|typeof|void|delete|yield|await)$/.test(trimmed)
  }

  function readRegexLiteral() {
    const start = i++
    let inClass = false
    while (i < n) {
      const c = src[i]
      if (c === '\\') { i += 2; continue }
      if (c === '[') { inClass = true; i++; continue }
      if (c === ']') { inClass = false; i++; continue }
      i++
      if (c === '/' && !inClass) {
        while (i < n && /[A-Za-z]/.test(src[i])) i++
        break
      }
    }
    return src.slice(start, i)
  }

  // از داخل `${` یا `{` — خودِ آکولادِ باز قبلاً مصرف شده است
  function readBalancedBraces() {
    let depth = 1
    let s = ''
    while (i < n && depth > 0) {
      const c = src[i]
      if (c === '"' || c === "'" || c === '`') { s += readString(c); continue }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { s += src[i++] } continue }
      if (c === '/' && src[i + 1] === '*') { while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { s += src[i++] } s += '*/'; i += 2; continue }
      if (c === '/' && looksLikeRegex(s)) { s += readRegexLiteral(); continue }
      if (c === '{') depth++
      if (c === '}') { depth--; if (depth === 0) { i++; return s } }
      s += c; i++
    }
    errs.push('آکولاد بسته‌نشده')
    return s
  }

  /**
   * یک عبارت JS داخل {} در JSX — خروجی: رشته‌ی عبارت (بدون آکولادها).
   *
   * 🐞 باگ جلسه ۲۷ که اینجا رفع شد (روی ۱۹ فایل سالم False Positive می‌داد):
   * `lastTok` بین دو عبارتِ *مستقلِ* JSX نشت می‌کرد. مثلاً در
   * `<Modal title={a ? b : 'x'} footer={<>…</>}>` مقدار `lastTok` بعد از
   * عبارت اول `'str'` می‌ماند، پس `exprPosition()` برای `footer={<>` نتیجه‌ی
   * `false` می‌داد و `<` به‌جای «شروع عنصر» یک «عملگر کوچکتر» فرض می‌شد ⇒ کل
   * Fragment خام در خروجی می‌ماند و node آن را SyntaxError می‌گرفت.
   * هر `{…}` در JSX همیشه *ابتدای یک عبارت* است، پس اینجا با `lastTok = ''`
   * شروع و در پایان همان مقدار قبلی برگردانده می‌شود.
   */
  function readJsxExpr() {
    i++ // {
    const saved = lastTok
    lastTok = ''
    const body = readBalancedBracesJsxAware()
    lastTok = saved
    return body
  }

  function readBalancedBracesJsxAware() {
    let depth = 1
    let s = ''
    while (i < n && depth > 0) {
      const c = src[i]
      if (c === '"' || c === "'" || c === '`') { lastTok = 'str'; s += readString(c); continue }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { s += src[i++] } continue }
      if (c === '/' && src[i + 1] === '*') { s += '/*'; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { s += src[i++] } s += '*/'; i += 2; continue }
      if (c === '/' && looksLikeRegex(s)) { s += readRegexLiteral(); continue }
      if (c === '<' && exprPosition() && /[A-Za-z>]/.test(src[i + 1] ?? '')) { s += readElement(); lastTok = ')'; continue }
      if (c === '{') { depth++; lastTok = '{'; s += c; i++; continue }
      if (c === '}') { depth--; if (depth === 0) { i++; return s } lastTok = '}'; s += c; i++; continue }
      if (!/\s/.test(c)) lastTok = isIdent(c) ? (isIdent(lastTok.slice(-1)) ? lastTok + c : c) : c
      if (/\s/.test(c) && isIdent(lastTok.slice(-1))) lastTok = lastTok // keep word
      s += c; i++
    }
    errs.push('آکولاد بسته‌نشده در عبارت JSX')
    return s
  }

  /** از `<` شروع می‌کند و کل عنصر را به `__J(...)` تبدیل می‌کند */
  function readElement() {
    const startLine = src.slice(0, i).split('\n').length
    i++ // <
    // Fragment (`<>`) ⇒ نام خالی می‌ماند و با `</>` بسته می‌شود (cn هم خالی)
    let name = ''
    while (i < n && /[A-Za-z0-9_$.:-]/.test(src[i])) name += src[i++]
    const args = []
    // attributes
    while (i < n) {
      while (i < n && /\s/.test(src[i])) i++
      if (src[i] === '/' && src[i + 1] === '>') { i += 2; return `__J(${args.join(', ')})` }
      if (src[i] === '>') { i++; break }
      if (src[i] === '{') { const e = readJsxExpr(); if (e.replace(/\/\*[\s\S]*?\*\//g, '').trim()) args.push(`({${e}})`); continue }
      // attr name
      let an = ''
      while (i < n && /[A-Za-z0-9_$.:-]/.test(src[i])) an += src[i++]
      if (!an) { i++; continue }
      while (i < n && /\s/.test(src[i])) i++
      if (src[i] === '=') {
        i++
        while (i < n && /\s/.test(src[i])) i++
        if (src[i] === '"' || src[i] === "'") { readString(src[i]) }
        else if (src[i] === '{') { const e = readJsxExpr(); if (e.replace(/\/\*[\s\S]*?\*\//g, '').trim()) args.push(`(${e})`) }
        else if (src[i] === '<') { args.push(readElement()) }
      }
    }
    // children
    while (i < n) {
      if (src[i] === '<' && src[i + 1] === '/') {
        i += 2
        let cn = ''
        while (i < n && /[A-Za-z0-9_$.:-]/.test(src[i])) cn += src[i++]
        while (i < n && /\s/.test(src[i])) i++
        if (src[i] !== '>') errs.push(`تگ بسته‌ی ناقص نزدیک خط ${src.slice(0, i).split('\n').length}`)
        i++
        if (cn !== name) errs.push(`تگ <${name}> در خط ${startLine} با </${cn}> بسته شده است`)
        return `__J(${args.join(', ')})`
      }
      if (src[i] === '<' && /[A-Za-z>]/.test(src[i + 1] ?? '')) { args.push(readElement()); continue }
      if (src[i] === '{') { const e = readJsxExpr(); if (e.replace(/\/\*[\s\S]*?\*\//g, '').trim()) args.push(`(${e})`); continue }
      if (i >= n) break
      i++
    }
    errs.push(`تگ <${name}> در خط ${startLine} هیچ‌وقت بسته نشد`)
    return `__J(${args.join(', ')})`
  }

  while (i < n) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') { lastTok = 'str'; out += readString(c); continue }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') out += src[i++]; continue }
    if (c === '/' && src[i + 1] === '*') { out += '/*'; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) out += src[i++]; out += '*/'; i += 2; continue }
    if (c === '/' && looksLikeRegex(out)) { out += readRegexLiteral(); continue }
    if (c === '<' && exprPosition() && /[A-Za-z>]/.test(src[i + 1] ?? '')) { out += readElement(); lastTok = ')'; continue }
    if (!/\s/.test(c)) {
      if (isIdent(c)) lastTok = isIdent(lastTok.slice(-1) || '') ? lastTok + c : c
      else lastTok = c
    }
    out += c; i++
  }
  return { code: out, errs }
}

function findTsxFiles(dir) {
  let list = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'out' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) list = list.concat(findTsxFiles(p))
    else if (e.name.endsWith('.tsx')) list.push(p)
  }
  return list
}

const files = process.argv.length > 2 ? process.argv.slice(2) : findTsxFiles('src')
let bad = 0
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsxcheck-'))
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const { code, errs } = transform(src, f)
  let msg = ''
  if (errs.length) msg = errs.join(' · ')
  const out = path.join(tmp, path.basename(f).replace(/\.tsx?$/, '') + '.check.ts')
  fs.writeFileSync(out, 'const __J = (...a: any[]) => a\nvoid __J\n' + code)
  let parse = 'OK'
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', out], { stdio: 'pipe', timeout: 20000 })
  } catch (e) {
    const t = String(e.stderr ?? '') + String(e.stdout ?? '')
    if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(t)) parse = 'OK'
    else if (/SyntaxError|ERR_INVALID_TYPESCRIPT_SYNTAX|TransformError/.test(t)) {
      parse = 'SYNTAX ERROR'
      msg += '\n' + t.split('\n').slice(0, 14).join('\n')
    } else parse = 'OK'
  }
  const ok = parse === 'OK' && !errs.length
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}${ok ? '' : '\n  ' + msg}`)
}
console.log(bad ? `\n${bad} فایل مشکل نحوی دارد.` : `\nهمه‌ی ${files.length} فایل نحواً سالم‌اند.`)
process.exit(bad ? 1 : 0)
