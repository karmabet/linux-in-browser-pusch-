# CoreLinux - Browser OS

CoreLinux is a powerful, client-side Linux environment that runs entirely within your web browser using WebAssembly. It provides a fast, private, and accessible local Linux desktop experience without requiring any virtual machines or dedicated hardware.

## Features

- **In-Browser Execution:** Powered by WebAssembly, running entirely on the client side.
- **Privacy First:** No server-side processing. Your files and sessions stay local.
- **Built-in Tools:** 
  - Utilities like python, nano, links
  - Basic security tools (nmap, tcpdump) integrated.
- **State Persistence:** Local storage mechanics to keep your workflow intact.
- **Full Screen & Pointer Lock:** Immersive desktop-like experience.

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/corelinux.git
   cd corelinux
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:3000`.

## Building for Production

To create a production build:

```bash
npm run build
```

This will output the static files into the `dist` directory, which can be served using any standard web server.

## Technologies Used

- React 18
- TypeScript
- Vite
- WebAssembly (v86)
- Tailwind CSS

## License

This project is licensed under the MIT License.
