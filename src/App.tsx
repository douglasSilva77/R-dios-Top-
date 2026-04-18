import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume, Volume1, Volume2, VolumeX, Search, Radio, Music2, Plus, X, MapPin, Share2, ExternalLink, ChevronLeft, ChevronRight, Heart, Star, Menu, Maximize2, MessageSquare, Info, Send, User, LogOut, Sun, Moon, Infinity } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Hls from 'hls.js';
import { RADIO_STATIONS as INITIAL_STATIONS, RadioStation } from './constants';
import Visualizer from './components/Visualizer';
import { auth, db, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, handleFirestoreError, OperationType, updateDoc, deleteDoc, doc, limit, GoogleAuthProvider, signInWithPopup, signInAnonymously, updateProfile, setDoc, where } from './firebase';
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
  const [stations, setStations] = useState<CustomRadioStation[]>(INITIAL_STATIONS as any);
  const [currentStation, setCurrentStation] = useState<RadioStation | CustomRadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const wakeLockRef = useRef<any>(null);

  // Wake Lock to prevent sleep during playback
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isPlaying) {
        try {
          // Check if the permission is allowed by policy
          if ((navigator as any).permissions) {
            const status = await (navigator as any).permissions.query({ name: 'screen-wake-lock' });
            if (status.state === 'denied') {
              addDebug("Wake Lock negado pela política de permissões");
              return;
            }
          }
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          addDebug("Wake Lock ativado");
        } catch (err: any) {
          console.warn(`Wake Lock Error: ${err.name}, ${err.message}`);
        }
      }
    };

    if (isPlaying) {
      requestWakeLock();
    } else {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().then(() => {
          wakeLockRef.current = null;
          addDebug("Wake Lock liberado");
        });
      }
    }

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
      }
    };
  }, [isPlaying]);
  // Silent audio keep-alive for background playback on Android WebViews
  useEffect(() => {
    let silentAudio: HTMLAudioElement | null = null;
    
    if (isPlaying) {
      // Base64 of a 1-second silent MP3
      const silentSrc = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      silentAudio = new Audio(silentSrc);
      silentAudio.loop = true;
      silentAudio.volume = 0.01;
      silentAudio.play().catch(() => {});
    }

    return () => {
      if (silentAudio) {
        silentAudio.pause();
        silentAudio.src = "";
        silentAudio = null;
      }
    };
  }, [isPlaying]);

  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGenre, setActiveGenre] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
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
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<'home' | 'chat' | 'about' | 'background-guide'>('home');
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [nickname, setNickname] = useState('');
  const [user, setUser] = useState<any>(null);
  const [adminPassword, setAdminPassword] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [carouselItems, setCarouselItems] = useState<any[]>(CAROUSEL_ITEMS);
  const [isCarouselModalOpen, setIsCarouselModalOpen] = useState(false);
  const [isCloseAppModalOpen, setIsCloseAppModalOpen] = useState(false);
  const [editingCarouselId, setEditingCarouselId] = useState<string | null>(null);
  const [carouselFormData, setCarouselFormData] = useState({
    url: '',
    title: '',
    subtitle: '',
    order: 0
  });

  // Back button handling for mobile
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // If any modal or view is open, close it instead of going back in browser history
      if (isSidebarOpen || isModalOpen || isCarouselModalOpen || isCloseAppModalOpen || activeView !== 'home') {
        event.preventDefault();
        
        if (isSidebarOpen) setIsSidebarOpen(false);
        if (isModalOpen) setIsModalOpen(false);
        if (isCarouselModalOpen) setIsCarouselModalOpen(false);
        if (isCloseAppModalOpen) setIsCloseAppModalOpen(false);
        if (activeView !== 'home') setActiveView('home');
        
        // Push state again to keep the user on the page if they hit back again
        window.history.pushState({ noBack: true }, '');
      } else {
        // We are on home screen with no modals open
        // Show the "Close App" confirmation modal
        setIsCloseAppModalOpen(true);
        window.history.pushState({ noBack: true }, '');
      }
    };

    // Initial push state to enable back button interception
    window.history.pushState({ noBack: true }, '');

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isSidebarOpen, isModalOpen, isCarouselModalOpen, isCloseAppModalOpen, activeView]);

  // Fetch Admin Password from Firebase
  useEffect(() => {
    if (!db) return;
    const settingsRef = doc(db, 'settings', 'admin');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setAdminPassword(docSnap.data().adminPassword);
      } else {
        // Fallback to env or default
        const envPassword = (process.env as any).VITE_SENHA || (import.meta as any).env.VITE_SENHA || 'admin123';
        setAdminPassword(envPassword);
      }
    });
    return () => unsubscribe();
  }, [db]);

  // Persistent AudioContext refs to survive component unmounting
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

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
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = auth.onAuthStateChanged((user: any) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || activeView !== 'chat') return;

    const q = query(
      collection(db, 'chat_messages'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).reverse();
      setChatMessages(messages);
    }, (error) => {
      console.error("Chat snapshot error:", error);
    });

    return () => unsubscribe();
  }, [db, activeView]);

  useEffect(() => {
    if (!db) return;

    const q = query(
      collection(db, 'carousel_items'),
      orderBy('order', 'asc'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const items = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCarouselItems(items);
      } else {
        setCarouselItems(CAROUSEL_ITEMS);
      }
    }, (error) => {
      console.error("Carousel snapshot error:", error);
      handleFirestoreError(error, OperationType.LIST, 'carousel_items');
    });

    return () => unsubscribe();
  }, [db]);

  const handleLogin = async () => {
    if (!auth) return;
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log("Login cancelado pelo usuário.");
        return;
      }
      console.error("Login failed:", error);
      // Fallback to nickname login if Google fails
      setNotification({ message: "Login com Google falhou. Tente usar um nome.", type: 'error' });
    }
  };

  const handleNicknameLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !nickname.trim()) return;
    try {
      const result = await signInAnonymously(auth);
      await updateProfile(result.user, {
        displayName: nickname.trim()
      });
      setUser({ ...result.user, displayName: nickname.trim() });
      setNickname('');
    } catch (error) {
      console.error("Nickname login failed:", error);
      setNotification({ message: "Erro ao entrar com nome.", type: 'error' });
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await auth.signOut();
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !user || !newMessage.trim()) return;

    try {
      await addDoc(collection(db, 'chat_messages'), {
        text: newMessage,
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: serverTimestamp()
      });
      setNewMessage('');
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  useEffect(() => {
    const savedFavorites = localStorage.getItem('radios-top-favorites');
    if (savedFavorites) {
      try {
        setFavorites(JSON.parse(savedFavorites));
      } catch (e) {
        console.error("Erro ao carregar favoritos:", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('radios-top-favorites', JSON.stringify(favorites));
  }, [favorites]);

  const toggleFavorite = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setFavorites(prev => 
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  };

  const isFavorite = (id: string) => favorites.includes(id);

  const [passwordError, setPasswordError] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [useProxy, setUseProxy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const requestNotificationPermission = async () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        if (permission === 'granted') {
          addDebug("Permissão de notificação concedida");
        }
      } catch (err) {
        console.error("Erro ao solicitar permissão de notificação:", err);
      }
    }
  };

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    streamingUrl: '',
    imageUrl: '',
    city: '',
    genre: 'Gospel'
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (!isInitialLoading) return;
    
    const timer = setTimeout(() => {
      if (isInitialLoading) {
        setLoadingError("Verifique sua conexão com a internet.");
      }
    }, 20000);

    return () => clearTimeout(timer);
  }, [isInitialLoading]);

  useEffect(() => {
    if (!db) {
      console.warn("Banco de dados não disponível para carregar rádios. Usando dados locais.");
      setStations(INITIAL_STATIONS as any);
      setIsInitialLoading(false);
      return;
    }

    console.log("Iniciando escuta do banco de dados...");
    const stationsRef = collection(db, 'radio_stations');
    const q = query(stationsRef);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`Snapshot recebido: ${snapshot.size} rádios encontradas.`);
      if (snapshot.empty) {
        setStations(INITIAL_STATIONS as any);
        setIsInitialLoading(false);
        return;
      }
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
      setIsInitialLoading(false);
    }, (error) => {
      console.error("Erro na escuta em tempo real:", error);
      setStations(INITIAL_STATIONS as any);
      setIsInitialLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'radio_stations');
    });

    return () => unsubscribe();
  }, [db]);

  const allStations = stations;
  const genres = Array.from(new Set(allStations.map(s => s.genre)));

  const filteredStations = allStations.filter(station => {
    const name = station.name || '';
    const genre = station.genre || 'Geral';
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         genre.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGenre = activeGenre ? genre === activeGenre : true;
    const matchesFavorites = showFavoritesOnly ? isFavorite(station.id) : true;
    return matchesSearch && matchesGenre && matchesFavorites;
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

  const handleShare = (stationName?: string, stationId?: string) => {
    // Dynamic URL based on current origin, replacing -dev- with -pre- for sharing
    let deployUrl = window.location.origin.replace('-dev-', '-pre-');
    if (stationId) {
      deployUrl += `?stationId=${stationId}`;
    }
    const text = stationName 
      ? `Estou ouvindo a rádio ${stationName} no Rádios Top! Ouça você também:`
      : 'Ouça as melhores rádios do mundo no Rádios Top!';
    
    if (navigator.share) {
      navigator.share({
        title: 'Rádios Top',
        text: text,
        url: deployUrl,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(deployUrl);
      setNotification({ message: 'Link copiado para a área de transferência!', type: 'success' });
    }
  };

  // Deep Linking logic
  useEffect(() => {
    if (stations.length > 0 && !currentStation) {
      const urlParams = new URLSearchParams(window.location.search);
      const stationId = urlParams.get('stationId');
      if (stationId) {
        const station = stations.find(s => s.id === stationId);
        if (station) {
          handleStationSelect(station);
        }
      }
    }
  }, [stations, currentStation]);

  const handleStationSelect = useCallback((station: RadioStation | CustomRadioStation) => {
    setPlaybackError(null);
    setCurrentStation(station);
    setIsPlaying(true);
  }, []);

  const handleNext = useCallback(() => {
    if (!currentStation || allStations.length === 0) return;
    const currentIndex = allStations.findIndex(s => s.id === currentStation?.id);
    const nextIndex = (currentIndex + 1) % allStations.length;
    handleStationSelect(allStations[nextIndex]);
  }, [currentStation, allStations, handleStationSelect]);

  const handlePrev = useCallback(() => {
    if (!currentStation || allStations.length === 0) return;
    const currentIndex = allStations.findIndex(s => s.id === currentStation?.id);
    const prevIndex = (currentIndex - 1 + allStations.length) % allStations.length;
    handleStationSelect(allStations[prevIndex]);
  }, [currentStation, allStations, handleStationSelect]);

  // Media Session API for background playback and lock screen controls
  const updateMediaSession = useCallback(() => {
    if ('mediaSession' in navigator && currentStation) {
      try {
        const artworkUrl = currentStation.logo || `https://picsum.photos/seed/${currentStation.id}/512/512`;
        
        // Ensure URLs are absolute for native wrappers
        const absoluteArtworkUrl = artworkUrl.startsWith('http') ? artworkUrl : window.location.origin + artworkUrl;

        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentStation.name,
          artist: (currentStation as any).city || currentStation.country || 'Rádios Top',
          album: currentStation.genre || 'Streaming ao vivo',
          artwork: [
            { src: absoluteArtworkUrl, sizes: '96x96', type: 'image/png' },
            { src: absoluteArtworkUrl, sizes: '128x128', type: 'image/png' },
            { src: absoluteArtworkUrl, sizes: '192x192', type: 'image/png' },
            { src: absoluteArtworkUrl, sizes: '256x256', type: 'image/png' },
            { src: absoluteArtworkUrl, sizes: '384x384', type: 'image/png' },
            { src: absoluteArtworkUrl, sizes: '512x512', type: 'image/png' },
          ]
        });

        const playHandler = () => {
          setIsPlaying(true);
          if (audioRef.current) audioRef.current.play().catch(() => {});
        };

        const pauseHandler = () => {
          setIsPlaying(false);
          if (audioRef.current) audioRef.current.pause();
        };

        navigator.mediaSession.setActionHandler('play', playHandler);
        navigator.mediaSession.setActionHandler('pause', pauseHandler);
        navigator.mediaSession.setActionHandler('previoustrack', handlePrev);
        navigator.mediaSession.setActionHandler('nexttrack', handleNext);
        
        // Android specific: sometimes stop is required for the notification to behave
        navigator.mediaSession.setActionHandler('stop', pauseHandler);
      } catch (error) {
        console.error("MediaSession error:", error);
      }
    }
  }, [currentStation, handlePrev, handleNext]);

  useEffect(() => {
    updateMediaSession();
  }, [currentStation, updateMediaSession]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      // Re-sync metadata when playing starts to ensure Android notification shows up
      if (isPlaying) {
        setTimeout(updateMediaSession, 500);
      }
    }
  }, [isPlaying, updateMediaSession]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === adminPassword) {
      setIsAdmin(true);
      setPasswordError(false);
      addDebug("Admin logado com sucesso");
    } else {
      setPasswordError(true);
      addDebug("Tentativa de login admin falhou");
      setTimeout(() => setPasswordError(false), 2000);
    }
  };

  const updateAdminPassword = async () => {
    if (!db || !newPasswordInput) return;
    try {
      const settingsRef = doc(db, 'settings', 'admin');
      await setDoc(settingsRef, {
        adminPassword: newPasswordInput,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setNotification({ message: 'Senha administrativa atualizada!', type: 'success' });
      setNewPasswordInput('');
    } catch (error) {
      console.error("Erro ao atualizar senha:", error);
      setNotification({ message: 'Erro ao atualizar senha.', type: 'error' });
    }
  };

  const handleEdit = (station: CustomRadioStation) => {
    setEditingId(station.id);
    setFormData({
      name: station.name,
      streamingUrl: station.streamingUrl || station.url || '',
      imageUrl: station.imageUrl || station.logo || '',
      city: station.city || station.country || '',
      genre: station.genre || 'Gospel'
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      name: '',
      streamingUrl: '',
      imageUrl: '',
      city: '',
      genre: 'Gospel'
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

  const handleCarouselSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;

    try {
      const data = {
        ...carouselFormData,
        createdAt: serverTimestamp()
      };

      if (editingCarouselId) {
        await updateDoc(doc(db, 'carousel_items', editingCarouselId), data);
        setNotification({ message: 'Banner atualizado com sucesso!', type: 'success' });
      } else {
        await addDoc(collection(db, 'carousel_items'), data);
        setNotification({ message: 'Banner adicionado com sucesso!', type: 'success' });
      }

      resetCarouselForm();
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'carousel_items');
    }
  };

  const resetCarouselForm = () => {
    setEditingCarouselId(null);
    setCarouselFormData({
      url: '',
      title: '',
      subtitle: '',
      order: 0
    });
    setIsCarouselModalOpen(false);
  };

  const deleteCarouselItem = async (id: string) => {
    if (!db || !window.confirm("Tem certeza que deseja excluir este banner?")) return;
    try {
      await deleteDoc(doc(db, 'carousel_items', id));
      setNotification({ message: 'Banner removido!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'carousel_items');
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
    <div className={`min-h-screen font-sans selection:bg-orange-500/30 transition-colors duration-500 ${isDarkMode ? 'bg-[#0a0502] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Atmospheric Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className={`absolute top-[-10%] left-[-10%] w-[40%] h-[40%] blur-[120px] rounded-full transition-colors duration-700 ${isDarkMode ? 'bg-orange-900/20' : 'bg-orange-200/40'}`} />
        <div className={`absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] blur-[150px] rounded-full transition-colors duration-700 ${isDarkMode ? 'bg-blue-900/10' : 'bg-blue-200/30'}`} />
      </div>

      {/* Header */}
      <header className="relative z-20 px-4 md:px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className={`p-2 rounded-full transition-colors text-orange-600 ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            >
              <Menu className="w-6 h-6" />
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2 rounded-full transition-all duration-300 ${isDarkMode ? 'hover:bg-white/10 text-yellow-400' : 'hover:bg-black/5 text-gray-600'}`}
              title={isDarkMode ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveView('home')}>
            <Radio className="w-6 h-6 text-orange-500" />
            <span className="font-bold tracking-tighter text-xl text-orange-500">RÁDIOS TOP</span>
          </div>
          <div className="sm:hidden" /> {/* Spacer for mobile centering */}
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-8 space-y-8 md:space-y-12">
        {activeView === 'home' && (
          <>
            {/* Carousel Section */}
            <section className="relative h-48 md:h-80 rounded-3xl overflow-hidden group shadow-2xl shadow-black/50 mb-8 md:mb-12">
              <AnimatePresence mode="wait">
                <motion.img
                  key={carouselIndex}
                  src={carouselItems[carouselIndex % carouselItems.length]?.url}
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
                    <h2 className="text-2xl md:text-4xl font-bold tracking-tight">{carouselItems[carouselIndex % carouselItems.length]?.title}</h2>
                    <p className="text-white/60 text-sm md:text-lg mt-2 max-w-md">{carouselItems[carouselIndex % carouselItems.length]?.subtitle}</p>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Carousel Controls */}
              <div className="absolute inset-y-0 left-4 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => setCarouselIndex((prev) => (prev - 1 + carouselItems.length) % carouselItems.length)}
                  className="p-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 hover:bg-orange-600 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              </div>
              <div className="absolute inset-y-0 right-4 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => setCarouselIndex((prev) => (prev + 1) % carouselItems.length)}
                  className="p-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 hover:bg-orange-600 transition-colors"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>

              {/* Carousel Indicators */}
              <div className="absolute bottom-6 right-6 flex gap-2">
                {carouselItems.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCarouselIndex(i)}
                    className={`w-2 h-2 rounded-full transition-all ${i === carouselIndex ? 'w-8 bg-orange-500' : 'bg-white/30'}`}
                  />
                ))}
              </div>

              {/* Admin Carousel Management Button */}
              {isAdmin && (
                <div className="absolute top-6 right-6 flex gap-2">
                  <button 
                    onClick={() => setIsCarouselModalOpen(true)}
                    className="p-3 rounded-2xl bg-orange-600 text-white shadow-xl hover:bg-orange-700 transition-all flex items-center gap-2 font-bold text-sm"
                  >
                    <Maximize2 className="w-4 h-4" />
                    Gerenciar Banners
                  </button>
                </div>
              )}
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
                            <button
                              onClick={(e) => toggleFavorite(e, currentStation.id)}
                              className={`flex items-center gap-2 px-3 py-1 rounded-full transition-all ${isFavorite(currentStation.id) ? 'bg-pink-500/20 text-pink-500' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                            >
                              <Heart className={`w-3 h-3 ${isFavorite(currentStation.id) ? 'fill-current' : ''}`} />
                              <span className="text-[10px] uppercase tracking-widest font-bold">
                                {isFavorite(currentStation.id) ? 'Favorito' : 'Favoritar'}
                              </span>
                            </button>
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
                    <div className="h-24 md:h-32 flex items-center justify-center relative w-full px-4 overflow-hidden">
                      <div className="w-full max-w-2xl h-full flex items-center">
                        <Visualizer 
                          audioElement={audioRef.current} 
                          isPlaying={isPlaying} 
                          isDarkMode={isDarkMode}
                          audioContextRef={audioContextRef}
                          analyserRef={analyserRef}
                          sourceRef={sourceRef}
                        />
                      </div>
                    </div>

                    {/* Player Controls */}
                    <div className="flex flex-col gap-6 md:gap-8">
                      <div className="flex items-center justify-center lg:justify-start gap-6 md:gap-8">
                        <button 
                          onClick={handlePrev}
                          className={`p-3 md:p-4 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}
                        >
                          <SkipBack className="w-6 h-6 md:w-8 md:h-8" />
                        </button>
                        
                        <button 
                          onClick={togglePlay}
                          className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-orange-600 flex items-center justify-center hover:scale-105 transition-transform shadow-2xl shadow-orange-600/20 text-white"
                        >
                          {isPlaying ? (
                            <Pause className="w-8 h-8 md:w-10 md:h-10 fill-white" />
                          ) : (
                            <Play className="w-8 h-8 md:w-10 md:h-10 fill-white ml-1" />
                          )}
                        </button>

                        <button 
                          onClick={handleNext}
                          className={`p-3 md:p-4 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-500 hover:text-gray-900'}`}
                        >
                          <SkipForward className="w-6 h-6 md:w-8 md:h-8" />
                        </button>
                      </div>

                      {/* Volume Control */}
                      <div className="flex items-center gap-4 max-w-xs mx-auto lg:mx-0 w-full group/volume">
                        <button 
                          onClick={() => setIsMuted(!isMuted)} 
                          className={`transition-colors ${isMuted || volume === 0 ? 'text-red-500' : 'text-orange-500 hover:text-orange-400'}`}
                        >
                          {isMuted || volume === 0 ? (
                            <VolumeX className="w-5 h-5" />
                          ) : volume < 0.3 ? (
                            <Volume className="w-5 h-5" />
                          ) : volume < 0.7 ? (
                            <Volume1 className="w-5 h-5" />
                          ) : (
                            <Volume2 className="w-5 h-5" />
                          )}
                        </button>
                        <div className="flex-1 flex items-center gap-3">
                          <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.01" 
                            value={isMuted ? 0 : volume}
                            onChange={(e) => {
                              setVolume(parseFloat(e.target.value));
                              if (isMuted) setIsMuted(false);
                            }}
                            className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-orange-600 hover:accent-orange-500 transition-all ${isDarkMode ? 'bg-white/10' : 'bg-gray-200'}`}
                            style={{
                              background: `linear-gradient(to right, #ea580c ${(isMuted ? 0 : volume) * 100}%, ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'} ${(isMuted ? 0 : volume) * 100}%)`
                            }}
                          />
                          <span className={`text-[10px] font-mono font-bold min-w-[32px] ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                            {Math.round((isMuted ? 0 : volume) * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              )}

              {/* Right Column: Station List */}
              <div className={`${currentStation ? 'lg:col-span-5' : 'lg:col-span-12'} space-y-6 md:space-y-8`}>
                <div className={`backdrop-blur-xl border rounded-3xl p-4 md:p-8 flex flex-col transition-colors duration-500 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200 shadow-xl'} ${currentStation ? 'h-[60vh] lg:h-[80vh]' : 'min-h-[40vh]'}`}>
                  <div className="space-y-4 md:space-y-6 mb-6 md:mb-8">
                    <div className="flex items-center justify-between">
                      <h2 className={`text-xl md:text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Estações Disponíveis</h2>
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
                      <Search className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`} />
                      <input 
                        type="text" 
                        placeholder="Buscar rádios ou gêneros..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={`w-full border rounded-2xl py-3 md:py-4 pl-12 pr-4 focus:outline-none focus:border-orange-500/50 transition-colors text-sm md:text-base ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button 
                        onClick={() => {
                          setActiveGenre(null);
                          setShowFavoritesOnly(false);
                        }}
                        className={`px-4 py-2 rounded-full text-[10px] md:text-xs font-medium transition-colors whitespace-nowrap ${(!activeGenre && !showFavoritesOnly) ? 'bg-orange-600 text-white' : (isDarkMode ? 'bg-white/5 text-white/40 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}`}
                      >
                        Todas
                      </button>
                      <button 
                        onClick={() => {
                          setActiveGenre(null);
                          setShowFavoritesOnly(true);
                        }}
                        className={`px-4 py-2 rounded-full text-[10px] md:text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${showFavoritesOnly ? 'bg-pink-600 text-white' : (isDarkMode ? 'bg-white/5 text-white/40 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}`}
                      >
                        <Heart className={`w-3 h-3 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                        Favoritos
                      </button>
                      {genres.map(genre => (
                        <button 
                          key={genre}
                          onClick={() => {
                            setActiveGenre(genre);
                            setShowFavoritesOnly(false);
                          }}
                          className={`px-4 py-2 rounded-full text-[10px] md:text-xs font-medium transition-colors whitespace-nowrap ${activeGenre === genre ? 'bg-orange-600 text-white' : (isDarkMode ? 'bg-white/5 text-white/40 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}`}
                        >
                          {genre}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={`flex-1 overflow-y-auto custom-scrollbar pr-2 ${currentStation ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'}`}>
                    {filteredStations.map((station) => (
                      <div
                        key={station.id}
                        onClick={() => handleStationSelect(station)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            handleStationSelect(station);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={`w-full group flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-2xl transition-all cursor-pointer border ${
                          currentStation?.id === station.id 
                            ? (isDarkMode ? 'bg-orange-600/20 border-orange-600/30' : 'bg-orange-50 border-orange-200 shadow-sm')
                            : (isDarkMode ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-white border-transparent hover:bg-gray-50 hover:border-gray-100 shadow-sm')
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
                          <h3 className={`text-sm md:text-base font-medium transition-colors ${currentStation?.id === station.id ? 'text-orange-500' : (isDarkMode ? 'text-white/80 group-hover:text-white' : 'text-gray-700 group-hover:text-gray-900')}`}>
                            {station.name}
                          </h3>
                          <p className={`text-[10px] md:text-xs ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>{station.genre} • {(station as any).city || station.country}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleShare(station.name, station.id); }}
                            className={`p-2 rounded-full transition-colors ${isDarkMode ? 'text-white/20 hover:text-white/40 hover:bg-white/5' : 'text-gray-300 hover:text-gray-500 hover:bg-black/5'}`}
                            title="Compartilhar Rádio"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => toggleFavorite(e, station.id)}
                            className={`p-2 rounded-full transition-colors ${isFavorite(station.id) ? 'text-pink-500 bg-pink-500/10' : (isDarkMode ? 'text-white/20 hover:text-white/40 hover:bg-white/5' : 'text-gray-300 hover:text-gray-500 hover:bg-black/5')}`}
                          >
                            <Heart className={`w-4 h-4 ${isFavorite(station.id) ? 'fill-current' : ''}`} />
                          </button>
                        </div>
                      </div>
                    ))}
                    {filteredStations.length === 0 && (
                      <div className={`col-span-full py-12 text-center ${isDarkMode ? 'text-white/20' : 'text-gray-400'}`}>
                        Nenhuma rádio encontrada para sua busca.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeView === 'chat' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`max-w-6xl mx-auto w-full h-[85vh] flex flex-col backdrop-blur-xl border rounded-3xl overflow-hidden shadow-2xl transition-colors duration-500 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
          >
            <div className={`p-6 border-b flex justify-between items-center transition-colors duration-500 ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50/50'}`}>
              <div className="flex items-center gap-3">
                <MessageSquare className="w-6 h-6 text-orange-600" />
                <h2 className="text-xl font-bold">Chat Rádios Top</h2>
              </div>
              <div className="flex items-center gap-4">
                {user && (
                  <button onClick={handleLogout} className={`text-xs flex items-center gap-2 transition-colors ${isDarkMode ? 'text-white/40 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                    <LogOut className="w-4 h-4" />
                    Sair da Conta
                  </button>
                )}
                <button 
                  onClick={() => setActiveView('home')}
                  className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-white/40 hover:text-white' : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'}`}
                  title="Voltar para Rádios"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              <AnimatePresence initial={false}>
                {chatMessages.map((msg) => (
                  <motion.div 
                    key={msg.id} 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className={`flex gap-3 ${msg.uid === user?.uid ? 'flex-row-reverse' : ''}`}
                  >
                    <img src={msg.photoURL || `https://ui-avatars.com/api/?name=${msg.displayName}`} className={`w-8 h-8 rounded-full border ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`} />
                    <div className={`max-w-[70%] space-y-1 ${msg.uid === user?.uid ? 'items-end' : ''}`}>
                      <div className="flex items-center gap-2 px-1">
                        <span className={`text-[10px] font-bold ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>{msg.displayName}</span>
                      </div>
                      <div className={`p-3 rounded-2xl text-sm ${msg.uid === user?.uid ? 'bg-orange-600 text-white rounded-tr-none' : (isDarkMode ? 'bg-white/10 text-white/80 rounded-tl-none' : 'bg-gray-100 text-gray-800 rounded-tl-none')}`}>
                        {msg.text}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {chatMessages.length === 0 && (
                <div className={`h-full flex flex-col items-center justify-center space-y-4 ${isDarkMode ? 'text-white/20' : 'text-gray-300'}`}>
                  <MessageSquare className="w-12 h-12" />
                  <p>Seja o primeiro a enviar uma mensagem!</p>
                </div>
              )}
            </div>

            <div className={`p-6 border-t transition-colors duration-500 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50/50 border-gray-200'}`}>
              {user ? (
                <form onSubmit={sendChatMessage} className="flex gap-3">
                  <input 
                    type="text" 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Escreva sua mensagem..."
                    className={`flex-1 border rounded-2xl px-4 py-3 focus:outline-none focus:border-orange-500/50 transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'}`}
                  />
                  <button type="submit" className="p-3 bg-orange-600 rounded-2xl hover:bg-orange-700 transition-colors text-white">
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              ) : (
                <div className="max-w-md mx-auto space-y-8">
                  <div className="text-center space-y-2">
                    <p className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Participe do Chat</p>
                    <p className={`${isDarkMode ? 'text-white/40' : 'text-gray-500'} text-sm`}>Escolha um nome para começar a conversar</p>
                  </div>
                  
                  <form onSubmit={handleNicknameLogin} className="flex flex-col gap-4">
                    <div className="space-y-2">
                      <label className={`text-[10px] uppercase tracking-widest ml-1 ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Seu Nome</label>
                      <input 
                        type="text" 
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="Ex: João_Radio"
                        className={`w-full border rounded-2xl px-5 py-4 focus:outline-none focus:border-orange-500/50 text-lg transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'}`}
                        maxLength={20}
                        autoFocus
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="w-full py-4 bg-orange-600 rounded-2xl font-bold text-lg hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20 active:scale-[0.98] text-white"
                    >
                      Entrar no Chat
                    </button>
                  </form>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeView === 'about' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`max-w-6xl mx-auto w-full backdrop-blur-xl border rounded-3xl p-8 md:p-12 space-y-8 shadow-2xl transition-colors duration-500 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
          >
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-orange-600/20 rounded-2xl flex items-center justify-center">
                  <Info className="w-8 h-8 text-orange-600" />
                </div>
                <div>
                  <h2 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Quem Somos</h2>
                  <p className="text-orange-500 font-mono text-xs tracking-widest uppercase mt-1">Rádios Top</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveView('home')}
                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-white/40 hover:text-white' : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'}`}
                title="Voltar para Rádios"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className={`space-y-6 leading-relaxed ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
              <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Bem-vindo ao <span className="text-orange-500 font-bold">Rádios Top</span>, sua plataforma definitiva para streaming de rádio de alta qualidade.</p>
              
              <p>Nossa missão é conectar ouvintes com as melhores estações de rádio, oferecendo uma experiência fluida, moderna e acessível em qualquer dispositivo. Seja você um fã de música Gospel, Eclética ou qualquer outro gênero, o Rádios Top foi construído pensando na sua paixão pelo som.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8">
                <div className={`p-6 rounded-2xl border transition-colors ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                  <h3 className="text-orange-500 font-bold mb-2">Nossa Visão</h3>
                  <p className="text-sm">Ser a maior e mais amada plataforma de rádio online, unindo tecnologia de ponta com o calor da rádio tradicional.</p>
                </div>
                <div className={`p-6 rounded-2xl border transition-colors ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                  <h3 className="text-orange-500 font-bold mb-2">Nossos Valores</h3>
                  <p className="text-sm">Qualidade de áudio, facilidade de uso, comunidade vibrante e respeito aos nossos ouvintes e parceiros.</p>
                </div>
              </div>

              <div className={`pt-8 border-t flex flex-col items-center text-center space-y-4 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                <p className={`text-sm italic ${isDarkMode ? 'text-white/50' : 'text-gray-400'}`}>"Onde o som encontra a tecnologia."</p>
                <div className="flex gap-4">
                  <Radio className="w-5 h-5 text-orange-500" />
                  <Music2 className="w-5 h-5 text-orange-500" />
                  <Heart className="w-5 h-5 text-orange-500" />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeView === 'background-guide' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`max-w-4xl mx-auto w-full backdrop-blur-xl border rounded-3xl p-8 md:p-12 space-y-8 shadow-2xl transition-colors duration-500 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}
          >
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-orange-600/20 rounded-2xl flex items-center justify-center">
                  <Infinity className="w-8 h-8 text-orange-600" />
                </div>
                <div>
                  <h2 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Tocar sem parar</h2>
                  <p className="text-orange-500 font-mono text-xs tracking-widest uppercase mt-1">Guia de Configuração</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveView('home')}
                className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/10 text-white/40 hover:text-white' : 'hover:bg-black/5 text-gray-400 hover:text-gray-900'}`}
                title="Voltar para Rádios"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-8">
              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-orange-600/10 border-orange-600/20' : 'bg-orange-50 border-orange-100'}`}>
                <h3 className="text-xl font-bold text-orange-600 mb-2">Tocar em Segundo Plano</h3>
                <p className={`text-sm ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                  Para garantir que a música não pare quando você sair do app ou desligar a tela, siga os passos abaixo para desativar as restrições de bateria do sistema Android.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { step: "Passo 1", title: "Configurações do Sistema", desc: "Abra as Configurações do seu celular e vá em \"Aplicativos\" ou \"Apps\"." },
                  { step: "Passo 2", title: "Selecione o App", desc: "Encontre e selecione o \"Rádios Top\" na lista de aplicativos." },
                  { step: "Passo 3", title: "Bateria / Economia de Energia", desc: "Toque em \"Bateria\" ou \"Uso da bateria\"." },
                  { step: "Passo 4", title: "Sem Restrições", desc: "Selecione a opção \"Sem restrições\" ou \"Não otimizar\". Isso permite que a rádio continue tocando mesmo com a tela desligada." }
                ].map((item, idx) => (
                  <div key={idx} className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                    <span className="text-orange-500 font-mono text-[10px] uppercase tracking-widest font-bold">{item.step}</span>
                    <h4 className={`font-bold mt-1 mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.title}</h4>
                    <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-blue-600/10 border-blue-600/20' : 'bg-blue-50 border-blue-100'}`}>
                <h3 className="text-lg font-bold text-blue-600 mb-2">Dica Adicional</h3>
                <p className={`text-sm ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                  Em alguns aparelhos (Xiaomi, Samsung, Huawei), você também pode precisar "Bloquear" o app na tela de aplicativos recentes para evitar que o sistema o feche automaticamente.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed top-0 left-0 bottom-0 w-80 z-[70] border-r p-8 flex flex-col transition-colors duration-500 ${isDarkMode ? 'bg-[#0f0a07] border-white/10' : 'bg-white border-gray-200 shadow-2xl'}`}
            >
              <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-2">
                  <Radio className="w-6 h-6 text-orange-500" />
                  <span className="font-bold text-xl text-orange-500 uppercase tracking-tighter">MENU</span>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/5 text-white' : 'hover:bg-black/5 text-gray-900'}`}>
                  <X className="w-6 h-6" />
                </button>
              </div>

              <nav className="flex-1 space-y-2">
                <button 
                  onClick={() => { setActiveView('home'); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${activeView === 'home' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : (isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-600 hover:text-gray-900')}`}
                >
                  <Radio className={`w-5 h-5 ${activeView === 'home' ? 'text-white' : 'text-orange-600'}`} />
                  <span className="font-bold">Rádios</span>
                </button>
                <button 
                  onClick={() => { setActiveView('chat'); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${activeView === 'chat' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : (isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-600 hover:text-gray-900')}`}
                >
                  <MessageSquare className={`w-5 h-5 ${activeView === 'chat' ? 'text-white' : 'text-orange-600'}`} />
                  <span className="font-bold">Chat Rádios Top</span>
                </button>
                <button 
                  onClick={() => { setActiveView('about'); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${activeView === 'about' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : (isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-600 hover:text-gray-900')}`}
                >
                  <Info className={`w-5 h-5 ${activeView === 'about' ? 'text-white' : 'text-orange-600'}`} />
                  <span className="font-bold">Quem Somos</span>
                </button>
                <button 
                  onClick={() => { setActiveView('background-guide'); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${activeView === 'background-guide' ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' : (isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-600 hover:text-gray-900')}`}
                >
                  <Infinity className={`w-5 h-5 ${activeView === 'background-guide' ? 'text-white' : 'text-orange-600'}`} />
                  <span className="font-bold">Tocar sem parar</span>
                </button>
                <button 
                  onClick={() => { setIsModalOpen(true); setIsSidebarOpen(false); }}
                  className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-600 hover:text-gray-900'}`}
                >
                  <Plus className="w-5 h-5 text-orange-600" />
                  <span className="font-bold">Adicionar Rádio</span>
                </button>
                {isAdmin && (
                  <button 
                    onClick={() => { setIsCarouselModalOpen(true); setIsSidebarOpen(false); }}
                    className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all ${isDarkMode ? 'hover:bg-white/5 text-white/60 hover:text-white' : 'hover:bg-black/5 text-gray-600 hover:text-gray-900'}`}
                  >
                    <Maximize2 className="w-5 h-5 text-orange-600" />
                    <span className="font-bold">Gerenciar Banners</span>
                  </button>
                )}
              </nav>

              <div className={`pt-8 border-t ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="flex items-center gap-3 px-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${isDarkMode ? 'bg-orange-600/20' : 'bg-orange-100'}`}>
                    {user?.photoURL ? (
                      <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-5 h-5 text-orange-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{user?.displayName || 'Visitante'}</p>
                    <p className={`text-[10px] uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>
                      {user ? (user.isAnonymous ? 'Sessão Temporária' : 'Conectado') : 'Não Logado'}
                    </p>
                  </div>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

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
              className={`relative border rounded-3xl p-6 md:p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto custom-scrollbar transition-colors duration-500 ${isDarkMode ? 'bg-[#151619] border-white/10' : 'bg-white border-gray-200 shadow-2xl'}`}
            >
              {!isAdmin ? (
                <div className="max-w-md mx-auto py-12">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-orange-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Radio className="w-8 h-8 text-orange-500" />
                    </div>
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Área Administrativa</h2>
                    <p className={`${isDarkMode ? 'text-white/40' : 'text-gray-500'} mt-2`}>Insira a senha para continuar</p>
                  </div>
                  
                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <input 
                        type="password" 
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        className={`w-full border rounded-xl py-3 px-4 focus:outline-none transition-colors ${passwordError ? 'border-red-500' : (isDarkMode ? 'bg-white/5 border-white/10 focus:border-orange-500/50 text-white' : 'bg-gray-50 border-gray-200 focus:border-orange-500/50 text-gray-900')}`}
                        placeholder="Senha"
                        autoFocus
                      />
                      {passwordError && (
                        <p className="text-red-500 text-xs text-center">Senha errada</p>
                      )}
                    </div>
                    <div className="flex gap-4">
                      <button 
                        type="submit"
                        className="flex-1 py-3 bg-orange-600 rounded-xl font-bold hover:bg-orange-700 transition-colors text-white"
                      >
                        Entrar
                      </button>
                      <button 
                        type="button"
                        onClick={() => setIsModalOpen(false)}
                        className={`flex-1 py-3 border rounded-xl font-bold transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white' : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-700'}`}
                      >
                        Sair
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{editingId ? 'Editar Rádio' : 'Adicionar Nova Rádio'}</h2>
                      <div className="flex items-center gap-4">
                        {editingId && (
                          <button 
                            onClick={resetForm}
                            className="text-xs text-orange-500 hover:underline"
                          >
                            Novo Cadastro
                          </button>
                        )}
                        <button 
                          onClick={() => {
                            setIsAdmin(false);
                            setPasswordInput('');
                            setIsModalOpen(false);
                          }}
                          className="text-xs text-red-500 hover:underline flex items-center gap-1"
                        >
                          <LogOut className="w-3 h-3" />
                          Sair
                        </button>
                      </div>
                    </div>
                    <p className={`${isDarkMode ? 'text-white/40' : 'text-gray-500'} text-xs mb-8`}>Para adicionar sua rádio entre em contato com o administrador.</p>

                    <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
                      {/* Advanced Settings */}
                      <div className={`p-4 rounded-2xl border mb-6 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                        <h3 className={`text-xs font-bold uppercase tracking-widest mb-4 ${isDarkMode ? 'text-orange-500' : 'text-orange-600'}`}>Configurações Técnicas</h3>
                        
                        {/* Proxy Toggle */}
                        <div className="flex items-center justify-between gap-4 mb-4">
                          <div className="flex-1">
                            <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Usar Servidor Proxy</p>
                            <p className={`text-[10px] ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Recomendado para evitar erros de CORS e Mixed Content</p>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setUseProxy(!useProxy)}
                            className={`relative w-12 h-6 rounded-full transition-colors ${useProxy ? 'bg-orange-600' : (isDarkMode ? 'bg-white/10' : 'bg-gray-200')}`}
                          >
                            <motion.div 
                              animate={{ x: useProxy ? 24 : 4 }}
                              className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                            />
                          </button>
                        </div>

                         {/* Password Change */}
                        <div className="pt-4 border-t border-white/5 mb-4">
                          <p className={`text-sm font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Alterar Senha Admin</p>
                          <div className="flex gap-2">
                            <input 
                              type="text"
                              value={newPasswordInput}
                              onChange={(e) => setNewPasswordInput(e.target.value)}
                              placeholder="Nova senha"
                              className={`flex-1 text-xs border rounded-lg py-2 px-3 focus:outline-none ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'}`}
                            />
                            <button 
                              type="button"
                              onClick={updateAdminPassword}
                              className="px-4 py-2 bg-orange-600 text-white text-xs font-bold rounded-lg hover:bg-orange-700 transition-colors"
                            >
                              Salvar
                            </button>
                          </div>
                        </div>
                        
                        {/* Banner Manager Link */}
                        <div className="pt-4 border-t border-white/5 mb-4">
                          <button 
                            type="button"
                            onClick={() => {
                              setIsModalOpen(false);
                              setIsCarouselModalOpen(true);
                            }}
                            className="w-full py-3 bg-blue-600/20 text-blue-500 text-xs font-bold rounded-xl hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2"
                          >
                            <Maximize2 className="w-4 h-4" />
                            Gerenciar Banners (Carrossel)
                          </button>
                        </div>

                        <div className="mt-4 pt-4 border-t border-white/5">
                          <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Status do Proxy: <span className={serverStatus === 'online' ? 'text-green-500' : 'text-red-500'}>{serverStatus.toUpperCase()}</span></p>
                          <div className={`p-2 rounded-lg font-mono text-[9px] max-h-24 overflow-y-auto ${isDarkMode ? 'bg-black/40 text-white/60' : 'bg-gray-100 text-gray-600'}`}>
                            {debugInfo.length > 0 ? debugInfo.map((msg, i) => <div key={i}>{msg}</div>) : "Nenhum log disponível"}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className={`text-[10px] md:text-xs uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Nome da Rádio</label>
                        <input 
                          required
                          type="text" 
                          value={formData.name}
                          onChange={(e) => setFormData({...formData, name: e.target.value})}
                          className={`w-full border rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                          placeholder="Ex: Rádio Mix"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] md:text-xs uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Streaming da Rádio</label>
                        <input 
                          required
                          type="url" 
                          value={formData.streamingUrl}
                          onChange={(e) => setFormData({...formData, streamingUrl: e.target.value})}
                          className={`w-full border rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                          placeholder="https://..."
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] md:text-xs uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Imagem da Rádio</label>
                        <input 
                          required
                          type="url" 
                          value={formData.imageUrl}
                          onChange={(e) => setFormData({...formData, imageUrl: e.target.value})}
                          className={`w-full border rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                          placeholder="https://..."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className={`text-[10px] md:text-xs uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Cidade</label>
                          <input 
                            required
                            type="text" 
                            value={formData.city}
                            onChange={(e) => setFormData({...formData, city: e.target.value})}
                            className={`w-full border rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                            placeholder="Ex: São Paulo"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className={`text-[10px] md:text-xs uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Gênero</label>
                          <select 
                            required
                            value={formData.genre}
                            onChange={(e) => setFormData({...formData, genre: e.target.value})}
                            className={`w-full border rounded-xl py-2.5 md:py-3 px-4 focus:outline-none focus:border-orange-500/50 text-sm md:text-base appearance-none transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`}
                          >
                            <option value="Gospel" className={isDarkMode ? 'bg-[#151619]' : 'bg-white'}>Gospel</option>
                            <option value="Eclética" className={isDarkMode ? 'bg-[#151619]' : 'bg-white'}>Eclética</option>
                          </select>
                        </div>
                      </div>
                      <div className="pt-4 flex gap-4">
                        <button 
                          type="submit"
                          className="flex-1 py-3 md:py-4 bg-orange-600 rounded-2xl font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-600/20 text-sm md:text-base text-white"
                        >
                          {editingId ? 'Atualizar' : 'Salvar'}
                        </button>
                        {editingId ? (
                          <button 
                            type="button"
                            onClick={() => setStationToDelete(editingId)}
                            className="flex-1 py-3 md:py-4 bg-red-600 rounded-2xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 text-sm md:text-base text-white"
                          >
                            Deletar
                          </button>
                        ) : (
                          <button 
                            type="button"
                            onClick={() => {
                              setIsAdmin(false);
                              setPasswordInput('');
                              setIsModalOpen(false);
                            }}
                            className={`flex-1 py-3 md:py-4 border rounded-2xl font-bold transition-colors text-sm md:text-base ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white' : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-700'}`}
                          >
                            Sair
                          </button>
                        )}
                      </div>
                    </form>
                  </div>

                  <div className={`border-l pl-0 lg:pl-12 transition-colors duration-500 ${isDarkMode ? 'border-white/5' : 'border-gray-200'}`}>
                    <div className="flex justify-between items-center mb-8">
                      <div className="flex items-center gap-3">
                        <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Rádios Salvas</h2>
                        <span className="bg-orange-600/20 text-orange-500 px-2 py-0.5 rounded-full text-xs font-bold">
                          {stations.length}
                        </span>
                      </div>
                      <button onClick={() => setIsModalOpen(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/5 text-white' : 'hover:bg-black/5 text-gray-900'}`}>
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                    
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                      {stations.length === 0 ? (
                        <p className={`text-center py-12 ${isDarkMode ? 'text-white/20' : 'text-gray-400'}`}>Nenhuma rádio salva no banco de dados.</p>
                      ) : (
                        stations.map((station) => (
                          <div 
                            key={station.id}
                            className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${editingId === station.id ? (isDarkMode ? 'bg-orange-600/10 border-orange-600/30' : 'bg-orange-50 border-orange-200') : (isDarkMode ? 'bg-white/5 border-transparent hover:border-white/10' : 'bg-gray-50 border-transparent hover:border-gray-200')}`}
                          >
                            <button 
                              onClick={() => handleEdit(station)}
                              className="flex items-center gap-3 flex-1 text-left"
                            >
                              <img 
                                src={station.imageUrl || (station as any).logo} 
                                alt="" 
                                className={`w-10 h-10 rounded-lg object-cover ${isDarkMode ? 'bg-black/20' : 'bg-gray-200'}`}
                                referrerPolicy="no-referrer"
                              />
                              <div>
                                <h4 className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{station.name}</h4>
                                <p className={`text-[10px] ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>{station.city} • {station.genre}</p>
                              </div>
                            </button>
                            <button 
                              onClick={() => handleDelete(station.id)}
                              className={`p-2 transition-colors opacity-0 group-hover:opacity-100 ${isDarkMode ? 'text-white/20 hover:text-red-500' : 'text-gray-400 hover:text-red-600'}`}
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

      {/* Loading Overlay */}
      <AnimatePresence>
        {isInitialLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-xl transition-colors duration-500 ${isDarkMode ? 'bg-[#0a0502]' : 'bg-white'}`}
          >
            <div className="text-center space-y-8 max-w-xs px-6">
              <div className="relative w-24 h-24 mx-auto">
                <div className={`absolute inset-0 border-4 rounded-full ${isDarkMode ? 'border-orange-500/10' : 'border-orange-500/5'}`} />
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-4 border-t-orange-500 rounded-full"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Radio className="w-8 h-8 text-orange-500 animate-pulse" />
                </div>
              </div>
              
              <div className="space-y-2">
                <h2 className={`text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {loadingError ? "Erro de Conexão" : "Aguarde por Favor"}
                </h2>
                <p className={`${isDarkMode ? 'text-white/40' : 'text-gray-500'} text-sm`}>
                  {loadingError || "Carregando a lista das Rádios"}
                </p>
              </div>

              {loadingError ? (
                <button 
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-orange-500 text-white rounded-full font-bold hover:bg-orange-600 transition-colors"
                >
                  Tentar Novamente
                </button>
              ) : (
                <div className={`w-full h-1 rounded-full overflow-hidden ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.5, ease: "easeInOut" }}
                    className="h-full bg-orange-500 shadow-[0_0_15px_rgba(234,88,12,0.5)]"
                  />
                </div>
              )}
            </div>
          </motion.div>
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
              className={`relative border rounded-3xl p-6 md:p-8 w-full max-w-md text-center transition-colors duration-500 ${isDarkMode ? 'bg-[#151619] border-white/10' : 'bg-white border-gray-200 shadow-2xl'}`}
            >
              <h3 className="text-2xl font-bold text-orange-500 mb-4">Atenção</h3>
              <p className={`mb-8 ${isDarkMode ? 'text-white/80' : 'text-gray-600'}`}>Você deseja deletar essa rádio?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setStationToDelete(null)}
                  className={`flex-1 py-3 rounded-xl font-bold transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                >
                  Não
                </button>
                <button 
                  onClick={executeDelete}
                  className="flex-1 py-3 bg-red-600 rounded-xl font-bold hover:bg-red-700 transition-colors text-white"
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
        ref={audioRef} 
        preload="auto"
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
        onPlay={() => {
          setIsPlaying(true);
          setPlaybackError(null);
          // Sync media session state
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        }}
        onPause={() => {
          setIsPlaying(false);
          // Sync media session state
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
          }
        }}
        onError={handleAudioError}
      />

      {/* Carousel Management Modal */}
      <AnimatePresence>
        {isCarouselModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={resetCarouselForm}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative border rounded-3xl p-6 md:p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto custom-scrollbar transition-colors duration-500 ${isDarkMode ? 'bg-[#151619] border-white/10' : 'bg-white border-gray-200 shadow-2xl'}`}
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {editingCarouselId ? 'Editar Banner' : 'Gerenciar Banners'}
                </h2>
                <button onClick={resetCarouselForm} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-white/5 text-white' : 'hover:bg-black/5 text-gray-900'}`}>
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Form */}
                <form onSubmit={handleCarouselSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-orange-500">URL da Imagem</label>
                      <input 
                        type="url" 
                        required
                        value={carouselFormData.url}
                        onChange={(e) => setCarouselFormData({...carouselFormData, url: e.target.value})}
                        className={`w-full border rounded-xl py-3 px-4 focus:outline-none transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 focus:border-orange-500/50 text-white' : 'bg-gray-50 border-gray-200 focus:border-orange-500/50 text-gray-900'}`}
                        placeholder="https://exemplo.com/imagem.jpg"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-orange-500">Título</label>
                      <input 
                        type="text" 
                        required
                        value={carouselFormData.title}
                        onChange={(e) => setCarouselFormData({...carouselFormData, title: e.target.value})}
                        className={`w-full border rounded-xl py-3 px-4 focus:outline-none transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 focus:border-orange-500/50 text-white' : 'bg-gray-50 border-gray-200 focus:border-orange-500/50 text-gray-900'}`}
                        placeholder="Título do Banner"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-orange-500">Subtítulo</label>
                      <input 
                        type="text" 
                        required
                        value={carouselFormData.subtitle}
                        onChange={(e) => setCarouselFormData({...carouselFormData, subtitle: e.target.value})}
                        className={`w-full border rounded-xl py-3 px-4 focus:outline-none transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 focus:border-orange-500/50 text-white' : 'bg-gray-50 border-gray-200 focus:border-orange-500/50 text-gray-900'}`}
                        placeholder="Subtítulo do Banner"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase tracking-widest text-orange-500">Ordem de Exibição</label>
                      <input 
                        type="number" 
                        value={carouselFormData.order}
                        onChange={(e) => setCarouselFormData({...carouselFormData, order: parseInt(e.target.value) || 0})}
                        className={`w-full border rounded-xl py-3 px-4 focus:outline-none transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 focus:border-orange-500/50 text-white' : 'bg-gray-50 border-gray-200 focus:border-orange-500/50 text-gray-900'}`}
                      />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button 
                      type="submit"
                      className="flex-1 py-4 bg-orange-600 rounded-2xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20 text-white"
                    >
                      {editingCarouselId ? 'Salvar Alterações' : 'Adicionar Banner'}
                    </button>
                    {editingCarouselId && (
                      <button 
                        type="button"
                        onClick={() => {
                          setEditingCarouselId(null);
                          setCarouselFormData({ url: '', title: '', subtitle: '', order: 0 });
                        }}
                        className={`px-6 py-4 border rounded-2xl font-bold transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white' : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-700'}`}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>

                {/* List */}
                <div className="space-y-4">
                  <h3 className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>Banners Atuais</h3>
                  <div className="space-y-3">
                    {carouselItems.map((item) => (
                      <div 
                        key={item.id || item.url} 
                        className={`p-4 rounded-2xl border flex items-center gap-4 transition-colors ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                      >
                        <div className="w-16 h-12 rounded-lg overflow-hidden flex-shrink-0">
                          <img src={item.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-sm font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.title}</h4>
                          <p className={`text-xs truncate ${isDarkMode ? 'text-white/40' : 'text-gray-500'}`}>{item.subtitle}</p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              setEditingCarouselId(item.id);
                              setCarouselFormData({
                                url: item.url,
                                title: item.title,
                                subtitle: item.subtitle,
                                order: item.order || 0
                              });
                            }}
                            className="p-2 rounded-xl bg-orange-600/20 text-orange-500 hover:bg-orange-600 hover:text-white transition-all"
                          >
                            <Maximize2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => item.id && deleteCarouselItem(item.id)}
                            className="p-2 rounded-xl bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Close App Confirmation Modal */}
      <AnimatePresence>
        {isCloseAppModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCloseAppModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative border rounded-3xl p-8 w-full max-w-sm text-center transition-colors duration-500 ${isDarkMode ? 'bg-[#151619] border-white/10' : 'bg-white border-gray-200 shadow-2xl'}`}
            >
              <div className="w-16 h-16 bg-orange-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Info className="w-8 h-8 text-orange-500" />
              </div>
              <h2 className={`text-2xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Atenção</h2>
              <p className={`${isDarkMode ? 'text-white/60' : 'text-gray-500'} mb-8`}>Deseja fechar o aplicativo?</p>
              
              <div className="flex gap-4">
                <button 
                  onClick={() => {
                    // Stop audio immediately
                    if (audioRef.current) {
                      audioRef.current.pause();
                      audioRef.current.src = '';
                    }
                    setIsPlaying(false);

                    // Try multiple methods to close the app depending on the Android wrapper
                    try {
                      // 1. Cordova / PhoneGap
                      if ((navigator as any).app && (navigator as any).app.exitApp) {
                        (navigator as any).app.exitApp();
                      } 
                      // 2. Capacitor
                      else if ((window as any).Capacitor && (window as any).Capacitor.Plugins && (window as any).Capacitor.Plugins.App) {
                        (window as any).Capacitor.Plugins.App.exitApp();
                      }
                      // 3. Custom Android WebView Interfaces
                      else if ((window as any).Android && (window as any).Android.closeApp) {
                        (window as any).Android.closeApp();
                      }
                      else if ((window as any).Android && (window as any).Android.finish) {
                        (window as any).Android.finish();
                      }
                      // 4. React Native WebView
                      else if ((window as any).ReactNativeWebView) {
                        (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'closeApp' }));
                      }
                    } catch (e) {
                      console.error("Error closing app natively:", e);
                    }

                    // 5. Standard Web / PWA Fallback
                    window.close();
                  }}
                  className="flex-1 py-3 bg-orange-600 rounded-xl font-bold hover:bg-orange-700 transition-colors text-white"
                >
                  Sim
                </button>
                <button 
                  onClick={() => setIsCloseAppModalOpen(false)}
                  className={`flex-1 py-3 border rounded-xl font-bold transition-colors ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10 text-white' : 'bg-gray-100 border-gray-200 hover:bg-gray-200 text-gray-700'}`}
                >
                  Não
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
          background: ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'};
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
