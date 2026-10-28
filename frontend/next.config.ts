import type { NextConfig } from "next";

const backendUrl = (process.env.AURA_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
	poweredByHeader: false,
	experimental: { proxyClientMaxBodySize: "55mb" },
	async rewrites() {
		return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
	},
};

export default nextConfig;