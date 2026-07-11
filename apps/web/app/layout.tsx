import { ClerkProvider } from "@clerk/nextjs"
import { Archivo, Inter } from "next/font/google"
import type { ReactNode } from "react"

import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider"

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
import "./styles/assistant.css"

const inter = Inter({
	display: "swap",
	subsets: ["latin"],
	variable: "--font-inter"
})

const archivo = Archivo({
	axes: ["wdth"],
	display: "swap",
	subsets: ["latin"],
	variable: "--font-archivo"
})

export const metadata = {
	title: {
		default: "LogLoads — Timber hauling, connected from landing to mill",
		template: "%s · LogLoads",
	},
	description: "Landings post timber that needs to move. Log truckers find work that fits their rig. Every haul keeps its schedule, access, and proof in one place.",
	applicationName: "LogLoads",
	metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002"),
	openGraph: {
		siteName: "LogLoads",
		title: "LogLoads — Timber hauling, connected from landing to mill",
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
			<html className={`${inter.variable} ${archivo.variable}`} lang="en">
				<body>
					{children}
					<AnalyticsProvider />
				</body>
			</html>
		</AuthBoundary>
	)
}
