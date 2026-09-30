import { handle } from '../../lib/api.js';

export const onRequest = ({ request, env }) => handle(request, env);
