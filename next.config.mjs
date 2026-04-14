/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@phantom/auth2',
    '@phantom/base64url',
    '@phantom/browser-injected-sdk',
    '@phantom/browser-sdk',
    '@phantom/chain-interfaces',
    '@phantom/client',
    '@phantom/constants',
    '@phantom/embedded-provider-core',
    '@phantom/indexed-db-stamper',
    '@phantom/parsers',
    '@phantom/sdk-types',
  ],
};

export default nextConfig;
