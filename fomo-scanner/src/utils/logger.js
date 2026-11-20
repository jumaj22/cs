// Logger console lisible : heure, niveau coloré, module.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = useColor
  ? { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', bold: '\x1b[1m' }
  : new Proxy({}, { get: () => '' });

let minLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
export function setLogLevel(level) {
  if (LEVELS[level] !== undefined) minLevel = LEVELS[level];
}

function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function out(level, color, tag, mod, args) {
  if (LEVELS[level] < minLevel) return;
  const prefix = `${C.dim}${ts()}${C.reset} ${color}${tag}${C.reset} ${mod ? `${C.cyan}[${mod}]${C.reset} ` : ''}`;
  const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(prefix + text + '\n');
}

function make(mod) {
  return {
    debug: (...a) => out('debug', C.dim, 'DEBUG', mod, a),
    info: (...a) => out('info', C.blue, 'INFO ', mod, a),
    success: (...a) => out('info', C.green, 'OK   ', mod, a),
    signal: (...a) => out('info', C.bold + C.magenta, 'SIGNAL', mod, a),
    warn: (...a) => out('warn', C.yellow, 'WARN ', mod, a),
    error: (...a) => out('error', C.red, 'ERROR', mod, a),
    child: (m) => make(m),
  };
}

export const logger = make('');
export const colors = C;
