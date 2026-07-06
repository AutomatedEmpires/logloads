import { ClerkProvider } from "@clerk/nextjs"
import type { ReactNode } from "react"

import "./globals.css"
import "./styles/public.css"
import "./styles/auth.css"
import "./styles/map.css"
import "./styles/driver.css"
import "./styles/fleet.css"
import "./styles/host.css"
import "./styles/admin.css"
import "./styles/messages.css"
import "./styles/billing.css"

export const metadata = {
	title: "LogLoads",
	description: "The operating network for moving timber.",
	metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"),
	openGraph: {
		siteName: "LogLoads",
		title: "LogLoads - The operating network for moving timber",
		description: "Find capacity, put trucks to work, and keep every timber haul connected.",
		type: "website",
	},
}

function AuthBoundary({ children }: { children: ReactNode }) {
	if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
		return <>{children}</>
	}

	return <ClerkProvider>{children}</ClerkProvider>
}

export default function RootLayout({
	children,
}: {
	children: ReactNode
}) {
	return (
		<AuthBoundary>
			<html lang="en">
				<body>{children}</body>
			</html>
		</AuthBoundary>
	)
}
