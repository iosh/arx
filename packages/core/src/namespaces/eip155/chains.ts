import { type ChainDefinitionSeed, defineChainDefinitionSeeds, type RpcEndpoint } from "../../chains/definition.js";

const defineRpcChainDefinitionSeeds = <const TSeeds extends readonly ChainDefinitionSeed<RpcEndpoint>[]>(
  seeds: TSeeds,
): TSeeds => defineChainDefinitionSeeds(seeds);

export const EIP155_MAINNET_DEFINITION_SEEDS = defineRpcChainDefinitionSeeds([
  {
    definition: {
      chainRef: "eip155:1",
      displayName: "Ethereum Mainnet",
      shortName: "eth",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://etherscan.io", title: "Etherscan" }],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://cloudflare-eth.com", type: "public" },
      { url: "https://eth.drpc.org", type: "public" },
    ],
  },

  {
    definition: {
      chainRef: "eip155:10",
      displayName: "Optimism",
      shortName: "op",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://optimistic.etherscan.io", title: "Etherscan (Optimism)" }],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://mainnet.optimism.io", type: "public" },
      { url: "https://optimism-rpc.publicnode.com", type: "public" },
    ],
  },

  {
    definition: {
      chainRef: "eip155:137",
      displayName: "Polygon PoS",
      shortName: "matic",
      nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://polygonscan.com", title: "Polygonscan" }],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://polygon-rpc.com", type: "public" },
      { url: "https://polygon.drpc.org", type: "public" },
    ],
  },

  {
    definition: {
      chainRef: "eip155:42161",
      displayName: "Arbitrum One",
      shortName: "arb",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://arbiscan.io", title: "Arbiscan" }],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://arb1.arbitrum.io/rpc", type: "public" },
      { url: "https://arbitrum-one-rpc.publicnode.com", type: "public" },
    ],
  },

  {
    definition: {
      chainRef: "eip155:1030",
      displayName: "Conflux eSpace",
      shortName: "cfxe",
      nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://evm.confluxscan.net", title: "ConfluxScan eSpace" }],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux-evm/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://evm.confluxrpc.com", type: "public" },
      { url: "https://evmmain-global.confluxrpc.com", type: "public" },
    ],
  },
]);

export const EIP155_TESTNET_DEFINITION_SEEDS = defineRpcChainDefinitionSeeds([
  {
    definition: {
      chainRef: "eip155:11155111",
      displayName: "Sepolia Testnet",
      shortName: "sep",
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ type: "default", url: "https://sepolia.etherscan.io", title: "Etherscan (Sepolia)" }],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://1rpc.io/sepolia", type: "public" },
      { url: "https://sepolia.drpc.org", type: "public" },
    ],
  },
  {
    definition: {
      chainRef: "eip155:71",
      displayName: "Conflux eSpace Testnet",
      shortName: "cfxe-test",
      nativeCurrency: { name: "Test Conflux", symbol: "CFX", decimals: 18 },
      blockExplorers: [
        { type: "default", url: "https://evmtestnet.confluxscan.net", title: "ConfluxScan eSpace Testnet" },
      ],
      icon: {
        url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux-evm/info/logo.png",
        format: "png",
      },
    },
    defaultRpcEndpoints: [
      { url: "https://evmtestnet.confluxrpc.com", type: "public" },
      { url: "https://evmtest.confluxrpc.com", type: "public" },
    ],
  },
]);

export const EIP155_CHAIN_DEFINITION_SEEDS = defineRpcChainDefinitionSeeds([
  ...EIP155_MAINNET_DEFINITION_SEEDS,
  ...EIP155_TESTNET_DEFINITION_SEEDS,
]);
