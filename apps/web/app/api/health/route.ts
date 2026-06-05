import { NextResponse } from "next/server"

export async function GET() {
	return NextResponse.json({
		app: "logloads",
		environment: process.env.NODE_ENV ?? "development",
		gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "unknown",
		timestamp: new Date().toISOString(),
	})
}