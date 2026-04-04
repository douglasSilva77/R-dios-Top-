import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Search, Radio, Music2, Plus, X, MapPin, Share2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Hls from 'hls.js';
import { RADIO_STATIONS as INITIAL_STATIONS, RadioStation } from './constants';
import Visualizer from './components/Visualizer';
import { auth, db, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, handleFirestoreError, OperationType, updateDoc, deleteDoc, doc } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';

// Carousel Items from Environment Variables or Defaults
const CAROUSEL_ITEMS = [
  {
    url: import.meta.env.VITE_CAROUSEL_IMG_1 || "https://i.ibb.co/20QZfQSP/banner1.jpg",
    title: import.meta.env.VITE_CAROUSEL_TITLE_1 || "Rádios Top",
    subtitle: import.meta.env.VITE_CAROUSEL_SUB_1 || "As melhores estão aqui"
  },
  {
    url: import.meta.env.VITE_CAROUSEL_IMG_2 || "https://i.ibb.co/N2GvNqPH/banner2.jpg",
    title: import.meta.env.VITE_CAROUSEL_TITLE_2 || "Qualidade Premium",
    subtitle: import.meta.env.VITE_CAROUSEL_SUB_2 || "Transmissões de alta qualidade"
  },
  {
    url: import.meta.env.VITE_CAROUSEL_IMG_3 || "https://i.ibb.co/Xfw3BP4c/banner4.jpg",
    title: import.meta.env.VITE_CAROUSEL_TITLE_3 || "Rádio Manancial",
    subtitle: import.meta.env.VITE_CAROUSEL_SUB_3 || "Conectando você com Deus"
  },
  {
    url: import.meta.env.VITE_CAROUSEL_IMG_4 || "https://i.ibb.co/1gSdhBW/banner3.jpg",
    title: import.meta.env.VITE_CAROUSEL_TITLE_4 || "Rádios Estelar",
    subtitle: import.meta.env.VITE_CAROUSEL_SUB_4 || "Onde o som alcança o infinito"
  }
];

// Extended RadioStation type for Firestore
interface CustomRadioStation extends RadioStation {
  createdAt: any;
  streamingUrl?: string;
  imageUrl?: string;
  city?: string;
}

function RadioApp() {
  const [stations, setStations] = useState<CustomRadioStation[]>([]);
  const [currentStation, setCurrentStation] = useState<RadioStation | CustomRadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGenre, setActiveGenre] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stationToDelete, setStationToDelete] = useState<string | null>(null);
  const [notification, setNotification] = useState<{title?: string, message: string, type: 'success' | 'error'} | null>(null);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [carouselIndex, setCarouselIndex] = useState(0);

  const addDebug = (msg: string) => {
    console.log(`[DEBUG] ${msg}`);
    setDebugInfo(prev => [new Date().toLocaleTimeString() + ': ' + msg, ...prev].slice(0, 20));
  };

  useEffect(() => {
    const checkServer = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          setServerStatus('online');
          addDebug("Servidor Proxy Online");
        } else {
          setServerStatus('offline');
          addDebug("Servidor Proxy Offline (Status: " + res.status + ")");
        }
      } catch (err) {
        setServerStatus('offline');
        addDebug("Erro ao conectar ao servidor proxy");
      }
    };
    checkServer();
  }, []);
  const [passwordError, setPasswordError] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [useProxy, setUseProxy] = useState(true);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    streamingUrl: '',
    imageUrl: '',
    city: '',
    genre: 'Geral'
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (!db) {
      console.warn("Banco de dados não disponível para carregar rádios.");
      return;
    }

    console.log("Iniciando escuta do banco de dados...");
    const stationsRef = collection(db, 'radio_stations');
    const q = query(stationsRef);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Snapshot recebido: ${snapshot.size} rádios encontradas.`);
      const fetchedStations = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          genre: data.genre || 'Geral',
          name: data.name || 'Sem Nome',
          city: data.city || data.country || 'Desconhecida',
          url: data.streamingUrl || data.url || '',
          logo: data.imageUrl || data.logo || `https://picsum.photos/seed/${doc.id}/200/200`
        };
      }) as CustomRadioStation[];
      
      // Sort in memory
      const sorted = fetchedStations.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const timeB = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return timeB - timeA;
      });

      setStations(sorted);
    }, (error) => {
      console.error("Erro na escuta em tempo real:", error);
      handleFirestoreError(error, OperationType.LIST, 'radio_stations');
    });

    return () => unsubscribe();
  }, []);

  const allStations = stations;
  const genres = Array.from(new Set(allStations.map(s => s.genre)));

  const filteredStations = allStations.filter(station => {
    const name = station.name || '';
    const genre = station.genre || 'Geral';
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         genre.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGenre = activeGenre ? genre === activeGenre : true;
    return matchesSearch && matchesGenre;
  });

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (!audioRef.current || !currentStation) return;
    
    const rawUrl = currentStation.url || (currentStation as any).streamingUrl;
    const url = getAudioUrl(rawUrl);
    
    // If URL is empty, stop and show error
    if (!url || url === '' || url.includes('undefined')) {
      console.warn("Nenhuma URL de streaming disponível para:", currentStation.name);
      setIsPlaying(false);
      setPlaybackError("Esta rádio não possui um link de áudio válido ou o link está quebrado.");
      return;
    }

    // Reset error when starting
    setPlaybackError(null);

    // Clean up previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // If station changed or src is different, reload
    const currentSrc = audioRef.current.src;
    const targetSrc = url.startsWith('http') ? url : window.location.origin + url;
    
    if (currentSrc !== targetSrc || rawUrl.includes('.m3u8')) {
      addDebug(`Carregando nova URL: ${targetSrc}`);
      
      // Stop and clean up previous source
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      
      if (rawUrl.includes('.m3u8')) {
        if (Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(targetSrc);
          hls.attachMedia(audioRef.current);
          hlsRef.current = hls;
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              addDebug(`HLS Fatal Error: ${data.type}`);
              setPlaybackError(`Erro HLS: ${data.type}`);
              setIsPlaying(false);
            }
          });
        } else if (audioRef.current.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS support (Safari)
          audioRef.current.src = targetSrc;
          audioRef.current.load();
        } else {
          setPlaybackError("Seu navegador não suporta transmissões HLS (.m3u8)");
          setIsPlaying(false);
          return;
        }
      } else {
        audioRef.current.src = targetSrc;
        audioRef.current.load();
      }
    }
    
    if (isPlaying) {
      addDebug(`Iniciando play: ${currentStation.name}`);
      
      // Use a small timeout to avoid the play/pause race condition
      const playTimeout = setTimeout(() => {
        if (!audioRef.current) return;
        
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            addDebug("Reprodução iniciada com sucesso!");
          }).catch(err => {
            const isAbortError = err.name === 'AbortError' || err.message?.includes('interrupted by a call to pause');
            if (!isAbortError) {
              addDebug(`Erro ao iniciar reprodução: ${err.message}`);
              setPlaybackError(`Erro ao tocar: ${err.message || 'O formato do áudio pode não ser suportado ou o link está quebrado.'}`);
              setIsPlaying(false);
            } else {
              addDebug("Reprodução interrompida (AbortError ignorado)");
            }
          });
        }
      }, 200);
      return () => clearTimeout(playTimeout);
    } else {
      addDebug("Pausando áudio.");
      audioRef.current.pause();
    }
  }, [isPlaying, currentStation?.id, useProxy]);

  const togglePlay = () => setIsPlaying(!isPlaying);

  const handleShare = () => {
    // Dynamic URL based on current origin, replacing -dev- with -pre- for sharing
    const deployUrl = window.location.origin.replace('-dev-', '-pre-');
    
    if (navigator.share) {
      navigator.share({
        title: 'Global Hub Radio',
        text: 'Ouça as melhores rádios do mundo no Global Hub!',
        url: deployUrl,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(deployUrl);
      alert('Link copiado para a área de transferência!');
    }
  };

  const handleStationSelect = (station: RadioStation | CustomRadioStation) => {
    setPlaybackError(null);
    setCurrentStation(station);
    setIsPlaying(true);
  };

  const handleNext = () => {
    if (!currentStation || allStations.length === 0) return;
    const currentIndex = allStations.findIndex(s => s.id === currentStation?.id);
    const nextIndex = (currentIndex + 1) % allStations.length;
    handleStationSelect(allStations[nextIndex]);
  };

  const handlePrev = () => {
    if (!currentStation || allStations.length === 0) return;
    const currentIndex = allStations.findIndex(s => s.id === currentStation?.id);
    const prevIndex = (currentIndex - 1 + allStations.length) % allStations.length;
    handleStationSelect(allStations[prevIndex]);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPassword = (import.meta as any).env.VITE_SENHA;
    if (passwordInput === correctPassword) {
      setIsAdmin(true);
      setPasswordError(false);
    } else {
      setPasswordError(true);
      setTimeout(() => setPasswordError(false), 2000);
    }
  };

  const handleEdit = (station: CustomRadioStation) => {
    setEditingId(station.id);
    setFormData({
      name: station.name,
      streamingUrl: station.streamingUrl || station.url || '',
      imageUrl: station.imageUrl || station.logo || '',
      city: station.city || station.country || '',
      genre: station.genre || 'Geral'
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      name: '',
      streamingUrl: '',
      imageUrl: '',
      city: '',
      genre: 'Geral'
    });
  };

  const handleDelete = (id: string) => {
    setStationToDelete(id);
  };

  const executeDelete = async () => {
    if (!db || !stationToDelete) return;
    try {
      await deleteDoc(doc(db, 'radio_stations', stationToDelete));
      if (editingId === stationToDelete) resetForm();
      if (currentStation?.id === stationToDelete) {
        setCurrentStation(null);
        setIsPlaying(false);
      }
      setNotification({ title: 'Atenção', message: 'Rádio deletada com sucesso', type: 'success' });
      setStationToDelete(null);
      
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'radio_stations');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Tentando salvar/atualizar rádio...", formData);
    if (!db) {
      console.error("Erro: Banco de dados não inicializado.");
      alert("Erro: O banco de dados não está pronto. Verifique sua conexão.");
      return;
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, 'radio_stations', editingId), {
          ...formData,
          updatedAt: serverTimestamp()
        });
        alert("Rádio atualizada com sucesso!");
      } else {
        const docRef = await addDoc(collection(db, 'radio_stations'), {
          ...formData,
          createdAt: serverTimestamp()
        });
        console.log("Rádio salva com sucesso! ID:", docRef.id);
        alert("Rádio salva com sucesso!");
      }
      resetForm();
    } catch (error) {
      console.error("Erro ao salvar/atualizar rádio:", error);
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'radio_stations');
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % CAROUSEL_ITEMS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleAudioError = () => {
    if (!currentStation) return;
    const error = audioRef.current?.error;
    let message = "Não foi possível carregar o áudio. O link pode estar offline ou o formato não é suportado.";
    
    if (error) {
      console.error("Erro detalhado do elemento áudio:", {
        code: error.code,
        message: error.message
      });
      
      switch (error.code) {
        case 1: message = "O carregamento foi interrompido."; break;
        case 2: message = "Erro de rede: Verifique sua conexão ou se o link da rádio ainda existe."; break;
        case 3: message = "Erro de decodificação: O formato deste streaming não é compatível com seu navegador."; break;
        case 4: message = "Fonte não suportada: O navegador não conseguiu abrir este link de áudio."; break;
      }
    }

    setIsPlaying(false);
    const url = currentStation.url || (currentStation as any).streamingUrl;
    
    if (url?.startsWith('http') && useProxy) {
      setPlaybackError(`${message} (Tentando via Servidor)`);
    } else {
      setPlaybackError(message);
    }
  };

  const getAudioUrl = (url: string) => {
    if (!url || url === 'undefined') return '';
    
    // HLS (.m3u8) should NOT be proxied if it's already HTTPS because 
    // the proxy doesn't rewrite relative paths in the playlist.
    if (url.startsWith('https') && url.includes('.m3u8')) {
      return url;
    }

    // Force proxy for non-secure HTTP (http://) to avoid Mixed Content errors
    if (url.startsWith('http://')) {
      return `/api/proxy?url=${encodeURIComponent(url)}`;
    }

    if (!useProxy) return url;

    // Proxy HTTPS URLs (except HLS) to avoid CORS issues
    if (url.startsWith('https')) {
      return `/api/proxy?url=${encodeURIComponent(url)}`;
    }

    return url;
  };

  return (
    <div className="min-h-screen bg-[#0a0502] text-white font-sans selection:bg-orange-500/30">
      {/* Atmospheric Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/10 blur-[150px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-20 px-4 md:px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <Radio className="w-6 h-6 text-orange-500" />
          <span className="font-bold tracking-tighter text-xl text-orange-500">RÁDIOS TOP</span>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button 
            onClick={handleShare}
            className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-white/10 hover:bg-white/20 rounded-full text-sm font-medium transition-all w-full sm:w-auto"
            title="Compartilhar App"
          >
            <Share2 className="w-4 h-4" />
            <span className="sm:hidden lg:inline">Compartilhar</span>
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 px-6 py-3 sm:py-2 bg-orange-600 rounded-full text-sm font-medium hover:bg-orange-700 transition-colors shadow-lg shadow-orange-600/20 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            Adicionar Rádio
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-8 space-y-8 md:space-y-12">
        {/* Carousel Section */}
        <section className="relative h-48 md:h-80 rounded-3xl overflow-hidden group shadow-2xl shadow-black/50">
          <AnimatePresence mode="wait">
            <motion.img
              key={carouselIndex}
              src={CAROUSEL_ITEMS[carouselIndex].url}
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="absolute inset-0 w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </AnimatePresence>
          
          {/* Carousel Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-6 md:p-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={`text-${carouselIndex}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
              >
                <h2 className="text-2xl md:text-4xl font-bold tracking-tight">{CAROUSEL_ITEMS[carouselIndex].title}</h2>
                <p className="text-white/60 text-sm md:text-lg mt-2 max-w-md">{CAROUSEL_ITEMS[carouselIndex].subtitle}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Carousel Controls */}
          <div className="absolute inset-y-0 left-4 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => setCarouselIndex((prev) => (prev - 1 + CAROUSEL_ITEMS.length) % CAROUSEL_ITEMS.length)}
              className="p-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 hover:bg-orange-600 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          </div>
          <div className="absolute inset-y-0 right-4 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button 
              onClick={() => setCarouselIndex((prev) => (prev + 1) % CAROUSEL_ITEMS.length)}
              className="p-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 hover:bg-orange-600 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Carousel Indicators */}
          <div className="absolute bottom-6 right-6 flex gap-2">
            {CAROUSEL_ITEMS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCarouselIndex(i)}
                className={`w-2 h-2 rounded-full transition-all ${i === carouselIndex ? 'w-8 bg-orange-500' : 'bg-white/30'}`}
              />
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12">
          
          {/* Left Column: Player & Now Playing */}
          {currentStation && (
            <div className="lg:col-span-7 flex flex-col justify-center">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 md:space-y-8"
              >
                <div className="flex items-center gap-3 text-orange-500 font-mono text-[10px] md:text-xs tracking-[0.2em] uppercase">
                  <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  <span>Transmissão ao Vivo</span>
                </div>

                <div className="space-y-6">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentStation.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="space-y-6"
                    >
                      <div className="w-24 h-24 md:w-32 md:h-32 rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-orange-600/10">
                        <img 
                          src={currentStation.logo || (currentStation as any).imageUrl} 
                          alt={currentStation.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      
                      <div>
                        <h1 className="text-4xl sm:text-6xl md:text-8xl font-light tracking-tighter leading-tight md:leading-none break-words">
                          {currentStation.name}
                        </h1>
                        <div className="mt-4 flex flex-wrap items-center gap-4 md:gap-6 text-white/50">
                          <div className="flex items-center gap-2">
                            <Music2 className="w-4 h-4" />
                            <span className="text-xs md:text-sm uppercase tracking-wider">{currentStation.genre}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            <span className="text-xs md:text-sm uppercase tracking-wider">{(currentStation as any).city || currentStation.country}</span>
                          </div>
                        </div>

                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-2 px-3 py-1 bg-orange-500/20 rounded-full">
                          <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                          <span className="text-[10px] uppercase tracking-widest font-bold text-orange-500">Ao Vivo</span>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${serverStatus === 'online' ? 'bg-green-500' : serverStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'}`} title={`Servidor: ${serverStatus}`} />
                      </div>

                        {playbackError && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs md:text-sm flex flex-col gap-3"
                          >
                            <div className="flex items-center gap-3">
                              <X className="w-4 h-4 flex-shrink-0" />
                              <p>{playbackError}</p>
                            </div>
                            <button 
                              onClick={() => {
                                setPlaybackError(null);
                                if (audioRef.current) {
                                  audioRef.current.load();
                                  audioRef.current.play().catch(err => setPlaybackError(`Erro: ${err.message}`));
                                }
                              }}
                              className="text-[10px] uppercase tracking-widest font-bold text-white bg-red-500/20 px-3 py-1 rounded-full hover:bg-red-500/40 transition-all self-start"
                            >
                              Tentar Novamente
                            </button>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Visualizer Area */}
                <div className="h-24 md:h-32 flex items-end relative">
                  <Visualizer audioElement={audioRef.current} isPlaying={isPlaying} />
                  {isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center gap-1 pointer-events-none">
                      {[...Array(20)].map((_, i) => (
                        <motion.div
                          key={i}
                          animate={{ 
                            height: [10, Math.random() * 60 + 20, 10],
                            opacity: [0.3, 0.6, 0.3]
                          }}
                          transition={{ 
                            duration: 0.5 + Math.random() * 0.5, 
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.05
                          }}
                          className="w-1 bg-orange-500/40 rounded-full"
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Player Controls */}
                <div className="flex flex-col gap-6 md:gap-8">
                  <div className="flex items-center justify-center lg:justify-start gap-6 md:gap-8">
                    <button 
                      onClick={handlePrev}
                      className="p-3 md:p-4 rounded-full hover:bg-white/5 transition-colors text-white/60 hover:text-white"
                    >
                      <SkipBack className="w-6 h-6 md:w-8 md:h-8" />
                    </button>
                    
                    <button 
                      onClick={togglePlay}
                      className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-orange-600 flex items-center justify-center hover:scale-105 transition-transform shadow-2xl shadow-orange-600/20"
                    >
                      {isPlaying ? (
                        <Pause className="w-8 h-8 md:w-10 md:h-10 fill-white" />
                      ) : (
                        <Play className="w-8 h-8 md:w-10 md:h-10 fill-white ml-1" />
                      )}
                    </button>

                    <button 
                      onClick={handleNext}
                      className="p-3 md:p-4 rounded-full hover:bg-white/5 transition-colors text-white/60 hover:text-white"
                    >
                      <SkipForward className="w-6 h-6 md:w-8 md:h-8" />
                    </button>
                  </div>

                  {/* Volume Control */}
                  <div className="flex items-center gap-4 max-w-xs mx-auto lg:mx-0 w-full">
                    <button onClick={() => setIsMuted(!isMuted)} className="text-white/40 hover:text-white transition-colors">
                      {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-600"
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          )}

          {/* Right Column: Station List */}
          <div className={`${currentStation ? 'lg:col-span-5' : 'lg:col-span-12'} space-y-6 md:space-y-8`}>
            <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-4 md:p-8 flex flex-col ${currentStation ? 'h-[60vh] lg:h-[80vh]' : 'min-h-[40vh]'}`}>
              <div className="space-y-4 md:space-y-6 mb-6 md:mb-8">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl md:text-2xl font-bold tracking-tight">Estações Disponíveis</h2>
                  {!currentStation && stations.length === 0 && (
                    <button 
                      onClick={() => setIsModalOpen(true)}
                      className="text-[10px] uppercase tracking-widest font-bold text-orange-500 hover:text-orange-400"
                    >
                      Adicionar Rádio
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input 
                    type="text" 
                    placeholder="Buscar rádios ou gêneros..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 md:py-4 pl-12 pr-4 focus:outline-none focus:border-orange-500/50 transition-colors text-sm md:text-base"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button 
                    onClick={() => setActiveGenre(null)}
                    className={`px-4 py-2 rounded-full text-[10px] md:text-xs font-medium transition-colors whitespace-nowrap ${!activeGenre ? 'bg-orange-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                  >
                    Todas
                  </button>
                  {genres.map(genre => (
                    <button 
                      key={genre}
                      onClick={() => setActiveGenre(genre)}
                      className={`px-4 py-2 rounded-full text-[10px] md:text-xs font-medium transition-colors whitespace-nowrap ${activeGenre === genre ? 'bg-orange-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`flex-1 overflow-y-auto custom-scrollbar pr-2 ${currentStation ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'}`}>
                {filteredStations.map((station) => (
                  <button
                    key={station.id}
                    onClick={() => handleStationSelect(station)}
                    className={`w-full group flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-2xl transition-all ${
                      currentStation?.id === station.id 
                        ? 'bg-orange-600/20 border border-orange-600/30' 
                        : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <div className="relative w-10 h-10 md:w-12 md:h-12 rounded-xl overflow-hidden flex-shrink-0">
                      <img 
                        src={station.logo || (station as any).imageUrl} 
                        alt={station.name} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      {currentStation?.id === station.id && isPlaying && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="flex gap-0.5 items-end h-3 md:h-4">
                            <div className="w-0.5 md:w-1 bg-orange-500 animate-[music-bar_0.6s_ease-in-out_infinite]" />
                            <div className="w-0.5 md:w-1 bg-orange-500 animate-[music-bar_0.8s_ease-in-out_infinite]" />
                            <div className="w-0.5 md:w-1 bg-orange-500 animate-[music-bar_0.7s_ease-in-out_infinite]" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className={`text-sm md:text-base font-medium transition-colors ${currentStation?.id === station.id ? 'text-orange-500' : 'text-white/80 group-hover:text-white'}`}>
                        {station.name}
                      </h3>
                      <p className="text-[10px] md:text-xs text-white/40">{station.genre} • {(station as any).city || station.country}</p>
                    </div>
                  </button>
                ))}
                {filteredStations.length === 0 && (
                  <div className="col-span-full py-12 text-center text-white/20">
                    Nenhuma rádio encontrada para sua busca.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Add Station Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsModalOpen(false);
                if (!isAdmin) setPasswordInput('');
              }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-[#151619] border border-white/10 rounded-3xl p-6 md:p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              {!isAdmin ? (
                <div className="max-w-md mx-auto py-12">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-orange-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Radio className="w-8 h-8 text-orange-500" />
                    </div>
                    <h2 className="text-2xl font-bold">Área Administrativa</h2>
                    <p className="text-white/40 mt-2">Insira a senha para continuar</p>
                  </div>
                  
                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <input 
                        type="password" 
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        className={`w-full bg-white/5 border rounded-xl py-3 px-4 focus:outline-none transition-colors ${passwordError ? 'border-red-500' : 'border-white/10 focus:border-orange-500/50'}`}
                        placeholder="Senha"
                        autoFocus
                      />
                      {passwordError && (
                        <p className="text-red-500 text-xs text-center">Senha errada</p>
                      )}
                    </div>
                    <button 
                      type="submit"
                      className="w-full py-3 bg-orange-600 rounded-xl font-bold hover:bg-orange-700 transition-colors"
                    >
                      Entrar
                    </button>
                  </form>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div>
                    <div className="flex justify-between items-center mb-8">
                      <h2 className="text-2xl font-bold">{editingId ? 'Editar Rádio' : 'Adicionar Nova Rádio'}</h2>
                      {editingId && (
                        <button 
                          onClick={resetForm}
                          className="text-xs text-orange-500 hover:underline"
                        >
                          Novo Cadastro
                        </button>
                      )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] md:text-xs uppercase tracking-widest text-white/40">Nome da Rádio</label>
                        <input 
                          required
                          type="text" 
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base"
                          placeholder="Ex: Rádio Mix"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] md:text-xs uppercase tracking-widest text-white/40">Streaming da Rádio</label>
                        <input 
                          required
                          type="url" 
                          value={formData.streamingUrl}
                          onChange={(e) => setFormData({...formData, streamingUrl: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base"
                          placeholder="https://..."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] md:text-xs uppercase tracking-widest text-white/40">Imagem da Rádio</label>
                        <input 
                          required
                          type="url" 
                          value={formData.imageUrl}
                          onChange={(e) => setFormData({...formData, imageUrl: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base"
                          placeholder="https://..."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] md:text-xs uppercase tracking-widest text-white/40">Cidade</label>
                          <input 
                            required
                            type="text" 
                            value={formData.city}
                            onChange={(e) => setFormData({...formData, city: e.target.value})}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base"
                            placeholder="Ex: São Paulo"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] md:text-xs uppercase tracking-widest text-white/40">Gênero</label>
                          <input 
                            required
                            type="text" 
                            value={formData.genre}
                            onChange={(e) => setFormData({...formData, genre: e.target.value})}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base"
                            placeholder="Ex: Pop"
                          />
                        </div>
                      </div>
                      <div className="pt-4 flex gap-4">
                        <button 
                          type="submit"
                          className="flex-1 py-3 md:py-4 bg-orange-600 rounded-2xl font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-600/20 text-sm md:text-base"
                        >
                          {editingId ? 'Atualizar' : 'Salvar'}
                        </button>
                        {editingId && (
                          <button 
                            type="button"
                            onClick={() => setStationToDelete(editingId)}
                            className="flex-1 py-3 md:py-4 bg-red-600 rounded-2xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 text-sm md:text-base"
                          >
                            Deletar
                          </button>
                        )}
                      </div>
                    </form>
                  </div>

                  <div className="border-l border-white/5 pl-0 lg:pl-12">
                    <div className="flex justify-between items-center mb-8">
                      <h2 className="text-2xl font-bold">Rádios Salvas</h2>
                      <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                    
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                      {stations.length === 0 ? (
                        <p className="text-white/20 text-center py-12">Nenhuma rádio salva no banco de dados.</p>
                      ) : (
                        stations.map((station) => (
                          <div 
                            key={station.id}
                            className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${editingId === station.id ? 'bg-orange-600/10 border-orange-600/30' : 'bg-white/5 border-transparent hover:border-white/10'}`}
                          >
                            <button 
                              onClick={() => handleEdit(station)}
                              className="flex items-center gap-3 flex-1 text-left"
                            >
                              <img 
                                src={station.imageUrl || (station as any).logo} 
                                alt="" 
                                className="w-10 h-10 rounded-lg object-cover bg-black/20"
                                referrerPolicy="no-referrer"
                              />
                              <div>
                                <h4 className="text-sm font-medium">{station.name}</h4>
                                <p className="text-[10px] text-white/40">{station.city} • {station.genre}</p>
                              </div>
                            </button>
                            <button 
                              onClick={() => handleDelete(station.id)}
                              className="p-2 text-white/20 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {stationToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setStationToDelete(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-[#151619] border border-white/10 rounded-3xl p-6 md:p-8 w-full max-w-md text-center"
            >
              <h3 className="text-2xl font-bold text-orange-500 mb-4">Atenção</h3>
              <p className="text-white/80 mb-8">Você deseja deletar essa rádio?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setStationToDelete(null)}
                  className="flex-1 py-3 bg-white/10 rounded-xl font-bold hover:bg-white/20 transition-colors"
                >
                  Não
                </button>
                <button 
                  onClick={executeDelete}
                  className="flex-1 py-3 bg-red-600 rounded-xl font-bold hover:bg-red-700 transition-colors"
                >
                  Sim
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 right-6 z-[70] bg-green-600 text-white px-6 py-4 rounded-2xl shadow-2xl shadow-green-600/20 flex items-center gap-3"
          >
            <div>
              {notification.title && <h4 className="font-bold text-sm">{notification.title}</h4>}
              <p className="text-sm">{notification.message}</p>
            </div>
            <button onClick={() => setNotification(null)} className="p-1 hover:bg-white/20 rounded-full transition-colors ml-2">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <audio 
        key={currentStation?.id || 'none'}
        ref={audioRef} 
        preload="auto"
        crossOrigin="anonymous"
        onPlay={() => {
          setIsPlaying(true);
          setPlaybackError(null);
        }}
        onPause={() => setIsPlaying(false)}
        onError={handleAudioError}
      />

      <style>{`
        @keyframes music-bar {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <RadioApp />
    </ErrorBoundary>
  );
}
