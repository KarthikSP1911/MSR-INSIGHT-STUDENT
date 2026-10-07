import type { MetadataRoute } from 'next'

/**
 * Makes the dashboard installable. `display: 'standalone'` is what turns "Add to Home Screen" from a
 * browser shortcut into an app window, and browsers also want a 192px and a 512px icon plus a
 * maskable one so Android can crop it to its own icon shape (see src/app/icons/[name]/route.tsx).
 * The shortcuts appear when the installed app's icon is long-pressed (Android) or right-clicked
 * (desktop) and open the matching dashboard tab (`?tab=`, read by the dashboard page).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'MSR Insight',
    short_name: 'MSR Insight',
    description: 'Student academic dashboard: performance, analytics, exam history, and more.',
    lang: 'en',
    categories: ['education'],
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Exam History',
        short_name: 'Results',
        url: '/student/dashboard?tab=history',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Grade Simulator',
        short_name: 'Simulator',
        url: '/student/dashboard?tab=simulator',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Notes & PYQs',
        short_name: 'Notes',
        url: '/student/dashboard?tab=notes',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  }
}
