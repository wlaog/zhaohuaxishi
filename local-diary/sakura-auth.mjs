import crypto from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiaryError } from './store.mjs';

const scrypt = promisify(crypto.scrypt);
const kdfOptions = { N:131072, r:8, p:1, maxmem:192 * 1024 * 1024 };
const cookieName = '__Host-diary-session';
const lifetime = 30 * 24 * 60 * 60 * 1000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !url.hostname.includes('.') || url.hostname.endsWith('.') || url.hostname.includes(':')) {
    throw Error('Sakura 访问地址必须是完整 HTTPS origin，不能包含路径或登录信息');
  }
  return url;
}

export function sakuraAccess(value) {
  if (!value || value.enabled === false) return null;
  const url = httpsOrigin(value.origin);
  const extra = value.additionalOrigins ?? [];
  if (!Array.isArray(extra) || extra.length > 4) throw Error('Sakura 备用地址需要是最多四个 HTTPS 地址的列表');
  const additionalOrigins = [...new Set(extra.map(origin => httpsOrigin(origin).origin))].filter(origin => origin !== url.origin);
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535
    || value.password?.algorithm !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(value.password.salt)
    || !/^[a-f0-9]{128}$/.test(value.password.hash)) {
    throw Error('Sakura 配置无效：需要完整 HTTPS 地址、独立本地端口和访问密码');
  }
  return { enabled:true, origin:url.origin, host:url.host, port:value.port, password:value.password, additionalOrigins };
}

export async function makeSakuraConfig({ origin, port, password, additionalOrigins }, previous = null) {
  let record = previous?.password;
  if (password !== undefined && password !== '') {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw Error('访问密码需要 12–256 个字符');
    const salt = crypto.randomBytes(16).toString('hex');
    record = { algorithm:'scrypt-v1', salt, hash:(await scrypt(password, salt, 64, kdfOptions)).toString('hex') };
  }
  return sakuraAccess({ enabled:true, origin, port, password:record, additionalOrigins:additionalOrigins ?? previous?.additionalOrigins ?? [] });
}

// This listener never inherits the trusted loopback bypass from the desktop listener.
// Forwarded headers describe transport, not identity. Authentication is always required.
export function createSakuraAuth(config, now = Date.now) {
  const origins = new Map([config.origin, ...(config.additionalOrigins ?? [])].map(origin => [new URL(origin).host, origin]));
  const sessions = new Map();
  let failures = [], verifying = false;
  function sessionKey(req) {
    const values = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName + '='));
    if (values.length !== 1) return null;
    const value = values[0].slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? digest(value) : null;
  }
  function authenticated(req) {
    for (const [key, expiry] of sessions) if (expiry <= now()) sessions.delete(key);
    return sessions.has(sessionKey(req));
  }
  return {
    connection(req) {
      const origin = origins.get(req.headers.host);
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        || !origin || req.headers['x-forwarded-proto'] !== 'https'
        || Object.keys(req.headers).some(key => key.startsWith('tailscale-'))) throw new DiaryError(403, 'Sakura 访问地址或 HTTPS 转发配置不正确');
      return { origin, remote:true, sakura:true };
    },
    authenticated,
    async login(password, res) {
      failures = failures.filter(time => time > now() - 15 * 60 * 1000);
      if (verifying || failures.length >= 5) {
        res.setHeader('Retry-After', '900');
        throw new DiaryError(429, '尝试过于频繁，请 15 分钟后重试');
      }
      if (typeof password !== 'string' || password.length > 256) throw new DiaryError(400, '密码格式无效');
      verifying = true;
      try {
        const candidate = await scrypt(password, config.password.salt, 64, kdfOptions);
        if (!crypto.timingSafeEqual(candidate, Buffer.from(config.password.hash, 'hex'))) {
          failures.push(now());
          throw new DiaryError(401, '密码不正确');
        }
        // Bound memory even if a valid client repeatedly logs in.
        authenticated({ headers:{} });
        const session = crypto.randomBytes(32).toString('hex');
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        sessions.set(digest(session), now() + lifetime);
        res.setHeader('Set-Cookie', cookie(session, lifetime / 1000));
      } finally { verifying = false; }
    },
    logout(req, res) {
      sessions.delete(sessionKey(req));
      res.setHeader('Set-Cookie', cookie('', 0));
    },
  };
}

// Desktop controller supplies the secret through stdin, never command arguments or logs.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const part of process.stdin) { input += part; if (input.length > 8192) throw Error('配置输入过大'); }
    const { previous, ...value } = JSON.parse(input.trim());
    const config = await makeSakuraConfig(value, previous);
    // host is derived from origin, so persist only canonical configuration fields.
    delete config.host;
    process.stdout.write(JSON.stringify(config));
  } catch (error) { process.stderr.write(error instanceof SyntaxError ? '无法读取 Sakura 配置输入' : error.message); process.exitCode = 1; }
}
