/**
 * The two PDF money parsers. They read different DOF documents, and parentheses mean different
 * things there: in department detail PDFs "(3,178)" is a non-add figure (shown, not summed); in
 * the Summary Schedules it is a negative amount. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNum } from './exp-pdf.ts';
import { parseAmount, splitRow, type Tok } from './rev-pdf.ts';

test('parseNum (department detail PDFs)', () => {
	const cases: [string, number, boolean][] = [
		['$1,234', 1234, false],
		['-$3,756', -3756, false],
		['- $5', -5, false],
		['1,832.6', 1832.6, false],
		['-', 0, false],
		['$ -', 0, false],
		['(3,178)', 3178, true],
		['(-)', 0, true]
	];
	for (const [s, v, nonAdd] of cases) assert.deepEqual(parseNum(s), { v, nonAdd }, s);
});

test('parseAmount (Summary Schedules, fund condition statements)', () => {
	const cases: [string, number | undefined][] = [
		['$1,234', 1234],
		['-$3,756', -3756],
		['- $5', -5],
		['$1,234.50', 1234.5],
		['-', 0],
		['$ -', 0],
		['(3,178)', -3178],
		['', undefined],
		['Total', undefined]
	];
	for (const [s, v] of cases) assert.equal(parseAmount(s), v, s);
});

test('splitRow merges a doubled dash into one zero and keeps the label', () => {
	const tok = (x: number, s: string): Tok => ({ x, r: x + 10, s });
	const row = {
		page: 1,
		y: 0,
		toks: [
			tok(10, 'Personal Income Tax'),
			tok(300, '$ -'),
			tok(305, '-'),
			tok(400, '1,234'),
			tok(500, '-5')
		]
	};
	const { label, vals } = splitRow(row, 250);
	assert.equal(label, 'Personal Income Tax');
	assert.deepEqual(vals, [0, 1234, -5]);
});
