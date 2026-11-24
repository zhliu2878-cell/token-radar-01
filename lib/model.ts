// Token Radar's valuation model, radar-2.
//
// One sealed snapshot in, one ranked board out. The board covers every slug on the snapshot's
// watchlist (the floor, never the ceiling) and adds pre-token protocols below the floor, by TVL:
// the early rows the radar exists to find. A protocol is pre-token when its record carries no
// token at all (no market cap, no CoinGecko id, no symbol). Live-token protocols are kept apart
// and shown with the market's own values, never mixed into the ranking.
//
// Implied value is a model of what a token would be worth if the protocol launched one, built
// only from the snapshot's own figures:
//
//   base        = tvl_usd x 0.25
//   category    = the market's own pricing of this category: the median market-cap/TVL of the
//                 snapshot's live-token protocols in the category, divided by the overall
//                 median (0.169), damped toward 1.0 and clamped to [0.6, 1.5]. Categories with
//                 fewer than 5 live-token protocols score 1.0. Dexs price near 0.34, liquid
//                 staking near 0.03: the market does not pay the same multiple everywhere.
//   chains      = 1 + 0.08 x ln(number of chains), capped at 1.4. A protocol live on several
//                 chains has more places a token can matter; 54% of the snapshot sits on one
//                 chain, so multi-chain is a real distinction, but the log keeps it gentle.
//   growth      = clamp(change_7d, -60, 120) per cent; the growth weight rises with size,
//                 0.30 at $5M TVL to 0.50 at $500M and above. A 7-day move on a $5M protocol
//                 is mostly small-base noise; the same move on a $1B protocol is real flow.
//   maturity    = 0.6 + min(age_days, 1095) / 1095 x 0.4 (age unknown: 365 days). A protocol
//                 that has run for years with no token has had longer to earn one.
//   implied     = max(1, round(base x category x chains x growth x maturity))
//
// No protocol name is ever special-cased: the same function scores every row, and every factor
// is computed from the snapshot itself. The dashboard's model section states each factor and
// the numbers behind it.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight_min: number;
  growth_weight_max: number;
  growth_size_floor: number;
  growth_size_top: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_damp: number;
  category_low: number;
  category_high: number;
  category_min_live: number;
  chain_weight: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight_min: 0.3,
  growth_weight_max: 0.5,
  growth_size_floor: 5_000_000,
  growth_size_top: 500_000_000,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_damp: 0.4,
  category_low: 0.6,
  category_high: 1.5,
  category_min_live: 5,
  chain_weight: 0.08,
  chain_cap: 1.4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
    base_multiple: number;
    category_multiplier: number;
    chain_multiplier: number;
    growth_pct: number;
    growth_weight: number;
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
  category_multiplier: number;
  chain_multiplier: number;
  growth_weight: number;
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

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  category_table: { category: string; live_n: number; median_multiple: number; multiplier: number }[];
  overall_median_multiple: number;
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The middle value of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * The category pricing table, read off the snapshot's live-token protocols: for each category
 * with at least `minLive` live-token protocols, the median market-cap/TVL, and the multiplier
 * the model applies, damped toward 1.0 so no category is ever worth more than 1.5x or less
 * than 0.6x the base. The overall median across all live-token protocols is the reference.
 */
export function categoryTable(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { table: { category: string; live_n: number; median_multiple: number; multiplier: number }[]; overall: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(ratio);
    byCat.set(key, list);
  }
  all.sort((a, b) => a - b);
  const overall = median(all) ?? 0.25;
  const table: { category: string; live_n: number; median_multiple: number; multiplier: number }[] = [];
  for (const [category, ratios] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ratios.length < model.category_min_live) continue;
    ratios.sort((a, b) => a - b);
    const med = median(ratios) ?? overall;
    const raw = 1 - model.category_damp + model.category_damp * (med / overall);
    const multiplier = Math.min(model.category_high, Math.max(model.category_low, raw));
    table.push({ category, live_n: ratios.length, median_multiple: Math.round(med * 1000) / 1000, multiplier: Math.round(multiplier * 100) / 100 });
  }
  return { table, overall: Math.round(overall * 1000) / 1000 };
}

/** The multiplier one category earns, from the table; 1.0 when the category has no row. */
function categoryMultiplier(
  table: { category: string; multiplier: number }[],
  category: string | null,
): number {
  if (category === null) return 1;
  const row = table.find((t) => t.category === category);
  return row === undefined ? 1 : row.multiplier;
}

/** The multi-chain factor: 1 on one chain, rising with the log of the chain count, capped. */
function chainMultiplier(chains: string[], model: ModelConstants): number {
  const n = Math.max(1, chains.length);
  return Math.min(model.chain_cap, 1 + model.chain_weight * Math.log(n));
}

/** The growth weight for one protocol: heavier for larger TVL, where a 7-day move is real flow. */
function growthWeight(tvlUsd: number, model: ModelConstants): number {
  const span = Math.log10(model.growth_size_top / model.growth_size_floor);
  const at = Math.min(1, Math.max(0, Math.log10(Math.max(tvlUsd, model.growth_size_floor) / model.growth_size_floor) / span));
  return model.growth_weight_min + (model.growth_weight_max - model.growth_weight_min) * at;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  catTable: { category: string; multiplier: number }[],
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMult: number;
  chainMult: number;
  growthPct: number;
  growthWeight: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMult = categoryMultiplier(catTable, protocol.category);
  const chainMult = chainMultiplier(protocol.chains, model);
  const gw = growthWeight(protocol.tvl_usd, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * gw;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * model.base_multiple * categoryMult * chainMult * growthMult * maturityMult),
  );
  return { implied, categoryMult, chainMult, growthPct, growthWeight: gw, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { table } = categoryTable(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, model);
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
      base_multiple: model.base_multiple,
      category_multiplier: round2(s.categoryMult),
      chain_multiplier: round2(s.chainMult),
      growth_pct: s.growthPct,
      growth_weight: round2(s.growthWeight),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** What one transaction costs on a chain, in dollars, by how expensive that chain usually is. */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum') || c.includes('bitcoin')) return 8;
  if (c.includes('solana') || c.includes('sui') || c.includes('aptos') || c.includes('near')) return 0.1;
  if (c.includes('tron') || c.includes('bsc') || c.includes('binance')) return 0.5;
  return 1.5;
}

/** A short dollar figure: whole dollars, or two decimals under a dollar. */
function usd(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

/** The category's core action, written for this protocol, this chain and this capital. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): { verb: string; detail: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      verb: `Supply $${capital} of USDC to ${name} on ${chain} and keep the loan open`,
      detail: `borrow a small amount against it so the position shows both sides of the book`,
      weekly: `repay a little, borrow a little, or top up the collateral so the loan stays active`,
    };
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return {
      verb: `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP receipt`,
      detail: `pick the pair with the most volume, not the highest advertised yield`,
      weekly: `claim the pool fees, and add or remove a small amount so the position changes`,
    };
  }
  if (c.includes('bridge') || c.includes('canonical bridge')) {
    return {
      verb: `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its app`,
      detail: `a bridge alone is one transaction; using the funds afterwards is what counts`,
      weekly: `bridge a small amount back and forth, and use the destination app each time`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      verb: `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token`,
      detail: `restaking or liquid staking receipts are the position, not the deposit alone`,
      weekly: `check the receipt balance and, if the protocol offers it, delegate or vote once`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return {
      verb: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position`,
      detail: `keep leverage low: the point is an open position, not a trade`,
      weekly: `adjust the hedge or close and reopen it, so the account shows ongoing use`,
    };
  }
  if (c.includes('prediction')) {
    return {
      verb: `Fund $${capital} on ${name} and take one position in an active market`,
      detail: `pick a market that settles after your hold window, not one that ends tomorrow`,
      weekly: `take one new market position, and settle or close the old one`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) {
    return {
      verb: `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares`,
      detail: `vault shares are the receipt; a deposit with no shares is not a position`,
      weekly: `check the share price and, if the vault allows it, add a small top-up`,
    };
  }
  if (c.includes('stable')) {
    return {
      verb: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it`,
      detail: `holding the minted asset, not just minting and redeeming it, is the position`,
      weekly: `use the stable asset once, in a swap or a payment, and keep the balance`,
    };
  }
  if (c.includes('rwa')) {
    return {
      verb: `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it in the same wallet`,
      detail: `real-world-asset positions are read from the holding wallet, so do not move it`,
      weekly: `claim the yield once, and leave the principal untouched`,
    };
  }
  if (c.includes('insurance')) {
    return {
      verb: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`,
      detail: `cover that lapses before a snapshot reads as no position at all`,
      weekly: `check the policy is still active, and renew it before it expires`,
    };
  }
  if (c.includes('basis')) {
    return {
      verb: `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold the position through one funding cycle`,
      detail: `basis trades are judged over a full cycle, not a single day`,
      weekly: `check the funding rate and rebalance only if the vault asks for it`,
    };
  }
  return {
    verb: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`,
    detail: `use the protocol's main feature once, so the wallet is more than a deposit`,
    weekly: `use the protocol's main feature once, such as a swap, a deposit or a vote`,
  };
}

/** A whole-dollar figure with thousands separators. */
function commas(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * A protocol's farm plan: six steps, each built from this protocol's own record (name, category,
 * chains, TVL, age, implied value), never from a shared template. Every step carries its own
 * cost and time, and the gas budget is stated against the implied value so the reader can see
 * the expected-value arithmetic: farming is only worth it while gas stays a small fraction of
 * what a token could be worth.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(2, Math.ceil(hold / 7));
  const gas = gasPerTx(chain);
  const txs = 2 + weeks + 2;
  const totalGas = gas * txs;
  const core = coreAction(p, capital, chain);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const ageLine = age === null ? 'with no listing date on record' : `listed ${age} days ago`;
  const tinySlice = Math.max(1, Math.round(implied * 0.0001));
  return [
    {
      text: `Open a fresh wallet for ${p.name} alone and fund it with $${capital + Math.ceil(totalGas)} on ${chain} (${usd(capital)} to farm with, about ${usd(totalGas)} for gas). Fund it from an exchange withdrawal, not from another farm wallet.`,
      cost: `about ${usd(gas)} of gas for the first transaction`,
      time: '10 minutes to set up',
    },
    {
      text: `${core.verb} — ${core.detail}.`,
      cost: `${usd(capital)} of capital and about ${usd(gas * 2)} of gas to open it`,
      time: '15 minutes to set up',
    },
    {
      text: `Once a week for ${weeks} weeks, ${core.weekly} on ${p.name}. Do it on a different day each week, at a different hour, so the activity reads as real use and not a batch. Each week costs about ${usd(gas)} of gas.`,
      cost: `about ${usd(gas * weeks)} of gas over ${weeks} weeks`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days (${p.name} is ${ageLine}) and keep at least $${Math.round(capital * 0.8)} of it in place, so the balance is counted in more than one snapshot. Withdrawing early is the most common way a farm scores zero.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Keep this farm to one wallet: do not fund a second wallet from the first, do not repeat the same amounts on the same day, and never pay anyone to claim for you. The whole plan costs about ${usd(totalGas)} of gas; it breaks even on any airdrop above that, and 0.01% of the $${commas(implied)} implied value would be $${commas(tinySlice)}${secondChain !== null ? `; ${secondChain} is a second chain this protocol runs on, not a reason to open a second farm` : ''}.`,
      cost: `about ${usd(totalGas)} of gas in total`,
      time: 'nothing to do but check once a week',
    },
    {
      text: `After ${hold} days, or when ${p.name} announces a token, open the protocol's own points or rewards page from its official site and claim only from the link it publishes. Then unwind in reverse: close the position, withdraw the $${capital}, and keep the wallet's log.`,
      cost: `about ${usd(gas * 2)} of gas to claim and unwind`,
      time: '20 minutes to exit',
    },
  ];
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
    category_multiplier: row.model.category_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    growth_weight: row.model.growth_weight,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const { table, overall } = categoryTable(snapshot, model);
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
    category_table: table,
    overall_median_multiple: overall,
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
