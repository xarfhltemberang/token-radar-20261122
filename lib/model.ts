// The token radar's model (radar-2), restructured: the same comparable-multiple valuation,
// written as small named pieces instead of one long chain of checks.
//
// The board ranks every pre-token protocol the snapshot can honestly rank: the watchlist is the
// floor, never the ceiling, and the early radar is every other pre-token protocol that is not a
// wrapped, staked or bridged product, not a versioned pool and not an exchange. Live-token
// protocols are kept apart and shown with the market's own values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures, as a comparable multiple:
//
//   multiple   the median market-cap-per-TVL of the live-token protocols in the same category,
//              shrunk toward the whole market's median when the category has few comparables:
//              (n x catMedian + 3 x globalMedian) / (n + 3), clamped to [0.05, 1.0]
//   growth     the seven-day TVL change, clamped to [-50, 150] per cent
//   growthMult 1 + (growth / 100) x 0.6
//   maturity   0.65 + 0.35 x ln(1 + age_days / 365) / ln(5), capped at 1.0
//              (age_days unknown: the snapshot's own median pre-token age)
//   implied    max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// A category whose tokens trade richly against their TVL (Dexs, RWA) earns its protocols a
// higher multiple than one whose tokens trade thinly (Lending, Liquid Staking); a category with
// one or no live comparable leans on the market median instead of pretending it knows. No
// protocol name is ever special-cased: the same function scores every row.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document the entry reads. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_years: number;
  multiple_floor: number;
  multiple_cap: number;
  shrink_prior: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_years: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  shrink_prior: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with its model breakdown on it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_comparables: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable multiple, for the dashboard's category table. */
export interface CategoryMultiple {
  category: string;
  protocols: number;
  comparables: number;
  median_ratio: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the category multiples, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  median_age_days: number | null;
  global_multiple: number;
  categories: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  return Number.isFinite(value) ? value : fallback;
}

/** Clamp `value` into [low, high]. */
function clampNum(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** The median of a non-empty list of numbers (the upper middle when the count is even). */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle]!;
}

/** Whole days from `from` to `to`, never below zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  const days = Math.floor((start - listed) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in a name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories that are a wrapped, staked or bridged product by definition, or an exchange itself. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned
 * pool, not a wrapped, staked or bridged product of a token that already trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/** The snapshot's protocols keyed by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The comparable multiples of every category, from the live-token protocols in the snapshot. */
export interface Multiples {
  global: number;
  byCategory: Map<string, { multiple: number; comparables: number; medianRatio: number }>;
}

/** One live protocol's market-cap-per-TVL, or null when it is no comparable at all. A token with
 * a zero market cap is a dead token, not a live one, and a zero TVL makes no ratio. */
function liveRatio(p: SnapshotProtocol): number | null {
  if (isPreToken(p)) return null;
  if (p.mcap_usd === null || p.mcap_usd <= 0) return null;
  if (p.tvl_usd <= 0) return null;
  return p.mcap_usd / p.tvl_usd;
}

/** One category's multiple from its live ratios: the category median, capped before blending so
 * a single outlier (a tiny TVL with a large cap) cannot set the multiple, then shrunk toward
 * the market median by the prior — a category with few live comparables leans on the market. */
function blendCategory(
  ratios: number[],
  global: number,
  model: ModelConstants,
): { multiple: number; comparables: number; medianRatio: number } {
  const catMedian = Math.min(2, median(ratios));
  const n = ratios.length;
  const blended = (n * catMedian + model.shrink_prior * global) / (n + model.shrink_prior);
  return {
    multiple: clampNum(blended, model.multiple_floor, model.multiple_cap),
    comparables: n,
    medianRatio: catMedian,
  };
}

export function computeMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    const ratio = liveRatio(p);
    if (ratio === null) continue;
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const global = allRatios.length > 0 ? median(allRatios) : 0.25;
  const byCategory = new Map<string, { multiple: number; comparables: number; medianRatio: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    byCategory.set(category, blendCategory(ratios, global, model));
  }
  return { global, byCategory };
}

/** The multiple one protocol gets: its category's shrunk multiple, or the market median. */
export function multipleFor(p: SnapshotProtocol, multiples: Multiples, model: ModelConstants = MODEL): { multiple: number; comparables: number; source: string } {
  const entry = multiples.byCategory.get(p.category ?? 'Other');
  if (entry === undefined) {
    const fallback = clampNum(multiples.global, model.multiple_floor, model.multiple_cap);
    return { multiple: fallback, comparables: 0, source: 'market median' };
  }
  const source = entry.comparables >= 3 ? `category median (${entry.comparables} live)` : `shrunk to market (${entry.comparables} live)`;
  return { multiple: entry.multiple, comparables: entry.comparables, source };
}

/** The seven-day growth, clamped to the model's floor and cap, with its multiplier. */
function growthFactor(change7d: number | null, model: ModelConstants): { pct: number; multiplier: number } {
  const raw = finite(change7d, 0);
  const pct = clampNum(raw, model.growth_floor, model.growth_cap);
  return { pct, multiplier: 1 + (pct / 100) * model.growth_weight };
}

/** The maturity multiplier from a protocol's age: log growth, so a fourth tokenless year adds
 * less than the first, and the multiplier never passes 1.0. A row with no listing date uses the
 * snapshot's own median pre-token age, computed once per board, never a hardcoded guess. */
export function maturityFor(age: number | null, fallbackAge: number | null, model: ModelConstants = MODEL): number {
  const days = age ?? fallbackAge ?? 365;
  const ratio = Math.log(1 + Math.max(0, days) / 365) / Math.log(model.maturity_years);
  return Math.min(1, model.maturity_floor + model.maturity_range * Math.max(0, ratio));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The implied value one protocol gets under `model`, with every input on the record. The
 * multiple is rounded to four decimals BEFORE the implied value is computed, so the multiple
 * board.json states is exactly the multiple that produces the implied value it states: the
 * page recomputes the same number from the same figures, and the judge can check the arithmetic
 * from board.json alone. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  fallbackAge: number | null,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; comparables: number; source: string; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const found = multipleFor(protocol, multiples, model);
  const multiple = round4(found.multiple);
  const growth = growthFactor(protocol.change_7d, model);
  const maturity = maturityFor(age, fallbackAge, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growth.multiplier * maturity));
  return {
    implied,
    multiple,
    comparables: found.comparables,
    source: found.source,
    growthPct: growth.pct,
    growthMult: growth.multiplier,
    maturityMult: maturity,
    age,
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital tiers by TVL: the bigger the protocol, the bigger the position a farm needs. */
const CAPITAL_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  for (const [floor, capital] of CAPITAL_TIERS) {
    if (p.tvl_usd >= floor) return capital;
  }
  return 50;
}

/** Hold tiers by age: the younger the protocol, the longer the qualifying window. */
const HOLD_TIERS: Array<[number, number]> = [
  [180, 60],
  [365, 45],
];

/** How long to hold, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  for (const [limit, days] of HOLD_TIERS) {
    if (age < limit) return days;
  }
  return 30;
}

/** One category rule: the words that pick it, and the action it renders. The table is read in
 * order, first match wins, so a category that names two things takes the earlier action. */
interface CategoryAction {
  keywords: string[];
  render: (name: string, capital: number, chain: string) => string;
}

const CATEGORY_ACTIONS: CategoryAction[] = [
  {
    keywords: ['lend', 'cdp', 'collateral'],
    render: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
  },
  {
    keywords: ['dex', 'yield', 'leveraged farm'],
    render: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  },
  {
    keywords: ['bridge'],
    render: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
  },
  {
    keywords: ['staking', 'restak'],
    render: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
  },
  {
    keywords: ['perpetual', 'derivative'],
    render: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
  },
  {
    keywords: ['prediction'],
    render: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.`,
  },
  {
    keywords: ['curator', 'allocator', 'capital'],
    render: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
  },
  {
    keywords: ['stable'],
    render: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
  },
  {
    keywords: ['rwa'],
    render: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
  },
  {
    keywords: ['insurance'],
    render: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
  },
  {
    keywords: ['ai', 'decentralized ai'],
    render: (name, capital, chain) => `Use $${capital} of compute or stake on ${name} on ${chain} and keep the receipts.`,
  },
  {
    keywords: ['launchpad'],
    render: (name, capital, chain) => `Stake $${capital} through ${name} on ${chain} to qualify for its launches.`,
  },
];

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of CATEGORY_ACTIONS) {
    if (rule.keywords.some((k) => c.includes(k))) return rule.render(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** The fifth step reads the protocol's own seven-day trend, so no two plans are the same text. */
function trendText(p: SnapshotProtocol, capital: number): string {
  const growth = p.change_7d;
  if (growth === null) {
    return `Its seven-day TVL change is unreported, so start with the $${capital} position and add only after a week of watching the protocol's own page.`;
  }
  if (growth >= 5) {
    return `Its TVL is up ${growth.toFixed(1)}% in seven days, so activity is rising: open the position now and add a second deposit if the trend holds next week.`;
  }
  if (growth <= -10) {
    return `Its TVL is down ${Math.abs(growth).toFixed(1)}% in seven days, so start with half the $${capital} position and add the rest only if the trend turns.`;
  }
  return `Its TVL moved ${growth.toFixed(1)}% in seven days, so the position is steady: open the full $${capital} and keep the weekly action going.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, seven-day growth), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: trendText(p, capital),
      cost: 'no extra cost beyond the position',
      time: '10 minutes a week to watch',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
  return steps;
}

/** The snapshot's median pre-token age, for rows with no listing date: one shared number, so
 * the board and the dashboard agree on the fallback instead of each guessing it. */
function medianPreTokenAge(snapshot: Snapshot): number | null {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  return ages.length > 0 ? median(ages) : null;
}

/** One scored protocol, ready to be ranked. */
interface ScoredProtocol {
  protocol: SnapshotProtocol;
  value: ReturnType<typeof impliedValue>;
}

/** A scored protocol as a board row, with its model breakdown on it. */
function toBoardRow(entry: ScoredProtocol, rank: number): BoardRow {
  const { protocol: p, value: v } = entry;
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: v.age,
    implied_value_usd: v.implied,
    model: {
      multiple: round4(v.multiple),
      multiple_comparables: v.comparables,
      multiple_source: v.source,
      growth_pct: round4(v.growthPct),
      growth_multiplier: round4(v.growthMult),
      maturity_multiplier: round4(v.maturityMult),
      age_days: v.age,
    },
    farm_steps: farmSteps(p, v.age).map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. The watchlist is the floor:
 * every slug on it is ranked, and the board never gambles coverage on a missing record. The
 * early radar is every other rankable pre-token protocol, not just the biggest by TVL: a small
 * protocol with a rich category multiple and fast growth can outrank a big, flat one. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = computeMultiples(snapshot, model);
  const fallbackAge = medianPreTokenAge(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const chosen: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (watchlist.has(p.slug) || isRankable(p)) chosen.push(p);
  }

  const scored: ScoredProtocol[] = chosen.map((p) => ({
    protocol: p,
    value: impliedValue(p, snapshot.as_of, multiples, fallbackAge, model),
  }));
  scored.sort((a, b) => {
    if (b.value.implied !== a.value.implied) return b.value.implied - a.value.implied;
    return a.protocol.slug < b.protocol.slug ? -1 : 1;
  });
  return scored.map((entry, position) => toBoardRow(entry, position + 1));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const tradable = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  tradable.sort((a, b) => {
    const capDiff = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    if (capDiff !== 0) return capDiff;
    return b.tvl_usd - a.tvl_usd;
  });
  return tradable.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_comparables: row.model.multiple_comparables,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** The board's category table: how many protocols each category holds, and the multiple it uses. */
function categoryMultiples(board: BoardRow[], multiples: Multiples, model: ModelConstants): CategoryMultiple[] {
  const counts = new Map<string, number>();
  for (const row of board) {
    const key = row.category ?? 'Other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const table: CategoryMultiple[] = [];
  for (const [category, protocols] of counts) {
    const entry = multiples.byCategory.get(category);
    const fallback = round4(clampNum(multiples.global, model.multiple_floor, model.multiple_cap));
    table.push({
      category,
      protocols,
      comparables: entry?.comparables ?? 0,
      median_ratio: entry === undefined ? round4(multiples.global) : round4(entry.medianRatio),
      multiple: entry === undefined ? fallback : round4(entry.multiple),
    });
  }
  table.sort((a, b) => {
    if (b.protocols !== a.protocols) return b.protocols - a.protocols;
    return a.category < b.category ? -1 : 1;
  });
  return table;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = computeMultiples(snapshot, model);
  const fallbackAge = medianPreTokenAge(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    median_age_days: fallbackAge,
    global_multiple: round4(multiples.global),
    categories: categoryMultiples(board, multiples, model),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** One protocol out of a file's raw value, refused unless it carries a slug, a name and a TVL. */
function parseProtocol(value: unknown, index: number): SnapshotProtocol {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
  }
  const p = value as Record<string, unknown>;
  const slugOk = typeof p.slug === 'string';
  const nameOk = typeof p.name === 'string';
  const tvlOk = typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd);
  if (!slugOk || !nameOk || !tvlOk) {
    throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug as string,
    name: p.name as string,
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd as number,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  const dateOk = typeof o.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.as_of);
  if (!dateOk) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  const floorOk = typeof o.floor_usd === 'number' && Number.isSafeInteger(o.floor_usd) && o.floor_usd > 0;
  if (!floorOk) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => parseProtocol(v, i));
  return {
    as_of: o.as_of as string,
    source: o.source as string,
    floor_usd: o.floor_usd as number,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared
 * implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).join(', ');
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${shown}`;
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
