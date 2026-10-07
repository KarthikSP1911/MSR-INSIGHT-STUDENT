import { ImageResponse } from 'next/og'

/**
 * App icons referenced by the web app manifest. Same artwork as src/app/icon.tsx, rendered at the
 * sizes installers ask for. The maskable variant draws the art smaller because Android may crop the
 * outer ~20% of the square into a circle or squircle; the background always fills the full square.
 */
const ICONS = {
  'icon-192.png': { size: 192, artScale: 0.8 },
  'icon-512.png': { size: 512, artScale: 0.8 },
  'maskable-512.png': { size: 512, artScale: 0.7 },
} as const

type IconName = keyof typeof ICONS

// Only the three icons above exist; they are rendered once at build time.
export const dynamicParams = false

export function generateStaticParams() {
  return (Object.keys(ICONS) as IconName[]).map((name) => ({ name }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const icon = ICONS[name as IconName]
  if (!icon) return new Response('Not found', { status: 404 })

  const art = `${icon.artScale * 100}%`
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090b',
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" width={art} height={art}>
          <polygon points="256,40 440,146 440,366 256,472 72,366 72,146" stroke="#F8FAFC" strokeWidth="36" strokeLinejoin="round" />
          <line x1="256" y1="40" x2="256" y2="256" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.4" />
          <line x1="440" y1="366" x2="256" y2="256" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.4" />
          <line x1="72" y1="366" x2="256" y2="256" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.4" />
          <circle cx="256" cy="256" r="56" fill="#FF8A00" />
        </svg>
      </div>
    ),
    {
      width: icon.size,
      height: icon.size,
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    },
  )
}
