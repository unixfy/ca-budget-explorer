/**
 * Documented differences between official sources, used by the reconciliation ETL to mark a check
 * "explained" instead of "differs".
 *
 * Rules (so this never hides a real problem):
 *   - an entry explains one exact amount (thousands) for one department / fund type / year; the
 *     reconciliation recomputes every difference from the data and only matches an entry when the
 *     recomputed amount equals `amount` (±1);
 *   - a check is "explained" only when matched entries account for the whole difference;
 *   - every entry cites the exact source pages on both sides.
 * Anything new or changed in the data therefore shows up as an unexplained difference again.
 */
import type { SourceRef } from '../../../src/lib/data/schema.ts';

export type ExpFundType = 'general' | 'special' | 'bond' | 'federal';
export type Yr = 'py' | 'cy' | 'by';

export interface SourceHelpers {
	/** DOF Summary Schedule 9 */
	s9: (page: number) => SourceRef;
	/** department budget detail PDF ({agency}/{org}.pdf) */
	dept: (agencyCd: string, orgCd: string, page: number, what?: string) => SourceRef;
	/** fund condition statements PDF ({agency}/{org}FCS.pdf) */
	fcs: (agencyCd: string, orgCd: string, page: number, what?: string) => SourceRef;
	/** ebudget API endpoint */
	api: (p: string) => SourceRef;
}

/** Explorer department detail (expenditures.json) minus Schedule 9, for one department. */
export interface DeptDifference {
	orgCd: string;
	fundType: ExpFundType;
	year: Yr;
	/** explorer − Schedule 9, thousands */
	amount: number;
	label: string;
	cause: string;
	sources: SourceRef[];
}

export function departmentDifferences(
	fy: string,
	pit: string,
	h: SourceHelpers
): Omit<DeptDifference, 'label'>[] {
	if (fy !== '2026-27' || pit !== 'e') return [];
	return [
		{
			orgCd: '1996',
			fundType: 'general',
			year: 'cy',
			amount: 3_048,
			cause:
				'General obligation bond debt service (Business and Consumer Services) is a statewide item with no department page. ebudget’s expenditures-by-fund (rwaCntl/support/1996) and program list (orgProgram/1996, program 1620 “GO Bonds - Debt Service - BCS”) report 2025-26 General Fund spending of $202,890K; Schedule 9 (p. 4, “Totals,1996-General Obligation Bonds-BCS”) reports $199,842K. No other official document reconciles the two; the explorer keeps the department-level figure.',
			sources: [h.api('rwaCntl/support/1996'), h.api('orgProgram/1996'), h.s9(4)]
		},
		{
			orgCd: '2665',
			fundType: 'special',
			year: 'cy',
			amount: 14_000,
			cause:
				'High-Speed Rail Authority capital outlay from the Greenhouse Gas Reduction Fund (3228), 2025-26: the department’s Summary of Projects and Detail of Appropriations (2665 PDF p. 5, Phase 1 Blended System; “TOTALS, EXPENDITURES $4,432,744” after a −$8,000K “2025-26 Cap-and-Invest Auction Proceeds Adjustment”) and rwaCntl report $4,432,744K. The fund’s own condition statement (3900 Air Resources Board FCS p. 3, “2665 High-Speed Rail Authority (Capital Outlay) 4,418,744”) and Schedule 9 (p. 5, capital outlay) report $4,418,744K — $14,000K less.',
			sources: [
				h.dept('2500', '2665', 5, 'Summary of Projects / Detail of Appropriations'),
				h.fcs('3890', '3900', 3, 'Greenhouse Gas Reduction Fund condition statement'),
				h.s9(5)
			]
		},
		{
			orgCd: '3340',
			fundType: 'general',
			year: 'cy',
			amount: -6_396,
			cause:
				'California Conservation Corps, 2025-26 capital outlay: the department’s Summary of Projects (3340 PDF p. 7) lists $6,396K for project 0003516 “Residential Center, Greenwood: New Residential Center”, but the FUNDING block under it and the Detail of Appropriations (pp. 7–8; General Fund capital outlay “TOTALS, EXPENDITURES –”) attribute no fund to it, so ebudget’s capital outlay by fund (rwaCntl/capOutlay/3340) and the explorer’s department funding total omit it. Schedule 9 (p. 6, 3340 capital outlay) counts it as General Fund. The explorer’s 3340 program tree shows the project amount as an unreconciled infrastructure line.',
			sources: [
				h.dept('3000', '3340', 7, 'Summary of Projects'),
				h.api('rwaCntl/capOutlay/3340'),
				h.s9(6)
			]
		},
		{
			orgCd: '8570',
			fundType: 'general',
			year: 'cy',
			amount: -983,
			cause:
				'Department of Food and Agriculture, 2025-26 General Fund capital outlay: the department’s Summary of Projects (8570 PDF p. 15, project 0014655 Meadowview Biological Control Office, preliminary plans) and Detail of Appropriations (p. 16, item 301 “$595”) and rwaCntl report $595K; Schedule 9 (p. 14, 8570 capital outlay, General Fund) reports $1,578K.',
			sources: [
				h.dept('8000', '8570', 15, 'Summary of Projects'),
				h.dept('8000', '8570', 16, 'Detail of Appropriations — capital outlay'),
				h.s9(14)
			]
		}
	];
}
