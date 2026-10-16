/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
