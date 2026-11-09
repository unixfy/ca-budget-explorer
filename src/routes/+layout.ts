// SPA mode: there are thousands of drill-down paths per dataset and new datasets appear
// without a rebuild (manifest-driven), so pages are rendered client-side from static JSON
// and adapter-static emits an `index.html` fallback that serves every route.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
