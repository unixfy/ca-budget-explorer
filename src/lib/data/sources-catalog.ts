/**
 * Shape of static/data/{fy}/{pit}/sources-catalog.json (built by scripts/etl/sources-catalog.ts)
 * plus a fetch-and-cache loader.
 *
 * The catalog is a tree of every place California budget information is published:
 *   root -> publisher -> publication -> document type -> document / endpoint (or series)
 * Branches the explorer actually downloads carry measured volumes (files, bytes, pages, how many
 * nodes of our data files cite them); the rest are hand-curated "not used (yet)" references.
 */
import { dataUrl, DataError } from './load.ts';

export type CatalogLevel = 'root' | 'publisher' | 'publication' | 'docType' | 'document';
export type CatalogFormat = 'JSON' | 'PDF' | 'PNG' | 'XLSX' | 'CSV' | 'HTML' | 'DOCX';
/** The explorer's own data files (static/data/{fy}/{pit}/*.json). */
export type Product =
	'meta' | 'expenditures' | 'departments' | 'funds' | 'revenues' | 'flows' | 'reconciliation';

/**
 * official: the State's own budget documents/data; analysis: non-partisan commentary (LAO);
 * reference: manuals, code lists and other material needed to *read* the numbers.
 */
export type SourceKind = 'official' | 'analysis' | 'reference';

export interface CatalogNode {
	id: string;
	name: string;
	level: CatalogLevel;
	/** Used by this explorer's ETLs (true), or only listed for completeness (false). */
	used: boolean;
	kind?: SourceKind;
	description?: string;
	url?: string;
	/**
	 * URL check by the catalog author (HTTP 200 from a plain request). false = could not be
	 * verified automatically (bot protection / captcha), the link may still be correct.
	 */
	verified?: boolean;
	formats?: CatalogFormat[];
	/** Unit convention as printed, e.g. "thousands of dollars". */
	units?: string;
	years?: string;
	granularity?: string;
	/** Which of the explorer's data files this source feeds. */
	feeds?: Product[];
	/** Files actually downloaded (data-raw/), bytes, and PDF pages parsed. */
	files?: number;
	bytes?: number;
	pages?: number;
	/** Number of citations (SourceRefs) in our data files that point at this source, by product. */
	backs?: Partial<Record<Product, number>>;
	/** Ids of CatalogPainPoint entries that apply to this node. */
	pain?: string[];
	/** For a collapsed series: how many documents it stands for. */
	count?: number;
	/** A few concrete examples (links) for a series node. */
	examples?: { label: string; url: string }[];
	/** Expected to exist but not published (e.g. May Revision schedules). */
	missing?: boolean;
	children?: CatalogNode[];
}

export interface CatalogPainPoint {
	id: string;
	title: string;
	body: string;
	/** A concrete instance found in this dataset. */
	example?: string;
	/** Rough category, used for grouping/icons. */
	tag: 'format' | 'units' | 'codes' | 'coverage' | 'consistency' | 'access';
}

export interface CatalogStats {
	publishers: number;
	publishersUsed: number;
	publications: number;
	documentTypes: number;
	/** Leaf documents/endpoints, counting each series by its document count. */
	documents: number;
	documentsUsed: number;
	formats: CatalogFormat[];
	unitConventions: string[];
	codeSystems: string[];
	filesDownloaded: number;
	bytesDownloaded: number;
	pdfPagesParsed: number;
	handTranscribed: number;
	citations: number;
	apiEndpoints: number;
	crossChecks?: { total: number; ok: number };
	etlMessages?: number;
}

export interface SourcesCatalog {
	fiscalYear: string;
	pit: string;
	publication: string;
	generatedAt: string;
	root: CatalogNode;
	painPoints: CatalogPainPoint[];
	stats: CatalogStats;
	products: { id: Product; label: string; file: string; nodes?: number }[];
	notes: string[];
}

const cache = new Map<string, Promise<SourcesCatalog>>();

export async function getSourcesCatalog(
	dir: string,
	f: typeof fetch = fetch
): Promise<SourcesCatalog> {
	const url = dataUrl(`${dir}/sources-catalog.json`);
	let p = cache.get(url);
	if (!p) {
		p = f(url).then(async (r) => {
			if (!r.ok) throw new DataError(`sources-catalog.json: HTTP ${r.status}`, r.status, url);
			const t = await r.text();
			if (/^\s*</.test(t)) throw new DataError('sources-catalog.json not found', 404, url);
			return JSON.parse(t) as SourcesCatalog;
		});
		cache.set(url, p);
		p.catch(() => cache.delete(url));
	}
	return p;
}
