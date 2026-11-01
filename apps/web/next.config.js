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
        // The builder used to live at /routine/builder; the query string (?template=, ?product=) is carried over.
        source: '/routine/builder',
        destination: '/routines/build',
        permanent: true,
      },
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
