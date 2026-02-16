import type { ChainMetadata } from "./metadata.js";

export const EIP155_MAINNETS = [
  {
    chainRef: "eip155:1",
    namespace: "eip155",
    chainId: "0x1",
    displayName: "Ethereum Mainnet",
    shortName: "eth",
    description: "Canonical Ethereum proof-of-stake network",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcEndpoints: [
      { url: "https://cloudflare-eth.com", type: "public" },
      { url: "https://eth.drpc.org", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://etherscan.io", title: "Etherscan" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain"],
    tags: ["mainnet", "production", "ethereum"],
    extensions: {
      coingeckoId: "ethereum",
      documentation: "https://ethereum.org/developers",
    },
  },

  {
    chainRef: "eip155:10",
    namespace: "eip155",
    chainId: "0xa",
    displayName: "Optimism",
    shortName: "op",
    description: "Optimistic rollup secured by Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcEndpoints: [
      { url: "https://mainnet.optimism.io", type: "public" },
      { url: "https://optimism-rpc.publicnode.com", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://optimistic.etherscan.io", title: "Etherscan (Optimism)" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain", "rollup"],
    tags: ["mainnet", "production", "l2"],
    extensions: {
      coingeckoId: "optimism",
      status: "https://status.optimism.io",
    },
  },

  {
    chainRef: "eip155:137",
    namespace: "eip155",
    chainId: "0x89",
    displayName: "Polygon PoS",
    shortName: "matic",
    description: "Polygon proof-of-stake network",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    rpcEndpoints: [
      { url: "https://polygon-rpc.com", type: "public" },
      { url: "https://polygon.drpc.org", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://polygonscan.com", title: "Polygonscan" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain"],
    tags: ["mainnet", "production", "l2"],
    extensions: {
      coingeckoId: "polygon-pos",
      documentation: "https://docs.polygon.technology",
    },
  },

  {
    chainRef: "eip155:42161",
    namespace: "eip155",
    chainId: "0xa4b1",
    displayName: "Arbitrum One",
    shortName: "arb",
    description: "Nitro-powered optimistic rollup",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcEndpoints: [
      { url: "https://arb1.arbitrum.io/rpc", type: "public" },
      { url: "https://arbitrum-one-rpc.publicnode.com", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://arbiscan.io", title: "Arbiscan" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain", "rollup"],
    tags: ["mainnet", "production", "l2"],
    extensions: {
      coingeckoId: "arbitrum-one",
      documentation: "https://docs.arbitrum.io",
    },
  },

  {
    chainRef: "eip155:1030",
    namespace: "eip155",
    chainId: "0x406",
    displayName: "Conflux eSpace",
    shortName: "cfxe",
    description: "Conflux EVM-compatible network",
    nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
    rpcEndpoints: [
      { url: "https://evm.confluxrpc.com", type: "public" },
      { url: "https://evmmain-global.confluxrpc.com", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://evm.confluxscan.net", title: "ConfluxScan eSpace" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux-evm/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain"],
    tags: ["mainnet", "production", "conflux"],
    extensions: {
      coingeckoId: "conflux-espace",
      networkId: 1030,
    },
  },
] as const satisfies readonly ChainMetadata[];

export const EIP155_TESTNETS = [
  {
    chainRef: "eip155:11155111",
    namespace: "eip155",
    chainId: "0xaa36a7",
    displayName: "Sepolia Testnet",
    shortName: "sep",
    description: "Ethereum proof-of-stake test network",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcEndpoints: [
      { url: "https://1rpc.io/sepolia", type: "public" },
      { url: "https://sepolia.drpc.org", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://sepolia.etherscan.io", title: "Etherscan (Sepolia)" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain"],
    tags: ["testnet", "ethereum"],
    extensions: {
      faucet: "https://sepoliafaucet.com",
    },
  },
  {
    chainRef: "eip155:71",
    namespace: "eip155",
    chainId: "0x47",
    displayName: "Conflux eSpace Testnet",
    shortName: "cfxe-test",
    description: "Conflux eSpace public test network",
    nativeCurrency: { name: "Test Conflux", symbol: "CFX", decimals: 18 },
    rpcEndpoints: [
      { url: "https://evmtestnet.confluxrpc.com", type: "public" },
      { url: "https://evmtest.confluxrpc.com", type: "public" },
    ],
    blockExplorers: [
      { type: "default", url: "https://evmtestnet.confluxscan.net", title: "ConfluxScan eSpace Testnet" },
    ],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux-evm/info/logo.png",
      format: "png",
    },
    features: ["eip155", "eip1559", "wallet_switchEthereumChain"],
    tags: ["testnet", "conflux"],
    extensions: {
      networkId: 71,
      faucet: "https://efaucet.confluxnetwork.org",
      documentation: "https://doc.confluxnetwork.org/docs/espace/network-endpoints",
    },
  },
] as const satisfies readonly ChainMetadata[];

export const CONFLUX_NETWORKS = [
  {
    chainRef: "conflux:cfx",
    chainId: "0x405",
    namespace: "conflux",
    displayName: "Conflux Core Space",
    shortName: "cfx",
    description: "Native Conflux network (CIP-37)",
    nativeCurrency: { name: "Conflux", symbol: "CFX", decimals: 18 },
    rpcEndpoints: [
      { url: "https://main.confluxrpc.com", type: "public" },
      { url: "https://cfxmain-global.confluxrpc.com", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://confluxscan.io", title: "ConfluxScan" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux/info/logo.png",
      format: "png",
    },
    features: ["cfx_sendTransaction", "cfx_signData"],
    tags: ["mainnet", "production", "conflux"],
    extensions: {
      networkId: 1029,
      addressPrefix: "cfx",
    },
  },
  {
    chainRef: "conflux:cfxtest",
    namespace: "conflux",
    chainId: "0x1",
    displayName: "Conflux Core Testnet",
    shortName: "cfxtest",
    description: "Conflux Core Space public test network",
    nativeCurrency: { name: "Test Conflux", symbol: "CFX", decimals: 18 },
    rpcEndpoints: [
      { url: "https://test.confluxrpc.com", type: "public" },
      { url: "https://cfxtest.confluxrpc.com", type: "public" },
    ],
    blockExplorers: [{ type: "default", url: "https://testnet.confluxscan.io", title: "ConfluxScan Testnet" }],
    icon: {
      url: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/conflux/info/logo.png",
      format: "png",
    },
    features: ["cfx_sendTransaction", "cfx_signData"],
    tags: ["testnet", "conflux"],
    extensions: {
      networkId: 1,
      addressPrefix: "cfxtest",
      faucet: "https://faucet.confluxnetwork.org",
    },
  },
] as const satisfies readonly ChainMetadata[];

export const DEFAULT_CHAIN_METADATA = [
  ...EIP155_MAINNETS,
  ...EIP155_TESTNETS,
  // ...CONFLUX_NETWORKS,
] as const satisfies readonly ChainMetadata[];
