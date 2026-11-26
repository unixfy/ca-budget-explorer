/**
 * Greedy word wrap for SVG labels, measured by an average character width (`per` px).
 * Words are never split: a label whose first word can't fit is dropped (the block keeps its
 * colour, page roundel and table row), and text past `maxLines` or past a word that can't
 * fit ends in an ellipsis after the last whole word ("Corrections and…").
 * `firstPx` narrows only the first line (e.g. beside a page roundel).
 */
export function wrapText(
	s: string,
	px: number,
	per: number,
	maxLines: number,
	firstPx = px
): string[] {
	const fitOf = (i: number) => Math.floor((i ? px : firstPx) / per);
	if (fitOf(0) < 4 || maxLines < 1) return [];
	const lines: string[] = [];
	let cur = '';
	let cut = false;
	for (const w of s.split(/\s+/).filter(Boolean)) {
		const next = cur ? `${cur} ${w}` : w;
		if (next.length <= fitOf(lines.length)) cur = next;
		else if (cur && w.length <= fitOf(lines.length + 1)) {
			lines.push(cur);
			cur = w;
		} else {
			cut = true;
			break;
		}
	}
	if (cur) lines.push(cur);
	if (lines.length > maxLines) {
		lines.length = maxLines;
		cut = true;
	}
	if (!cut) return lines;
	// make room for the ellipsis by dropping whole words from the end
	while (lines.length) {
		const last = lines[lines.length - 1];
		if (last.length + 1 <= fitOf(lines.length - 1)) {
			lines[lines.length - 1] = last.replace(/[\s,;:–—-]+$/, '') + '…';
			return lines;
		}
		const sp = last.lastIndexOf(' ');
		if (sp > 0) lines[lines.length - 1] = last.slice(0, sp);
		else lines.pop();
	}
	return [];
}
