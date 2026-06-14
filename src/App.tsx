import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Square, Maximize, Keyboard, Monitor, Cpu } from 'lucide-react';

declare global {
  interface Window {
    V86: any;
    V86Starter: any;
  }
}

export default function App() {
  const [systemState, setSystemState] = useState<'dashboard' | 'loading' | 'running'>('dashboard');
  const [progress, setProgress] = useState<number>(0);
  const [ram, setRam] = useState(256);
  const [v86Loaded, setV86Loaded] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const screenContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textFallbackRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  
  const emulatorRef = useRef<any>(null);

// Load expected libraries
  useEffect(() => {
    // libv86.js is included in index.html
    const checkV86 = setInterval(() => {
      if (window.V86) {
        setV86Loaded(true);
        clearInterval(checkV86);
      }
    }, 100);
    return () => clearInterval(checkV86);
  }, []);

  // Recalculate zoom whenever running state changes or resize
  useEffect(() => {
     const handleResize = () => {
         if (systemState !== 'dashboard') {
             const toolbarHeight = 56; // 14 Tailwind units = 56px
             const maxW = window.innerWidth;
             const maxH = window.innerHeight - toolbarHeight;
             
             // Base VM resolution is 800x600
             const scaleX = maxW / 800;
             const scaleY = maxH / 600;
             let newZoom = Math.min(scaleX, scaleY);
             
             // Leave a 2% buffer so it doesn't touch the absolute pixel edges perfectly
             setZoom(newZoom * 0.98);
         }
     };
     
     window.addEventListener('resize', handleResize);
     handleResize(); // Initial call

     return () => window.removeEventListener('resize', handleResize);
  }, [systemState, isFullscreen]);

  // Full screen tracking
  useEffect(() => {
      const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', handleFsChange);
      return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Cleanup Emulator on Unmount
  useEffect(() => {
    return () => {
      if (emulatorRef.current) {
        try { emulatorRef.current.destroy(); } catch(e) {}
        emulatorRef.current = null;
      }
    };
  }, []);

  // Keep spacebar/arrows from scrolling the page
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            if (document.activeElement === canvasRef.current) {
                e.preventDefault();
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFocus = () => {
    if (emulatorRef.current && systemState === 'running') {
        emulatorRef.current.keyboard_set_status(true);
        canvasRef.current?.focus();
    }
  };

  const startV86 = useCallback((memory: number) => {
      if (!window.V86) {
          console.error("V86 not loaded. Cannot start virtual machine.");
          return;
      }
      
      setSystemState('loading');
      setProgress(0);
      
      setTimeout(() => {
          if (!screenContainerRef.current) return;
          
          if (emulatorRef.current) {
              try { emulatorRef.current.destroy() } catch(e){}
          }
          
          if (textFallbackRef.current) textFallbackRef.current.innerHTML = '';

          try {
              emulatorRef.current = new window.V86({
                  wasm_path: "https://unpkg.com/v86/build/v86.wasm",
                  memory_size: memory * 1024 * 1024,
                  vga_memory_size: 8 * 1024 * 1024,
                  screen_container: screenContainerRef.current,
                  bios: { url: "/bios/seabios.bin" },
                  vga_bios: { url: "/bios/vgabios.bin" },
                  cdrom: { url: "/bios/linux.iso" },
                  autostart: true,
              });

              const emu = emulatorRef.current;

              emu.add_listener("download-progress", (e: any) => {
                  console.log("Loading:", e);
                  if (e && typeof e.loaded === 'number' && e.total > 0) {
                      const p = Math.min(100, Math.round((e.loaded / e.total) * 100));
                      setProgress(p);
                      if (p >= 100) {
                           setTimeout(() => setSystemState('running'), 500);
                      }
                  }
              });

              emu.add_listener("emulator-ready", () => {
                  console.log("VM ready");
                  setSystemState('running');
              });
              emu.add_listener("emulator-started", () => setSystemState('running'));

          } catch (err) {
              console.error("V86 Initialization Error:", err);
              setSystemState('dashboard');
          }
      }, 100);
  }, []);

  const handleStop = () => {
    if (emulatorRef.current) {
         try { emulatorRef.current.destroy() } catch(e){}
         emulatorRef.current = null;
    }
    setSystemState('dashboard');
  };

  const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
      } else {
          document.exitFullscreen().catch(() => {});
      }
  };

  const handleKeyboardToggle = () => {
      if (mobileInputRef.current) {
          mobileInputRef.current.focus();
          mobileInputRef.current.click();
      }
  };

  const handleMobileKeyboardInput = (e: React.FormEvent<HTMLInputElement>) => {
      const ev = e.nativeEvent as InputEvent;
      if (ev.inputType === 'deleteContentBackward') {
          emulatorRef.current?.keyboard_send_scancodes([0x0E]); // Backspace
      } else if (ev.data && emulatorRef.current) {
          emulatorRef.current.keyboard_send_text(ev.data);
      }
      e.currentTarget.value = '';
  };

  const handleMobileKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          emulatorRef.current?.keyboard_send_scancodes([0x1C]); // Enter
      } else if (e.key === 'Backspace') {
          emulatorRef.current?.keyboard_send_scancodes([0x0E]); // Backspace
      }
  };

  return (
    <div className="h-screen w-screen bg-[#050505] text-slate-300 font-sans flex flex-col overflow-hidden relative">
      <input 
         ref={mobileInputRef} 
         type="text" 
         autoCapitalize="none"
         autoComplete="off"
         spellCheck="false"
         className="absolute top-0 left-0 opacity-0 w-0 h-0 -z-50 focus:outline-none" 
         onInput={handleMobileKeyboardInput}
         onKeyDown={handleMobileKeyDown}
      />

      <div 
        className="absolute inset-0 flex flex-col items-center justify-center bg-[#050505] text-slate-300 p-4"
        style={{ display: systemState === 'dashboard' ? 'flex' : 'none' }}
      >
           <div className="max-w-md w-full bg-[#111] border border-white/10 rounded-xl p-8 shadow-2xl flex flex-col items-center">
               <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10 shadow-[0_0_30px_rgba(255,255,255,0.05)]">
                    <Monitor className="w-10 h-10 text-slate-300" />
               </div>
               <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">v86 Emulator</h1>
               <p className="text-slate-400 text-center mb-8 text-sm">
                   Run a full x86-64 Linux environment natively in your browser.
               </p>
    
               <div className="w-full mb-8">
                   <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 block text-center">Memory Allocation (RAM)</label>
                   <div className="flex gap-2">
                       {[128, 256, 512].map(m => (
                           <button
                               key={m}
                               onClick={() => setRam(m)}
                               className={`flex-1 py-2.5 text-sm font-mono rounded border transition-all ${ram === m ? 'bg-white/10 border-white/30 text-white shadow-inner' : 'bg-transparent border-white/5 text-slate-500 hover:bg-white/5 hover:text-slate-300'}`}
                           >
                               {m} MB
                           </button>
                       ))}
                   </div>
               </div>
    
               <button
                   disabled={!v86Loaded}
                   onClick={() => startV86(ram)}
                   className="w-full py-4 bg-white text-black font-bold rounded flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-widest"
               >
                   <Play className="w-4 h-4 fill-current" />
                   Start Virtual Machine
               </button>
           </div>
      </div>

      <div 
        className="flex-1 flex flex-col w-full h-full bg-[#000] relative"
        style={{ display: systemState !== 'dashboard' ? 'flex' : 'none' }}
      >
               
               {/* Loading Overlay */}
               {systemState === 'loading' && (
                   <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm text-slate-300 p-4">
                       <div className="max-w-md w-full flex flex-col items-center">
                           <Cpu className="w-12 h-12 text-slate-500 mb-6 animate-pulse" />
                           <h2 className="text-xl font-bold text-white mb-2 uppercase tracking-widest">Loading System</h2>
                           <p className="text-slate-500 text-sm mb-8 font-mono">Fetching Virtual Disk Image...</p>
                           
                           <div className="w-full max-w-xs h-1 bg-white/10 rounded overflow-hidden">
                               <div 
                                   className="h-full bg-white transition-all duration-300 ease-out shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                                   style={{ width: `${progress}%` }}
                               />
                           </div>
                           <div className="mt-4 text-xs font-mono text-slate-400">{progress}%</div>
                       </div>
                   </div>
               )}
        
               {/* VM Container */}
               <div className="flex-1 flex items-center justify-center overflow-hidden w-full relative">
                   {/* Explicit CSS zoom handles perfect scaling mapped to original pixel tracking */}
                   <div style={{ zoom: zoom, width: 800, height: 600, position: 'relative', backgroundColor: '#000' }}>
                       <div ref={screenContainerRef} className="w-full h-full relative overflow-hidden" style={{ width: 800, height: 600 }}>
                           <div ref={textFallbackRef} className="absolute inset-0 whitespace-pre font-mono text-slate-300 pointer-events-none overflow-hidden" style={{ width: 800, height: 600, fontSize: '14px', lineHeight: '1.2' }}></div>
                           <canvas ref={canvasRef} onClick={handleFocus} className="block absolute inset-0 w-full h-full cursor-crosshair focus:outline-none" tabIndex={0} style={{ touchAction: 'none' }}></canvas>
                       </div>
                   </div>
               </div>
        
               {/* Toolbar */}
               <div className="h-14 bg-[#0a0a0a] border-t border-white/5 flex items-center justify-between px-4 sm:px-6 shrink-0 z-40">
                    <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                         <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                         System Running
                    </div>
                    
                    <div className="flex items-center gap-1 sm:gap-2">
                         <button onClick={handleKeyboardToggle} className="md:hidden p-2.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Toggle Virtual Keyboard">
                             <Keyboard className="w-5 h-5" />
                         </button>
                         <button onClick={toggleFullscreen} className="p-2.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Toggle Fullscreen">
                             <Maximize className="w-5 h-5" />
                         </button>
                         <div className="w-px h-5 bg-white/10 mx-1"></div>
                         <button onClick={handleStop} className="p-2.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors group flex items-center gap-2" title="Power Off">
                             <Square className="w-4 h-4 group-hover:fill-current" />
                             <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:block">Power Off</span>
                         </button>
                    </div>
               </div>
          </div>
    </div>
  );
}

