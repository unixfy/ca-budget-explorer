import type { HandleFetch } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';

const assets = (env as { ASSETS?: { fetch: typeof fetch } }).ASSETS;

// SvelteKit fetches static/ files during SSR over the network (the worker calling its own URL),
// which 404s on deployed Workers. Serve /data/* straight from the assets binding instead.
export const handleFetch: HandleFetch = ({ event, request, fetch }) => {
	const url = new URL(request.url);
	if (
		!import.meta.env.DEV &&
		assets &&
		url.origin === event.url.origin &&
		url.pathname.startsWith('/data/')
	)
		return assets.fetch(request);
	return fetch(request);
};
