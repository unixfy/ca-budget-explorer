/**
 * Shared fetch client for ebudget.ca.gov (JSON API + PDFs).
 *
 * - Every response is cached on disk under `data-raw/{fy}/{pit}/...` so re-runs are
 *   offline/deterministic. Pass `refresh: true` (or `--refresh`) to bypass the cache.
 * - Polite: at most `concurrency` (default 4, max 4) requests in flight, small delay
 *   between requests, retries with exponential backoff on network errors / 5xx / 429.
 *
 * URL layout (reverse-engineered from the ebudget Angular bundle):
 *   API base : https://ebudget.ca.gov/api/{prefix}/{pit}/{fy}/...
 *              prefix = "budget" (2026-27+) or "publication" (2025-26 and earlier);
 *              resolved from https://ebudget.ca.gov/api/home/getLink.
 *   PDF root : https://ebudget.ca.gov/{fy}/pdf/{pit=="p" ? "" : publication + "/"}
 *              GovernorsBudget/{agencyCd}/{orgCd}.pdf   (department detail)
 *              BudgetSummary/...                         (summary schedules)
 */
import fs from 'node:fs';
import path from 'node:path';

export const EBUDGET_ORIGIN = 'https://ebudget.ca.gov';
const UA = 'ca-budget-explorer ETL (+https://github.com/; public-data research)';

export interface AppInfo {
	previousYear: string;
	currentYear: string;
	budgetYear: string;
	publication: string;
	publicationTitle: string;
	publicationDate: string;
	pit: string;
	proposedAppName: string;
}

export interface EBudgetOptions {
	fy: string;
	pit: string;
	/** "budget" | "publication"; auto-detected from getLink when omitted. */
	prefix?: string;
	rawRoot?: string;
	concurrency?: number;
	refresh?: boolean;
	log?: (msg: string) => void;
}

class Limiter {
	private active = 0;
	private queue: (() => void)[] = [];
	private max: number;
	constructor(max: number) {
		this.max = max;
	}
	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
		this.active++;
		try {
			return await fn();
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NotFoundError extends Error {}

export class EBudget {
	readonly fy: string;
	readonly pit: string;
	prefix: string | undefined;
	readonly rawDir: string;
	private limiter: Limiter;
	private refresh: boolean;
	private log: (msg: string) => void;
	appInfo!: AppInfo;
	stats = { network: 0, cached: 0, failed: 0 };

	constructor(opts: EBudgetOptions) {
		this.fy = opts.fy;
		this.pit = opts.pit;
		this.prefix = opts.prefix;
		this.rawDir = path.join(opts.rawRoot ?? 'data-raw', opts.fy, opts.pit);
		this.limiter = new Limiter(Math.min(4, Math.max(1, opts.concurrency ?? 4)));
		this.refresh = !!opts.refresh;
		this.log = opts.log ?? (() => {});
	}

	/** Resolve API prefix (budget|publication) and load appInfo. */
	async init(): Promise<this> {
		if (!this.prefix) {
			const raw = await this.fetchCached(
				`${EBUDGET_ORIGIN}/api/home/getLink`,
				path.join(this.rawDir, '..', '..', 'getLink.json'),
				'json'
			);
			const parsed = JSON.parse(raw.toString('utf8'));
			const links: Record<string, string | null>[] = JSON.parse(
				Array.isArray(parsed) ? parsed.join('') : JSON.stringify(parsed)
			);
			const link = links.find((l) => l.budgetYear === this.fy);
			const p = link?.[`detail_${this.pit}`] ?? link?.[`summary_${this.pit}`];
			const m = p?.match(/^\/?([a-z]+)\//);
			this.prefix = m ? m[1] : Number(this.fy.slice(0, 4)) >= 2026 ? 'budget' : 'publication';
			this.log(`api prefix for ${this.fy}/${this.pit}: ${this.prefix}`);
		}
		this.appInfo = await this.api<AppInfo>('appInfo');
		return this;
	}

	get apiBase(): string {
		return `${EBUDGET_ORIGIN}/api/${this.prefix}/${this.pit}/${this.fy}`;
	}

	/** Root for PDFs, mirrors the SPA's `pdfRootDir`. */
	get pdfRoot(): string {
		const pub = this.pit === 'p' ? '' : `${this.appInfo.publication}/`;
		return `${EBUDGET_ORIGIN}/${this.fy}/pdf/${pub}`;
	}

	apiUrl(p: string): string {
		return `${this.apiBase}/${p.replace(/^\//, '')}`;
	}

	deptPdfUrl(agencyCd: string, orgCd: string): string {
		return `${this.pdfRoot}GovernorsBudget/${agencyCd}/${orgCd}.pdf`;
	}

	/** GET JSON from the API (cached). Returns `fallback` on 404/empty if provided. */
	async api<T = unknown>(p: string, fallback?: T): Promise<T> {
		const file = path.join(this.rawDir, 'api', p.replace(/^\//, '') + '.json');
		try {
			const buf = await this.fetchCached(this.apiUrl(p), file, 'json');
			const txt = buf.toString('utf8').trim();
			if (!txt) {
				if (fallback !== undefined) return fallback;
				throw new NotFoundError(`empty response: ${p}`);
			}
			return JSON.parse(txt) as T;
		} catch (e) {
			if (fallback !== undefined) return fallback;
			throw e;
		}
	}

	/** GET a PDF (cached). Returns null when not published (404 / HTML fallback page). */
	async pdf(url: string): Promise<Buffer | null> {
		const rel = url.replace(EBUDGET_ORIGIN + '/', '').replace(/^\d{4}-\d{2}\/pdf\//, '');
		const file = path.join(this.rawDir, 'pdf', rel);
		try {
			const buf = await this.fetchCached(url, file, 'pdf');
			return buf.subarray(0, 5).toString() === '%PDF-' ? buf : null;
		} catch (e) {
			if (e instanceof NotFoundError) return null;
			throw e;
		}
	}

	private async fetchCached(url: string, file: string, kind: 'json' | 'pdf'): Promise<Buffer> {
		const missFile = file + '.404';
		if (!this.refresh) {
			if (fs.existsSync(file)) {
				this.stats.cached++;
				return fs.readFileSync(file);
			}
			if (fs.existsSync(missFile)) throw new NotFoundError(url);
		}
		return this.limiter.run(async () => {
			let lastErr: unknown;
			for (let attempt = 0; attempt < 5; attempt++) {
				try {
					this.stats.network++;
					await sleep(120);
					const res = await fetch(url, {
						headers: {
							'User-Agent': UA,
							Accept: kind === 'json' ? 'application/json' : 'application/pdf'
						},
						signal: AbortSignal.timeout(120_000)
					});
					if (
						res.status === 404 ||
						(kind === 'pdf' && res.headers.get('content-type')?.includes('text/html'))
					) {
						fs.mkdirSync(path.dirname(file), { recursive: true });
						fs.writeFileSync(missFile, String(res.status));
						throw new NotFoundError(url);
					}
					// The API answers unknown orgs/endpoints with a Spring JSON 500; treat a
					// repeated JSON 500 as "not published" rather than retrying forever.
					if (res.status === 500 && kind === 'json' && attempt >= 1) {
						const body = await res.text();
						if (body.includes('"status":500')) {
							fs.mkdirSync(path.dirname(file), { recursive: true });
							fs.writeFileSync(missFile, '500 ' + body);
							throw new NotFoundError(url);
						}
					}
					if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${url}`);
					if (!res.ok) throw new NotFoundError(`HTTP ${res.status} ${url}`);
					const buf = Buffer.from(await res.arrayBuffer());
					fs.mkdirSync(path.dirname(file), { recursive: true });
					fs.writeFileSync(file, buf);
					return buf;
				} catch (e) {
					if (e instanceof NotFoundError) throw e;
					lastErr = e;
					const wait = 800 * 2 ** attempt;
					this.log(`retry ${attempt + 1} in ${wait}ms: ${url} (${(e as Error).message})`);
					await sleep(wait);
				}
			}
			this.stats.failed++;
			throw lastErr;
		});
	}
}

/** Run `fn` over items with bounded concurrency (the client also limits network). */
export async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (t: T, i: number) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i], i);
			}
		})
	);
	return out;
}
