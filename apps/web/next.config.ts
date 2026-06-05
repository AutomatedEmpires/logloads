import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	transpilePackages: ["@logloads/core", "@logloads/db", "@logloads/services"],
}

export default nextConfig
