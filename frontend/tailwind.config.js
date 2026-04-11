/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
  	extend: {
  		// Typography: Inter for body (set on <body> in index.css), Manrope
  		// for headings (set on h1-h6 in index.css). The `font-display`
  		// utility exposes Manrope for non-heading display elements — large
  		// metric readouts, stat cards, etc. — so they don't have to use
  		// inline `style={{ fontFamily: 'Manrope' }}`.
  		fontFamily: {
  			display: ['Manrope', 'sans-serif'],
  			sans: ['Inter', 'sans-serif'],
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			// Brand semantic tokens — use these instead of raw Tailwind
  			// color classes (bg-blue-*, bg-purple-*, etc). They follow the
  			// Hub Indigo / Spoke Teal / Warning Amber palette from
  			// design_guidelines.json and are dark-mode aware.
  			hub: {
  				DEFAULT: 'hsl(var(--hub))',
  				soft: 'hsl(var(--hub-soft))',
  				strong: 'hsl(var(--hub-strong))'
  			},
  			spoke: {
  				DEFAULT: 'hsl(var(--spoke))',
  				soft: 'hsl(var(--spoke-soft))'
  			},
  			warn: {
  				DEFAULT: 'hsl(var(--warn))',
  				soft: 'hsl(var(--warn-soft))'
  			},
  			info: {
  				DEFAULT: 'hsl(var(--info))',
  				soft: 'hsl(var(--info-soft))'
  			},
  			progress: 'hsl(var(--progress))',
  			danger: {
  				DEFAULT: 'hsl(var(--danger))',
  				soft: 'hsl(var(--danger-soft))'
  			},
  			'ownership-internal': {
  				DEFAULT: 'hsl(var(--ownership-internal))',
  				soft: 'hsl(var(--ownership-internal-soft))'
  			},
  			'ownership-partner': {
  				DEFAULT: 'hsl(var(--ownership-partner))',
  				soft: 'hsl(var(--ownership-partner-soft))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
};