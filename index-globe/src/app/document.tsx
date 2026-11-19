export function Document({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Compare, negotiate and review electricity offers with your counterparties." />
    <title>Index Globe | Power trading desk</title>
    <link rel="icon" type="image/svg+xml" href="/index.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Instrument+Sans:wght@500;600;700&display=swap" />
    <link rel="stylesheet" href="/index-globe.css" />
    <link rel="stylesheet" href="/account.css" />
    <link rel="stylesheet" href="/trade.css" />
    <link rel="modulepreload" href="/src/client.tsx" />
  </head><body>{children}<script>import("/src/client.tsx")</script></body></html>;
}
