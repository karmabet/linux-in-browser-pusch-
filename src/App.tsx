import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Square, Maximize, Keyboard, Monitor, Cpu, Save, Clipboard, Network } from 'lucide-react';

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
  const [saveSlots, setSaveSlots] = useState<Record<string, string | null>>({});
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  const screenContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textFallbackRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  
  const emulatorRef = useRef<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
         setIsPointerLocked(document.pointerLockElement === canvasRef.current);
     };
     document.addEventListener('pointerlockchange', handlePointerLockChange);
     return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  // Pointer lock mouse input
  useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
          if (document.pointerLockElement === canvasRef.current && emulatorRef.current) {
              emulatorRef.current.mouse_move(e.movementX, e.movementY, 0, 0);
          }
      };

      const handleMouseDown = (e: MouseEvent) => {
          if (document.pointerLockElement === canvasRef.current && emulatorRef.current) {
              emulatorRef.current.mouse_click(e.button === 0 ? 1 : 0, e.button === 2 ? 1 : 0, 0);
          }
      };

      const handleMouseUp = (e: MouseEvent) => {
          if (document.pointerLockElement === canvasRef.current && emulatorRef.current) {
              emulatorRef.current.mouse_click(0, 0, 0);
          }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("mouseup", handleMouseUp);
      
      return () => {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mousedown", handleMouseDown);
          document.removeEventListener("mouseup", handleMouseUp);
      };
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

  const handleCanvasClick = async () => {
    if (emulatorRef.current && systemState === 'running') {
        emulatorRef.current.keyboard_set_status(true);
        canvasRef.current?.focus();
        try {
            await canvasRef.current?.requestPointerLock();
        } catch (e) {
            console.error("Pointer lock failed:", e);
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
      
      setTimeout(() => {
          if (!screenContainerRef.current) return;
          
          if (emulatorRef.current) {
              try { emulatorRef.current.destroy() } catch(e){}
          }
          
          if (textFallbackRef.current) textFallbackRef.current.innerHTML = '';

          try {
              const v86Config: any = {
                  wasm_path: "https://unpkg.com/v86/build/v86.wasm",
                  memory_size: memory * 1024 * 1024,
                  vga_memory_size: 8 * 1024 * 1024,
                  screen_container: screenContainerRef.current,
                  bios: { url: "/bios/seabios.bin" },
                  vga_bios: { url: "/bios/vgabios.bin" },
                  cdrom: { url: "/bios/linux.iso" },
                  autostart: true,
                  boot_order: 0x132,
                  network_relay_url: "wss://relay.widgetry.org/",
              };
              
              emulatorRef.current = new window.V86(v86Config);

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
          const el = canvasRef.current as any;
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

  const saveToSlot = async (slot: string) => {
      if (!emulatorRef.current) return;
      setToastMessage("Saving...");
      try {
          emulatorRef.current.stop();
          const state = await emulatorRef.current.save_state();
          emulatorRef.current.run();
          
          const request = indexedDB.open("vm-saves", 2);
          request.onsuccess = (e: any) => {
              const db = e.target.result;
              const tx = db.transaction("saves", "readwrite");
              const dateStr = new Date().toLocaleString();
              tx.objectStore("saves").put({ slot, state, date: dateStr }).onsuccess = () => {
                  setSaveSlots(prev => ({...prev, [slot]: dateStr}));
                  setToastMessage(`✅ Saved to Slot ${slot.replace('save-', '')}`);
                  setTimeout(() => setToastMessage(null), 3000);
              };
          };
      } catch (err) {
          emulatorRef.current?.run();
          console.error(err);
          setToastMessage("Save failed.");
          setTimeout(() => setToastMessage(null), 3000);
      }
  };

  const loadFromSlot = (slot: string) => {
      if (!emulatorRef.current) return;
      
      try {
          const request = indexedDB.open("vm-saves", 2);
          request.onsuccess = (e: any) => {
              const db = e.target.result;
              const tx = db.transaction("saves", "readonly");
              const req = tx.objectStore("saves").get(slot);
              req.onsuccess = (ev: any) => {
                  if (!ev.target.result) {
                      setToastMessage(`Slot ${slot.replace('save-', '')} is empty`);
                      setTimeout(() => setToastMessage(null), 3000);
                      return;
                  }
                  emulatorRef.current.stop();
                  emulatorRef.current.restore_state(ev.target.result.state);
                  emulatorRef.current.run();
                  setToastMessage(`✅ Loaded Slot ${slot.replace('save-', '')} — ${ev.target.result.date}`);
                  setTimeout(() => setToastMessage(null), 3000);
              };
              req.onerror = () => {
                  setToastMessage("Load Storage Error");
                  setTimeout(() => setToastMessage(null), 3000);
              };
          };
          request.onerror = () => {
              setToastMessage("Load DB Error");
              setTimeout(() => setToastMessage(null), 3000);
          };
      } catch (errIdb) {
          console.error(errIdb);
          setToastMessage("Load Catch Error");
          setTimeout(() => setToastMessage(null), 3000);
      }
  };

  const setupNetwork = () => {
      if (!emulatorRef.current) return;
      canvasRef.current?.focus();
      setTimeout(() => {
          emulatorRef.current.keyboard_send_text("sudo udhcpc\n");
          setToastMessage("Network setup command sent");
          setTimeout(() => setToastMessage(null), 3000);
      }, 200);
  };

  const handlePaste = async () => {
      if (!emulatorRef.current) return;
      try {
          const text = await navigator.clipboard.readText();
          if (!text) return;
          for (const char of text) {
              emulatorRef.current.keyboard_send_text(char);
          }
          setToastMessage(`Pasted ${text.length} characters`);
          setTimeout(() => setToastMessage(null), 3000);
      } catch (e) {
          console.error(e);
          setToastMessage("Clipboard access denied — click inside the VM first, then try again");
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
                   Run a full x86-64 Linux environment natively in your browser.
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
                   <div ref={screenContainerRef} className="relative overflow-hidden" style={{ zoom: zoom, width: 800, height: 600, backgroundColor: '#000' }}>
                       <div ref={textFallbackRef} className="absolute inset-0 whitespace-pre font-mono text-slate-300 pointer-events-none overflow-hidden" style={{ fontSize: '14px', lineHeight: '14px' }}></div>
                       <canvas 
                           ref={canvasRef} 
                           onClick={handleCanvasClick} 
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
                               <div className="bg-black/80 backdrop-blur text-white px-4 py-2 rounded-full text-xs font-mono border border-white/20 shadow-xl">
                                   Click to capture mouse — Press ESC to release
                               </div>
                           </div>
                       )}
                   </div>
               </div>
        
               {/* Toolbar */}
               <div className="h-14 bg-[#0a0a0a] border-t border-white/5 flex items-center justify-between px-2 sm:px-4 shrink-0 z-40 relative">
                    <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs font-mono text-slate-400 shrink-0 hidden md:flex">
                         <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                         System Running
                    </div>

                    {systemState === 'running' && (
                         <div className="flex items-center group ml-2 shrink-0">
                              <button 
                                  onClick={setupNetwork}
                                  className="px-2 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded border border-white/10 text-[10px] sm:text-xs font-mono transition-colors flex items-center gap-1.5"
                                  title="Setup Internet Connection"
                              >
                                  <Network className="w-3.5 h-3.5" /> 
                                  <span className="hidden lg:inline">Connect Net</span>
                              </button>
                         </div>
                    )}

                    {/* Compact Save Slots */}
                    <div className="flex flex-1 justify-center sm:justify-start md:justify-center items-center gap-1 sm:gap-2 px-2 shrink">
                         {[1, 2, 3].map(slotNum => {
                             const slotKey = `save-${slotNum}`;
                             const isSaved = !!saveSlots[slotKey];
                             return (
                                 <div key={slotNum} className="flex items-center bg-black/40 rounded border border-white/10 overflow-hidden shrink-0" title={isSaved ? saveSlots[slotKey]! : "Empty Slot"}>
                                     <span className="px-1.5 py-1 text-[10px] sm:text-xs text-slate-500 font-mono bg-white/5 border-r border-white/10 hidden sm:block">{slotNum}</span>
                                     <button 
                                         onClick={() => saveToSlot(slotKey)} 
                                         className="px-2 py-1.5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                                         title={`Save to Slot ${slotNum}`}
                                     >
                                         <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                     </button>
                                     <button 
                                         onClick={() => loadFromSlot(slotKey)} 
                                         disabled={!isSaved} 
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

