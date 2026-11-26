// Server-rendered on Cloudflare: pages render on request from the static JSON under /data,
// so new manifest-driven datasets and the thousands of drill-down paths need no prerender.
export const prerender = false;
export const trailingSlash = 'never';
