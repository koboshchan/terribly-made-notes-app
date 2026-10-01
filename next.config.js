/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['fluent-ffmpeg'],
  experimental: {
    proxyClientMaxBodySize: `${Math.min(256 * 1024 * 1024, Math.max(1024, Number(process.env.MAX_UPLOAD_BYTES) || 64 * 1024 * 1024)) + 65536}b`,
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
}

module.exports = nextConfig
