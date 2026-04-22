/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // for Docker / Railway deployments
};

module.exports = nextConfig;
