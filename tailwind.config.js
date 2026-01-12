/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        white: "#ffffff",
        slate: {
          50: "#f5f8f6",
          100: "#e6efe9",
          200: "#cfdcd4",
          300: "#b3c5bb",
          400: "#8aa196",
          500: "#6c8477",
          600: "#566b5f",
          700: "#425347",
          800: "#2c3930",
          900: "#19231d"
        }
      },
      borderRadius: {
        card: "14px"
      },
      boxShadow: {
        soft: "0 14px 30px rgba(20, 40, 30, 0.12)"
      }
    }
  },
  plugins: []
};
