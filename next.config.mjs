/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['sharp', 'pdf-poppler'],
  },
};

export default nextConfig;
