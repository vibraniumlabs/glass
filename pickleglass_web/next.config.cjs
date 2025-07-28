/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // output: 'export', // <-- This was disabling the server and API routes

  images: { unoptimized: true },
}

module.exports = nextConfig 