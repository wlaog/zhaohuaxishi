import { DiaryError } from './store.mjs';

// Only Tailscale Serve on this machine may supply identity/forwarding headers.
// The HTTP listener must remain bound to loopback, even when remote access is on.
export function remoteAccess(config) {
  if (!config || config.enabled === false) return null;
  const url = new URL(config.origin);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || typeof config.login !== 'string' || !/^[\x21-\x7e]+$/.test(config.login)) {
    throw new Error('远程访问配置无效：需要 Tailscale HTTPS 地址和登录身份');
  }
  return { origin: url.origin, host: url.host, login: config.login };
}

export function requestAccess(req, port, remote) {
  const deny = message => { throw new DiaryError(403, message); };
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) deny('仅允许本机代理连接');
  const h = req.headers, localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const forwarded = Object.keys(h).some(key => key.startsWith('x-forwarded-') || key.startsWith('tailscale-'));
  if (!forwarded && localHosts.includes(h.host)) return { origin: `http://${h.host}`, remote: false };
  if (!remote || !forwarded || h['tailscale-funnel-request'] !== undefined
    || h['tailscale-user-login'] !== remote.login
    || h['x-forwarded-proto'] !== 'https' || h['x-forwarded-host'] !== remote.host
    || ![remote.host, ...localHosts].includes(h.host)) deny('此设备的 Tailscale 身份或访问地址未获授权');
  return { origin: remote.origin, remote: true };
}
