/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained build (.next/standalone) for a small container image.
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
