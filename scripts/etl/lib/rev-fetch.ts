/**
 * Cached, polite HTTP client for the revenue ETL (ebudget.ca.gov + dof.ca.gov).
 *
 * Raw downloads are cached under `data-raw/{fy}/{pit}/rev/` so re-runs are offline and
 * deterministic; pass `--refresh` to re-download. At most 3 requests in flight, a short
 * delay between requests, and exponential-backoff retries on network errors / 429 / 5xx.
 */
import fs from 'node:fs';
import path from 'node:path';

export const EBUDGET = 'https://ebudget.ca.gov';
const UA = 'ca-budget-explorer revenue ETL (public budget data research)';

export class NotFound extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AppInfo {
	previousYear: string;
	currentYear: string;
	budgetYear: string;
	publication: string;
	publicationTitle: string;
	publicationDate: string;
	pit: string;
}

export class RevFetcher {
	fy: string;
	pit: string;
	rawDir: string;
	refresh: boolean;
	prefix = '';
	appInfo!: AppInfo;
	stats = { network: 0, cached: 0, missing: 0 };
	private active = 0;
	private queue: (() => void)[] = [];

	constructor(fy: string, pit: string, opts: { rawRoot?: string; refresh?: boolean } = {}) {
		this.fy = fy;
		this.pit = pit;
		this.rawDir = path.join(opts.rawRoot ?? 'data-raw', fy, pit, 'rev');
		this.refresh = !!opts.refresh;
	}

	/** Resolve the API prefix ("budget" | "publication") from getLink, then load appInfo. */
	async init(): Promise<this> {
		const raw = await this.getText(`${EBUDGET}/api/home/getLink`, 'getLink.json');
		let parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed) && typeof parsed[0] === 'string')
			parsed = JSON.parse(parsed.join(''));
		const links = parsed as Record<string, string | null>[];
		const link = links.find((l) => l.budgetYear === this.fy);
		const p = link?.[`summary_${this.pit}`] ?? link?.[`detail_${this.pit}`] ?? '';
		const m = p.match(/^\/?([a-z]+)\//);
		this.prefix = m ? m[1] : Number(this.fy.slice(0, 4)) >= 2026 ? 'budget' : 'publication';
		this.appInfo = await this.api<AppInfo>('appInfo');
		return this;
	}

	apiUrl(p: string) {
		return `${EBUDGET}/api/${this.prefix}/${this.pit}/${this.fy}/${p.replace(/^\//, '')}`;
	}

	/** Mirrors the ebudget SPA's pdfRootDir: /{fy}/pdf/{publication/ unless pit p}. */
	get pdfRoot() {
		return `${EBUDGET}/${this.fy}/pdf/${this.pit === 'p' ? '' : this.appInfo.publication + '/'}`;
	}

	summaryPdfUrl(file: string) {
		return `${this.pdfRoot}BudgetSummary/${file}`;
	}

	fcsPdfUrl(agencyCd: string, orgCd: string) {
		return `${this.pdfRoot}GovernorsBudget/${agencyCd}/${orgCd}FCS.pdf`;
	}

	async api<T>(p: string, fallback?: T): Promise<T> {
		try {
			const txt = (await this.getText(this.apiUrl(p), path.join('api', p + '.json'))).trim();
			if (!txt) throw new NotFound(p);
			return JSON.parse(txt) as T;
		} catch (e) {
			if (fallback !== undefined) return fallback;
			throw e;
		}
	}

	/** Returns null when the PDF is not published (404 or HTML fallback page). */
	async pdf(url: string): Promise<Buffer | null> {
		const rel = path.join('pdf', url.replace(/^https?:\/\/[^/]+\//, ''));
		try {
			const buf = await this.get(url, rel, 'pdf');
			if (buf.subarray(0, 5).toString() !== '%PDF-') return null;
			return buf;
		} catch (e) {
			if (e instanceof NotFound) return null;
			throw e;
		}
	}

	async getText(url: string, rel: string) {
		return (await this.get(url, rel, 'json')).toString('utf8');
	}

	private async slot<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= 3) await new Promise<void>((r) => this.queue.push(r));
		this.active++;
		try {
			return await fn();
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}

	private async get(url: string, rel: string, kind: 'json' | 'pdf'): Promise<Buffer> {
		const file = path.join(this.rawDir, rel);
		const miss = file + '.missing';
		if (!this.refresh) {
			if (fs.existsSync(file)) {
				this.stats.cached++;
				return fs.readFileSync(file);
			}
			if (fs.existsSync(miss)) {
				this.stats.missing++;
				throw new NotFound(url);
			}
		}
		return this.slot(async () => {
			let last: unknown;
			for (let attempt = 0; attempt < 5; attempt++) {
				try {
					await sleep(150 + attempt * attempt * 1000);
					this.stats.network++;
					const res = await fetch(url, {
						headers: {
							'User-Agent': UA,
							Accept: kind === 'pdf' ? 'application/pdf' : 'application/json'
						},
						signal: AbortSignal.timeout(120_000)
					});
					const ctype = res.headers.get('content-type') ?? '';
					if (res.status === 404 || (kind === 'pdf' && res.ok && ctype.includes('text/html'))) {
						fs.mkdirSync(path.dirname(file), { recursive: true });
						fs.writeFileSync(miss, String(res.status));
						this.stats.missing++;
						throw new NotFound(url);
					}
					if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${url}`);
					if (!res.ok) throw new NotFound(`HTTP ${res.status} ${url}`);
					const buf = Buffer.from(await res.arrayBuffer());
					fs.mkdirSync(path.dirname(file), { recursive: true });
					fs.writeFileSync(file, buf);
					return buf;
				} catch (e) {
					if (e instanceof NotFound) throw e;
					last = e;
				}
			}
			throw last;
		});
	}
}
