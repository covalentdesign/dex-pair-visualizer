import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ws", "@covalenthq/client-sdk"],
};

export default nextConfig;
