// Only what hooks.server.ts uses. Including the full Workers types (worker-configuration.d.ts)
// would replace the DOM types app-wide, e.g. Response.json() would return unknown.
declare module 'cloudflare:workers' {
	export const env: { ASSETS?: { fetch: typeof fetch } };
}
