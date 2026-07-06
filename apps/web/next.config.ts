import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	transpilePackages: ["@logloads/contracts", "@logloads/db", "@logloads/services", "@logloads/ui"],
}

export default nextConfig
