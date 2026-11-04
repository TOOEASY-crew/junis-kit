// Opens a link in the user's browser when a person sits at this terminal. The
// link is always printed as well, so failing to open it is never an error.
import { spawn } from 'node:child_process';

export function openInBrowser(url, { allowedOrigin, isTTY = process.stdout.isTTY, platform = process.platform, env = process.env } = {}) {
  if (!isTTY) return false;
  let target;
  try {
    target = new URL(url);
    // Only pages of the web app this kit is set up for; any other link is shown, not opened.
    if (allowedOrigin && target.origin !== new URL(allowedOrigin).origin) return false;
  } catch {
    return false;
  }
  if (!/^https?:$/.test(target.protocol)) return false;
  // Over SSH the browser would open on the remote machine, and a Linux shell
  // without a display (a container, a server) has no browser to open.
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform !== 'darwin' && platform !== 'win32' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  const [command, args] =
    platform === 'darwin'
      ? ['open', [target.href]]
      : platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', target.href]] // no shell, so `&` in the link stays text
        : ['xdg-open', [target.href]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, env });
    // A missing opener is reported as an 'error' event, which would otherwise end the process.
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
