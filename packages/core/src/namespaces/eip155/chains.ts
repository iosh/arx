import { defineBuiltinNetworkSeeds } from "../../networks/types.js";

export const EIP155_MAINNET_NETWORK_SEEDS = defineBuiltinNetworkSeeds([
  {
    definition: {
      chainRef: "eip155:1",
      name: "Ethereum Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ url: "https://etherscan.io", name: "Etherscan" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    },
    defaultRpcEndpoints: ["https://cloudflare-eth.com", "https://eth.drpc.org"],
  },
  {
    definition: {
      chainRef: "eip155:10",
      name: "Optimism",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ url: "https://optimistic.etherscan.io", name: "Etherscan (Optimism)" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
    },
    defaultRpcEndpoints: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
  },
  {
    definition: {
      chainRef: "eip155:137",
      name: "Polygon PoS",
      nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
      blockExplorers: [{ url: "https://polygonscan.com", name: "Polygonscan" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
    },
    defaultRpcEndpoints: ["https://polygon-rpc.com", "https://polygon.drpc.org"],
  },
  {
    definition: {
      chainRef: "eip155:42161",
      name: "Arbitrum One",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ url: "https://arbiscan.io", name: "Arbiscan" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
    },
    defaultRpcEndpoints: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  },
  {
    definition: {
      chainRef: "eip155:1030",
      name: "Conflux eSpace",
      nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
      blockExplorers: [{ url: "https://evm.confluxscan.net", name: "ConfluxScan eSpace" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux-evm/info/logo.png",
    },
    defaultRpcEndpoints: ["https://evm.confluxrpc.com", "https://evmmain-global.confluxrpc.com"],
  },
]);

export const EIP155_TESTNET_NETWORK_SEEDS = defineBuiltinNetworkSeeds([
  {
    definition: {
      chainRef: "eip155:11155111",
      name: "Sepolia Testnet",
      nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
      blockExplorers: [{ url: "https://sepolia.etherscan.io", name: "Etherscan (Sepolia)" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
    },
    defaultRpcEndpoints: ["https://1rpc.io/sepolia", "https://sepolia.drpc.org"],
  },
  {
    definition: {
      chainRef: "eip155:71",
      name: "Conflux eSpace Testnet",
      nativeCurrency: { name: "Test Conflux", symbol: "CFX", decimals: 18 },
      blockExplorers: [{ url: "https://evmtestnet.confluxscan.net", name: "ConfluxScan eSpace Testnet" }],
      iconUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux-evm/info/logo.png",
    },
    defaultRpcEndpoints: ["https://evmtestnet.confluxrpc.com", "https://evmtest.confluxrpc.com"],
  },
]);

export const EIP155_BUILTIN_NETWORK_SEEDS = defineBuiltinNetworkSeeds([
  ...EIP155_MAINNET_NETWORK_SEEDS,
  ...EIP155_TESTNET_NETWORK_SEEDS,
]);
