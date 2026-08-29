import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}
export const contentType = 'image/png'

export default function AppleIcon() {
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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" width="80%" height="80%">
          <polygon points="256,40 440,146 440,366 256,472 72,366 72,146" stroke="#F8FAFC" strokeWidth="36" strokeLinejoin="round"/>
          <line x1="256" y1="40" x2="256" y2="256" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.4"/>
          <line x1="440" y1="366" x2="256" y2="256" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.4"/>
          <line x1="72" y1="366" x2="256" y2="256" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" strokeOpacity="0.4"/>
          <circle cx="256" cy="256" r="56" fill="#FF8A00"/>
        </svg>
      </div>
    ),
    { ...size }
  )
}
