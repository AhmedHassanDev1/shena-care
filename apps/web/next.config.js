/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.shopify.com',
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/login',
        destination: '/auth',
        permanent: false,
      },
      {
        source: '/business/login',
        destination: `${process.env.NEXT_PUBLIC_BUSINESS_URL || 'http://localhost:3002'}/login`,
        permanent: false,
      },
      {
        source: '/business',
        destination: `${process.env.NEXT_PUBLIC_BUSINESS_URL || 'http://localhost:3002'}/login`,
        permanent: false,
      },
      {
        source: '/bussins/login',
        destination: `${process.env.NEXT_PUBLIC_BUSINESS_URL || 'http://localhost:3002'}/login`,
        permanent: false,
      },
      {
        source: '/bussins',
        destination: `${process.env.NEXT_PUBLIC_BUSINESS_URL || 'http://localhost:3002'}/login`,
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
