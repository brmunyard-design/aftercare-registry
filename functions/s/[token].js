import { serveShell } from '../../lib/shell.js';

// /s/<token> is a supporter's private link (or QR code). The page itself fetches /api/s/<token>.
export const onRequestGet = ({ request, env }) => serveShell(request, env, '/supporter');
