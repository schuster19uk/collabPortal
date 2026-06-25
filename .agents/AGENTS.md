# Project-Specific Rules for Antigravity

## Design Guidelines
- **CSS Extraction**: Do NOT include internal `<style>` blocks in HTML files. Always extract custom styles to dedicated `.css` files under `/css/` and link them in the `<head>`.
- **Button / Component Decisions**: Do not add call-to-action buttons (like "Book a Slot" or "Owner Dashboard") directly to the landing page unless explicitly requested. Rely on navigation links in the header/navbar or seek user confirmation first.
- **Aesthetics**: Ensure a clean, modern layout using design variables from `theme.css`.
