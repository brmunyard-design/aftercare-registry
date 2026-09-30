import { serveShell } from '../../lib/shell.js';

// /c/<token> is a supporter's own commitment link. The page itself fetches /api/c/<token>.
export const onRequestGet = ({ request, env }) => serveShell(request, env, '/commitment');
