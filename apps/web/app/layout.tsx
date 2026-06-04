export const metadata = {
	title: "LogLoads",
	description: "The timber truck operating network.",
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
