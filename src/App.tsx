import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Square, Maximize, Keyboard, Monitor, Cpu, Save, Clipboard, Network, Globe } from 'lucide-react';

declare global {
  interface Window {
    V86: any;
    V86Starter: any;
  }
}

const offlineFlag = new URLSearchParams(location.search).get('offline');
const offlineMode = offlineFlag === '1' || (location.protocol === 'nexus:' && offlineFlag !== '0');
async function snapshotStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
 return new Promise((resolve,reject) => {
  const open = indexedDB.open('vm-saves',2);
  open.onupgradeneeded = () => { if(!open.result.objectStoreNames.contains('saves'))open.result.createObjectStore('saves',{keyPath:'slot'}); };
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const db=open.result;const tx=db.transaction('saves',mode);const req=action(tx.objectStore('saves'));let value:T;
   req.onsuccess=()=>{value=req.result};tx.oncomplete=()=>{db.close();resolve(value)};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error || req.error || Error('Snapshot transaction failed'));};
  };
 });
}
export default function App() {
  const [systemState, setSystemState] = useState<'dashboard' | 'loading' | 'running'>('dashboard');
  const [caseFiles, setCaseFiles] = useState<{name: string; text: string}[]>([]);
  const [caseBusy, setCaseBusy] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      const trusted = ['https://nexushacker.com', 'https://www.nexushacker.com', 'nexus://game'];
      const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(event.origin);
      if (!trusted.includes(event.origin) && !local) return;
      const data = event.data;
      if (data?.type !== 'nexus-case-files' || data.version !== 1 || !Array.isArray(data.files) || data.files.length !== 2) return;
      if (!data.files.every((f: any) => f && ['auth.log', 'export.log'].includes(f.name) && typeof f.text === 'string' && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(f.text) && f.text.length <= 4096)) return;
      if (new Set(data.files.map((f: any) => f.name)).size !== 2) return;
      setCaseFiles(data.files.map((f: any) => ({name: f.name, text: f.text})));
    };
    window.addEventListener('message', receive);
    if (window.parent !== window) window.parent.postMessage({type: 'nexus-case-ready'}, '*');
    return () => window.removeEventListener('message', receive);
  }, []);
  const [snapshotBusy,setSnapshotBusy] = useState(false);
  const bootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [ram, setRam] = useState(256);
  const [v86Loaded, setV86Loaded] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveSlots, setSaveSlots] = useState<Record<string, string | null>>({});
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  const screenContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textFallbackRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  
  const emulatorRef = useRef<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const sendGuestText = async (text: string) => {
    const emu=emulatorRef.current;if(!emu)throw Error('VM is not running');
    emu.keyboard_set_status(true);
    try { await emu.keyboard_send_text(text, 3); }
    finally { if(emulatorRef.current===emu)emu.keyboard_set_status(!!screenContainerRef.current?.contains(document.activeElement)); }
  };

  const importCase = async () => {
    const vm = emulatorRef.current;
    if (!vm?.is_running() || caseBusy || snapshotBusy || caseFiles.length !== 2) return;
    setCaseBusy(true);
    try {
      // Quote the evidence as shell data. TinyCore's minimal BusyBox has no base64 applet.
      // User must intentionally open an idle guest shell before pressing this button.
      const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      const marker = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
      const writes = caseFiles.map(file => `printf '%s' ${quote(file.text)} > '/home/tc/nexus-case/${file.name}'`).join(' && ');
      await sendGuestText(`mkdir -p /home/tc/nexus-case && ${writes} && printf 'CASE_READY_%s\\n' '${marker}'\n`);
      const ok = await vm.wait_until_vga_screen_contains(`CASE_READY_${marker}`, {timeout_msec: 30000});
      setToastMessage(ok ? 'Case logs written to /home/tc/nexus-case. Use cat and grep to investigate.' : 'Guest did not confirm the write. Open an idle guest terminal and try again.');
    } catch (error) {
      console.error(error); setToastMessage('Case import failed. Open an idle guest terminal and try again.');
    } finally { setCaseBusy(false); }
  };

  // Touch gesture refs
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dragStartedRef = useRef(false);
  const lastTouchYRef = useRef<number | null>(null);

  const dispatchMouseEvent = (type: string, clientX: number, clientY: number, button: number) => {
      if (!canvasRef.current) return;
      const event = new MouseEvent(type, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: clientX,
          clientY: clientY,
          button: button,
          buttons: button === 2 ? 2 : (button === 0 ? 1 : 0),
      });
      canvasRef.current.dispatchEvent(event);
  };

  const dispatchWheelEvent = (clientX: number, clientY: number, deltaY: number) => {
      if (!canvasRef.current) return;
      const event = new WheelEvent('wheel', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: clientX,
          clientY: clientY,
          deltaY: deltaY,
      });
      canvasRef.current.dispatchEvent(event);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 1) {
          dragStartedRef.current = false;
          const touch = e.touches[0];
          longPressTimerRef.current = setTimeout(() => {
              if (!dragStartedRef.current) {
                  dispatchMouseEvent('mousedown', touch.clientX, touch.clientY, 2);
                  dispatchMouseEvent('mouseup', touch.clientX, touch.clientY, 2);
                  setToastMessage("Right Click simulated");
                  setTimeout(() => setToastMessage(null), 1500);
              }
          }, 600);
      } else if (e.touches.length === 2) {
          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
          lastTouchYRef.current = e.touches[0].clientY;
      }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
      dragStartedRef.current = true;
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      
      if (e.touches.length === 2 && lastTouchYRef.current !== null) {
          const deltaY = lastTouchYRef.current - e.touches[0].clientY;
          lastTouchYRef.current = e.touches[0].clientY;
          // Multiply for faster scroll
          dispatchWheelEvent(e.touches[0].clientX, e.touches[0].clientY, deltaY * 4);
      }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      lastTouchYRef.current = null;
  };


// Load expected libraries
  useEffect(() => {
    // Setup IndexedDB for saves
    const request = indexedDB.open("vm-saves", 2);
    request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("saves")) {
            db.createObjectStore("saves", { keyPath: "slot" });
        }
    };
    request.onsuccess = (e: any) => {
        const db = e.target.result;
        try {
            const tx = db.transaction("saves", "readonly");
            tx.objectStore("saves").getAll().onsuccess = (ev: any) => {
                const slots = ev.target.result || [];
                const newSaveSlots: Record<string, string> = {};
                slots.forEach((s: any) => {
                    newSaveSlots[s.slot] = s.date;
                });
                setSaveSlots(newSaveSlots);
            };
        } catch(err) {} 
    };

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

  // Pointer lock tracking
  useEffect(() => {
     const handlePointerLockChange = () => {
         setIsPointerLocked(document.pointerLockElement === screenContainerRef.current);
     };
     document.addEventListener('pointerlockchange', handlePointerLockChange);
     return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  // Cleanup Emulator on Unmount
  useEffect(() => {
    return () => {
      if (bootTimer.current)clearTimeout(bootTimer.current);
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
            if (screenContainerRef.current?.contains(document.activeElement)) {
                e.preventDefault();
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCanvasClick = async () => {
    if (emulatorRef.current && systemState === 'running') {
        emulatorRef.current.keyboard_set_status(true);
        screenContainerRef.current?.focus();
        if (!isPointerLocked) {
            try {
                await screenContainerRef.current?.requestPointerLock();
            } catch (e) {
                console.error("Pointer lock failed:", e);
            }
        }
    }
  };

  const startV86 = useCallback(async (memory: number) => {
      if (!window.V86) {
          console.error("V86 not loaded. Cannot start virtual machine.");
          return;
      }
      
      setSystemState('loading');
      setProgress(0);
      
      bootTimer.current = setTimeout(() => {
          if (!screenContainerRef.current) return;
          
          if (emulatorRef.current) {
              try { emulatorRef.current.destroy() } catch(e){}
          }
          
          if (textFallbackRef.current) textFallbackRef.current.innerHTML = '';

          try {
              const v86Config: any = {
                  wasm_path: "./v86/v86.wasm",
                  memory_size: memory * 1024 * 1024,
                  vga_memory_size: 8 * 1024 * 1024,
                  screen_container: screenContainerRef.current,
                  bios: { url: "./bios/seabios.bin" },
                  vga_bios: { url: "./bios/vgabios.bin" },
                  cdrom: { url: "./bios/linux.iso" },
                  autostart: true,
                  boot_order: 0x132,
                  ...(offlineMode ? {} : { network_relay_url: "wss://relay.widgetry.org/" }),
              };
              
              emulatorRef.current = new window.V86(v86Config);

              const emu = emulatorRef.current;

              emu.add_listener("download-progress", (e: any) => {
                  console.log("Loading:", e);
                  if (e && typeof e.loaded === 'number' && e.total > 0) {
                      const p = Math.min(100, Math.round((e.loaded / e.total) * 100));
                      setProgress(p);

                  }
              });

              emu.add_listener("download-error", (event: any) => {
                  setToastMessage("VM resource could not be loaded: " + event.file_name);setSystemState("dashboard");void emu.destroy();
              });
              emu.add_listener("emulator-ready", () => {
                  console.log("VM ready");
                  emu.keyboard_set_status(screenContainerRef.current?.contains(document.activeElement));
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
    if(document.pointerLockElement === screenContainerRef.current)document.exitPointerLock();
    if (emulatorRef.current) {
         try { emulatorRef.current.destroy() } catch(e){}
         emulatorRef.current = null;
    }
    setSystemState('dashboard');
  };

  const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
          const el = screenContainerRef.current as any;
          if (!el) return;
          if (el.requestFullscreen) el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
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
          emulatorRef.current?.keyboard_send_scancodes([0x0E,0x8E]); // Backspace
      } else if (ev.data && emulatorRef.current) {
          void sendGuestText(ev.data).catch(() => setToastMessage("Keyboard input failed"));
      }
      e.currentTarget.value = '';
  };

  const handleMobileKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          emulatorRef.current?.keyboard_send_scancodes([0x1C,0x9C]); // Enter
      } else if (e.key === 'Backspace') {
          e.preventDefault();
          emulatorRef.current?.keyboard_send_scancodes([0x0E,0x8E]); // Backspace
      }
  };

  const saveToSlot = async (slot: string) => {
    const emu=emulatorRef.current;if(!emu || snapshotBusy || caseBusy)return;
    setSnapshotBusy(true);setToastMessage('Saving…');
    try { await emu.stop();const state=await emu.save_state();const date=new Date().toLocaleString();
      await snapshotStore('readwrite', store=>store.put({slot,state,date}));setSaveSlots(prev=>({...prev,[slot]:date}));setToastMessage('Saved to Slot '+slot.replace('save-',''));
    } catch(error){console.error(error);setToastMessage('Save failed. Existing snapshots are unchanged.');}
    finally { if(emulatorRef.current===emu)await emu.run();setSnapshotBusy(false);setTimeout(()=>setToastMessage(null),3000); }
  };
  const loadFromSlot = async (slot: string) => {
    const emu=emulatorRef.current;if(!emu || snapshotBusy || caseBusy)return;
    setSnapshotBusy(true);setToastMessage('Loading…');
    try { const saved:any=await snapshotStore('readonly',store=>store.get(slot));if(!saved)throw Error('Empty snapshot slot');
      await emu.stop();await emu.restore_state(saved.state);setToastMessage('Loaded Slot '+slot.replace('save-','')+' — '+saved.date);
    } catch(error){console.error(error);setToastMessage('Load failed. The snapshot could not be restored.');}
    finally { if(emulatorRef.current===emu)await emu.run();setSnapshotBusy(false);setTimeout(()=>setToastMessage(null),3000); }
  };

  const setupNetwork = () => {
      if (!emulatorRef.current || offlineMode) return;
      canvasRef.current?.focus();
      setTimeout(() => {
          emulatorRef.current.keyboard_send_text("sudo udhcpc\n");
          setToastMessage("Network setup command sent");
          setTimeout(() => setToastMessage(null), 3000);
      }, 200);
  };

  const installBrowser = () => {
      if (!emulatorRef.current) return;
      canvasRef.current?.focus();
      setTimeout(() => {
          emulatorRef.current.keyboard_send_text("tce-load -wi links && clear && links https://google.com\n");
          setToastMessage("Browser command sent to the guest terminal.");
          setTimeout(() => setToastMessage(null), 3000);
      }, 200);
  };

  const handlePaste = async () => {
      if (!emulatorRef.current) return;
      try {
          const text = await navigator.clipboard.readText();
          if (!text) return;
          await sendGuestText(text);
          setToastMessage(`Pasted ${text.length} characters`);
          setTimeout(() => setToastMessage(null), 3000);
      } catch (e) {
          console.error(e);
          setToastMessage("Paste failed — check clipboard access and that the VM is running");
          setTimeout(() => setToastMessage(null), 3000);
      }
  };

  return (
    <div className="h-screen w-screen bg-[#050505] text-slate-300 font-sans flex flex-col overflow-hidden relative">
      {toastMessage && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/10 backdrop-blur-md border border-white/20 text-white px-4 py-2 rounded-lg text-sm shadow-xl z-50 pointer-events-none">
               {toastMessage}
          </div>
      )}

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
                   Tiny Core Linux 17.0 — a 32-bit x86 guest running locally in v86.
               </p>
    
               <div className="w-full mb-8 relative">
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
               <a href={offlineMode ? "./credits.html?offline=1" : "./credits.html"} className="mt-5 text-xs text-slate-400 underline underline-offset-4">Tiny Core Linux · v86 · Credits &amp; licenses</a>
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
                   {/* Explicit CSS transform wrapper handles perfect scaling mapped to original pixel tracking */}
                   <div style={{ width: 800 * zoom, height: 600 * zoom, position: 'relative' }}>
                       <div ref={screenContainerRef} tabIndex={0} onClick={handleCanvasClick} onFocus={() => emulatorRef.current?.keyboard_set_status(true)} onBlur={() => emulatorRef.current?.keyboard_set_status(false)} onContextMenu={event => event.preventDefault()} className="absolute top-0 left-0 overflow-hidden" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 800, height: 600, backgroundColor: '#000' }}>
                           <div ref={textFallbackRef} className="absolute inset-0 whitespace-pre font-mono text-slate-300 pointer-events-none overflow-hidden" style={{ fontSize: '14px', lineHeight: '14px' }}></div>
                           <canvas 
                               ref={canvasRef} 

                               onTouchStart={handleTouchStart}
                               onTouchMove={handleTouchMove}
                               onTouchEnd={handleTouchEnd}
                               onTouchCancel={handleTouchEnd}
                               className="block absolute inset-0 w-full h-full cursor-crosshair focus:outline-none" 
                               tabIndex={0} 
                               style={{ touchAction: 'none' }}
                           ></canvas>
                           
                           {systemState === 'running' && !isPointerLocked && (
                               <div className="absolute inset-x-0 bottom-4 pointer-events-none flex justify-center z-10">
                                   <div className="bg-black/80 backdrop-blur text-white px-4 py-2 rounded-full text-xs font-mono border border-white/20 shadow-xl" style={{ transform: `scale(${1/zoom})` }}>
                                       Click to capture mouse — Press ESC to release
                                   </div>
                               </div>
                           )}
                       </div>
                   </div>
               </div>
        
               {/* Toolbar */}
               <div className="h-14 bg-[#0a0a0a] border-t border-white/5 flex items-center justify-between px-2 sm:px-4 shrink-0 z-40 relative">
                    <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-mono text-slate-400 shrink-0 hidden md:flex">
                         <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                         {offlineMode ? "VM Running · Offline" : "VM Running"}
                    </div>

                    {systemState === 'running' && !offlineMode && (
                         <div className="flex items-center group ml-2 shrink-0 gap-1 sm:gap-2">
                              <button 
                                  onClick={setupNetwork}
                                  className="px-2 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded border border-white/10 text-[10px] sm:text-xs font-mono transition-colors flex items-center gap-1.5"
                                  title="Setup Internet Connection"
                              >
                                  <Network className="w-3.5 h-3.5" /> 
                                  <span className="hidden sm:inline">Connect Net</span>
                              </button>
                              
                              <button 
                                  onClick={installBrowser}
                                  className="px-2 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded border border-white/10 text-[10px] sm:text-xs font-mono transition-colors flex items-center gap-1.5"
                                  title="Install Links Browser"
                              >
                                  <Globe className="w-3.5 h-3.5" /> 
                                  <span className="hidden sm:inline">Install Browser</span>
                              </button>


                         </div>
                    )}

                    {caseFiles.length === 2 && <button onClick={importCase} disabled={caseBusy || snapshotBusy || systemState !== 'running'} title="At an idle tc@box shell prompt: write auth.log and export.log into /home/tc/nexus-case" className="px-2 py-1.5 rounded border border-cyan-400/30 text-cyan-200 text-xs disabled:opacity-40">{caseBusy ? 'Writing case logs…' : 'Import case logs'}</button>}
                    {/* Compact Save Slots */}
                    <div className="flex flex-1 justify-center sm:justify-start md:justify-center items-center gap-1 sm:gap-2 px-2 shrink">
                         {[1, 2, 3].map(slotNum => {
                             const slotKey = `save-${slotNum}`;
                             const isSaved = !!saveSlots[slotKey];
                             return (
                                 <div key={slotNum} className="flex items-center bg-black/40 rounded border border-white/10 overflow-hidden shrink-0" title={isSaved ? saveSlots[slotKey]! : "Empty Slot"}>
                                     <span className="px-1.5 py-1 text-[10px] sm:text-xs text-slate-500 font-mono bg-white/5 border-r border-white/10 hidden sm:block">{slotNum}</span>
                                     <button 
                                         disabled={snapshotBusy} onClick={() => saveToSlot(slotKey)}
                                         className="px-2 py-1.5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                                         title={`Save to Slot ${slotNum}`}
                                     >
                                         <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                     </button>
                                     <button 
                                         onClick={() => loadFromSlot(slotKey)} 
                                         disabled={!isSaved || snapshotBusy}
                                         className="px-2 py-1.5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                         title={isSaved ? `Load Slot ${slotNum}` : `Slot ${slotNum} Empty`}
                                     >
                                         <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                                     </button>
                                 </div>
                             );
                         })}
                    </div>
                    
                    <div className="flex items-center gap-1 shrink-0">
                         <button onClick={handlePaste} className="p-2 sm:p-2.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Paste">
                             <Clipboard className="w-4 h-4 sm:w-5 sm:h-5" />
                         </button>
                         <button onClick={handleKeyboardToggle} className="md:hidden p-2 sm:p-2.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Toggle Virtual Keyboard">
                             <Keyboard className="w-4 h-4 sm:w-5 sm:h-5" />
                         </button>
                         <button onClick={toggleFullscreen} className="p-2 sm:p-2.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Toggle Fullscreen">
                             <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
                         </button>
                         <div className="w-px h-5 bg-white/10 mx-1"></div>
                         <button onClick={handleStop} className="p-2 sm:p-2.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors group flex items-center gap-2" title="Power Off">
                             <Square className="w-4 h-4 sm:w-4 sm:h-4 group-hover:fill-current" />
                             <span className="text-[10px] font-bold uppercase tracking-wider hidden lg:block">Power Off</span>
                         </button>
                    </div>
               </div>
          </div>
    </div>
  );
}

