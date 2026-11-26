import type { HandleFetch } from '@sveltejs/kit';

// Cloudflare: a worker can't reliably fetch its own URL (fails on *.workers.dev previews),
// so SSR reads the static /data JSON straight from the assets binding.
export const handleFetch: HandleFetch = ({ event, request, fetch }) => {
	const assets = event.platform?.env?.ASSETS;
	const url = new URL(request.url);
	if (assets && url.origin === event.url.origin && url.pathname.startsWith('/data/'))
		return assets.fetch(request);
	return fetch(request);
};
