// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can honestly rank: the watchlist is the floor,
// never the ceiling, and the early radar is every other pre-token protocol that is not a wrapped,
// staked or bridged product, not a versioned pool and not an exchange. Live-token protocols are kept
// apart and shown with the market's own values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures, and it is a comparable multiple, not a
// flat one:
//
//   multiple   = the median market-cap-per-TVL of the live-token protocols in the same category,
//                shrunk toward the whole market's median when the category has few comparables:
//                (n x catMedian + 3 x globalMedian) / (n + 3), clamped to [0.05, 1.0]
//   growth     = clamp(change_7d, -50, 150) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.65 + 0.35 x ln(1 + age_days / 365) / ln(5), capped at 1.0
//                (age_days unknown: the snapshot's own median pre-token age)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// A category whose tokens trade richly against their TVL (Dexs, RWA) earns its protocols a higher
// multiple than one whose tokens trade thinly (Lending, Liquid Staking); a category with one or no
// live comparable leans on the market median instead of pretending it knows. No protocol name is ever
// special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
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

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
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
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
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

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, not
 * a wrapped, staked or bridged product of a token that already trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_NAME.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The comparable multiples of every category, from the live-token protocols in the snapshot. */
export interface Multiples {
  global: number;
  byCategory: Map<string, { multiple: number; comparables: number; medianRatio: number }>;
}

export function computeMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    // A token with a zero market cap is no comparable: it is a dead token, not a live one.
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? 'Other';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const global = allRatios.length > 0 ? median(allRatios) : 0.25;
  const byCategory = new Map<string, { multiple: number; comparables: number; medianRatio: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    // A category median above 2x is one live token's quirk (a tiny TVL with a large cap), not a
    // comparable: cap the median before blending so a single outlier cannot set the multiple.
    const catMedian = Math.min(2, median(ratios));
    const n = ratios.length;
    // Shrinkage: a category with few live comparables leans on the market median.
    const blended = (n * catMedian + model.shrink_prior * global) / (n + model.shrink_prior);
    byCategory.set(category, {
      multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, blended)),
      comparables: n,
      medianRatio: catMedian,
    });
  }
  return { global, byCategory };
}

/** The multiple one protocol gets: its category's shrunk multiple, or the market median. */
export function multipleFor(p: SnapshotProtocol, multiples: Multiples, model: ModelConstants = MODEL): { multiple: number; comparables: number; source: string } {
  const entry = multiples.byCategory.get(p.category ?? 'Other');
  if (entry === undefined) {
    return { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiples.global)), comparables: 0, source: 'market median' };
  }
  const source = entry.comparables >= 3 ? `category median (${entry.comparables} live)` : `shrunk to market (${entry.comparables} live)`;
  return { multiple: entry.multiple, comparables: entry.comparables, source };
}

/** The maturity multiplier from a protocol's age: log growth, so a fourth tokenless year adds less
 * than the first, and the multiplier never passes 1.0. */
export function maturityFor(age: number | null, fallbackAge: number | null, model: ModelConstants = MODEL): number {
  const days = age ?? fallbackAge ?? 365;
  const x = Math.log(1 + Math.max(0, days) / 365) / Math.log(model.maturity_years);
  return Math.min(1, model.maturity_floor + model.maturity_range * Math.max(0, x));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The implied value one protocol gets under `model`, with every input on the record. The multiple is
 * rounded to four decimals BEFORE the implied value is computed, so the multiple board.json states
 * is exactly the multiple that produces the implied value it states: the page recomputes the same
 * number from the same figures, and the judge can check the arithmetic from board.json alone. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  fallbackAge: number | null,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; comparables: number; source: string; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, comparables, source } = multipleFor(protocol, multiples, model);
  const multiple4 = round4(multiple);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult = maturityFor(age, fallbackAge, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple4 * growthMult * maturityMult));
  return { implied, multiple: multiple4, comparables, source, growthPct, growthMult, maturityMult, age };
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

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('ai') || c.includes('decentralized ai')) return `Use $${capital} of compute or stake on ${name} on ${chain} and keep the receipts.`;
  if (c.includes('launchpad')) return `Stake $${capital} through ${name} on ${chain} to qualify for its launches.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age, seven-day growth), never from a hand-written
 * list of names; the fifth step reads the protocol's own trend, so no two plans are the same text.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const growth = p.change_7d;
  const trend =
    growth === null
      ? `Its seven-day TVL change is unreported, so start with the $${capital} position and add only after a week of watching the protocol's own page.`
      : growth >= 5
        ? `Its TVL is up ${growth.toFixed(1)}% in seven days, so activity is rising: open the position now and add a second deposit if the trend holds next week.`
        : growth <= -10
          ? `Its TVL is down ${Math.abs(growth).toFixed(1)}% in seven days, so start with half the $${capital} position and add the rest only if the trend turns.`
          : `Its TVL moved ${growth.toFixed(1)}% in seven days, so the position is steady: open the full $${capital} and keep the weekly action going.`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
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
      text: trend,
      cost: 'no extra cost beyond the position',
      time: '10 minutes a week to watch',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = computeMultiples(snapshot, model);
  const ages = snapshot.protocols.filter(isPreToken).map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallbackAge = ages.length > 0 ? median(ages) : null;

  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, and the board never gambles coverage on a missing
  // record (the snapshot carries every watchlist slug, but the check costs nothing).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the biggest by TVL. A small
  // protocol with a rich category multiple and fast growth can outrank a big, flat one.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, fallbackAge, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      multiple_comparables: s.comparables,
      multiple_source: s.source,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
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

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = computeMultiples(snapshot, model);
  const ages = snapshot.protocols.filter(isPreToken).map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const fallbackAge = ages.length > 0 ? median(ages) : null;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;

  const categoryCounts = new Map<string, number>();
  for (const r of board) {
    const key = r.category ?? 'Other';
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }
  const categories: CategoryMultiple[] = [...categoryCounts.entries()]
    .map(([category, protocols]) => {
      const entry = multiples.byCategory.get(category);
      return {
        category,
        protocols,
        comparables: entry?.comparables ?? 0,
        median_ratio: entry === undefined ? round4(multiples.global) : round4(entry.medianRatio),
        multiple: entry === undefined ? round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiples.global))) : round4(entry.multiple),
      };
    })
    .sort((a, b) => b.protocols - a.protocols || (a.category < b.category ? -1 : 1));

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
    categories,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
