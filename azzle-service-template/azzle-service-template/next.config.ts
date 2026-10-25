import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/VPS image uses the standalone server (NEXT_OUTPUT=standalone); Vercel ignores this.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  // never trace local runtime data / test artifacts into the deploy bundle
  outputFileTracingExcludes: { "*": ["./data/**", "./jobs/**", "./examples/**"] },
  // @base-org/account's node entry pulls @coinbase/cdp-sdk's optional x402 peers, which we never use.
  serverExternalPackages: ["@coinbase/cdp-sdk"],
  webpack: (config, { webpack }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false, "@x402/evm": false, "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false, "@x402/svm/exact/client": false, accounts: false,
      // optional wagmi connectors we don't ship. Privy brings its own nested @coinbase/wallet-sdk and
      // @walletconnect/ethereum-provider (lazy chunks), so those two must NOT be aliased away.
      "@metamask/connect-evm": false, "@safe-global/safe-apps-sdk": false, "@safe-global/safe-apps-provider": false,
      // Privy's optional Solana/Farcaster peers; this template is Base only.
      "@farcaster/mini-app-solana": false,
    };
    // wagmi's coinbaseWallet connector (unused) wants a top-level @coinbase/wallet-sdk; ignore it only there.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@coinbase\/wallet-sdk$/, contextRegExp: /@wagmi[\\/]connectors/ }));
    // viem/ox "tempo" chain code uses a dynamic require; harmless for Base-only usage
    config.ignoreWarnings = [...(config.ignoreWarnings || []), { module: /node_modules\/ox\/_esm\/tempo/ }];
    config.externals = [...(Array.isArray(config.externals) ? config.externals : []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};

export default nextConfig;
