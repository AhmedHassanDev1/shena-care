/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  agentRules: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: '/business',
        destination: '/login',
        permanent: false,
      },
      {
        source: '/bussins',
        destination: '/login',
        permanent: false,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/business/:path*',
        destination: '/:path*',
      },
      {
        source: '/bussins/:path*',
        destination: '/:path*',
      },
    ]
  },
}

export default nextConfig

