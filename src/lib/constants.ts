export interface ChainConfig {
  name: string;
  displayName: string;
  color: string;
  protocols: string[];
}

// Protocols per chain — only those accepted by the GoldRush GraphQL API
export const CHAINS: ChainConfig[] = [
  {
    name: "ETH_MAINNET",
    displayName: "ETHEREUM",
    color: "#627EEA",
    protocols: ["UNISWAP_V2", "UNISWAP_V3", "SUSHISWAP_V2"],
  },
  {
    name: "BASE_MAINNET",
    displayName: "BASE",
    color: "#0052FF",
    protocols: ["UNISWAP_V2", "UNISWAP_V3", "VIRTUALS_V2"],
  },
  {
    name: "BSC_MAINNET",
    displayName: "BSC",
    color: "#F0B90B",
    protocols: ["PANCAKESWAP_V2", "PANCAKESWAP_V3"],
  },
  {
    name: "POLYGON_MAINNET",
    displayName: "POLYGON",
    color: "#8247E5",
    protocols: ["UNISWAP_V2", "UNISWAP_V3", "QUICKSWAP_V2", "QUICKSWAP_V3"],
  },
  {
    name: "SOLANA_MAINNET",
    displayName: "SOLANA",
    color: "#14F195",
    protocols: [
      "RAYDIUM_AMM", "RAYDIUM_CLMM", "RAYDIUM_CPMM", "RAYDIUM_LAUNCH_LAB",
      "PUMP_FUN_AMM", "MOONSHOT",
      "METEORA_DAMM", "METEORA_DLMM", "METEORA_DBC",
    ],
  },
  {
    name: "SONIC_MAINNET",
    displayName: "SONIC",
    color: "#5B6EF5",
    protocols: ["SHADOW_V2", "SHADOW_V3"],
  },
  {
    name: "MONAD_MAINNET",
    displayName: "MONAD",
    color: "#836EF9",
    protocols: ["UNISWAP_V2", "UNISWAP_V3"],
  },
  {
    name: "HYPERCORE_MAINNET",
    displayName: "HYPERCORE",
    color: "#77FF33",
    protocols: ["UNISWAP_V2", "UNISWAP_V3"],
  },
  {
    name: "HYPEREVM_MAINNET",
    displayName: "HYPEREVM",
    color: "#FF5733",
    protocols: ["UNISWAP_V2", "UNISWAP_V3"],
  },
  {
    name: "MEGAETH_MAINNET",
    displayName: "MEGAETH",
    color: "#00D4AA",
    protocols: ["UNISWAP_V2", "UNISWAP_V3"],
  },
];

// Map for looking up chain config by canonical name
export const CHAIN_MAP = new Map(CHAINS.map((c) => [c.name, c]));

// The API returns chain names in various formats (e.g. "solana-mainnet", "base_mainnet")
// Build a lookup that normalizes any variant back to our canonical name
const CHAIN_NAME_VARIANTS = new Map<string, string>();
for (const chain of CHAINS) {
  const canonical = chain.name;
  CHAIN_NAME_VARIANTS.set(canonical, canonical);
  CHAIN_NAME_VARIANTS.set(canonical.toLowerCase(), canonical);
  CHAIN_NAME_VARIANTS.set(
    canonical.toLowerCase().replace(/_/g, "-"),
    canonical
  );
}

export function normalizeChainName(raw: string): string {
  return (
    CHAIN_NAME_VARIANTS.get(raw) ??
    CHAIN_NAME_VARIANTS.get(raw.toLowerCase()) ??
    raw.toUpperCase().replace(/-/g, "_")
  );
}

// Physics constants
export const PHYSICS = {
  ATTRACTION_STRENGTH: 0.6,
  REPULSION_STRENGTH: 0.8,
  DAMPING: 0.88,
  BROWNIAN_STRENGTH: 0.03,
  MIN_CELL_RADIUS: 4,
  MAX_CELL_RADIUS: 20,
  DEFAULT_CELL_RADIUS: 7,
  ORGAN_BASE_RADIUS: 40,
  ORGAN_GROWTH_PER_CELL: 18,
  SPATIAL_CELL_SIZE: 100,
  MAX_CELLS_PER_CHAIN: 80,
};

export const RENDER = {
  BG_COLOR: "#FAFAFA",
  TEXT_COLOR: "#1a1a1a",
  CELL_FILL_ALPHA: 0.25,
  CELL_STROKE_ALPHA: 0.55,
  CELL_STROKE_WIDTH: 1,
  ORGAN_FILL_ALPHA: 0.12,
  ORGAN_STROKE_ALPHA: 0.4,
  LABEL_FONT_SIZE: 10,
  WOBBLE_HARMONICS: 4,
  WOBBLE_AMPLITUDE: 0.08,
  WOBBLE_SPEED: 0.4,
};
