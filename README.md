# CoreLinux in Browser

CoreLinux is a browser front end for a **32-bit x86 Tiny Core Linux 17.0 desktop** emulated by v86. The shipped app entry is `index.html` → `src/main.tsx` → `src/App.tsx`. The guest ISO is `public/bios/linux.iso`; it contains Linux kernel 6.18.2, BusyBox 1.36.1, and the listed desktop extensions, including FLTK, FLWM, Xvesa, Xprogs, and wbar. The ISO's `cde/onboot.lst` records the extensions loaded at boot.

## Run locally

```sh
npm install
npm run dev
```

Build the static app with `npm run build`; Vite writes it to `dist/`. The production build uses the pinned local v86 package (`0.5.471+g94faf3d`) and its local WebAssembly runtime.

For offline use, open the app with `?offline=1`. Offline mode omits network relay setup and network dependent actions. Emulator snapshots are stored in the browser's IndexedDB on that device/profile; clearing browser storage removes them.

The guest image is a minimal desktop. Availability of commands depends on the included Tiny Core image and extensions; this repository does not promise Python, nano, links, nmap, or tcpdump as preinstalled tools.

## Credits and notices

See the [offline-readable credits and license notices](public/credits.html), including upstream source references and copies of the applicable license texts. The project README's MIT statement covers this project's own code; guest OS and emulator components retain their separate notices and terms.
