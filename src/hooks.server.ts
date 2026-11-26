import type { HandleFetch } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';
import { setServerRead } from '#lib/data/load.ts';

const assets = env.ASSETS;

// Large /data files bypass SvelteKit's fetch so they are not copied into every page's HTML.
// dataUrl() may be page-relative ("../../data/…"); against the root it resolves to /data/….
if (!import.meta.env.DEV && assets)
	setServerRead((url) => assets.fetch(new URL(url, 'http://assets/')));

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
