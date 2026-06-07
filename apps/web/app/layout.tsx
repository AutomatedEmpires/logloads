export const metadata = {
	title: "LogLoads",
	description: "The Timber Truck Operating Network.",
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
