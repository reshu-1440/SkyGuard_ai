/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Canvas & surface depth
        canvas: '#080C12',
        surface: {
          1: '#0D1420',
          2: '#131C2E',
          3: '#1A2540',
          hover: '#1E2B47',
        },
        // Borders
        border: {
          DEFAULT: '#1F2D45',
          subtle: '#152030',
          accent: '#2A4070',
        },
        // Operational signal colors
        ops: {
          neutral:   '#4A5B78',
          weather:   '#38BDF8',   // Temperature / primary telemetry
          pressure:  '#818CF8',   // Pressure
          humidity:  '#34D399',   // Humidity
          healthy:   '#00C9A7',   // Healthy / live connection
          warning:   '#F59E0B',   // Degraded / warning
          critical:  '#EF4444',   // Critical / anomaly
          genuine:   '#6366F1',   // Genuine event classification
          uncertain: '#EC4899',   // Uncertain classification
          offline:   '#334155',   // Offline station
          synthetic: '#A78BFA',   // Synthetic mode accent
          historical:'#60A5FA',   // Historical mode accent
        },
      },
      fontFamily: {
        // Display / UI prose
        sans: ['IBM Plex Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        // All data, telemetry, codes, IDs, timestamps
        mono: ['JetBrains Mono', 'ui-monospace', 'Cascadia Code', 'Segoe UI Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        'stat':      ['28px', { lineHeight: '1.0', letterSpacing: '-0.025em', fontWeight: '700' }],
        'stat-sm':   ['20px', { lineHeight: '1.0', letterSpacing: '-0.02em',  fontWeight: '700' }],
        'h1':        ['16px', { lineHeight: '1.3', letterSpacing: '-0.01em',  fontWeight: '600' }],
        'h2':        ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        'body':      ['13px', { lineHeight: '1.5' }],
        'data':      ['12px', { lineHeight: '1.3', fontWeight: '500' }],
        'telemetry': ['11px', { lineHeight: '1.2' }],
        'micro':     ['10px', { lineHeight: '1.2', letterSpacing: '0.06em' }],
      },
      spacing: {
        '4.5': '1.125rem',
        '13':  '3.25rem',
      },
      borderRadius: {
        'panel': '2px',
        'none': '0px',
      },
      boxShadow: {
        'panel-sm': '0 1px 4px rgba(0,0,0,0.4)',
        'panel':    '0 2px 8px rgba(0,0,0,0.5)',
        'panel-lg': '0 4px 16px rgba(0,0,0,0.6)',
        'critical': '0 0 0 1px rgba(239,68,68,0.3)',
        'warn':     '0 0 0 1px rgba(245,158,11,0.3)',
      },
    },
  },
  plugins: [],
}
