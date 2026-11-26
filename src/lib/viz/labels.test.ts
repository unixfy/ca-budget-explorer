import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from './labels.ts';

// per = 1 so `px` is the number of characters per line
test('wraps on words and keeps everything that fits', () => {
	assert.deepEqual(wrapText('Health and Human Services', 12, 1, 3), [
		'Health and',
		'Human',
		'Services'
	]);
});

test('never splits a word: a first word that cannot fit drops the label', () => {
	assert.deepEqual(wrapText('Environmental Protection', 8, 1, 3), []);
});

test('ellipsis goes after the last whole word', () => {
	assert.deepEqual(wrapText('Corrections and Rehabilitation', 16, 1, 1), ['Corrections and…']);
	assert.deepEqual(wrapText('Legislative, Judicial, and Executive', 13, 1, 1), ['Legislative…']);
});

test('a word too long mid-label ends the label there', () => {
	assert.deepEqual(wrapText('K thru 12 Education', 8, 1, 3), ['K thru', '12…']);
});

test('a narrower first line (beside a roundel) still lets later lines use the full width', () => {
	assert.deepEqual(wrapText('General Government', 10, 1, 2, 8), ['General', 'Government']);
});

test('too narrow for any label', () => {
	assert.deepEqual(wrapText('Anything', 3, 1, 2), []);
});
